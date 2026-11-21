BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();

SELECT has_column('public','vehicles',name,'vehicle ownership contract includes '||name)
FROM unnest(ARRAY['ownership_type','sequence_number','rental_company','rental_contract_end','rental_monthly_cost']) name;
SELECT col_type_is('public','vehicles','rental_contract_end','date','rental expiry is a date');
SELECT col_type_is('public','vehicles','rental_monthly_cost','numeric(12,2)','rental cost preserves exact cents');

CREATE TEMP TABLE hosted_address_contract(kind text PRIMARY KEY,normalized jsonb);
INSERT INTO hosted_address_contract VALUES('customers',NULL),('suppliers',NULL);
SELECT lives_ok(format($test$UPDATE hosted_address_contract SET normalized=accounting_master_private.normalize_input(%L,'create','{"name_ar":"عميل توافق","city":"الرياض","district":"الاختبار","building_number":"0123","additional_number":"0456","postal_code":"01234","country_code":"sa"}') WHERE kind=%L$test$,kind,kind),kind||' accepts the current national address payload')
FROM unnest(ARRAY['customers','suppliers']) kind;
SELECT is(normalized->>'building_number','0123',kind||' retains building leading zero') FROM hosted_address_contract;
SELECT is(normalized->>'additional_number','0456',kind||' retains additional-number leading zero') FROM hosted_address_contract;
SELECT is(normalized->>'postal_code','01234',kind||' retains postal leading zero') FROM hosted_address_contract;
SELECT is(normalized->>'country_code','SA',kind||' canonicalizes country code') FROM hosted_address_contract;
SELECT is((SELECT count(*)::integer FROM hosted_address_contract WHERE normalized IS NOT NULL),2,'both party types normalize successfully');

SELECT is(accounting_master_private.normalize_input('customers','create','{"name_ar":"عميل توافق"}'),'{"name_ar":"عميل توافق","name_en":null,"phone":null,"email":null,"tax_number":null,"address":null,"credit_limit":null,"is_active":true}'::jsonb,'legacy create payload normalization and receipt identity are unchanged');
SELECT throws_like($$SELECT accounting_master_private.normalize_input('customers','create','{"name_ar":"عميل توافق","building_number":"12AB"}')$$,'MASTER_INVALID:%','invalid building number still rejects');
SELECT throws_like($$SELECT accounting_master_private.normalize_input('customers','create','{"name_ar":"عميل توافق","country_code":"SAUDI"}')$$,'MASTER_INVALID:%','invalid country code still rejects');
SELECT throws_like($$SELECT accounting_master_private.normalize_input('customers','update','{"tenant_id":"00000000-0000-4000-8000-000000000001"}')$$,'MASTER_INVALID:%','tenant reassignment is not an editable master field');
SELECT ok(NOT has_function_privilege('anon','public.mutate_my_accounting_master(text,text,jsonb,uuid,timestamptz,uuid)','EXECUTE'),'anonymous master writes stay denied');

SELECT * FROM finish();
ROLLBACK;
