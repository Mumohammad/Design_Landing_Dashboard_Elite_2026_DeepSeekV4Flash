BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('96800000-0000-4000-8000-000000000001','settings-owner@example.test','{"_invite_provisioned":true}'),
 ('96800000-0000-4000-8000-000000000002','settings-foreign@example.test','{"_invite_provisioned":true}'),
 ('96800000-0000-4000-8000-000000000003','settings-viewer@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE settings_companies AS
 SELECT 'owner'::text label,(public.provision_company_atomic('96800000-0000-4000-8000-000000000001','{"name":"Settings fixture","slug":"settings-atomic-fixture","domain":"settings-atomic.example.test"}')->>'id')::uuid id
 UNION ALL SELECT 'foreign',(public.provision_company_atomic('96800000-0000-4000-8000-000000000002','{"name":"Foreign settings","slug":"settings-foreign-fixture","domain":"settings-foreign.example.test"}')->>'id')::uuid;
INSERT INTO public.users(auth_user_id,tenant_id,email,full_name_ar,role,status,must_change_password)
 SELECT '96800000-0000-4000-8000-000000000003',id,'settings-viewer@example.test','Viewer','readonly_auditor','active',false FROM settings_companies WHERE label='owner';
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('96800000-0000-4000-8000-000000000001','96800000-0000-4000-8000-000000000002');
UPDATE public.tenants SET logo_url='https://cdn.example.test/existing-logo.png' WHERE id=(SELECT id FROM settings_companies WHERE label='owner');
CREATE TEMP TABLE settings_before AS SELECT id,configuration_version,name_ar,name_en,logo_url FROM public.tenants WHERE id IN(SELECT id FROM settings_companies);
GRANT SELECT ON settings_companies,settings_before TO authenticated,service_role;
SELECT ok(NOT has_function_privilege('anon','public.save_my_settings(text,jsonb,bigint)','execute'),'anonymous settings mutation denied');
SELECT ok(NOT has_table_privilege('authenticated','public.tenants','UPDATE'),'authenticated cannot change tenant fields outside guarded workflow');
SELECT ok(NOT has_any_column_privilege('authenticated','public.system_settings','UPDATE'),'legacy settings column ACL cannot bypass workflow');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96800000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(jsonb_array_length(public.read_my_settings_bundle('payroll')->'rows'),3,'all supported reference fields are visible even before first configuration');
SELECT is((public.read_my_settings_bundle('company')->>'can_manage')::boolean,true,'owner has explicit manage affordance');
SELECT lives_ok($$SELECT public.save_my_settings('company','{"name_ar":"اسم محدث","name_en":"Updated company","timezone":"Asia/Riyadh","default_locale":"en"}',(SELECT configuration_version FROM settings_before WHERE id=(SELECT id FROM settings_companies WHERE label='owner')))$$,'company metadata and audit save together');
SELECT is(public.read_my_settings_bundle('company')->>'logo_url','https://cdn.example.test/existing-logo.png','omitted logo is preserved instead of cleared');
SELECT is(public.read_my_settings_bundle('company')->>'name_en','Updated company','company name saved');
SELECT throws_ok($$SELECT public.save_my_settings('company','{"name_ar":"Old stale","name_en":"Old stale"}',(SELECT configuration_version FROM settings_before WHERE id=(SELECT id FROM settings_companies WHERE label='owner')))$$,'P0001','SETTINGS_STALE','stale profile cannot overwrite concurrent settings');
SELECT throws_ok($$SELECT public.save_my_settings('payroll','{"payroll.default_working_days":"27","security.max_failed_login_attempts":"9999"}',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint)$$,'P0001','SETTINGS_INVALID','unknown security keys rejected even beside a valid payroll setting');
SELECT throws_ok($$SELECT public.save_my_settings('payroll','{"payroll.default_working_days":"26.5"}',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint)$$,'P0001','SETTINGS_INVALID','fractional working days rejected');
SELECT lives_ok($$SELECT public.save_my_settings('payroll','{"payroll.default_working_days":"26","payroll.min_net_floor":"1700.25","payroll.saudi_minimum_wage":"4200.00"}',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint)$$,'reference values update as one transaction');
SELECT is((SELECT value FROM public.system_settings WHERE tenant_id=(SELECT id FROM settings_companies WHERE label='owner') AND key='payroll.min_net_floor' AND deleted_at IS NULL),'1700.25','exact reference cents preserved');
SELECT throws_ok($$SELECT public.save_my_settings('wps','{"company.mol_reference":"12345678","company.wps_iban":"SA0380000000608010167510"}',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint)$$,'P0001','SETTINGS_INVALID','checksum-invalid IBAN rejected');
SELECT lives_ok($$SELECT public.save_my_settings('wps','{"company.mol_reference":"12345678","company.wps_iban":"sa03 8000 0000 6080 1016 7519"}',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint)$$,'valid WPS identity saves atomically');
SELECT is(public.read_my_settings_bundle('company')->>'wps_iban','SA0380000000608010167519','IBAN normalized without changing its digits');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_log_safe WHERE tenant_id=(SELECT id FROM settings_companies WHERE label='owner') AND (new_values ? 'company.wps_iban' OR coalesce(new_values::text,'') LIKE '%7519%')),'caller-safe audit omits even masked bank references');
RESET ROLE;
-- Inspect stored writer minimization as the test owner; caller access to raw
-- JSON is deliberately revoked by the independent audit privacy boundary.
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_log WHERE tenant_id=(SELECT id FROM settings_companies WHERE label='owner') AND new_values::text LIKE '%SA0380000000608010167519%'),'full IBAN never enters stored audit values');
SELECT is((SELECT new_values->>'company.wps_iban' FROM public.audit_log WHERE tenant_id=(SELECT id FROM settings_companies WHERE label='owner') AND action='settings_wps_updated'),'****7519','stored WPS audit retains only masked bank reference');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE public.tenants SET plan='single_tenant' WHERE id=(SELECT id FROM settings_companies WHERE label='owner')$$,'42501',NULL,'tenant owner cannot change billing plan with direct table access');
RESET ROLE;
CREATE TEMP TABLE settings_saved AS SELECT configuration_version,(SELECT value FROM public.system_settings WHERE tenant_id=t.id AND key='payroll.min_net_floor' AND deleted_at IS NULL)floor FROM public.tenants t WHERE id=(SELECT id FROM settings_companies WHERE label='owner');
GRANT SELECT ON settings_saved TO authenticated;
CREATE FUNCTION pg_temp.fail_settings_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'settings_%_updated' THEN RAISE EXCEPTION 'Test settings audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_settings_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_settings_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_my_settings('payroll','{"payroll.min_net_floor":"1999.99"}',(SELECT configuration_version FROM settings_saved))$$,'P0001','Test settings audit failure','audit failure rolls back all configured values');
SELECT is((SELECT value FROM public.system_settings WHERE tenant_id=(SELECT id FROM settings_companies WHERE label='owner') AND key='payroll.min_net_floor' AND deleted_at IS NULL),(SELECT floor FROM settings_saved),'failed audit preserves original floor');
SELECT is((public.read_my_settings_bundle('company')->>'configuration_version')::bigint,(SELECT configuration_version FROM settings_saved),'failed audit preserves configuration version');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96800000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is(public.read_my_settings_bundle('company')->>'name_en',(SELECT name_en FROM settings_before WHERE id=(SELECT id FROM settings_companies WHERE label='foreign')),'foreign owner sees only own company');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96800000-0000-4000-8000-000000000003","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.save_my_settings('payroll','{"payroll.min_net_floor":"0"}',1)$$,'42501','SETTINGS_FORBIDDEN','viewer cannot change configuration');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96800000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.read_my_settings_bundle('company')$$,'42501','SETTINGS_FORBIDDEN','privileged low assurance cannot read private settings');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE public.system_settings SET value='0' WHERE tenant_id=(SELECT id FROM settings_companies WHERE label='owner')$$,'42501','SETTINGS_CALLER_REQUIRED','stale service-role application cannot bypass atomic settings workflow');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
