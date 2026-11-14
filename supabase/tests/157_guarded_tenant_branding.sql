BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('15700000-0000-4000-8000-000000000001','branding-owner@example.test','{"_invite_provisioned":true}'),
 ('15700000-0000-4000-8000-000000000002','branding-foreign@example.test','{"_invite_provisioned":true}'),
 ('15700000-0000-4000-8000-000000000003','branding-viewer@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE branding_tenants(label text PRIMARY KEY,id uuid);
INSERT INTO branding_tenants VALUES
 ('own',(public.provision_company_atomic('15700000-0000-4000-8000-000000000001','{"name":"Branding fixture","slug":"branding157","domain":"branding157.example.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('15700000-0000-4000-8000-000000000002','{"name":"Foreign branding","slug":"branding157foreign","domain":"branding157foreign.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('15700000-0000-4000-8000-000000000001','15700000-0000-4000-8000-000000000002');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
 SELECT '15700000-0000-4000-8000-000000000003',id,'branding-viewer@example.test','readonly_auditor','active',false FROM branding_tenants WHERE label='own';
UPDATE public.tenants SET logo_url='https://legacy.example.test/logo.png',building_number='0123',additional_number='0456',district='District',postal_code='01234' WHERE id=(SELECT id FROM branding_tenants WHERE label='own');
CREATE TEMP TABLE branding_state(label text PRIMARY KEY,result jsonb);
INSERT INTO branding_state SELECT 'initial',jsonb_build_object('configuration_version',configuration_version) FROM public.tenants WHERE id=(SELECT id FROM branding_tenants WHERE label='own');
CREATE TEMP TABLE branding_paths(label text PRIMARY KEY,path text);
INSERT INTO branding_paths SELECT 'attach',id||'/logos/15700000-0000-4000-8000-000000000001/15700000-0000-4000-8000-000000000101/logo-0123456789abcdef.png' FROM branding_tenants WHERE label='own';
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) SELECT 'company-assets',path,'15700000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":100}' FROM branding_paths;
GRANT SELECT ON branding_tenants,branding_paths TO authenticated;
GRANT SELECT,INSERT ON branding_state TO authenticated;
SELECT ok(NOT has_function_privilege('anon','public.save_my_company_logo(uuid,bigint,text)','EXECUTE'),'anonymous logo mutation denied');
SELECT ok(NOT has_function_privilege('service_role','public.save_my_company_logo(uuid,bigint,text)','EXECUTE'),'service role cannot bypass caller logo mutation');
SELECT ok(NOT has_column_privilege('authenticated','public.tenants','logo_storage_path','UPDATE'),'managed reference has no direct caller update grant');
SELECT ok(NOT has_table_privilege('authenticated','tenant_branding_private.logo_receipts','SELECT'),'durable receipts stay private');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15700000-0000-4000-8000-000000000001","aal":"aal2"}',true);
INSERT INTO branding_state VALUES('profile',public.save_my_settings('company','{"name_ar":"شركة","name_en":"Branding company"}',(SELECT(result->>'configuration_version')::bigint FROM branding_state WHERE label='initial')));
SELECT is(public.read_my_settings_bundle('company')->>'logo_url','https://legacy.example.test/logo.png','profile without logo preserves legacy URL');
SELECT is(public.read_my_settings_bundle('company')->>'postal_code','01234','profile preserves omitted National Address');
INSERT INTO branding_state VALUES('attach',public.save_my_company_logo('15700000-0000-4000-8000-000000000101',(SELECT(result->>'configuration_version')::bigint FROM branding_state WHERE label='profile'),(SELECT path FROM branding_paths WHERE label='attach')));
SELECT is(public.read_my_settings_bundle('company')->>'logo_storage_path',(SELECT path FROM branding_paths WHERE label='attach'),'caller attaches own immutable PNG');
SELECT is((public.read_my_settings_bundle('company')->>'configuration_version')::bigint,(SELECT(result->>'configuration_version')::bigint+1 FROM branding_state WHERE label='profile'),'logo advances shared version exactly once');
SELECT throws_ok($$SELECT public.save_my_settings('wps','{"company.mol_reference":"MOL157","company.wps_iban":"SA0380000000608010167519"}',(SELECT(result->>'configuration_version')::bigint FROM branding_state WHERE label='profile'))$$,'P0001','SETTINGS_STALE','stale WPS cannot overwrite a logo commit');
SELECT throws_ok($$SELECT public.save_my_company_logo('15700000-0000-4000-8000-000000000102',(SELECT(result->>'configuration_version')::bigint FROM branding_state WHERE label='profile'),NULL)$$,'P0001','SETTINGS_STALE','stale clear cannot overwrite logo/profile');
SELECT throws_ok($$SELECT public.save_my_company_logo('15700000-0000-4000-8000-000000000101',(SELECT(result->>'configuration_version')::bigint FROM branding_state WHERE label='profile'),NULL)$$,'P0001','SETTINGS_INVALID','request ID cannot be reused for changed details');
SELECT throws_ok($$SELECT public.save_my_settings('company','{"name_ar":"شركة","name_en":"Company","logo_url":"https://other.example/logo.png"}',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint)$$,'P0001','SETTINGS_INVALID','ordinary profile cannot change managed or legacy logo reference');
INSERT INTO branding_state VALUES('clear',public.save_my_company_logo('15700000-0000-4000-8000-000000000103',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint,NULL));
SELECT is(public.read_my_settings_bundle('company')->>'logo_storage_path',NULL::text,'clear removes managed reference');
SELECT is(public.read_my_settings_bundle('company')->>'logo_url',NULL::text,'clear also removes legacy URL');
SELECT is(public.save_my_company_logo('15700000-0000-4000-8000-000000000101',(SELECT(result->>'configuration_version')::bigint FROM branding_state WHERE label='profile'),(SELECT path FROM branding_paths WHERE label='attach')),(SELECT result||'{"replayed":true}'::jsonb FROM branding_state WHERE label='attach'),'exact replay returns historical receipt before stale check');
SELECT is((public.read_my_settings_bundle('company')->>'configuration_version')::bigint,(SELECT(result->>'configuration_version')::bigint FROM branding_state WHERE label='clear'),'historical replay leaves current version intact');
SELECT is(public.read_my_settings_bundle('company')->>'logo_storage_path',NULL::text,'historical attach replay cannot undo later clear');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15700000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.save_my_company_logo('15700000-0000-4000-8000-000000000101',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint,(SELECT path FROM branding_paths WHERE label='attach'))$$,'P0001','SETTINGS_INVALID','foreign tenant cannot attach another tenant object');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15700000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.save_my_company_logo('15700000-0000-4000-8000-000000000104',1,NULL)$$,'42501','SETTINGS_FORBIDDEN','viewer cannot mutate logos');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15700000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.save_my_company_logo('15700000-0000-4000-8000-000000000101',(SELECT(result->>'configuration_version')::bigint FROM branding_state WHERE label='profile'),(SELECT path FROM branding_paths WHERE label='attach'))$$,'42501','SETTINGS_FORBIDDEN','receipt replay still requires current MFA');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE tenant_id=(SELECT id FROM branding_tenants WHERE label='own') AND action='settings_logo_updated'),2,'attach/clear audit once; stale, foreign and replay do not duplicate audits');
SELECT is((SELECT count(*)::integer FROM tenant_branding_private.logo_receipts WHERE tenant_id=(SELECT id FROM branding_tenants WHERE label='own')),2,'durable receipts commit with their mutations');
SELECT throws_ok($$UPDATE tenant_branding_private.logo_receipts SET result='{}'$$,'P0001','SETTINGS_RECEIPT_IMMUTABLE','receipts cannot be rewritten');
SELECT throws_ok($$TRUNCATE tenant_branding_private.logo_receipts$$,'P0001','SETTINGS_RECEIPT_IMMUTABLE','receipts cannot be truncated');
UPDATE public.tenants SET status='suspended' WHERE id=(SELECT id FROM branding_tenants WHERE label='own');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15700000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.save_my_company_logo('15700000-0000-4000-8000-000000000103',(SELECT(result->>'configuration_version')::bigint-1 FROM branding_state WHERE label='clear'),NULL)$$,'42501','SETTINGS_FORBIDDEN','inactive tenant cannot replay committed logo receipt');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
