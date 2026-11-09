BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('95500000-0000-4000-8000-000000000001','bank-paid-owner@example.test','{"_invite_provisioned":true}'),
 ('95500000-0000-4000-8000-000000000002','bank-paid-other@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE bp_tenants AS SELECT 'own'::text label,(public.provision_company_atomic('95500000-0000-4000-8000-000000000001','{"name":"Bank paid fixture","domain":"bank-paid.test","slug":"bank-paid"}')->>'id')::uuid id
 UNION ALL SELECT 'other',(public.provision_company_atomic('95500000-0000-4000-8000-000000000002','{"name":"Bank paid other","domain":"bank-paid-other.test","slug":"bank-paid-other"}')->>'id')::uuid;
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('95500000-0000-4000-8000-000000000001','95500000-0000-4000-8000-000000000002');
INSERT INTO public.customers(id,tenant_id,customer_code,name_ar,name_en) SELECT '95500000-0000-4000-8000-000000000020',id,'BP0001','عميل','Bank paid customer' FROM bp_tenants WHERE label='own';
INSERT INTO public.bank_accounts(id,tenant_id,bank_name,account_name,iban,currency) SELECT CASE label WHEN 'own' THEN '95500000-0000-4000-8000-000000000030'::uuid ELSE '95500000-0000-4000-8000-000000000031'::uuid END,id,'Fixture bank','Fixture beneficiary','SA7480000000000000001234','SAR' FROM bp_tenants;
CREATE TEMP TABLE bp_results(label text PRIMARY KEY,result jsonb);
CREATE TEMP TABLE bp_input AS SELECT jsonb_build_object('invoice_type','sales','customer_id','95500000-0000-4000-8000-000000000020','issue_date',current_date,'due_date',current_date,'notes','Payment within 7 days','lines','[{"item_name":"Delivery","description":"Bank fixture","quantity":1,"unit_price":100,"vat_rate":15}]'::jsonb) input;
GRANT ALL ON bp_results TO authenticated;GRANT SELECT ON bp_tenants,bp_input TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"95500000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- Invoice bank account printed in the bank-details box
SELECT lives_ok($$INSERT INTO bp_results SELECT 'bank',public.save_my_invoice_draft(input||'{"bank_account_id":"95500000-0000-4000-8000-000000000030"}',NULL,NULL,'95500000-0000-4000-8000-000000000040') FROM bp_input$$,'draft saves the printed bank account');
SELECT is((SELECT row(bank_account_id,notes)::text FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM bp_results WHERE label='bank')),row('95500000-0000-4000-8000-000000000030'::uuid,'Payment within 7 days'::text)::text,'bank account and notes/terms persist');
SELECT is((SELECT (result->>'updated_at')::timestamptz FROM bp_results WHERE label='bank'),(SELECT updated_at FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM bp_results WHERE label='bank')),'receipt carries the committed version');
SELECT lives_ok($$INSERT INTO bp_results SELECT 'plain',public.save_my_invoice_draft(input||'{"bank_account_id":null}',NULL,NULL,'95500000-0000-4000-8000-000000000042') FROM bp_input$$,'bank account is optional');
SELECT lives_ok($$INSERT INTO bp_results SELECT 'cleared',public.save_my_invoice_draft(input,(SELECT (result->>'id')::uuid FROM bp_results WHERE label='bank'),(SELECT (result->>'updated_at')::timestamptz FROM bp_results WHERE label='bank'),'95500000-0000-4000-8000-000000000043') FROM bp_input$$,'edit with the receipt version succeeds');
SELECT is((SELECT bank_account_id FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM bp_results WHERE label='bank')),NULL,'editing without a bank account clears it');
SELECT throws_like($$SELECT public.save_my_invoice_draft(input||'{"bank_account_id":"95500000-0000-4000-8000-000000000031"}',NULL,NULL,'95500000-0000-4000-8000-000000000045') FROM bp_input$$,'INV002:%','a foreign tenant bank account cannot be printed');
SELECT throws_like($$SELECT public.save_my_invoice_draft(input||'{"bank_account_id":"not-a-uuid"}',NULL,NULL,'95500000-0000-4000-8000-000000000046') FROM bp_input$$,'INV002:%','malformed bank account identifiers are rejected');
SELECT is((SELECT count(*)::int FROM public.invoices WHERE tenant_id=(SELECT id FROM bp_tenants WHERE label='own')),2,'rejected requests leave no invoice');

-- Vehicle ownership, istimara sequence number and rental details
SELECT lives_ok($$INSERT INTO bp_results VALUES('rented',public.save_fleet_vehicle('{"plate_number":"أبج 12","make":"Toyota","model":"Hiace","ownership_type":"rented","sequence_number":"123456789","rental_company":"Fixture Rentals","rental_contract_end":"2027-01-31","rental_monthly_cost":2500}'))$$,'rented vehicle with a two-digit Saudi plate is saved');
SELECT is((SELECT row(ownership_type,sequence_number,rental_company,rental_contract_end,rental_monthly_cost)::text FROM public.vehicles WHERE id=(SELECT (result->>'id')::uuid FROM bp_results WHERE label='rented')),row('rented','123456789','Fixture Rentals','2027-01-31'::date,2500.00::numeric(12,2))::text,'ownership and rental details persist');
SELECT lives_ok($$SELECT public.save_fleet_vehicle('{"ownership_type":"company_owned","rental_company":"Ignored"}',(SELECT (result->>'id')::uuid FROM bp_results WHERE label='rented'),(SELECT (result->>'version')::bigint FROM bp_results WHERE label='rented'))$$,'ownership can change to company owned');
SELECT is((SELECT row(ownership_type,rental_company,rental_contract_end,rental_monthly_cost)::text FROM public.vehicles WHERE id=(SELECT (result->>'id')::uuid FROM bp_results WHERE label='rented')),row('company_owned',NULL::text,NULL::date,NULL::numeric)::text,'rental details are cleared for non-rented vehicles');
SELECT throws_like($$SELECT public.save_fleet_vehicle('{"plate_number":"XYZ 1234","make":"Toyota","model":"Bad","ownership_type":"leased_forever"}')$$,'FLT010:%','unknown ownership type is rejected');
SELECT throws_like($$SELECT public.save_fleet_vehicle('{"plate_number":"XYZ 1235","make":"Toyota","model":"Bad","sequence_number":"12AB"}')$$,'FLT010:%','sequence number must be digits');
SELECT throws_like($$SELECT public.save_fleet_vehicle('{"plate_number":"XYZ 1236","make":"Toyota","model":"Bad","ownership_type":"rented","rental_monthly_cost":-1}')$$,'FLT010:%','negative rental cost is rejected');
SELECT * FROM finish();
ROLLBACK;
