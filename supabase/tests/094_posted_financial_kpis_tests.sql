BEGIN;
SELECT no_plan();
SET LOCAL statement_timeout='30s';
-- A 1,201-entry fixture must fit a production request budget even with real
-- RLS. This is deliberately stricter than the old per-query 180s harness cap.

-- Synthetic full-schema fixtures only; every fixture and result rolls back.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('95000000-0000-4000-8000-000000000001','financial-kpi-owner@example.test','{"_invite_provisioned":true}'),
 ('95000000-0000-4000-8000-000000000002','financial-kpi-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE kpi_tenants AS
SELECT 'owner'::text label,(public.provision_company_atomic('95000000-0000-4000-8000-000000000001',
 '{"name":"Posted KPI Fixture","slug":"posted-kpi-fixture","domain":"posted-kpi.example.test"}')->>'id')::uuid id
UNION ALL SELECT 'foreign',(public.provision_company_atomic('95000000-0000-4000-8000-000000000002',
 '{"name":"Foreign KPI Fixture","slug":"foreign-kpi-fixture","domain":"foreign-kpi.example.test"}')->>'id')::uuid;
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN
 ('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002');
GRANT SELECT ON kpi_tenants TO authenticated;
SELECT ok((SELECT NOT prosecdef AND provolatile='s' AND 'search_path=""'=ANY(proconfig)
 FROM pg_proc WHERE oid='public.read_my_financial_kpis(date,date)'::regprocedure),'stable invoker and empty search path');
SELECT ok(NOT has_function_privilege('anon','public.read_my_financial_kpis(date,date)','execute'),'anonymous RPC execution denied');
SELECT ok(has_function_privilege('authenticated','public.read_my_financial_kpis(date,date)','execute'),'authenticated guarded entry point');
SELECT ok(position('SELECT' IN pg_get_expr(p.polqual,p.polrelid))>0
 AND position('get_my_tenant_id' IN pg_get_expr(p.polqual,p.polrelid))>0
 AND position('user_has_permission' IN pg_get_expr(p.polqual,p.polrelid))>0,
 'caller-wide tenant/RBAC checks use InitPlans without losing predicates: '||c.relname)
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND (c.relname,p.polname) IN
 (('journal_entries','sel_journal_entries_tenant'),('journal_entry_lines','sel_jel_tenant'),
 ('chart_of_accounts','sel_chart_of_accounts_tenant'),('receivables','sel_receivables_tenant')) AND p.polcmd='r';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(public.read_my_financial_kpis('2026-10-01','2026-10-21'),
 '{"revenue":"0.00","revenuePrevious":"0.00","invoicesCount":0,"invoicesCountPrevious":0,"pendingInvoicesAmount":"0.00","pendingInvoicesCount":0,"expenses":"0.00","expensesPrevious":"0.00","expensesCount":0,"netResult":"0.00"}'::jsonb,'empty ledger is genuinely zero');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
CREATE TEMP TABLE kpi_cases(id uuid DEFAULT gen_random_uuid(),label text,tenant_label text DEFAULT 'owner',
 entry_date date,entry_type text,source_type text,amount numeric,direction text,entry_id uuid DEFAULT gen_random_uuid(),
 draft boolean DEFAULT false,deleted boolean DEFAULT false);
INSERT INTO kpi_cases(label,entry_date,entry_type,source_type,amount,direction) VALUES
 ('paid','2026-10-01','invoice','invoice',100.15,'income_credit'),
 ('credited_original','2026-10-01','invoice','invoice',50.10,'income_credit'),
 ('credit','2026-10-03','reversal','credit_note',50.10,'income_debit'),
 ('manual_original','2026-09-30','manual','manual_entry',20.30,'income_credit'),
 ('manual_reversal','2026-10-01','reversal','manual_entry',20.30,'income_debit'),
 ('debit_note','2026-10-02','invoice','debit_note',30.25,'income_credit'),
 ('expense','2026-10-21','expense','expense',10.05,'expense_debit'),
 ('expense_previous','2026-09-10','expense','expense',5.05,'expense_debit'),
 ('previous','2026-09-10','invoice','invoice',40.11,'income_credit'),
 ('before_previous','2026-09-09','invoice','invoice',999,'income_credit'),
 ('after_end','2026-10-22','invoice','invoice',888,'income_credit'),
 ('draft','2026-10-05','invoice','invoice',700,'income_credit'),
 ('deleted','2026-10-05','invoice','invoice',600,'income_credit'),
 ('foreign','2026-10-05','invoice','invoice',999999,'income_credit');
UPDATE kpi_cases SET draft=true WHERE label='draft';
UPDATE kpi_cases SET deleted=true WHERE label='deleted';
UPDATE kpi_cases SET tenant_label='foreign' WHERE label='foreign';
INSERT INTO kpi_cases(label,entry_date,entry_type,source_type,amount,direction)
 SELECT 'bulk-'||i,'2026-10-10','invoice','invoice',0.01,'income_credit' FROM generate_series(1,1201) i;
-- Balanced real journal schema/constraints, avoiding a mocked aggregation table.
INSERT INTO public.journal_entries(id,tenant_id,entry_date,entry_type,source_entity_type,source_entity_id,deleted_at)
 SELECT c.entry_id,t.id,c.entry_date,c.entry_type::public.journal_entry_type,c.source_type,c.id,CASE WHEN c.deleted THEN now() END
 FROM kpi_cases c JOIN kpi_tenants t ON t.label=c.tenant_label;
INSERT INTO public.journal_entry_lines(tenant_id,journal_entry_id,account_id,debit_amount,credit_amount)
 SELECT t.id,c.entry_id,a.id,CASE WHEN c.direction IN ('income_debit','expense_debit') THEN c.amount ELSE 0 END,
 CASE WHEN c.direction='income_credit' THEN c.amount ELSE 0 END
 FROM kpi_cases c JOIN kpi_tenants t ON t.label=c.tenant_label
 JOIN public.chart_of_accounts a ON a.tenant_id=t.id AND a.account_code=CASE WHEN c.direction='expense_debit' THEN '5000' ELSE '4000' END
 UNION ALL
 SELECT t.id,c.entry_id,a.id,CASE WHEN c.direction='income_credit' THEN c.amount+CASE WHEN c.label='paid' THEN 15.02 ELSE 0 END ELSE 0 END,
 CASE WHEN c.direction IN ('income_debit','expense_debit') THEN c.amount ELSE 0 END
 FROM kpi_cases c JOIN kpi_tenants t ON t.label=c.tenant_label
 JOIN public.chart_of_accounts a ON a.tenant_id=t.id AND a.account_code='1000';
INSERT INTO public.journal_entry_lines(tenant_id,journal_entry_id,account_id,debit_amount,credit_amount)
 SELECT t.id,c.entry_id,a.id,0,15.02 FROM kpi_cases c JOIN kpi_tenants t ON t.label=c.tenant_label
 JOIN public.chart_of_accounts a ON a.tenant_id=t.id AND a.account_code='2500' WHERE c.label='paid';
UPDATE public.journal_entries j SET status='posted',posted_at=now()
 FROM kpi_cases c WHERE j.id=c.entry_id AND NOT c.draft;
UPDATE public.journal_entries SET status='reversed',reversed_entry_id=(SELECT entry_id FROM kpi_cases WHERE label='manual_reversal')
 WHERE id=(SELECT entry_id FROM kpi_cases WHERE label='manual_original');
-- Real document headers show that header state/amount cannot substitute for GL.
INSERT INTO public.customers(id,tenant_id,name_ar)
 SELECT '95000000-0000-4000-8000-000000000003',id,'KPI customer' FROM kpi_tenants WHERE label='owner';
INSERT INTO public.invoices(id,tenant_id,customer_id,issue_date,due_date,status,subtotal,vat_amount,total,vat_rate)
 SELECT c.id,t.id,'95000000-0000-4000-8000-000000000003','2026-10-01','2026-10-31',
 CASE WHEN c.label='paid' THEN 'paid'::public.invoice_status ELSE 'credited'::public.invoice_status END,c.amount,CASE WHEN c.label='paid' THEN 15.02 ELSE 0 END,c.amount+CASE WHEN c.label='paid' THEN 15.02 ELSE 0 END,0
 FROM kpi_cases c CROSS JOIN kpi_tenants t WHERE t.label='owner' AND c.label IN ('paid','credited_original');
INSERT INTO public.invoices(tenant_id,customer_id,issue_date,due_date,status,subtotal,vat_amount,total)
 SELECT t.id,'95000000-0000-4000-8000-000000000003','2026-10-01','2026-10-31','credited',1000,150,1150
 FROM kpi_tenants t CROSS JOIN generate_series(1,3) i WHERE t.label='owner';
INSERT INTO public.credit_notes(tenant_id,reference_invoice_id,customer_id,issue_date,reason,subtotal,vat_amount,total)
 SELECT i.tenant_id,i.id,i.customer_id,i.issue_date,'Synthetic imported example',1000,150,1150
 FROM public.invoices i JOIN kpi_tenants t ON t.id=i.tenant_id WHERE i.total=1150;
-- AR is total less paid across ALL dates, with a real posted source journal.
INSERT INTO public.receivables(tenant_id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status,source_entity_type,source_entity_id)
 SELECT t.id,c.label,c.entry_date,c.entry_date,c.amount,CASE WHEN c.label='paid' THEN 15.02 ELSE 0 END,c.amount+CASE WHEN c.label='paid' THEN 15.02 ELSE 0 END,
 CASE WHEN c.label='paid' THEN c.amount+15.02 WHEN c.label='debit_note' THEN 10.10 ELSE 0 END,
 CASE WHEN c.label='paid' THEN 'paid'::public.ar_ap_status WHEN c.label='debit_note' THEN 'partially_paid'::public.ar_ap_status ELSE 'open'::public.ar_ap_status END,
 c.source_type,c.id FROM kpi_cases c JOIN kpi_tenants t ON t.label=c.tenant_label
 WHERE c.label IN('paid','previous','debit_note','foreign') OR (CASE WHEN c.label LIKE 'bulk-%' THEN substring(c.label from 6)::int ELSE 99999 END<=1001);
INSERT INTO public.receivables(tenant_id,invoice_ref,invoice_date,due_date,amount,total_amount,paid_amount,status,source_entity_type,source_entity_id,deleted_at)
 SELECT t.id,x.label,'2026-10-01','2026-10-31',900,900,CASE WHEN x.label='settled' THEN 900 ELSE 0 END,
 CASE WHEN x.label='written_off' THEN 'written_off'::public.ar_ap_status ELSE 'open'::public.ar_ap_status END,
 CASE WHEN x.label='manual' THEN 'manual_entry' ELSE 'invoice' END,
 CASE WHEN x.label='unposted' THEN gen_random_uuid() ELSE (SELECT id FROM kpi_cases WHERE label='paid') END,
 CASE WHEN x.label='archived' THEN now() END
 FROM kpi_tenants t CROSS JOIN (VALUES('unposted'),('archived'),('written_off'),('settled'),('manual')) x(label) WHERE t.label='owner';
CREATE TEMP TABLE kpi_before AS SELECT (SELECT count(*) FROM public.journal_entries) journals,
 (SELECT count(*) FROM public.journal_entry_lines) lines,(SELECT count(*) FROM public.receivables) ar,
 (SELECT count(*) FROM public.invoices) invoices,(SELECT count(*) FROM public.audit_log) audits,
 (SELECT sum(total_amount) FROM public.receivables) ar_total;
GRANT SELECT ON kpi_before TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
CREATE TEMP TABLE kpi_result AS SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21') result;
SELECT is((SELECT (result->>'revenue')::numeric FROM kpi_result),122.11::numeric,'all 1201 tiny postings, paid revenue, credits and dated reversal net exactly; unposted examples excluded');
SELECT is((SELECT (result->>'revenuePrevious')::numeric FROM kpi_result),60.41::numeric,'previous inclusive 21-day window includes September 10 and reversed original on September 30, excludes September 9');
SELECT is((SELECT (result->>'invoicesCount')::int FROM kpi_result),1203,'posted paid and credited original invoices counted, note/manual/draft/deleted/foreign sources excluded');
SELECT is((SELECT (result->>'invoicesCountPrevious')::int FROM kpi_result),1,'previous invoice count uses posting date and same inclusive window');
SELECT is((SELECT (result->>'expenses')::numeric FROM kpi_result),10.05::numeric,'posted expense cents on inclusive end date');
SELECT is((SELECT (result->>'expensesPrevious')::numeric FROM kpi_result),5.05::numeric,'previous expense uses inclusive previous start');
SELECT is((SELECT (result->>'expensesCount')::int FROM kpi_result),1,'expense counts have actual posted sources');
SELECT is((SELECT (result->>'netResult')::numeric FROM kpi_result),112.06::numeric,'exact two-decimal net income');
SELECT is((SELECT (result->>'pendingInvoicesAmount')::numeric FROM kpi_result),70.27::numeric,'full AR beyond row cap uses remaining balance including old invoice/debit note, excludes settled/deleted/unposted/manual/written-off/foreign');
SELECT is((SELECT (result->>'pendingInvoicesCount')::int FROM kpi_result),1003,'all positive active posted invoice/debit-note balances counted');
SELECT is((SELECT jsonb_typeof(result->'revenue') FROM kpi_result),'string','exact money crosses RPC as decimal string');
SELECT is((SELECT count(*)::int FROM kpi_result CROSS JOIN LATERAL jsonb_object_keys(result)),10,'aggregate only, no private document rows');
SELECT is(public.read_my_financial_kpis('2026-10-01','2026-10-21'),(SELECT result FROM kpi_result),'stable read is repeatable');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.journal_entries),(SELECT journals FROM kpi_before),'reads do not change journals');
SELECT is((SELECT count(*) FROM public.journal_entry_lines),(SELECT lines FROM kpi_before),'reads do not change lines');
SELECT is((SELECT count(*) FROM public.receivables),(SELECT ar FROM kpi_before),'reads do not create/repair AR');
SELECT is((SELECT sum(total_amount) FROM public.receivables),(SELECT ar_total FROM kpi_before),'reads preserve AR money');
SELECT is((SELECT count(*) FROM public.invoices),(SELECT invoices FROM kpi_before),'reads leave all imported headers intact');
SELECT is((SELECT count(*) FROM public.audit_log),(SELECT audits FROM kpi_before),'read-only summary emits no mutations/audit decisions');
SET LOCAL ROLE authenticated;
SELECT is((public.read_my_financial_kpis('2026-10-01','2026-10-01')->>'revenue')::numeric,129.95::numeric,'one-day inclusive window includes both invoices and dated reversal');
SELECT is((public.read_my_financial_kpis('2026-10-01','2026-10-01')->>'revenuePrevious')::numeric,20.30::numeric,'one-day comparison is previous day, including reversed original');
SELECT throws_ok($$SELECT public.read_my_financial_kpis(NULL,'2026-10-01')$$,'22023','Invalid financial KPI date range','null start rejected');
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01',NULL)$$,'22023','Invalid financial KPI date range','null end rejected');
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-21','2026-10-01')$$,'22023','Invalid financial KPI date range','reversed period rejected');
SELECT throws_ok($$SELECT public.read_my_financial_kpis('-infinity','infinity')$$,'22023','Invalid financial KPI date range','infinite period rejected');
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-02-30','2026-03-01')$$,'22008',NULL,'impossible calendar date rejected');
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21','95000000-0000-4000-8000-000000000002'::uuid)$$,'42883',NULL,'no arbitrary tenant overload');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21')$$,'42501','Financial KPI access denied','privileged AAL1 denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is((public.read_my_financial_kpis('2026-10-01','2026-10-21')->>'revenue')::numeric,999999::numeric,'foreign tenant sees only its own ledger');
SELECT set_config('request.jwt.claims','{}',true);
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21')$$,'42501','Financial KPI access denied','missing JWT denied');
RESET ROLE;
-- Role and account state gates are the same shared RBAC/MFA boundary as VAT.
UPDATE public.users SET must_change_password=true WHERE auth_user_id='95000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21')$$,'42501','Financial KPI access denied','forced password gate');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET must_change_password=false,status='inactive' WHERE auth_user_id='95000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21')$$,'42501','Financial KPI access denied','inactive caller denied');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET status='active',locked_until=now()+interval '1 hour' WHERE auth_user_id='95000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21')$$,'42501','Financial KPI access denied','locked caller denied');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.users SET locked_until=NULL WHERE auth_user_id='95000000-0000-4000-8000-000000000001';
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('95000000-0000-4000-8000-000000000004','financial-kpi-accountant@example.test','{"_invite_provisioned":true}');
INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
 SELECT '95000000-0000-4000-8000-000000000004',id,'financial-kpi-accountant@example.test','accountant','active',false FROM kpi_tenants WHERE label='owner';
DELETE FROM public.role_permissions WHERE role_id IN(SELECT r.id FROM public.roles r JOIN kpi_tenants t ON t.id=r.tenant_id WHERE t.label='owner' AND r.name='accountant');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21')$$,'42501','Financial KPI access denied','role without accounting read denied');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines),0,'underlying GL RLS remains private to accounting role');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.read_my_financial_kpis('2026-10-01','2026-10-21')$$,'42501','Financial KPI access denied','service key without user is not a caller');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
