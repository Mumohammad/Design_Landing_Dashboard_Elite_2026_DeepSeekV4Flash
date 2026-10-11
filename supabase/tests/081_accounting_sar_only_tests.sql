BEGIN;
SELECT plan(29);
INSERT INTO public.tenants (id,name_ar,name_en,slug) VALUES
 ('82111111-1111-4111-8111-111111111111','SAR A','SAR A','sar-81-a');
INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-000000000000','82333333-3333-4333-8333-333333333333',
 'authenticated','authenticated','sar-81@test.local',crypt('x',gen_salt('bf')),now(),now(),now(),
 '{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}');
INSERT INTO public.users (id,auth_user_id,tenant_id,email,role,status,must_change_password) VALUES
 ('82444444-4444-4444-8444-444444444444','82333333-3333-4333-8333-333333333333',
 '82111111-1111-4111-8111-111111111111','sar-81@test.local','general_manager','active',false);
INSERT INTO public.customers (id,tenant_id,name_ar) VALUES
 ('82555555-5555-4555-8555-555555555555','82111111-1111-4111-8111-111111111111','Customer');
INSERT INTO public.suppliers (id,tenant_id,name_ar) VALUES
 ('82555555-5555-4555-8555-555555555556','82111111-1111-4111-8111-111111111111','Supplier');
INSERT INTO public.invoices (id,tenant_id,customer_id,issue_date,due_date) VALUES
 ('82666666-6666-4666-8666-666666666666','82111111-1111-4111-8111-111111111111',
 '82555555-5555-4555-8555-555555555555','2026-10-11','2026-10-11');

-- Simulate pre-migration foreign records, then restore the exact new constraints.
-- All fixture/schema changes below roll back at the end of this test.
ALTER TABLE public.bank_accounts DROP CONSTRAINT accounting_currency_sar_only;
ALTER TABLE public.invoices DROP CONSTRAINT accounting_currency_sar_only;
INSERT INTO public.bank_accounts (id,tenant_id,bank_name,account_name,iban,currency) VALUES
 ('82777777-7777-4777-8777-777777777777','82111111-1111-4111-8111-111111111111','Foreign bank','FX','FX81','USD');
INSERT INTO public.invoices (id,tenant_id,customer_id,issue_date,due_date,currency,subtotal,total) VALUES
 ('82888888-8888-4888-8888-888888888888','82111111-1111-4111-8111-111111111111',
 '82555555-5555-4555-8555-555555555555','2026-10-11','2026-10-11','USD',100,100);
ALTER TABLE public.bank_accounts ADD CONSTRAINT accounting_currency_sar_only CHECK (currency = 'SAR') NOT VALID;
ALTER TABLE public.invoices ADD CONSTRAINT accounting_currency_sar_only CHECK (currency = 'SAR') NOT VALID;
INSERT INTO public.receivables (id,tenant_id,customer_id,invoice_ref,invoice_date,due_date,amount,total_amount,source_entity_type,source_entity_id) VALUES
 ('82999999-9999-4999-8999-999999999999','82111111-1111-4111-8111-111111111111',
 '82555555-5555-4555-8555-555555555555','FX81AR','2026-10-11','2026-10-11',100,100,'invoice','82888888-8888-4888-8888-888888888888');
INSERT INTO public.payables (id,tenant_id,supplier_id,invoice_ref,invoice_date,due_date,amount,total_amount,source_entity_type,source_entity_id) VALUES
 ('82999999-9999-4999-8999-999999999998','82111111-1111-4111-8111-111111111111',
 '82555555-5555-4555-8555-555555555556','FX81AP','2026-10-11','2026-10-11',100,100,'purchase_invoice','82888888-8888-4888-8888-888888888888');
CREATE TEMP TABLE sar_fixture (document jsonb,lines jsonb,payment jsonb,allocations jsonb);
INSERT INTO sar_fixture VALUES (
 '{"invoice_type":"sales","customer_id":"82555555-5555-4555-8555-555555555555","issue_date":"2026-10-11","due_date":"2026-10-11"}',
 '[{"description":"SAR line","quantity":1,"unit_price":10}]',
 '{"direction":"in","payment_date":"2026-10-11","amount":1,"method":"cash","customer_id":"82555555-5555-4555-8555-555555555555"}',
 '[{"receivable_id":"82999999-9999-4999-8999-999999999999","amount":1}]');
GRANT SELECT ON sar_fixture TO authenticated;
SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.invoices'::regclass AND conname='accounting_currency_sar_only'),'Invoice currency constrained');
SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.bank_accounts'::regclass AND conname='accounting_currency_sar_only'),'Bank currency constrained');
SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.credit_notes'::regclass AND conname='accounting_currency_sar_only'),'Credit note currency constrained');
SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.debit_notes'::regclass AND conname='accounting_currency_sar_only'),'Debit note currency constrained');
SELECT ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.expenses'::regclass AND conname='accounting_currency_sar_only'),'Expense currency constrained');
SELECT is((SELECT currency FROM public.invoices WHERE id='82888888-8888-4888-8888-888888888888'),'USD','Legacy invoice is not silently relabeled');
SELECT is((SELECT currency FROM public.bank_accounts WHERE id='82777777-7777-4777-8777-777777777777'),'USD','Legacy bank is not silently relabeled');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='82333333-3333-4333-8333-333333333333';
SELECT lives_ok($$SELECT public.save_invoice_draft_atomic(document,lines) FROM sar_fixture$$,'SAR default draft succeeds');
SELECT lives_ok($$SELECT public.save_invoice_draft_atomic(jsonb_set(document,'{currency}','"SAR"'),lines) FROM sar_fixture$$,'Explicit SAR draft succeeds');
SELECT throws_ok($$SELECT public.save_invoice_draft_atomic(document,lines,'82888888-8888-4888-8888-888888888888') FROM sar_fixture$$,
 'P0001','ACC_CURRENCY: legacy foreign currency requires explicit migration review','Draft defaults cannot silently relabel a legacy invoice');
SELECT throws_ok($$UPDATE public.bank_accounts SET currency='SAR' WHERE id='82777777-7777-4777-8777-777777777777'$$,
 'P0001','ACC_CURRENCY: legacy foreign currency requires explicit migration review','Legacy bank cannot be silently relabeled');
SELECT throws_like($$SELECT public.save_invoice_draft_atomic(jsonb_set(document,'{currency}','"USD"'),lines) FROM sar_fixture$$,
 '%accounting_currency_sar_only%','RPC cannot bypass invoice currency check');
SELECT throws_like($$INSERT INTO public.invoices (tenant_id,customer_id,issue_date,due_date,currency) VALUES
 ('82111111-1111-4111-8111-111111111111','82555555-5555-4555-8555-555555555555','2026-10-11','2026-10-11','EUR')$$,
 '%accounting_currency_sar_only%','Direct invoice insert cannot bypass currency check');
SELECT throws_like($$UPDATE public.invoices SET currency='USD' WHERE id='82666666-6666-4666-8666-666666666666'$$,
 '%accounting_currency_sar_only%','Direct invoice update cannot change currency');
SELECT throws_like($$INSERT INTO public.bank_accounts (tenant_id,bank_name,account_name,iban,currency) VALUES
 ('82111111-1111-4111-8111-111111111111','Bank','Account','EUR81','EUR')$$,
 '%accounting_currency_sar_only%','Direct bank insert cannot bypass currency check');
SELECT throws_like($$INSERT INTO public.expenses (tenant_id,expense_type,amount,expense_date,currency) VALUES
 ('82111111-1111-4111-8111-111111111111','operational',1,'2026-10-11','USD')$$,
 '%accounting_currency_sar_only%','Foreign-currency expense rejected');
SELECT lives_ok($$INSERT INTO public.expenses (tenant_id,expense_type,amount,expense_date) VALUES
 ('82111111-1111-4111-8111-111111111111','operational',1,'2026-10-11')$$,'SAR expense succeeds');
SELECT throws_like($$INSERT INTO public.credit_notes (tenant_id,reference_invoice_id,issue_date,reason,currency) VALUES
 ('82111111-1111-4111-8111-111111111111','82666666-6666-4666-8666-666666666666','2026-10-11','Fixture','USD')$$,
 '%accounting_currency_sar_only%','Foreign-currency credit note rejected');
SELECT throws_like($$INSERT INTO public.debit_notes (tenant_id,reference_invoice_id,issue_date,reason,currency) VALUES
 ('82111111-1111-4111-8111-111111111111','82666666-6666-4666-8666-666666666666','2026-10-11','Fixture','USD')$$,
 '%accounting_currency_sar_only%','Foreign-currency debit note rejected');
SELECT lives_ok($$INSERT INTO public.credit_notes (tenant_id,reference_invoice_id,issue_date,reason) VALUES
 ('82111111-1111-4111-8111-111111111111','82666666-6666-4666-8666-666666666666','2026-10-11','Fixture')$$,'SAR credit note succeeds');
SELECT lives_ok($$INSERT INTO public.debit_notes (tenant_id,reference_invoice_id,issue_date,reason) VALUES
 ('82111111-1111-4111-8111-111111111111','82666666-6666-4666-8666-666666666666','2026-10-11','Fixture')$$,'SAR debit note succeeds');
SELECT throws_ok($$INSERT INTO public.credit_notes (tenant_id,reference_invoice_id,issue_date,reason) VALUES
 ('82111111-1111-4111-8111-111111111111','82888888-8888-4888-8888-888888888888','2026-10-11','Fixture')$$,
 'P0001','ACC_CURRENCY: note requires a SAR invoice in the same tenant','SAR credit note cannot disguise a legacy FX invoice');
SELECT throws_ok($$INSERT INTO public.debit_notes (tenant_id,reference_invoice_id,issue_date,reason) VALUES
 ('82111111-1111-4111-8111-111111111111','82888888-8888-4888-8888-888888888888','2026-10-11','Fixture')$$,
 'P0001','ACC_CURRENCY: note requires a SAR invoice in the same tenant','SAR debit note cannot disguise a legacy FX invoice');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(jsonb_set(payment,'{currency}','"USD"'),allocations,'82000000-0000-4000-8000-000000000001') FROM sar_fixture$$,
 'P0001','ACC_CURRENCY: accounting supports SAR only','Explicit foreign-currency payment rejected');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(jsonb_set(jsonb_set(payment,'{method}','"transfer"'),'{bank_account_id}','"82777777-7777-4777-8777-777777777777"'),allocations,'82000000-0000-4000-8000-000000000002') FROM sar_fixture$$,
 'P0001','ACC_CURRENCY: accounting supports SAR only','Legacy FX bank cannot fund a SAR payment');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(payment,allocations,'82000000-0000-4000-8000-000000000003') FROM sar_fixture$$,
 'P0001','ACC_CURRENCY: accounting supports SAR only','Legacy FX receivable cannot be paid as SAR');
SELECT throws_ok($$SELECT public.record_finance_payment_atomic(
 '{"direction":"out","payment_date":"2026-10-11","amount":1,"method":"cash","supplier_id":"82555555-5555-4555-8555-555555555556"}',
 '[{"payable_id":"82999999-9999-4999-8999-999999999998","amount":1}]','82000000-0000-4000-8000-000000000004')$$,
 'P0001','ACC_CURRENCY: accounting supports SAR only','Legacy FX payable cannot be paid as SAR');
SELECT is((SELECT count(*) FROM public.finance_payments),0::bigint,'Rejected FX operations leave no payments');
SELECT is((SELECT count(*) FROM public.payment_allocations),0::bigint,'Rejected FX operations leave no allocations');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
