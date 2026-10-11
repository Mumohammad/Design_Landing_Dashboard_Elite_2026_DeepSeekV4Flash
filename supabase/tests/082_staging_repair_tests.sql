BEGIN;
SELECT plan(24);
SELECT has_column('public','platform_admins','note','Older admin table gains the nullable note column');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.zatca_csids'::regclass),'Credential RLS remains enabled');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='zatca_csids'
  AND policyname='zatca_csids_tenant_isolation'),'Historical credential CRUD policy removed');
SELECT ok(NOT has_table_privilege('anon','public.zatca_csids','SELECT'),'Anon SELECT revoked');
SELECT ok(NOT has_table_privilege('anon','public.zatca_csids','INSERT'),'Anon INSERT revoked');
SELECT ok(NOT has_table_privilege('anon','public.zatca_csids','UPDATE'),'Anon UPDATE revoked');
SELECT ok(NOT has_table_privilege('anon','public.zatca_csids','DELETE'),'Anon DELETE revoked');
SELECT ok(NOT has_table_privilege('authenticated','public.zatca_csids','SELECT'),'Authenticated SELECT revoked');
SELECT ok(NOT has_table_privilege('authenticated','public.zatca_csids','INSERT'),'Authenticated INSERT revoked');
SELECT ok(NOT has_table_privilege('authenticated','public.zatca_csids','UPDATE'),'Authenticated UPDATE revoked');
SELECT ok(NOT has_table_privilege('authenticated','public.zatca_csids','DELETE'),'Authenticated DELETE revoked');
SELECT ok(NOT has_any_column_privilege('anon','public.zatca_csids','SELECT,INSERT,UPDATE,REFERENCES'),'No anon column-grant bypass');
SELECT ok(NOT has_any_column_privilege('authenticated','public.zatca_csids','SELECT,INSERT,UPDATE,REFERENCES'),'No authenticated column-grant bypass');
INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES
 ('83111111-1111-4111-8111-111111111111','Credential test','Credential test','stage-repair-82');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT secret FROM public.zatca_csids$$,'42501','permission denied for table zatca_csids','Anon cannot read credentials');
SELECT throws_ok($$INSERT INTO public.zatca_csids(tenant_id,environment,kind,csid_base64,secret)
 VALUES('83111111-1111-4111-8111-111111111111','sandbox','compliance','fixture','fixture')$$,
 '42501','permission denied for table zatca_csids','Anon cannot insert credentials');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='83333333-3333-4333-8333-333333333333';
SELECT throws_ok($$SELECT secret FROM public.zatca_csids$$,'42501','permission denied for table zatca_csids','Authenticated direct credential reads denied');
SELECT throws_ok($$INSERT INTO public.zatca_csids(tenant_id,environment,kind,csid_base64,secret)
 VALUES('83111111-1111-4111-8111-111111111111','sandbox','compliance','fixture','fixture')$$,
 '42501','permission denied for table zatca_csids','Authenticated direct credential inserts denied');
SELECT throws_ok($$UPDATE public.zatca_csids SET status='revoked'$$,'42501','permission denied for table zatca_csids','Authenticated credential updates denied');
SELECT throws_ok($$DELETE FROM public.zatca_csids$$,'42501','permission denied for table zatca_csids','Authenticated credential deletes denied');
SET LOCAL ROLE service_role;
SELECT lives_ok($$INSERT INTO public.zatca_csids(tenant_id,environment,kind,csid_base64,secret)
 VALUES('83111111-1111-4111-8111-111111111111','sandbox','compliance','fixture','fixture')$$,'Service credential provisioning preserved');
SELECT is((SELECT count(*) FROM public.zatca_csids WHERE tenant_id='83111111-1111-4111-8111-111111111111'),1::bigint,'Service credential read preserved');
SELECT lives_ok($$UPDATE public.zatca_csids SET status='revoked' WHERE tenant_id='83111111-1111-4111-8111-111111111111'$$,'Service credential revocation preserved');
SELECT lives_ok($$DELETE FROM public.zatca_csids WHERE tenant_id='83111111-1111-4111-8111-111111111111'$$,'Service cleanup deletes only this test fixture');
SELECT is((SELECT count(*) FROM public.zatca_csids WHERE tenant_id='83111111-1111-4111-8111-111111111111'),0::bigint,'Test credential fixture cleaned up');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
