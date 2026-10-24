-- Synthetic identities and Storage metadata only; every row rolls back.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('14400000-0000-4000-8000-000000000001','evidence-owner@example.test','{"_invite_provisioned":true}'),
 ('14400000-0000-4000-8000-000000000002','evidence-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE evidence_tenants(kind text PRIMARY KEY,id uuid);
INSERT INTO evidence_tenants VALUES
 ('own',(public.provision_company_atomic('14400000-0000-4000-8000-000000000001','{"name":"Evidence own fixture","slug":"evidence-own-fixture","domain":"evidence-own.example.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('14400000-0000-4000-8000-000000000002','{"name":"Evidence foreign fixture","slug":"evidence-foreign-fixture","domain":"evidence-foreign.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('14400000-0000-4000-8000-000000000001','14400000-0000-4000-8000-000000000002');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date)
 SELECT CASE kind WHEN 'own' THEN '14400000-0000-4000-8000-000000000011'::uuid ELSE '14400000-0000-4000-8000-000000000012'::uuid END,id,'Evidence fixture','0501440001','freelancer','active','2020-01-01' FROM evidence_tenants;
INSERT INTO storage.buckets(id,name,public) VALUES('driver-documents','driver-documents',false),('driver-photos','driver-photos',false) ON CONFLICT(id) DO NOTHING;
CREATE TEMP TABLE evidence_paths(kind text PRIMARY KEY,path text);
INSERT INTO evidence_paths SELECT file,id::text||'/14400000-0000-4000-8000-000000000011/'||file FROM evidence_tenants CROSS JOIN unnest(ARRAY['doc-one.pdf','doc-two.pdf','doc-fault.pdf','photo-one.png','photo-two.png','foreign-owner.pdf']) file WHERE kind='own';
INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata)
 SELECT CASE WHEN kind LIKE 'photo-%' THEN 'driver-photos' ELSE 'driver-documents' END,path,
 CASE WHEN kind='foreign-owner.pdf' THEN '14400000-0000-4000-8000-000000000002'::uuid ELSE '14400000-0000-4000-8000-000000000001'::uuid END,
 CASE WHEN kind='foreign-owner.pdf' THEN '14400000-0000-4000-8000-000000000002' ELSE '14400000-0000-4000-8000-000000000001' END,
 jsonb_build_object('size',100,'mimetype',CASE WHEN kind LIKE 'photo-%' THEN 'image/png' ELSE 'application/pdf' END) FROM evidence_paths;
CREATE TEMP TABLE evidence_results(kind text PRIMARY KEY,result jsonb);
GRANT SELECT ON evidence_tenants,evidence_paths TO authenticated,service_role;GRANT ALL ON evidence_results TO authenticated,service_role;
CREATE FUNCTION pg_temp.evidence_call(action text,input jsonb DEFAULT '{}',id uuid DEFAULT NULL,version integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$SELECT public.mutate_driver_evidence(action,'14400000-0000-4000-8000-000000000011',(SELECT profile_version FROM public.drivers WHERE drivers.id='14400000-0000-4000-8000-000000000011'),input,id,version);$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"14400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14400000-0000-4000-8000-000000000012',1)$$,'P0001','EVIDENCE_NOT_FOUND','foreign driver is not exposed through the owner RPC');
SELECT throws_ok($$SELECT pg_temp.evidence_call('document_register',jsonb_build_object('doc_type','health_certificate','file_path',(SELECT path FROM evidence_paths WHERE kind='foreign-owner.pdf')))$$,'P0001','EVIDENCE_OBJECT_REQUIRED','another uploader object cannot be claimed even within the same driver folder');
SELECT throws_ok($$SELECT pg_temp.evidence_call('document_register','{"doc_type":"health_certificate","file_path":"https://example.test/file.pdf"}')$$,'P0001','EVIDENCE_OBJECT_REQUIRED','external and unbound document paths are rejected');
INSERT INTO evidence_results VALUES('document',pg_temp.evidence_call('document_register',jsonb_build_object('doc_type','health_certificate','file_path',(SELECT path FROM evidence_paths WHERE kind='doc-one.pdf'),'doc_number','PRIVATE-DOC-144','file_size',100,'mime_type','application/pdf')));
SELECT ok((SELECT is_active AND NOT is_verified AND file_size_bytes=100 AND mime_type='application/pdf' FROM public.driver_documents WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='document')),'uploaded document metadata is finalized from the bound Storage object');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('document_verify','14400000-0000-4000-8000-000000000011',1,'{}',(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='document'),1)$$,'P0001','EVIDENCE_STALE','stale reviewed driver version cannot verify a document');
UPDATE evidence_results SET result=pg_temp.evidence_call('document_verify','{}',(result->>'id')::uuid,(result->>'version')::integer) WHERE kind='document';
SELECT ok((SELECT is_verified AND verified_by=auth.uid() AND verified_at IS NOT NULL AND workflow_version=2 FROM public.driver_documents WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='document')),'verification and actor evidence commit with source version');
INSERT INTO evidence_results VALUES('replacement',pg_temp.evidence_call('document_register',jsonb_build_object('doc_type','health_certificate','file_path',(SELECT path FROM evidence_paths WHERE kind='doc-two.pdf'))));
SELECT ok((SELECT NOT is_active AND is_verified AND verified_at IS NOT NULL AND file_url=(SELECT path FROM evidence_paths WHERE kind='doc-one.pdf') FROM public.driver_documents WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='document')),'replacement retains verified predecessor metadata and file binding');
SELECT throws_ok($$SELECT pg_temp.evidence_call('document_verify','{}',(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='document'),3)$$,'P0001','EVIDENCE_NOT_CURRENT','retired evidence cannot be verified after a replacement');
SELECT throws_ok($$UPDATE public.driver_documents SET is_verified=true WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='replacement')$$,'42501',NULL,'direct document mutation cannot bypass caller review');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_evidence_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action IN('document_register','photo_update','card_issue','card_print_requested') THEN RAISE EXCEPTION 'Synthetic evidence audit fault';END IF;RETURN NEW;END;$$;
CREATE TRIGGER fail_evidence_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_evidence_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.evidence_call('document_register',jsonb_build_object('doc_type','health_certificate','file_path',(SELECT path FROM evidence_paths WHERE kind='doc-fault.pdf')))$$,'P0001','Synthetic evidence audit fault','audit failure aborts source replacement and derived computation');
SELECT ok((SELECT is_active AND NOT is_verified AND workflow_version=1 FROM public.driver_documents WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='replacement')),'failed replacement leaves previous active document untouched');
SELECT is((SELECT count(*) FROM public.driver_documents WHERE file_url=(SELECT path FROM evidence_paths WHERE kind='doc-fault.pdf')),0::bigint,'failed audit leaves no newly registered document');
SELECT throws_ok($$SELECT pg_temp.evidence_call('photo_update',jsonb_build_object('file_path',(SELECT path FROM evidence_paths WHERE kind='photo-one.png')))$$,'P0001','Synthetic evidence audit fault','photo audit failure aborts the profile pointer');
SELECT is((SELECT photo_url FROM public.drivers WHERE id='14400000-0000-4000-8000-000000000011'),NULL::text,'photo audit failure leaves persisted profile unchanged');
SELECT throws_ok($$SELECT pg_temp.evidence_call('card_issue')$$,'P0001','Synthetic evidence audit fault','card issue audit failure rolls source and derived card status back');
SELECT is((SELECT count(*) FROM public.driver_cards WHERE driver_id='14400000-0000-4000-8000-000000000011'),0::bigint,'failed card issue leaves no active card');
RESET ROLE;
SELECT is((SELECT count(*) FROM driver_operations_private.photo_records WHERE driver_id='14400000-0000-4000-8000-000000000011'),0::bigint,'photo audit failure rolls private photo evidence back');
DROP TRIGGER fail_evidence_audit ON public.audit_log;
SET LOCAL ROLE authenticated;
INSERT INTO evidence_results VALUES('photo',pg_temp.evidence_call('photo_update',jsonb_build_object('file_path',(SELECT path FROM evidence_paths WHERE kind='photo-one.png'),'file_size',100,'mime_type','image/png')));
SELECT is((SELECT photo_url FROM public.drivers WHERE id='14400000-0000-4000-8000-000000000011'),(SELECT path FROM evidence_paths WHERE kind='photo-one.png'),'photo finalization succeeds without restoring generic driver UPDATE grants');
UPDATE evidence_results SET result=pg_temp.evidence_call('photo_remove') WHERE kind='photo';
SELECT is((SELECT photo_url FROM public.drivers WHERE id='14400000-0000-4000-8000-000000000011'),NULL::text,'photo removal atomically clears the current pointer');
RESET ROLE;
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='driver-photos' AND name=(SELECT path FROM evidence_paths WHERE kind='photo-one.png')),1::bigint,'photo removal retains the uploaded object');
SELECT ok((SELECT retired_at IS NOT NULL AND retired_by='14400000-0000-4000-8000-000000000001' FROM driver_operations_private.photo_records WHERE driver_id='14400000-0000-4000-8000-000000000011'),'photo history records controlled retirement without deleting bytes');
SET LOCAL ROLE authenticated;
INSERT INTO evidence_results VALUES('card',pg_temp.evidence_call('card_issue'));
SELECT is((SELECT card_status::text FROM public.drivers WHERE id='14400000-0000-4000-8000-000000000011'),'active','card issue atomically synchronizes derived driver card status');
SELECT throws_ok($$SELECT pg_temp.evidence_call('card_issue')$$,'P0001','EVIDENCE_ALREADY_CURRENT','driver lock prevents duplicate current card issuance');
SELECT throws_ok($$SELECT pg_temp.evidence_call('card_print','{"format":"pvc"}',(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card'),99)$$,'P0001','EVIDENCE_STALE','print uses the reviewed card source version');
RESET ROLE;
CREATE TRIGGER fail_evidence_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_evidence_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.evidence_call('card_print','{"format":"pvc"}',(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card'),1)$$,'P0001','Synthetic evidence audit fault','print audit failure rolls request and count back');
SELECT is((SELECT reprint_count FROM public.driver_cards WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card')),0,'failed print request does not increment its counter');
SELECT is((SELECT count(*) FROM public.driver_card_prints WHERE card_id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card')),0::bigint,'failed print audit leaves no print request');
RESET ROLE;DROP TRIGGER fail_evidence_audit ON public.audit_log;
SET LOCAL ROLE authenticated;
UPDATE evidence_results SET result=pg_temp.evidence_call('card_print','{"format":"pvc"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE kind='card';
SELECT is((SELECT reprint_count FROM public.driver_cards WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card')),1,'one successful print request records one counter increment');
UPDATE evidence_results SET result=pg_temp.evidence_call('card_revoke','{"reason":"Synthetic lost card review"}',(result->>'id')::uuid,(result->>'version')::integer) WHERE kind='card';
SELECT ok((SELECT status='revoked' AND revoke_reason='Synthetic lost card review' AND revoked_at IS NOT NULL FROM public.driver_cards WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card')),'reviewed card revocation retains final actor evidence');
SELECT is((SELECT card_status::text FROM public.drivers WHERE id='14400000-0000-4000-8000-000000000011'),'revoked','revocation synchronizes the derived card status in the same transaction');
SELECT throws_ok($$SELECT pg_temp.evidence_call('card_print','{"format":"pvc"}',(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card'),3)$$,'P0001','EVIDENCE_NOT_CURRENT','revoked card cannot be printed');
INSERT INTO evidence_results VALUES('override',pg_temp.evidence_call('override_create','{"requirement":"identity","reason":"PRIVATE-OVERRIDE-REASON-144","days":7}'));
SELECT throws_ok($$SELECT pg_temp.evidence_call('override_create','{"requirement":"identity","reason":"Duplicate override fixture","days":7}')$$,'P0001','EVIDENCE_ALREADY_CURRENT','an existing current override cannot be duplicated');
UPDATE evidence_results SET result=pg_temp.evidence_call('override_revoke','{}',(result->>'id')::uuid,(result->>'version')::integer) WHERE kind='override';
SELECT ok((SELECT revoked_at IS NOT NULL AND updated_by=auth.uid() AND reason='PRIVATE-OVERRIDE-REASON-144' FROM public.driver_compliance_overrides WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='override')),'override revocation retains approved source and current actor');
SELECT throws_ok($$SELECT pg_temp.evidence_call('override_revoke','{}',(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='override'),2)$$,'P0001','EVIDENCE_NOT_CURRENT','revoked override cannot be reviewed again');
UPDATE evidence_results SET result=pg_temp.evidence_call('document_remove','{}',(result->>'id')::uuid,(result->>'version')::integer) WHERE kind='replacement';
SELECT is((SELECT count(*) FROM public.driver_documents WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='replacement')),0::bigint,'retired document is hidden from active client reads');
RESET ROLE;
SELECT ok((SELECT NOT is_active AND deleted_at IS NOT NULL AND file_url=(SELECT path FROM evidence_paths WHERE kind='doc-two.pdf') FROM public.driver_documents WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='replacement')),'document removal preserves metadata while retiring its current state');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"14400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14400000-0000-4000-8000-000000000011',1)$$,'42501','EVIDENCE_FORBIDDEN','MFA is enforced before driver existence or state is exposed');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_log WHERE tenant_id=(SELECT id FROM evidence_tenants WHERE kind='own') AND (coalesce(new_values::text,'')||coalesce(old_values::text,'')) LIKE ANY(ARRAY['%PRIVATE-DOC-144%','%PRIVATE-OVERRIDE-REASON-144%','%doc-one.pdf%','%photo-one.png%'])),'evidence audit contains flags and versions without source PII or object paths');
SELECT throws_ok($$UPDATE public.driver_cards SET revoke_reason='Rewrite final review' WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card')$$,'P0001','EVIDENCE_HISTORY_IMMUTABLE','trusted direct write cannot rewrite final card history');
SELECT throws_ok($$UPDATE public.driver_documents SET doc_number='Rewrite old document' WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='document')$$,'P0001','EVIDENCE_HISTORY_IMMUTABLE','retired verified document metadata remains immutable');
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE public.driver_cards SET status='active' WHERE id=(SELECT (result->>'id')::uuid FROM evidence_results WHERE kind='card')$$,'42501',NULL,'BYPASSRLS service DML cannot replace the caller workflow');
SELECT throws_ok($$SELECT public.mutate_driver_evidence('card_issue','14400000-0000-4000-8000-000000000011',1)$$,'42501',NULL,'service role cannot impersonate a caller mutation');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.mutate_driver_evidence('recompute','14400000-0000-4000-8000-000000000011',1)$$,'42501',NULL,'anonymous evidence mutation is denied');
RESET ROLE;
SELECT * FROM finish();ROLLBACK;
