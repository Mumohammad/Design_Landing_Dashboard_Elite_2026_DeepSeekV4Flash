-- Driver self-service portal links + government checks register. Synthetic tenants; rolls back.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(13);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
('16300000-0000-4000-8000-000000000001','dpl-owner@example.test','{"_invite_provisioned":true}'),
('16300000-0000-4000-8000-000000000002','dpl-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE dpl_tenants(kind text PRIMARY KEY,tenant_id uuid);
INSERT INTO dpl_tenants VALUES
('own',(public.provision_company_atomic('16300000-0000-4000-8000-000000000001','{"name":"DPL owner","domain":"dpl-own.example.test","slug":"dpl-own-fixture"}')->>'id')::uuid),
('foreign',(public.provision_company_atomic('16300000-0000-4000-8000-000000000002','{"name":"DPL foreign","domain":"dpl-foreign.example.test","slug":"dpl-foreign-fixture"}')->>'id')::uuid);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('16300000-0000-4000-8000-000000000001','16300000-0000-4000-8000-000000000002');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status) VALUES
('16300000-0000-4000-8000-000000000011',(SELECT tenant_id FROM dpl_tenants WHERE kind='own'),'Portal driver','0501630001','freelancer','active'),
('16300000-0000-4000-8000-000000000013',(SELECT tenant_id FROM dpl_tenants WHERE kind='foreign'),'Foreign driver','0501630003','freelancer','active');

SELECT ok(NOT has_function_privilege('anon','public.issue_driver_portal_link(uuid,text,integer)','EXECUTE'),'anon cannot issue portal links');
SELECT ok(NOT has_function_privilege('anon','public.record_driver_government_check(uuid,text,text,text,text,date,date)','EXECUTE'),'anon cannot record government checks');
SELECT ok(NOT has_column_privilege('authenticated','public.driver_portal_links','token_hash','SELECT'),'staff can never read token hashes');
SELECT ok(NOT has_table_privilege('authenticated','public.driver_portal_submissions','INSERT'),'clients cannot insert portal submissions directly');
SELECT is((SELECT public FROM storage.buckets WHERE id='driver-portal-uploads'),false,'portal upload bucket is private');

GRANT ALL ON dpl_tenants TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16300000-0000-4000-8000-000000000001","aal":"aal2"}',true);

SELECT ok((public.issue_driver_portal_link('16300000-0000-4000-8000-000000000011',repeat('a',64),30)) ? 'expires_at','portal link issued');
SELECT lives_ok($$SELECT public.issue_driver_portal_link('16300000-0000-4000-8000-000000000011',repeat('b',64),7)$$,'a new link can be issued');
SELECT is((SELECT count(*)::int FROM public.driver_portal_links WHERE driver_id='16300000-0000-4000-8000-000000000011' AND revoked_at IS NULL),1,'issuing a new link revokes the previous one');
SELECT throws_like($$SELECT public.issue_driver_portal_link('16300000-0000-4000-8000-000000000011','not-a-hash',7)$$,'%DPL001%','only SHA-256 hashes are stored');
SELECT throws_like($$SELECT public.issue_driver_portal_link('16300000-0000-4000-8000-000000000013',repeat('c',64),7)$$,'%DPA001%','foreign drivers are out of reach');
SELECT is((public.record_driver_government_check('16300000-0000-4000-8000-000000000011','muqeem','ok','TX-1',NULL,NULL,NULL))->>'result','ok','government check recorded');
SELECT throws_like($$SELECT public.record_driver_government_check('16300000-0000-4000-8000-000000000011','gosi','ok',NULL,NULL,(now()+interval '5 days')::date,NULL)$$,'%GOV001%','future check dates are rejected');
SELECT is(public.revoke_driver_portal_links('16300000-0000-4000-8000-000000000011'),1,'links can be revoked');

SELECT * FROM finish();
ROLLBACK;
