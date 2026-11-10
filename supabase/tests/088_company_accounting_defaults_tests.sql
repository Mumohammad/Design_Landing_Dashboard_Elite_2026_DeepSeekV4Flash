BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('88000000-0000-4000-8000-000000000001','finance-company@example.test','{"_invite_provisioned":true}'),
 ('88000000-0000-4000-8000-000000000002','finance-company-fault@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE finance_company_result AS SELECT public.provision_company_atomic(
 '88000000-0000-4000-8000-000000000001','{"name":"Finance Company Fixture","domain":"finance-company.example.test","slug":"finance-company"}') AS result;
SELECT is((SELECT count(*)::int FROM public.chart_of_accounts WHERE tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result)),28,'new company has the standard empty chart');
SELECT is((SELECT count(*)::int FROM public.expense_category_mappings WHERE tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result)),6,'new company has all six expense mappings');
SELECT is((SELECT count(*)::int FROM public.accounting_periods WHERE tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result)),1,'new company has its current open period');
SELECT is((SELECT count(*)::int FROM public.expense_category_mappings m JOIN public.chart_of_accounts c ON c.tenant_id=m.tenant_id AND c.account_code=m.coa_account_code AND c.deleted_at IS NULL WHERE m.tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result)),6,'every template mapping resolves to a real account');
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result)),0,'initialization invents no opening balance or journal');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result) AND action='company_created'),1,'complete company has one creation audit');
SELECT is(public.ensure_default_chart_of_accounts((SELECT (result->>'id')::uuid FROM finance_company_result)),0,'repeat initialization inserts no duplicate accounts');
SELECT is((SELECT count(*)::int FROM public.expense_category_mappings WHERE tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result)),6,'repeat initialization duplicates no mappings');
UPDATE public.accounting_periods SET status='closed' WHERE tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result);
SELECT is(public.ensure_default_chart_of_accounts((SELECT (result->>'id')::uuid FROM finance_company_result)),0,'initialization remains idempotent with an existing closed period');
SELECT is((SELECT status::text FROM public.accounting_periods WHERE tenant_id=(SELECT (result->>'id')::uuid FROM finance_company_result)),'closed','initialization cannot silently reopen a closed period');

INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES('88000000-0000-4000-8000-000000000003','Legacy fixture','Legacy fixture','finance-legacy-fixture');
INSERT INTO public.chart_of_accounts(tenant_id,account_code,name_ar,name_en,account_type,normal_balance)
VALUES('88000000-0000-4000-8000-000000000003','5000','Custom fuel','Custom fuel','expense','debit');
-- Reconstruct pre-guard legacy configuration; the new guard is enabled for the initializer and every assertion.
ALTER TABLE public.expense_category_mappings DISABLE TRIGGER aaa_accounting_expense_binding;
INSERT INTO public.expense_category_mappings(tenant_id,expense_type,coa_account_code,vat_recoverability)
VALUES('88000000-0000-4000-8000-000000000003','fuel','5200','non_recoverable');
ALTER TABLE public.expense_category_mappings ENABLE TRIGGER aaa_accounting_expense_binding;
SELECT lives_ok($$SELECT public.ensure_default_chart_of_accounts('88000000-0000-4000-8000-000000000003')$$,'explicit initialization fills missing defaults');
SELECT is((SELECT name_en FROM public.chart_of_accounts WHERE tenant_id='88000000-0000-4000-8000-000000000003' AND account_code='5000'),'Custom fuel','existing account configuration is preserved');
SELECT is((SELECT coa_account_code||'|'||vat_recoverability FROM public.expense_category_mappings WHERE tenant_id='88000000-0000-4000-8000-000000000003' AND expense_type='fuel'),'5200|non_recoverable','existing category mapping is preserved');

INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES('88000000-0000-4000-8000-000000000004','Fresh guarded mapping','Fresh guarded mapping','finance-guarded-mapping');
SELECT throws_ok($$INSERT INTO public.expense_category_mappings(tenant_id,expense_type,coa_account_code,vat_recoverability) VALUES('88000000-0000-4000-8000-000000000004','fuel','5200','non_recoverable')$$,'P0001','COA002: mapping requires an active account in this tenant','new canonical mapping cannot precede its active account');
SELECT is((SELECT count(*)::int FROM public.expense_category_mappings WHERE tenant_id='88000000-0000-4000-8000-000000000004'),0,'rejected fresh binding leaves no dangling mapping');
CREATE FUNCTION pg_temp.fail_company_finance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM public.tenants WHERE id=NEW.tenant_id AND domain='finance-company-fault.example.test') THEN
  RAISE EXCEPTION 'synthetic company finance fault';END IF;RETURN NEW;END $$;
CREATE TRIGGER trg_test_company_finance BEFORE INSERT ON public.expense_category_mappings FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_company_finance();
SELECT throws_ok($$SELECT public.provision_company_atomic('88000000-0000-4000-8000-000000000002','{"name":"Finance Fault Fixture","domain":"finance-company-fault.example.test","slug":"finance-company-fault"}')$$,'P0001','synthetic company finance fault','finance failure aborts the complete company transaction');
SELECT is((SELECT count(*)::int FROM public.tenants WHERE domain='finance-company-fault.example.test'),0,'finance failure leaves no tenant');
SELECT is((SELECT count(*)::int FROM public.users WHERE auth_user_id='88000000-0000-4000-8000-000000000002'),0,'finance failure leaves no owner profile');
DROP TRIGGER trg_test_company_finance ON public.expense_category_mappings;
SELECT lives_ok($$SELECT public.provision_company_atomic('88000000-0000-4000-8000-000000000002','{"name":"Finance Fault Fixture","domain":"finance-company-fault.example.test","slug":"finance-company-fault"}')$$,'retry after rolled-back finance failure succeeds');
SELECT is((SELECT count(*)::int FROM public.expense_category_mappings m JOIN public.tenants t ON t.id=m.tenant_id WHERE t.domain='finance-company-fault.example.test'),6,'recovered company has all mappings');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.ensure_default_chart_of_accounts('88000000-0000-4000-8000-000000000003')$$,'42501',NULL,'anonymous initialization denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.ensure_default_chart_of_accounts('88000000-0000-4000-8000-000000000003')$$,'42501',NULL,'browser cannot initialize an arbitrary tenant');
SELECT throws_ok($$SELECT public.provision_company_atomic('88000000-0000-4000-8000-000000000002','{}')$$,'42501',NULL,'browser cannot provision arbitrary company owners');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
