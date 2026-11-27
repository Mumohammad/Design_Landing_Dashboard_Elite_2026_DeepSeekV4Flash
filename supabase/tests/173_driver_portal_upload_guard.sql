-- Synthetic-only rollback proof: quotas, stale preflight races, replay and scope.
-- These transaction tests exercise stale preflight outcomes; they do not claim
-- multi-session concurrency evidence.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
('17300000-0000-4000-8000-000000000001','portal-guard-own@example.test','{"_invite_provisioned":true}'),
('17300000-0000-4000-8000-000000000002','portal-guard-other@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE portal_guard_tenants(kind text PRIMARY KEY,tenant_id uuid);
INSERT INTO portal_guard_tenants VALUES
('own',(public.provision_company_atomic('17300000-0000-4000-8000-000000000001','{"name":"Portal guard own","domain":"portal-guard-own.example.test","slug":"portal-guard-own"}')->>'id')::uuid),
('other',(public.provision_company_atomic('17300000-0000-4000-8000-000000000002','{"name":"Portal guard other","domain":"portal-guard-other.example.test","slug":"portal-guard-other"}')->>'id')::uuid);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('17300000-0000-4000-8000-000000000001','17300000-0000-4000-8000-000000000002');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status)
SELECT x.id,tenant_id,x.name,x.mobile,'freelancer','active' FROM portal_guard_tenants CROSS JOIN (VALUES
('17300000-0000-4000-8000-000000000011'::uuid,'Portal guard driver','0501730001'),
('17300000-0000-4000-8000-000000000012'::uuid,'Portal quota driver','0501730002'))x(id,name,mobile) WHERE kind='own';
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status)
SELECT '17300000-0000-4000-8000-000000000013',tenant_id,'Foreign driver','0501730003','freelancer','active' FROM portal_guard_tenants WHERE kind='other';
CREATE TEMP TABLE portal_guard_results(kind text PRIMARY KEY,result jsonb);
GRANT ALL ON portal_guard_tenants,portal_guard_results TO authenticated,service_role;

SELECT ok(NOT has_function_privilege('anon','public.reserve_driver_portal_upload(text,text,integer,text)','EXECUTE'),'anon cannot reserve via RPC');
SELECT ok(NOT has_function_privilege('authenticated','public.reserve_driver_portal_upload(text,text,integer,text)','EXECUTE'),'staff cannot reserve via service RPC');
SELECT ok(NOT has_function_privilege('anon','public.activate_driver_portal_upload(text,text)','EXECUTE'),'anon cannot activate via RPC');
SELECT ok(NOT has_function_privilege('authenticated','public.complete_driver_portal_upload(text,text,text,text,date,text)','EXECUTE'),'staff cannot complete via service RPC');
SELECT ok(has_function_privilege('service_role','public.complete_driver_portal_upload(text,text,text,text,date,text)','EXECUTE'),'service can invoke bounded completion');
SELECT ok(NOT has_schema_privilege('authenticated','driver_portal_private','USAGE'),'reservation schema is private');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17300000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO portal_guard_results VALUES('link',public.issue_driver_portal_link('17300000-0000-4000-8000-000000000011',repeat('a',64),7));
INSERT INTO portal_guard_results VALUES('quota_link',public.issue_driver_portal_link('17300000-0000-4000-8000-000000000012',repeat('b',64),7));
SELECT throws_like($$SELECT public.issue_driver_portal_link('17300000-0000-4000-8000-000000000013',repeat('f',64),7)$$,'%DPA001%','foreign driver cannot receive own link');

RESET ROLE;
CREATE FUNCTION pg_temp.reserve_portal173(label text,token_hash text DEFAULT repeat('a',64)) RETURNS void LANGUAGE sql AS $$
 INSERT INTO portal_guard_results VALUES(label,public.reserve_driver_portal_upload(token_hash,'iqama',6,'application/pdf'));
$$;
CREATE FUNCTION pg_temp.finish_portal173(label text,number text DEFAULT 'DOC-1',note text DEFAULT NULL,token_hash text DEFAULT repeat('a',64)) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.complete_driver_portal_upload(token_hash,result->>'path','iqama',number,NULL,note) FROM portal_guard_results WHERE kind=label;
$$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_like($$SELECT public.reserve_driver_portal_upload(repeat('a',64),'photo',6,'application/pdf')$$,'%DPU004%','unsupported document type cannot reserve');
SELECT throws_like($$SELECT public.reserve_driver_portal_upload(repeat('a',64),'iqama',10485761,'application/pdf')$$,'%DPU004%','oversize input cannot reserve');
SELECT pg_temp.reserve_portal173('first');
SELECT is((SELECT count(*)::int FROM driver_portal_private.upload_reservations WHERE driver_id='17300000-0000-4000-8000-000000000011'),1,'a capability consumes a server reservation before signing');
SELECT throws_like($$SELECT pg_temp.finish_portal173('first')$$,'%DPU004%','unactivated capability cannot complete');
SELECT lives_ok($$SELECT public.activate_driver_portal_upload(repeat('a',64),result->>'path') FROM portal_guard_results WHERE kind='first'$$,'signed capability can be activated');
SELECT ok((SELECT expires_at>clock_timestamp()+interval '2 hours' FROM driver_portal_private.upload_reservations WHERE id=(SELECT (result->>'id')::uuid FROM portal_guard_results WHERE kind='first')),'issued quota remains held for the full Storage JWT lifetime');
SELECT throws_like($$SELECT pg_temp.finish_portal173('first')$$,'%DPU005%','missing Storage object cannot complete');

RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT 'driver-portal-uploads',result->>'path','{"size":7,"mimetype":"application/pdf"}' FROM portal_guard_results WHERE kind='first';
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.finish_portal173('first')$$,'%DPU005%','actual Storage size must equal the reservation');
RESET ROLE;
UPDATE storage.objects SET metadata='{"size":6,"mimetype":"image/png"}' WHERE name=(SELECT result->>'path' FROM portal_guard_results WHERE kind='first');
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.finish_portal173('first')$$,'%DPU005%','actual Storage MIME must equal the reservation');
RESET ROLE;
UPDATE storage.objects SET metadata='{"size":6,"mimetype":"application/pdf"}' WHERE name=(SELECT result->>'path' FROM portal_guard_results WHERE kind='first');
SET LOCAL ROLE service_role;
INSERT INTO portal_guard_results VALUES('completed',pg_temp.finish_portal173('first'));
INSERT INTO portal_guard_results VALUES('replayed',pg_temp.finish_portal173('first'));
SELECT is((SELECT result->>'id' FROM portal_guard_results WHERE kind='completed'),(SELECT result->>'id' FROM portal_guard_results WHERE kind='replayed'),'lost-response replay returns the same submission');
SELECT is((SELECT result->>'replayed' FROM portal_guard_results WHERE kind='replayed'),'true','repeat finish is recognized');
SELECT is((SELECT count(*)::int FROM public.driver_portal_submissions WHERE file_path=(SELECT result->>'path' FROM portal_guard_results WHERE kind='first')),1,'repeat finish creates exactly one submission');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id=(SELECT (result->>'id')::uuid FROM portal_guard_results WHERE kind='completed') AND action='portal_submission_created'),1,'repeat finish creates exactly one audit');
SELECT throws_like($$SELECT pg_temp.finish_portal173('first','changed')$$,'%DPU006%','replay with changed document number is rejected');
SELECT throws_like($$SELECT pg_temp.finish_portal173('first','DOC-1','changed')$$,'%DPU006%','replay with changed note is rejected');

-- A Storage preflight can become stale: completion rechecks the live link.
SELECT pg_temp.reserve_portal173('revocation');
SELECT public.activate_driver_portal_upload(repeat('a',64),result->>'path') FROM portal_guard_results WHERE kind='revocation';
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT 'driver-portal-uploads',result->>'path','{"size":6,"mimetype":"application/pdf"}' FROM portal_guard_results WHERE kind='revocation';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17300000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(public.revoke_driver_portal_links('17300000-0000-4000-8000-000000000011'),1,'staff can revoke the live link');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_like($$SELECT pg_temp.finish_portal173('revocation')$$,'%DPU001%','revocation between Storage check and finish prevents submission');
SELECT throws_like($$SELECT public.activate_driver_portal_upload(repeat('a',64),result->>'path') FROM portal_guard_results WHERE kind='revocation'$$,'%DPU001%','revocation between mint and activation prevents capability exposure');
SELECT is((SELECT count(*)::int FROM driver_portal_private.upload_reservations WHERE id=(SELECT (result->>'id')::uuid FROM portal_guard_results WHERE kind='revocation') AND status='issued' AND expires_at>clock_timestamp()),1,'revocation retains the outstanding Storage capability quota');

RESET ROLE;
-- Active driver quotas are serialized across all links, including uncertain
-- signing attempts. Expiring a slot never erases its rolling daily charge.
SET LOCAL ROLE service_role;
SELECT pg_temp.reserve_portal173('quota-'||g,repeat('b',64)) FROM generate_series(1,10)g;
SELECT throws_like($$SELECT public.reserve_driver_portal_upload(repeat('b',64),'iqama',6,'application/pdf')$$,'%DPU002%','ten uncompleted reservations exhaust pending capacity');
UPDATE driver_portal_private.upload_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE driver_id='17300000-0000-4000-8000-000000000012';
SELECT pg_temp.reserve_portal173('quota-'||g,repeat('b',64)) FROM generate_series(11,20)g;
UPDATE driver_portal_private.upload_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE driver_id='17300000-0000-4000-8000-000000000012';
SELECT throws_like($$SELECT public.reserve_driver_portal_upload(repeat('b',64),'iqama',6,'application/pdf')$$,'%DPU003%','twenty uncertain attempts exhaust the rolling daily quota');
SELECT throws_like($$SELECT public.activate_driver_portal_upload(repeat('b',64),result->>'path') FROM portal_guard_results WHERE kind='quota-1'$$,'%DPU004%','expired signing reservation cannot activate');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17300000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO portal_guard_results VALUES('quota_rotate',public.issue_driver_portal_link('17300000-0000-4000-8000-000000000012',repeat('c',64),7));
SELECT is((SELECT count(*)::int FROM public.driver_portal_links WHERE driver_id='17300000-0000-4000-8000-000000000012' AND revoked_at IS NULL),1,'rotation leaves one current link');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_like($$SELECT public.reserve_driver_portal_upload(repeat('c',64),'iqama',6,'application/pdf')$$,'%DPU003%','link rotation cannot reset the per-driver daily quota');

-- Prepare a live upload for current-scope and audit rollback tests.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17300000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO portal_guard_results VALUES('current_link',public.issue_driver_portal_link('17300000-0000-4000-8000-000000000011',repeat('d',64),7));
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.reserve_portal173('scope',repeat('d',64));
SELECT public.activate_driver_portal_upload(repeat('d',64),result->>'path') FROM portal_guard_results WHERE kind='scope';
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT 'driver-portal-uploads',result->>'path','{"size":6,"mimetype":"application/pdf"}' FROM portal_guard_results WHERE kind='scope';
UPDATE public.tenants SET status='suspended' WHERE id=(SELECT tenant_id FROM portal_guard_tenants WHERE kind='own');
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT public.reserve_driver_portal_upload(repeat('d',64),'iqama',6,'application/pdf')$$,'%DPU001%','suspended tenant cannot reserve');
SELECT throws_like($$SELECT pg_temp.finish_portal173('scope','DOC-1',NULL,repeat('d',64))$$,'%DPU001%','tenant suspension after Storage check prevents completion');
RESET ROLE;
UPDATE public.tenants SET status='active',deleted_at=clock_timestamp() WHERE id=(SELECT tenant_id FROM portal_guard_tenants WHERE kind='own');
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.finish_portal173('scope','DOC-1',NULL,repeat('d',64))$$,'%DPU001%','deleted tenant cannot complete');
RESET ROLE;
UPDATE public.tenants SET deleted_at=NULL WHERE id=(SELECT tenant_id FROM portal_guard_tenants WHERE kind='own');
UPDATE public.drivers SET status='suspended' WHERE id='17300000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.finish_portal173('scope','DOC-1',NULL,repeat('d',64))$$,'%DPU001%','inactive driver cannot complete');
RESET ROLE;
UPDATE public.drivers SET status='active',tenant_id=(SELECT tenant_id FROM portal_guard_tenants WHERE kind='other') WHERE id='17300000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.finish_portal173('scope','DOC-1',NULL,repeat('d',64))$$,'%DPU001%','a moved driver cannot use the old tenant link');
RESET ROLE;
UPDATE public.drivers SET tenant_id=(SELECT tenant_id FROM portal_guard_tenants WHERE kind='own') WHERE id='17300000-0000-4000-8000-000000000011';
UPDATE public.driver_portal_links SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=repeat('d',64);
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.finish_portal173('scope','DOC-1',NULL,repeat('d',64))$$,'%DPU001%','expired bearer cannot complete an otherwise valid reservation');
RESET ROLE;
UPDATE public.driver_portal_links SET expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=repeat('d',64);
CREATE FUNCTION pg_temp.reject_portal173_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='portal_submission_created' THEN RAISE EXCEPTION 'Synthetic portal audit failure'; END IF; RETURN NEW; END;$$;
CREATE TRIGGER reject_portal173_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_portal173_audit();
SET LOCAL ROLE service_role;
SELECT throws_like($$SELECT pg_temp.finish_portal173('scope','DOC-1',NULL,repeat('d',64))$$,'%Synthetic portal audit failure%','failed audit aborts all completion writes');
SELECT is((SELECT count(*)::int FROM public.driver_portal_submissions WHERE file_path=(SELECT result->>'path' FROM portal_guard_results WHERE kind='scope')),0,'audit failure leaves no partial submission');
SELECT is((SELECT status FROM driver_portal_private.upload_reservations WHERE id=(SELECT (result->>'id')::uuid FROM portal_guard_results WHERE kind='scope')),'issued','audit failure leaves the issued reservation retryable');
RESET ROLE;
DROP TRIGGER reject_portal173_audit ON public.audit_log;
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT pg_temp.finish_portal173('scope','DOC-1',NULL,repeat('d',64))$$,'retry after rolled-back audit completes once');
RESET ROLE;
SELECT throws_like($$INSERT INTO public.driver_portal_submissions(tenant_id,driver_id,link_id,doc_type,file_path,mime_type,file_size) SELECT tenant_id,driver_id,link_id,doc_type,file_path,mime_type,file_size FROM public.driver_portal_submissions WHERE file_path=(SELECT result->>'path' FROM portal_guard_results WHERE kind='scope')$$,'%uq_driver_portal_submission_path%','database uniqueness independently rejects duplicate file paths');
SELECT * FROM finish();
ROLLBACK;
