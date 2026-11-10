BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(12);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES ('95900000-0000-4000-8000-000000000001','card-owner@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE cp_tenant AS SELECT (public.provision_company_atomic('95900000-0000-4000-8000-000000000001','{"name":"Card fixture","domain":"card.test","slug":"card-fixture"}')->>'id')::uuid id;
INSERT INTO public.platform_invoices(id,tenant_id,invoice_number,amount,status) SELECT '95900000-0000-4000-8000-0000000000a1',id,'PLT-CARD-1',345.00,'pending' FROM cp_tenant;
INSERT INTO public.platform_invoices(id,tenant_id,invoice_number,amount,status) SELECT '95900000-0000-4000-8000-0000000000a2',id,'PLT-CARD-2',100.00,'paid' FROM cp_tenant;
INSERT INTO public.platform_payment_attempts(id,platform_invoice_id,tenant_id,amount_halalas,status,provider_invoice_id) SELECT '95900000-0000-4000-8000-0000000000b1','95900000-0000-4000-8000-0000000000a1',id,34500,'initiated','prov-1' FROM cp_tenant;
INSERT INTO public.platform_payment_attempts(id,platform_invoice_id,tenant_id,amount_halalas,status,provider_invoice_id) SELECT '95900000-0000-4000-8000-0000000000b2','95900000-0000-4000-8000-0000000000a2',id,10000,'initiated','prov-2' FROM cp_tenant;

SELECT ok(NOT has_table_privilege('authenticated','public.platform_payment_attempts','SELECT'), 'clients cannot read payment attempts');
SELECT ok(NOT has_function_privilege('authenticated','public.settle_platform_card_payment(uuid,text,integer)','EXECUTE'), 'clients cannot settle payments');
SELECT throws_ok($$SELECT public.settle_platform_card_payment('95900000-0000-4000-8000-0000000000b1','pay-1',100)$$, 'P0001', 'PAY002: payment does not match the invoice', 'amount mismatch rejected');
SELECT is(public.settle_platform_card_payment('95900000-0000-4000-8000-0000000000b1','pay-1',34500), 'settled', 'matching payment settles');
SELECT is((SELECT status||'/'||payment_method||'/'||payment_reference FROM public.platform_invoices WHERE id='95900000-0000-4000-8000-0000000000a1'), 'paid/card/pay-1', 'invoice marked paid by card');
SELECT is((SELECT billing_status FROM public.tenants WHERE id=(SELECT id FROM cp_tenant)), 'active_paid', 'tenant becomes active_paid');
SELECT is(public.settle_platform_card_payment('95900000-0000-4000-8000-0000000000b1','pay-1',34500), 'already_settled', 'replayed webhook is idempotent');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id='95900000-0000-4000-8000-0000000000a1' AND action='card_payment_settled'), 1, 'exactly one settlement audit');
SELECT is(public.settle_platform_card_payment('95900000-0000-4000-8000-0000000000b2','pay-2',10000), 'duplicate_payment', 'payment on an already-paid invoice is flagged');
SELECT is(public.settle_platform_card_payment('95900000-0000-4000-8000-0000000000b2','pay-2',10000), 'duplicate_payment', 'duplicate flag is stable');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id='95900000-0000-4000-8000-0000000000a2' AND action='card_payment_duplicate'), 1, 'one duplicate audit for refund follow-up');
SELECT throws_ok($$INSERT INTO public.platform_payment_attempts(platform_invoice_id,tenant_id,amount_halalas,status) SELECT '95900000-0000-4000-8000-0000000000a1',id,34500,'paid' FROM cp_tenant$$, '23505', NULL, 'second paid attempt for one invoice blocked');

SELECT * FROM finish();
ROLLBACK;
