BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();

INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('15400000-0000-4000-8000-000000000001','address-owner@example.test','{"_invite_provisioned":true}'),
 ('15400000-0000-4000-8000-000000000002','address-foreign@example.test','{"_invite_provisioned":true}'),
 ('15400000-0000-4000-8000-000000000003','address-viewer@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE address_tenants(label text PRIMARY KEY,id uuid);
INSERT INTO address_tenants VALUES
 ('own',(public.provision_company_atomic('15400000-0000-4000-8000-000000000001','{"name":"Address fixture","slug":"address154","domain":"address154.example.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('15400000-0000-4000-8000-000000000002','{"name":"Foreign address fixture","slug":"address154foreign","domain":"address154foreign.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('15400000-0000-4000-8000-000000000001','15400000-0000-4000-8000-000000000002');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
 SELECT '15400000-0000-4000-8000-000000000003',id,'address-viewer@example.test','readonly_auditor','active',false FROM address_tenants WHERE label='own';
CREATE TEMP TABLE address_results(label text PRIMARY KEY,result jsonb);
CREATE TEMP TABLE address_initial_version AS SELECT configuration_version FROM public.tenants WHERE id=(SELECT id FROM address_tenants WHERE label='own');
GRANT SELECT ON address_tenants,address_initial_version TO authenticated;
GRANT SELECT,INSERT ON address_results TO authenticated;

SELECT ok(NOT has_column_privilege('authenticated','public.tenants','building_number','UPDATE'),'new tenant address column does not reopen direct updates');
SELECT ok(NOT has_column_privilege('authenticated','public.customers','city','UPDATE'),'new customer address column does not reopen direct updates');
SELECT ok(NOT has_column_privilege('authenticated','public.suppliers','country_code','UPDATE'),'new supplier address column does not reopen direct updates');
SELECT ok(NOT has_function_privilege('anon','public.save_my_settings(text,jsonb,bigint)','EXECUTE'),'anonymous settings saves remain denied');
SELECT ok(NOT has_function_privilege('service_role','public.mutate_my_accounting_master(text,text,jsonb,uuid,timestamptz,uuid)','EXECUTE'),'service-role master bypass remains denied');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15400000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT lives_ok($$SELECT public.save_my_settings('company','{"name_ar":"شركة العنوان","name_en":"Address company","building_number":"0123","additional_number":"0456","district":"حي الاختبار","postal_code":"01234"}',(SELECT configuration_version FROM address_initial_version))$$,'National Address saves through the versioned company transaction');
SELECT is(public.read_my_settings_bundle('company')->>'building_number','0123','company building number retains its leading zero');
SELECT is(public.read_my_settings_bundle('company')->>'additional_number','0456','company additional number round trips');
SELECT is(public.read_my_settings_bundle('company')->>'district','حي الاختبار','company district round trips');
SELECT is(public.read_my_settings_bundle('company')->>'postal_code','01234','company postal code retains its leading zero');
SELECT is((public.read_my_settings_bundle('company')->>'configuration_version')::bigint,(SELECT configuration_version+1 FROM address_initial_version),'address save advances the configuration version once');
SELECT throws_ok($$SELECT public.save_my_settings('company','{"name_ar":"اسم قديم","name_en":"Stale","building_number":"9999"}',(SELECT configuration_version FROM address_initial_version))$$,'P0001','SETTINGS_STALE','stale address editor cannot overwrite a reviewed company');
SELECT is(public.read_my_settings_bundle('company')->>'building_number','0123','stale address save leaves stored values unchanged');
SELECT lives_ok($$SELECT public.save_my_settings('company','{"name_ar":"شركة العنوان","name_en":"Renamed company"}',(public.read_my_settings_bundle('company')->>'configuration_version')::bigint)$$,'company save without new fields remains compatible');
SELECT is(public.read_my_settings_bundle('company')->>'postal_code','01234','omitted company address fields are preserved');
SELECT throws_ok(format($q$SELECT public.save_my_settings('company',%L::jsonb,(public.read_my_settings_bundle('company')->>'configuration_version')::bigint)$q$,payload::text),'P0001','SETTINGS_INVALID',description)
FROM (VALUES
 ('{"name_ar":"شركة","name_en":"Company","building_number":"123"}'::jsonb,'short company building number rejected'),
 ('{"name_ar":"شركة","name_en":"Company","additional_number":"12x4"}'::jsonb,'nonnumeric company additional number rejected'),
 ('{"name_ar":"شركة","name_en":"Company","postal_code":"123456"}'::jsonb,'long company postal code rejected'),
 (jsonb_build_object('name_ar','شركة','name_en','Company','district',repeat('x',128)),'oversized company district rejected'))v(payload,description);

INSERT INTO address_results VALUES('customer',public.mutate_my_accounting_master('customers','create','{"code":"ADR154C","name_ar":"عميل عنوان","address":"شارع الاختبار","city":" الرياض ","district":"حي الاختبار","building_number":"0123","additional_number":"0456","postal_code":"01234","country_code":"sa"}',NULL,NULL,'15400000-0000-4000-8000-000000000101'));
INSERT INTO address_results VALUES('supplier',public.mutate_my_accounting_master('suppliers','create','{"code":"ADR154S","name_ar":"مورد عنوان","address":"شارع الاختبار","city":"الرياض","district":"حي الاختبار","building_number":"0123","additional_number":"0456","postal_code":"01234","country_code":"SA"}',NULL,NULL,'15400000-0000-4000-8000-000000000102'));
SELECT is(public.read_my_accounting_master_page(kind,'ADR154')->'rows'->0->>'city','الرياض',kind||' city normalizes and round trips') FROM unnest(ARRAY['customers','suppliers'])kind;
SELECT is(public.read_my_accounting_master_page(kind,'ADR154')->'rows'->0->>'district','حي الاختبار',kind||' district round trips') FROM unnest(ARRAY['customers','suppliers'])kind;
SELECT is(public.read_my_accounting_master_page(kind,'ADR154')->'rows'->0->>'building_number','0123',kind||' building number retains leading zero') FROM unnest(ARRAY['customers','suppliers'])kind;
SELECT is(public.read_my_accounting_master_page(kind,'ADR154')->'rows'->0->>'additional_number','0456',kind||' additional number round trips') FROM unnest(ARRAY['customers','suppliers'])kind;
SELECT is(public.read_my_accounting_master_page(kind,'ADR154')->'rows'->0->>'postal_code','01234',kind||' postal code retains leading zero') FROM unnest(ARRAY['customers','suppliers'])kind;
SELECT is(public.read_my_accounting_master_page(kind,'ADR154')->'rows'->0->>'country_code','SA',kind||' country code is canonical') FROM unnest(ARRAY['customers','suppliers'])kind;
SELECT is(public.read_my_accounting_master_page('customers','01234',1,25,true)->'rows'->0->>'postal_code','01234','complete export carries searchable address fields');
SELECT is(public.mutate_my_accounting_master('customers','create','{"code":"ADR154C","name_ar":"عميل عنوان","address":"شارع الاختبار","city":"الرياض","district":"حي الاختبار","building_number":"0123","additional_number":"0456","postal_code":"01234","country_code":"SA"}',NULL,NULL,'15400000-0000-4000-8000-000000000101'),(SELECT result FROM address_results WHERE label='customer'),'normalized same-address replay returns the exact original receipt');
SELECT throws_ok($$SELECT public.mutate_my_accounting_master('customers','create','{"code":"ADR154C","name_ar":"عميل عنوان","building_number":"9999"}',NULL,NULL,'15400000-0000-4000-8000-000000000101')$$,'P0001','MASTER_REQUEST_CONFLICT: request identifier was used for different details','changed address cannot reuse another payload receipt');

INSERT INTO address_results VALUES('customer-updated',public.mutate_my_accounting_master('customers','update','{"district":"حي محدث","postal_code":"54321"}',(SELECT(result->>'id')::uuid FROM address_results WHERE label='customer'),(SELECT(result->>'updated_at')::timestamptz FROM address_results WHERE label='customer'),'15400000-0000-4000-8000-000000000103'));
SELECT is(public.read_my_accounting_master_page('customers','ADR154C')->'rows'->0->>'district','حي محدث','reviewed address edit persists');
SELECT is(public.read_my_accounting_master_page('customers','ADR154C')->'rows'->0->>'building_number','0123','omitted party address fields remain intact on update');
SELECT throws_ok($$SELECT public.mutate_my_accounting_master('customers','update','{"building_number":"9999"}',(SELECT(result->>'id')::uuid FROM address_results WHERE label='customer'),(SELECT(result->>'updated_at')::timestamptz FROM address_results WHERE label='customer'),'15400000-0000-4000-8000-000000000104')$$,'P0001','MASTER_STALE: record changed; reload before saving','stale address update keeps the exact reviewed timestamp guard');
SELECT is(public.read_my_accounting_master_page('customers','ADR154C')->'rows'->0->>'building_number','0123','stale party edit cannot overwrite address');
SELECT throws_ok(format($q$SELECT public.mutate_my_accounting_master(%L,'create',%L::jsonb,NULL,NULL,%L::uuid)$q$,kind,payload::text,gen_random_uuid()::text),'22023',message,kind||': '||description)
FROM unnest(ARRAY['customers','suppliers'])kind CROSS JOIN (VALUES
 ('{"name_ar":"عنوان","building_number":"123"}'::jsonb,'MASTER_INVALID: invalid national address','short building number rejected'),
 ('{"name_ar":"عنوان","additional_number":"12345"}'::jsonb,'MASTER_INVALID: invalid national address','long additional number rejected'),
 ('{"name_ar":"عنوان","postal_code":"12x45"}'::jsonb,'MASTER_INVALID: invalid national address','nonnumeric postal code rejected'),
 ('{"name_ar":"عنوان","country_code":"SAU"}'::jsonb,'MASTER_INVALID: invalid country code','invalid country code rejected'),
 (jsonb_build_object('name_ar','عنوان','district',repeat('x',128)),'MASTER_INVALID: invalid national address','oversized district rejected'))v(payload,message,description);

-- A legacy receipt is seeded with the exact pre-address normalized payload.
-- This proves adding new columns did not add defaults to old request hashes.
RESET ROLE;
SELECT accounting_master_private.receipt_put((SELECT id FROM address_tenants WHERE label='own'),'15400000-0000-4000-8000-000000000105','customers:create',jsonb_build_object('input','{"name_en":null,"phone":null,"email":null,"tax_number":null,"address":null,"credit_limit":null,"is_active":true,"name_ar":"Legacy receipt"}'::jsonb,'id',NULL,'expected_updated_at',NULL),' {"id":"15400000-0000-4000-8000-000000000199","updated_at":"2026-10-25T12:30:00.123456Z","code":"LEGACY154","is_active":true,"archived":false}'::jsonb);
SET LOCAL ROLE authenticated;
SELECT is(public.mutate_my_accounting_master('customers','create','{"name_ar":"Legacy receipt"}',NULL,NULL,'15400000-0000-4000-8000-000000000105')->>'code','LEGACY154','a receipt created before address support remains replayable');
SELECT is((public.read_my_accounting_master_page('customers','Legacy receipt')->>'total')::integer,0,'legacy replay does not duplicate the mutation');

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15400000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is((public.read_my_accounting_master_page('customers','ADR154')->>'total')::integer,0,'foreign tenant cannot read party address');
SELECT throws_ok($$SELECT public.mutate_my_accounting_master('customers','update','{"city":"Foreign city"}',(SELECT(result->>'id')::uuid FROM address_results WHERE label='customer-updated'),(SELECT(result->>'updated_at')::timestamptz FROM address_results WHERE label='customer-updated'),'15400000-0000-4000-8000-000000000106')$$,'P0001','MASTER_NOT_FOUND: party not found','foreign tenant cannot mutate another party address');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"15400000-0000-4000-8000-000000000003","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.save_my_settings('company','{"name_ar":"شركة","name_en":"Company","building_number":"9999"}',1)$$,'42501','SETTINGS_FORBIDDEN','viewer cannot change company address');
SELECT throws_ok($$SELECT public.mutate_my_accounting_master('suppliers','create','{"name_ar":"عنوان","city":"الرياض"}',NULL,NULL,'15400000-0000-4000-8000-000000000107')$$,'42501','AUTH007: accounting permission required','viewer cannot create party addresses');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.audit_log WHERE tenant_id=(SELECT id FROM address_tenants WHERE label='own') AND action='customer_created'),1,'address replay and rejected edits do not duplicate success audits');
SELECT ok(EXISTS(SELECT 1 FROM public.audit_log WHERE tenant_id=(SELECT id FROM address_tenants WHERE label='own') AND action='settings_company_updated' AND new_values->>'postal_code'='01234'),'company address follows the existing atomic audit path');
SELECT * FROM finish();
ROLLBACK;
