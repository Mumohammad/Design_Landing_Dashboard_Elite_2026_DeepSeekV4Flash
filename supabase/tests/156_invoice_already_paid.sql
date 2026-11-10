BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('95600000-0000-4000-8000-000000000001','already-paid-owner@example.test','{"_invite_provisioned":true}'),
 ('95600000-0000-4000-8000-000000000002','already-paid-other@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE bp_tenants AS SELECT 'own'::text label,(public.provision_company_atomic('95600000-0000-4000-8000-000000000001','{"name":"Already paid fixture","domain":"already-paid.test","slug":"already-paid"}')->>'id')::uuid id
 UNION ALL SELECT 'other',(public.provision_company_atomic('95600000-0000-4000-8000-000000000002','{"name":"Already paid other","domain":"already-paid-other.test","slug":"already-paid-other"}')->>'id')::uuid;
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('95600000-0000-4000-8000-000000000001','95600000-0000-4000-8000-000000000002');
INSERT INTO public.customers(id,tenant_id,customer_code,name_ar,name_en) SELECT '95600000-0000-4000-8000-000000000020',id,'AP0001','عميل','Already paid customer' FROM bp_tenants WHERE label='own';
INSERT INTO public.bank_accounts(id,tenant_id,bank_name,account_name,iban,currency) SELECT CASE label WHEN 'own' THEN '95600000-0000-4000-8000-000000000030'::uuid ELSE '95600000-0000-4000-8000-000000000031'::uuid END,id,'Fixture bank','Fixture beneficiary','SA7480000000000000001234','SAR' FROM bp_tenants;
CREATE TEMP TABLE bp_results(label text PRIMARY KEY,result jsonb);
CREATE TEMP TABLE bp_input AS SELECT jsonb_build_object('invoice_type','sales','customer_id','95600000-0000-4000-8000-000000000020','issue_date',current_date,'due_date',current_date,'notes','Payment within 7 days','lines','[{"item_name":"Delivery","description":"Bank fixture","quantity":1,"unit_price":100,"vat_rate":15}]'::jsonb) input;
GRANT ALL ON bp_results TO authenticated;GRANT SELECT ON bp_tenants,bp_input TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"95600000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- Already-paid intent (no money moves on save)
SELECT lives_ok($$INSERT INTO bp_results SELECT 'transfer',public.save_my_invoice_draft(input||'{"bank_account_id":"95600000-0000-4000-8000-000000000030","already_paid":true,"already_paid_method":"transfer"}',NULL,NULL,'95600000-0000-4000-8000-000000000040') FROM bp_input$$,'transfer paid intent with a bank account is saved');
SELECT is((SELECT row(already_paid,already_paid_method,bank_account_id)::text FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM bp_results WHERE label='transfer')),row(true,'transfer','95600000-0000-4000-8000-000000000030'::uuid)::text,'paid intent persists with its method and bank');
SELECT lives_ok($$INSERT INTO bp_results SELECT 'cash',public.save_my_invoice_draft(input||'{"already_paid":true,"already_paid_method":"cash"}',NULL,NULL,'95600000-0000-4000-8000-000000000041') FROM bp_input$$,'cash paid intent needs no bank account');
SELECT lives_ok($$INSERT INTO bp_results SELECT 'plain',public.save_my_invoice_draft(input||'{"already_paid":false,"already_paid_method":"card"}',NULL,NULL,'95600000-0000-4000-8000-000000000042') FROM bp_input$$,'unpaid draft ignores a stray method');
SELECT is((SELECT row(already_paid,already_paid_method)::text FROM public.invoices WHERE id=(SELECT (result->>'id')::uuid FROM bp_results WHERE label='plain')),row(false,NULL::text)::text,'unpaid draft stores no method');
SELECT throws_like($$SELECT public.save_my_invoice_draft(input||'{"already_paid":true,"already_paid_method":"transfer"}',NULL,NULL,'95600000-0000-4000-8000-000000000043') FROM bp_input$$,'INV002:%','non-cash paid intent requires a bank account');
SELECT throws_like($$SELECT public.save_my_invoice_draft(input||'{"already_paid":true,"already_paid_method":"barter"}',NULL,NULL,'95600000-0000-4000-8000-000000000044') FROM bp_input$$,'INV002:%','unknown payment methods are rejected');
SELECT throws_like($$SELECT public.save_my_invoice_draft(input||'{"already_paid":"yes"}',NULL,NULL,'95600000-0000-4000-8000-000000000045') FROM bp_input$$,'INV002:%','non-boolean paid flag is rejected');
SELECT is((SELECT count(*)::int FROM public.finance_payments WHERE tenant_id=(SELECT id FROM bp_tenants WHERE label='own')),0,'saving a paid intent records no payment');
SELECT * FROM finish();
ROLLBACK;
