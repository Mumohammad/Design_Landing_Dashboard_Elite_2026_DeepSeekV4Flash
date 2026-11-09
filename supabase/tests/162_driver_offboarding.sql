-- Driver exit / clearance workflow + handover evidence guards. Synthetic tenants; rolls back.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(11);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
('16200000-0000-4000-8000-000000000001','ofb-owner@example.test','{"_invite_provisioned":true}'),
('16200000-0000-4000-8000-000000000002','ofb-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE ofb_tenants(kind text PRIMARY KEY,tenant_id uuid);
INSERT INTO ofb_tenants VALUES
('own',(public.provision_company_atomic('16200000-0000-4000-8000-000000000001','{"name":"OFB owner","domain":"ofb-own.example.test","slug":"ofb-own-fixture"}')->>'id')::uuid),
('foreign',(public.provision_company_atomic('16200000-0000-4000-8000-000000000002','{"name":"OFB foreign","domain":"ofb-foreign.example.test","slug":"ofb-foreign-fixture"}')->>'id')::uuid);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('16200000-0000-4000-8000-000000000001','16200000-0000-4000-8000-000000000002');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status) VALUES
('16200000-0000-4000-8000-000000000011',(SELECT tenant_id FROM ofb_tenants WHERE kind='own'),'Exit driver','0501620001','freelancer','active'),
('16200000-0000-4000-8000-000000000013',(SELECT tenant_id FROM ofb_tenants WHERE kind='foreign'),'Foreign driver','0501620003','freelancer','active');
INSERT INTO public.driver_platform_accounts(id,tenant_id,driver_id,platform_code,platform_driver_id,status) VALUES
('16200000-0000-4000-8000-000000000031',(SELECT tenant_id FROM ofb_tenants WHERE kind='own'),'16200000-0000-4000-8000-000000000011','keeta','K162','active');

SELECT ok(NOT has_function_privilege('anon','public.save_driver_offboarding(uuid,text,jsonb)','EXECUTE'),'anon cannot manage offboarding');
SELECT ok(NOT has_function_privilege('anon','public.attach_handover_evidence(uuid,text[],text,text)','EXECUTE'),'anon cannot attach handover evidence');
SELECT ok(NOT has_table_privilege('authenticated','public.driver_offboarding','INSERT'),'clients cannot write offboarding rows directly');
SELECT is((SELECT public FROM storage.buckets WHERE id='handover-evidence'),false,'handover evidence bucket is private');

GRANT ALL ON ofb_tenants TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16200000-0000-4000-8000-000000000001","aal":"aal2"}',true);

SELECT is((public.save_driver_offboarding('16200000-0000-4000-8000-000000000011','start','{"exit_type":"resignation","reason":"Moving city","last_working_day":"2026-11-30"}'::jsonb))->>'status','in_progress','exit process started');
SELECT throws_like($$SELECT public.save_driver_offboarding('16200000-0000-4000-8000-000000000011','start','{}'::jsonb)$$,'%OFB001%','only one open exit process per driver');
SELECT throws_like($$SELECT public.save_driver_offboarding('16200000-0000-4000-8000-000000000011','complete','{}'::jsonb)$$,'%OFB004%','cannot complete with open checklist items');
SELECT lives_ok($$SELECT public.save_driver_offboarding('16200000-0000-4000-8000-000000000011','check',jsonb_build_object('key',k,'done',true)) FROM unnest(ARRAY['assets_returned','final_settlement','exit_interview','gosi_deregistered','muqeem_updated','visa_or_transfer','access_revoked']) k$$,'checklist items can be ticked');
SELECT throws_like($$SELECT public.save_driver_offboarding('16200000-0000-4000-8000-000000000011','complete','{}'::jsonb)$$,'%OFB006%','active platform accounts block clearance');
SELECT throws_like($$SELECT public.save_driver_offboarding('16200000-0000-4000-8000-000000000013','start','{}'::jsonb)$$,'%DPA001%','foreign drivers are out of reach');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.driver_platform_accounts SET status='inactive' WHERE id='16200000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16200000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT matches((public.save_driver_offboarding('16200000-0000-4000-8000-000000000011','complete','{}'::jsonb))->>'clearance_ref','^CLR-[0-9]{8}-[0-9A-F]{6}$','clearance completes with a reference');

SELECT * FROM finish();
ROLLBACK;
