BEGIN;
SET LOCAL search_path = extensions, public, pg_temp;
SELECT no_plan();

INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
  ('17600000-0000-4000-8000-000000000001','export-owner@example.test','{"_invite_provisioned":true}'),
  ('17600000-0000-4000-8000-000000000002','export-foreign@example.test','{"_invite_provisioned":true}'),
  ('17600000-0000-4000-8000-000000000003','export-scoped@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE export_tenants AS
SELECT 'own' AS label, (public.provision_company_atomic(
  '17600000-0000-4000-8000-000000000001','{"name":"Export fixture","domain":"export176.test","slug":"export176"}')->>'id')::uuid AS id
UNION ALL SELECT 'foreign', (public.provision_company_atomic(
  '17600000-0000-4000-8000-000000000002','{"name":"Export foreign","domain":"foreign176.test","slug":"foreign176"}')->>'id')::uuid;
UPDATE public.users SET must_change_password = false WHERE auth_user_id IN (
  '17600000-0000-4000-8000-000000000001','17600000-0000-4000-8000-000000000002');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
  SELECT '17600000-0000-4000-8000-000000000003', id, 'export-scoped@example.test', 'accountant', 'active', false
  FROM export_tenants WHERE label = 'own';
DELETE FROM public.role_permissions rp USING public.roles r, public.permissions p
  WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.tenant_id = (SELECT id FROM export_tenants WHERE label='own')
    AND r.name = 'accountant' AND p.module = 'expense_claims' AND p.action IN ('read','approve');

INSERT INTO public.expense_claims (id,tenant_id,claim_no,submitter_id,status)
  SELECT '17600000-0000-4000-8000-000000000010'::uuid,id,'EXP-OWN','17600000-0000-4000-8000-000000000001'::uuid,'approved' FROM export_tenants WHERE label='own'
  UNION ALL SELECT '17600000-0000-4000-8000-000000000011'::uuid,id,'EXP-SCOPED','17600000-0000-4000-8000-000000000003'::uuid,'submitted' FROM export_tenants WHERE label='own'
  UNION ALL SELECT '17600000-0000-4000-8000-000000000012'::uuid,id,'EXP-FOREIGN','17600000-0000-4000-8000-000000000002'::uuid,'approved' FROM export_tenants WHERE label='foreign';
INSERT INTO public.expense_claim_attachments(id,tenant_id,claim_id,storage_path,original_filename,mime_type,size_bytes,sha256,doc_kind,uploaded_by)
  SELECT '17600000-0000-4000-8000-000000000020', tenant_id,id,'export176/receipt.pdf','receipt.pdf','application/pdf',100,
    repeat('0',64),'digital_pdf',submitter_id FROM public.expense_claims WHERE claim_no='EXP-OWN';

-- Capture exactly what the preparation read. Tests also exercise equal-count
-- replacements and edits that intentionally leave the existing workflow version alone.
CREATE TEMP TABLE export_input AS SELECT
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM (SELECT id,version,export_revision FROM public.expense_claims
    WHERE id IN ('17600000-0000-4000-8000-000000000010','17600000-0000-4000-8000-000000000011')) s) AS claims,
  (SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT id,claim_id,export_revision FROM public.expense_claim_attachments
    WHERE id = '17600000-0000-4000-8000-000000000020') s) AS evidence,
  (SELECT jsonb_build_object('id',id,'version',version,'export_revision',export_revision)
   FROM public.expense_claims WHERE id='17600000-0000-4000-8000-000000000012') AS foreign_claim,
  clock_timestamp() AS prepared_at;
GRANT SELECT ON export_input TO authenticated;

CREATE TEMP TABLE export_snapshot_input AS
  SELECT scope, count(*)::integer AS rows,
    encode(sha256(convert_to(string_agg(id::text || export_revision::text, '' ORDER BY id), 'UTF8')), 'hex') AS digest
  FROM (
    SELECT 'tenant' AS scope, id, export_revision FROM public.expense_claims WHERE claim_no IN ('EXP-OWN', 'EXP-SCOPED')
    UNION ALL
    SELECT 'own', id, export_revision FROM public.expense_claims WHERE claim_no = 'EXP-SCOPED'
  ) AS claims GROUP BY scope;
GRANT SELECT ON export_snapshot_input TO authenticated;

CREATE FUNCTION pg_temp.try_export(claims jsonb, evidence jsonb,
  request_id uuid DEFAULT '17600000-0000-4000-8000-000000000099', mark boolean DEFAULT true,
  digest text DEFAULT repeat('a',64)) RETURNS integer LANGUAGE sql AS $$
  SELECT public.expense_claims_commit_export(request_id,prepared_at,mark,$1,$2,digest) FROM export_input;
$$;

SELECT ok(NOT has_function_privilege('authenticated','public.expense_claims_record_export(uuid[],boolean,jsonb)','EXECUTE'),
  'clients cannot use the old unversioned mutation');
SELECT ok(NOT has_function_privilege('anon','public.expense_claims_commit_export(uuid,timestamptz,boolean,jsonb,jsonb,text)','EXECUTE'),
  'anonymous users cannot register exports');
SELECT ok(NOT has_function_privilege('anon','public.expense_claims_verify_export_snapshot(integer,text)','EXECUTE'),
  'anonymous users cannot verify export snapshots');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17600000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT ok((SELECT public.expense_claims_verify_export_snapshot(rows,digest) FROM export_snapshot_input WHERE scope='tenant'),
  'snapshot matches the whole visible tenant and excludes foreign claims');
SELECT ok(NOT public.expense_claims_verify_export_snapshot(2,repeat('a',64)),
  'the visible count alone cannot match independently paginated claims');
SELECT throws_like($$SELECT pg_temp.try_export(claims || jsonb_build_array(foreign_claim), evidence) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'mixed cross-tenant selection fails in full');
SELECT throws_like($$SELECT pg_temp.try_export(claims || jsonb_build_array(claims->0), evidence) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'duplicate claim IDs fail in full');
SELECT throws_like($$SELECT pg_temp.try_export(jsonb_set(claims, '{1,version}', '100'), evidence) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'one stale workflow version invalidates the batch');
SELECT throws_like($$SELECT pg_temp.try_export(claims, '[]') FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'newly present attachment cannot be omitted');
SELECT throws_like($$SELECT pg_temp.try_export(claims, jsonb_set(evidence,'{0,id}','"17600000-0000-4000-8000-000000000021"')) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'wrong receipt with the same count rejected');
SELECT throws_like($$SELECT pg_temp.try_export(claims, evidence || evidence) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'duplicate receipt cannot satisfy the exact set');
SELECT throws_like($$SELECT pg_temp.try_export(claims, evidence, digest => 'bad') FROM export_input$$,
  '%EXC001%', 'invalid workbook digest rejected');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17600000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT ok((SELECT public.expense_claims_verify_export_snapshot(rows,digest) FROM export_snapshot_input WHERE scope='own'),
  'own-read visibility is preserved when verifying a snapshot');
SELECT ok(NOT (SELECT public.expense_claims_verify_export_snapshot(rows,digest) FROM export_snapshot_input WHERE scope='tenant'),
  'own-read cannot verify a different actor claim set');
SELECT throws_like($$SELECT pg_temp.try_export(claims, evidence) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'export plus own-read cannot access a colleague claim');
SELECT is((SELECT pg_temp.try_export(jsonb_build_array(claims->1),'[]','17600000-0000-4000-8000-000000000088',false) FROM export_input),
  0,'own-readable claim can be exported without marking');
RESET ROLE;
SELECT is((SELECT count(*) FROM expense_claims_private.export_receipts WHERE request_id='17600000-0000-4000-8000-000000000099'),
  0::bigint, 'failed batches leave no receipt');
SELECT is((SELECT count(*) FROM public.expense_claim_events WHERE claim_id='17600000-0000-4000-8000-000000000010'),
  0::bigint, 'failed batches leave no claim history');
SELECT is((SELECT status FROM public.expense_claims WHERE id='17600000-0000-4000-8000-000000000010'),'approved','failed batch leaves approved status intact');

UPDATE public.expense_claim_attachments SET original_filename='changed.pdf' WHERE id='17600000-0000-4000-8000-000000000020';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17600000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_like($$SELECT pg_temp.try_export(claims, evidence) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'same receipt ID with changed workbook metadata rejected');
RESET ROLE;
UPDATE export_input SET evidence=(SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT id,claim_id,export_revision
  FROM public.expense_claim_attachments WHERE id='17600000-0000-4000-8000-000000000020') s);
UPDATE public.expense_claims SET duplicate_status='possible' WHERE id='17600000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
SELECT ok(NOT (SELECT public.expense_claims_verify_export_snapshot(rows,digest) FROM export_snapshot_input WHERE scope='tenant'),
  'a claim changed after pagination invalidates the prior snapshot at the same count');
SELECT throws_like($$SELECT pg_temp.try_export(claims, evidence) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'duplicate refresh invalidates export even without a workflow version increment');
RESET ROLE;
UPDATE export_input SET claims=jsonb_set(claims,'{0,export_revision}',(
  SELECT to_jsonb(export_revision) FROM public.expense_claims WHERE id='17600000-0000-4000-8000-000000000010'));
-- Force the last public write to fail after claim and history changes.
CREATE FUNCTION pg_temp.reject_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'synthetic audit failure';
END;
$$;
CREATE TRIGGER test_export_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW
  WHEN (NEW.request_id = '17600000-0000-4000-8000-000000000077')
  EXECUTE FUNCTION pg_temp.reject_export_audit();
SET LOCAL ROLE authenticated;
SELECT throws_like($$SELECT pg_temp.try_export(claims,evidence,'17600000-0000-4000-8000-000000000077') FROM export_input$$,
  '%synthetic audit failure%', 'failure writing audit fails the whole export');
RESET ROLE;
SELECT ok((SELECT status = 'approved' AND exported_at IS NULL FROM public.expense_claims WHERE id='17600000-0000-4000-8000-000000000010')
  AND NOT EXISTS (SELECT 1 FROM public.expense_claim_events WHERE claim_id='17600000-0000-4000-8000-000000000010')
  AND NOT EXISTS (SELECT 1 FROM expense_claims_private.export_receipts WHERE request_id='17600000-0000-4000-8000-000000000077'),
  'late failure rolls back status, events and receipt together');
SET LOCAL ROLE authenticated;
SELECT is((SELECT pg_temp.try_export(claims,evidence) FROM export_input),1,'only approved selected claim marked');
SELECT is((SELECT pg_temp.try_export(claims,evidence) FROM export_input),1,'identical replay returns original transition count');
SELECT throws_like($$SELECT pg_temp.try_export(claims,evidence,digest => repeat('b',64)) FROM export_input$$,
  '%EXC_EXPORT_CONFLICT%', 'same request cannot attest a different workbook');
RESET ROLE;
SELECT is((SELECT exported_at FROM public.expense_claims WHERE id='17600000-0000-4000-8000-000000000010'),
  (SELECT prepared_at FROM export_input),'marked claim uses workbook timestamp');
SELECT is((SELECT count(*) FROM public.expense_claim_events WHERE action='exported' AND actor_id='17600000-0000-4000-8000-000000000001'
  AND created_at=(SELECT prepared_at FROM export_input)),2::bigint,'one correctly dated event per selected claim, including replay');
SELECT is((SELECT count(*) FROM public.audit_log WHERE request_id='17600000-0000-4000-8000-000000000099'
  AND new_values->>'workbook_sha256'=repeat('a',64) AND new_values->>'rows'='2' AND new_values->>'marked_exported'='1'
  AND NOT new_values ? 'filters'),1::bigint,'single audit identifies the workbook and exact counts without search text');
SELECT is((SELECT status FROM public.expense_claims WHERE id='17600000-0000-4000-8000-000000000011'),'submitted','unapproved row retains its status');

DELETE FROM public.role_permissions rp USING public.roles r, public.permissions p
  WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.tenant_id=(SELECT id FROM export_tenants WHERE label='own')
    AND r.name='accountant' AND p.module='expense_claims' AND p.action='export';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17600000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT throws_like($$SELECT public.expense_claims_verify_export_snapshot(rows,digest) FROM export_snapshot_input WHERE scope='own'$$,
  '%AUTH007%', 'revoked export permission blocks snapshot verification');
SELECT throws_like($$SELECT pg_temp.try_export(jsonb_build_array(claims->1),'[]','17600000-0000-4000-8000-000000000088',false) FROM export_input$$,
  '%AUTH007%', 'revoked export permission blocks even an exact own-claim replay');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
