-- Driver platform accounts (rider IDs per platform). Synthetic tenants; rolls back.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(16);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
('16000000-0000-4000-8000-000000000001','dpa-owner@example.test','{"_invite_provisioned":true}'),
('16000000-0000-4000-8000-000000000002','dpa-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE dpa_tenants(kind text PRIMARY KEY,tenant_id uuid);
INSERT INTO dpa_tenants VALUES
('own',(public.provision_company_atomic('16000000-0000-4000-8000-000000000001','{"name":"DPA owner","domain":"dpa-own.example.test","slug":"dpa-own-fixture"}')->>'id')::uuid),
('foreign',(public.provision_company_atomic('16000000-0000-4000-8000-000000000002','{"name":"DPA foreign","domain":"dpa-foreign.example.test","slug":"dpa-foreign-fixture"}')->>'id')::uuid);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('16000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000002');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status) VALUES
('16000000-0000-4000-8000-000000000011',(SELECT tenant_id FROM dpa_tenants WHERE kind='own'),'Platform rider A','0501600001','freelancer','active'),
('16000000-0000-4000-8000-000000000012',(SELECT tenant_id FROM dpa_tenants WHERE kind='own'),'Platform rider B','0501600002','freelancer','active'),
('16000000-0000-4000-8000-000000000013',(SELECT tenant_id FROM dpa_tenants WHERE kind='foreign'),'Foreign rider','0501600003','freelancer','active');

SELECT ok(NOT has_table_privilege('authenticated','public.driver_platform_accounts','INSERT'),'clients cannot insert platform accounts directly');
SELECT ok(NOT has_table_privilege('authenticated','public.driver_platform_accounts','UPDATE'),'clients cannot update platform accounts directly');
SELECT ok(NOT has_function_privilege('anon','public.save_driver_platform_account(uuid,text,text,text,boolean,text)','EXECUTE'),'anon cannot save platform accounts');

GRANT ALL ON dpa_tenants TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16000000-0000-4000-8000-000000000001","aal":"aal2"}',true);

SELECT is((public.save_driver_platform_account('16000000-0000-4000-8000-000000000011','hungerstation','4747290'))->>'is_primary','true','first account becomes primary');
SELECT is((SELECT rider_id FROM public.drivers WHERE id='16000000-0000-4000-8000-000000000011'),'4747290','primary rider ID mirrors into drivers.rider_id');
SELECT is((public.save_driver_platform_account('16000000-0000-4000-8000-000000000011','keeta','K-1001'))->>'is_primary','false','second account is not primary by default');
SELECT is((public.save_driver_platform_account('16000000-0000-4000-8000-000000000011','keeta','K-1002',p_is_primary=>true))->>'platform_driver_id','K-1002','same platform updates in place');
SELECT is((SELECT count(*)::int FROM public.driver_platform_accounts WHERE driver_id='16000000-0000-4000-8000-000000000011'),2,'one row per platform');
SELECT is((SELECT rider_id FROM public.drivers WHERE id='16000000-0000-4000-8000-000000000011'),'K-1002','switching primary re-syncs rider_id');
SELECT is((SELECT count(*)::int FROM public.driver_platform_accounts WHERE driver_id='16000000-0000-4000-8000-000000000011' AND is_primary),1,'exactly one primary');
SELECT throws_ok($$SELECT public.save_driver_platform_account('16000000-0000-4000-8000-000000000012','keeta','K-1002')$$,'P0001','DPA006: this rider ID is already linked to another driver','rider ID unique per platform within tenant');
SELECT throws_ok($$SELECT public.save_driver_platform_account('16000000-0000-4000-8000-000000000011','jahez','bad id')$$,'P0001','DPA003: invalid platform rider ID','invalid rider ID rejected');
SELECT throws_ok($$SELECT public.save_driver_platform_account('16000000-0000-4000-8000-000000000013','jahez','J-1')$$,'P0001','DPA001: active tenant driver required','foreign tenant driver rejected');
SELECT lives_ok($$SELECT public.remove_driver_platform_account((SELECT id FROM public.driver_platform_accounts WHERE driver_id='16000000-0000-4000-8000-000000000011' AND platform_code='keeta'))$$,'primary account can be removed');
SELECT is((SELECT platform_code||':'||is_primary FROM public.driver_platform_accounts WHERE driver_id='16000000-0000-4000-8000-000000000011'),'hungerstation:true','remaining account promoted to primary');
SELECT is((SELECT rider_id FROM public.drivers WHERE id='16000000-0000-4000-8000-000000000011'),'4747290','rider_id follows the promoted primary');

SELECT * FROM finish();
ROLLBACK;
