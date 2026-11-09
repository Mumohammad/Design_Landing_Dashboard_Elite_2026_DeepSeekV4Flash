BEGIN;
SELECT no_plan();
SET LOCAL statement_timeout='120s';
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('96400000-0000-4000-8000-000000000001','financial-report-owner@example.test','{"_invite_provisioned":true}'),
 ('96400000-0000-4000-8000-000000000002','financial-report-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE report_tenants AS
SELECT 'owner'::text label,(public.provision_company_atomic('96400000-0000-4000-8000-000000000001',
 '{"name":"Posted KPI Fixture","slug":"financial-report-fixture","domain":"financial-report.example.test"}')->>'id')::uuid id
UNION ALL SELECT 'foreign',(public.provision_company_atomic('96400000-0000-4000-8000-000000000002',
 '{"name":"Foreign KPI Fixture","slug":"foreign-report-fixture","domain":"foreign-report.example.test"}')->>'id')::uuid;
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN
 ('96400000-0000-4000-8000-000000000001','96400000-0000-4000-8000-000000000002');
GRANT SELECT ON report_tenants TO authenticated;
CREATE TEMP TABLE report_cases(id uuid DEFAULT gen_random_uuid(),label text,tenant_label text DEFAULT 'owner',
 entry_date date,entry_type text,source_type text,amount numeric,direction text,entry_id uuid DEFAULT gen_random_uuid(),
 draft boolean DEFAULT false,deleted boolean DEFAULT false);
INSERT INTO report_cases(label,entry_date,entry_type,source_type,amount,direction) VALUES
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
UPDATE report_cases SET draft=true WHERE label='draft';
UPDATE report_cases SET deleted=true WHERE label='deleted';
UPDATE report_cases SET tenant_label='foreign' WHERE label='foreign';
INSERT INTO report_cases(label,entry_date,entry_type,source_type,amount,direction)
 SELECT 'bulk-'||i,'2026-10-10','invoice','invoice',0.01,'income_credit' FROM generate_series(1,1201) i;
-- Balanced real journal schema/constraints, avoiding a mocked aggregation table.
INSERT INTO public.journal_entries(id,tenant_id,entry_date,entry_type,source_entity_type,source_entity_id,deleted_at)
 SELECT c.entry_id,t.id,c.entry_date,c.entry_type::public.journal_entry_type,c.source_type,c.id,CASE WHEN c.deleted THEN now() END
 FROM report_cases c JOIN report_tenants t ON t.label=c.tenant_label;
INSERT INTO public.journal_entry_lines(tenant_id,journal_entry_id,account_id,debit_amount,credit_amount)
 SELECT t.id,c.entry_id,a.id,CASE WHEN c.direction IN ('income_debit','expense_debit') THEN c.amount ELSE 0 END,
 CASE WHEN c.direction='income_credit' THEN c.amount ELSE 0 END
 FROM report_cases c JOIN report_tenants t ON t.label=c.tenant_label
 JOIN public.chart_of_accounts a ON a.tenant_id=t.id AND a.account_code=CASE WHEN c.direction='expense_debit' THEN '5000' ELSE '4000' END
 UNION ALL
 SELECT t.id,c.entry_id,a.id,CASE WHEN c.direction='income_credit' THEN c.amount+CASE WHEN c.label='paid' THEN 15.02 ELSE 0 END ELSE 0 END,
 CASE WHEN c.direction IN ('income_debit','expense_debit') THEN c.amount ELSE 0 END
 FROM report_cases c JOIN report_tenants t ON t.label=c.tenant_label
 JOIN public.chart_of_accounts a ON a.tenant_id=t.id AND a.account_code='1000';
INSERT INTO public.journal_entry_lines(tenant_id,journal_entry_id,account_id,debit_amount,credit_amount)
 SELECT t.id,c.entry_id,a.id,0,15.02 FROM report_cases c JOIN report_tenants t ON t.label=c.tenant_label
 JOIN public.chart_of_accounts a ON a.tenant_id=t.id AND a.account_code='2500' WHERE c.label='paid';
UPDATE public.journal_entries j SET status='posted',posted_at=now()
 FROM report_cases c WHERE j.id=c.entry_id AND NOT c.draft;
UPDATE public.journal_entries SET status='reversed',reversed_entry_id=(SELECT entry_id FROM report_cases WHERE label='manual_reversal')
 WHERE id=(SELECT entry_id FROM report_cases WHERE label='manual_original');

SELECT ok((SELECT NOT prosecdef AND provolatile='s' AND 'search_path=""'=ANY(proconfig) FROM pg_proc WHERE oid='public.read_my_financial_report(text,integer,integer)'::regprocedure),'report reader is a stable invoker with empty search path');
SELECT ok(NOT has_function_privilege('anon','public.read_my_financial_report(text,integer,integer)','execute'),'anonymous report execution denied');
SELECT ok(NOT has_function_privilege('anon','public.resolve_my_vat_review(uuid,text)','execute'),'anonymous VAT review execution denied');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96400000-0000-4000-8000-000000000001","aal":"aal2"}',true);
CREATE TEMP TABLE reports AS SELECT public.read_my_financial_report('statements',2026,10) report;
SELECT is((SELECT sum((r->>'net_balance')::numeric) FROM reports,jsonb_array_elements(report->'profit_loss') r WHERE r->>'account_type'='income'),1010.11::numeric,'October income includes dated reversal, after-end source, credits and all bulk cents; excludes draft/deleted/foreign');
SELECT is((SELECT sum((r->>'net_balance')::numeric) FROM reports,jsonb_array_elements(report->'profit_loss') r WHERE r->>'account_type'='expense'),-10.05::numeric,'expense reporting uses exact posted lines');
SELECT is((SELECT (r->>'balance')::numeric FROM reports,jsonb_array_elements(report->'balance_sheet') r WHERE r->>'account_code'='__UNCLOSED_RESULT__'),2054.42::numeric,'cumulative unclosed result includes historical original and current reversal without a fabricated journal');
SELECT is((SELECT sum(CASE WHEN r->>'account_type'='asset' THEN (r->>'balance')::numeric ELSE -(r->>'balance')::numeric END) FROM reports,jsonb_array_elements(report->'balance_sheet') r),0::numeric,'assets equal liabilities plus equity including unclosed result');
SELECT is((SELECT sum((r->>'net_cash_flow')::numeric) FROM reports,jsonb_array_elements(report->'cash_flow') r),1015.08::numeric,'cash movement preserves actual period and posted VAT');
SELECT is((SELECT sum((r->>'net_balance')::numeric) FROM jsonb_array_elements(public.read_my_financial_report('statements',2026,9)->'profit_loss')r WHERE r->>'account_type'='income'),1059.41::numeric,'reversed September original remains in its historical period');
SELECT throws_ok($$SELECT public.read_my_financial_report('statements',2026,13)$$,'22023','Invalid financial report period','invalid period rejected');
SELECT throws_ok($$SELECT public.read_my_financial_report('arbitrary',2026,10)$$,'22023','Invalid financial report request','unrecognized report rejected');
SELECT throws_ok($$SELECT public.read_my_financial_report('statements',2026,10,'96400000-0000-4000-8000-000000000002'::uuid)$$,'42883',NULL,'no arbitrary tenant overload');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
-- One mapped bank GL outside 1000/1100 must not disappear from cash movement.
INSERT INTO public.chart_of_accounts(tenant_id,account_code,name_ar,name_en,account_type,normal_balance)
 SELECT id,'1155','بنك اختباري','Mapped bank fixture','asset','debit' FROM report_tenants WHERE label='owner';
INSERT INTO public.bank_accounts(tenant_id,bank_name,account_name,iban,coa_account_code)
 SELECT id,'Synthetic bank','Report fixture','SA0380000000608010167519','1155' FROM report_tenants WHERE label='owner';
CREATE TEMP TABLE mapped_entry AS SELECT gen_random_uuid() id;
INSERT INTO public.journal_entries(id,tenant_id,entry_date,entry_type) SELECT m.id,t.id,'2026-10-15','manual' FROM mapped_entry m,report_tenants t WHERE t.label='owner';
INSERT INTO public.journal_entry_lines(tenant_id,journal_entry_id,account_id,debit_amount,credit_amount)
 SELECT t.id,m.id,a.id,CASE WHEN a.account_code='1155' THEN 7 ELSE 0 END,CASE WHEN a.account_code='3000' THEN 7 ELSE 0 END
 FROM mapped_entry m,report_tenants t JOIN public.chart_of_accounts a ON a.tenant_id=t.id AND a.account_code IN('1155','3000') WHERE t.label='owner';
UPDATE public.journal_entries SET status='posted' WHERE id=(SELECT id FROM mapped_entry);
-- More than 1,000 pending VAT rows and periods exercise JSON aggregation.
INSERT INTO public.vat_output_ledger(tenant_id,period_year,period_month,invoice_ref,invoice_date,vat_amount)
 SELECT t.id,1900+(i-1)/12,1+(i-1)%12,'REPORT-'||i,'2026-10-01',0.01 FROM report_tenants t,generate_series(1,1201)i WHERE t.label='owner';
CREATE TEMP TABLE review_ids AS SELECT gen_random_uuid() id,i FROM generate_series(1,1201)i;
GRANT SELECT ON review_ids TO authenticated;
INSERT INTO public.vat_input_ledger(id,tenant_id,period_year,period_month,invoice_ref,invoice_date,vat_amount,vat_recoverability)
 SELECT r.id,t.id,2026,10,'REVIEW-'||r.i,DATE '2026-10-01'+(r.i%20),0.01,'pending_review' FROM report_tenants t,review_ids r WHERE t.label='owner';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96400000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((SELECT sum((r->>'net_cash_flow')::numeric) FROM jsonb_array_elements(public.read_my_financial_report('statements',2026,10)->'cash_flow')r),1022.08::numeric,'mapped bank movement beyond fixed account codes included');
SELECT is(jsonb_array_length(public.read_my_financial_report('vat')),1202,'all 1201 historical VAT periods plus current review period returned beyond API cap');
SELECT is(jsonb_array_length(public.read_my_financial_report('vat_review')),1201,'all pending VAT rows beyond API and old UI cap');
SELECT is((public.read_my_financial_report('vat_return',2026,10)->>'pending_review_rows')::int,1201,'one-period summary contains all pending rows');
SELECT is(public.read_my_financial_report('vat_return',1800,1),NULL::jsonb,'missing period is not a fake zero');
SELECT throws_ok($$SELECT public.resolve_my_vat_review((SELECT id FROM review_ids WHERE i=1),'recoverable')$$,'P0001','VAT007: source posting requires finance review','unknown imported classification is held for finance review; actual posted-source resolution is tested in142');
SELECT is((SELECT vat_recoverability FROM public.vat_input_ledger WHERE id=(SELECT id FROM review_ids WHERE i=1)),'pending_review','unknown imported source remains pending');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id=(SELECT id FROM review_ids WHERE i=1) AND action='vat_review_item_resolved'),0::bigint,'blocked imported source creates no decision audit');
SELECT throws_ok($$SELECT public.resolve_my_vat_review((SELECT id FROM review_ids WHERE i=1),'non_recoverable')$$,'P0001','VAT007: source posting requires finance review','retry cannot invent source accounting for an imported VAT row');
SELECT throws_ok($$UPDATE public.vat_input_ledger SET vat_recoverability='non_recoverable' WHERE id=(SELECT id FROM review_ids WHERE i=2)$$,'42501',NULL,'direct authenticated review cannot bypass transactional audit');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_report_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='vat_review_item_resolved' THEN RAISE EXCEPTION 'Test VAT audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_report_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_report_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.resolve_my_vat_review((SELECT id FROM review_ids WHERE i=2),'recoverable')$$,'P0001','VAT007: source posting requires finance review','unproven source is rejected before any attempted audit; real audit rollback is tested in142');
SELECT is((SELECT vat_recoverability FROM public.vat_input_ledger WHERE id=(SELECT id FROM review_ids WHERE i=2)),'pending_review','failed audit leaves pending input unchanged');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96400000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is(jsonb_array_length(public.read_my_financial_report('vat_review')),0,'foreign tenant cannot enumerate pending rows');
SELECT throws_ok($$SELECT public.resolve_my_vat_review((SELECT id FROM review_ids WHERE i=3),'recoverable')$$,'P0001','VAT005: review item not found','foreign classification target rejected');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96400000-0000-4000-8000-000000000001","aal":"aal2"}',true);
CREATE TEMP TABLE vat_documents AS SELECT public.create_my_vat_return_document(2026,10) doc;
GRANT SELECT ON vat_documents TO service_role;
SELECT ok((SELECT doc->>'doc_number' LIKE 'VAT-RET-2026-10-%' FROM vat_documents),'snapshot has its own immutable document number');
SELECT ok((SELECT doc->>'verify_url' ~ '^/verify-document/[a-f0-9]{64}$' FROM vat_documents),'snapshot verification uses an opaque token');
SELECT is((SELECT jsonb_typeof(doc->'data'->'output_vat') FROM vat_documents),'string','exact money crosses JSON as decimal text');
SELECT ok((SELECT (public.create_my_vat_return_document(2026,10)->>'id') <> (doc->>'id') FROM vat_documents),'repeat exports create a fresh snapshot instead of replacing financial history');
SELECT is((SELECT count(*) FROM public.audit_log WHERE entity_id=(SELECT (doc->>'id')::uuid FROM vat_documents) AND action='vat_return_report_generated'),1::bigint,'snapshot and audit commit together');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE public.generated_documents SET generated_data='{}' WHERE id=(SELECT (doc->>'id')::uuid FROM vat_documents)$$,'55000','VAT return snapshots are immutable; generate a new report','backend cannot rewrite an exported VAT snapshot');
SELECT throws_ok($$DELETE FROM public.generated_documents WHERE id=(SELECT (doc->>'id')::uuid FROM vat_documents)$$,'55000','VAT return snapshots are immutable; generate a new report','backend cannot delete a VAT snapshot');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96400000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.read_my_financial_report('periods')$$,'42501','Financial report access denied','privileged low-assurance report request denied');
RESET ROLE;
-- Independent balanced fixture: statement signs must use the accounting
-- equation rather than each account's natural balance. No earlier snapshot
-- expectations change, and no historical business rows are modified.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('96400000-0000-4000-8000-000000000003','financial-contra-owner@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE sign_report_tenant AS SELECT (public.provision_company_atomic('96400000-0000-4000-8000-000000000003','{"name":"Contra statement fixture","slug":"contra-statement-fixture","domain":"contra-statement.example.test"}')->>'id')::uuid id;
UPDATE public.users SET must_change_password=false WHERE auth_user_id='96400000-0000-4000-8000-000000000003';
GRANT SELECT ON sign_report_tenant TO authenticated;
INSERT INTO public.chart_of_accounts(tenant_id,account_code,name_ar,name_en,account_type,normal_balance,is_contra)
 SELECT id,'1691','مجمع إهلاك اختباري','Synthetic accumulated depreciation','asset'::public.account_type,'credit'::public.account_normal_balance,true FROM sign_report_tenant
 UNION ALL SELECT id,'3091','حساب مقابل حقوق الملكية','Synthetic contra equity','equity'::public.account_type,'debit'::public.account_normal_balance,true FROM sign_report_tenant;
CREATE TEMP TABLE sign_report_entries(label text,id uuid DEFAULT gen_random_uuid());
INSERT INTO sign_report_entries(label) VALUES('depreciation'),('contra_equity'),('overdrawn_cash');
INSERT INTO public.journal_entries(id,tenant_id,entry_date,entry_type) SELECT e.id,t.id,'2026-01-15','manual' FROM sign_report_entries e CROSS JOIN sign_report_tenant t;
INSERT INTO public.journal_entry_lines(tenant_id,journal_entry_id,account_id,debit_amount,credit_amount)
 SELECT t.id,e.id,a.id,CASE WHEN v.side='debit' THEN v.amount ELSE 0 END,CASE WHEN v.side='credit' THEN v.amount ELSE 0 END
 FROM (VALUES('depreciation','5700','debit',100::numeric),('depreciation','1691','credit',100),('contra_equity','3091','debit',40),('contra_equity','3000','credit',40),('overdrawn_cash','5000','debit',75),('overdrawn_cash','1000','credit',75)) v(label,account_code,side,amount)
 JOIN sign_report_entries e ON e.label=v.label CROSS JOIN sign_report_tenant t JOIN public.chart_of_accounts a ON a.tenant_id=t.id AND a.account_code=v.account_code;
UPDATE public.journal_entries SET status='posted' WHERE id IN(SELECT id FROM sign_report_entries);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"96400000-0000-4000-8000-000000000003","aal":"aal2"}',true);
CREATE TEMP TABLE sign_report AS SELECT public.read_my_financial_report('statements',2026,1) report;
SELECT is((SELECT (r->>'balance')::numeric FROM sign_report,jsonb_array_elements(report->'balance_sheet')r WHERE r->>'account_code'='1691'),-100::numeric,'credit-normal accumulated depreciation reduces assets');
SELECT is((SELECT (r->>'balance')::numeric FROM sign_report,jsonb_array_elements(report->'balance_sheet')r WHERE r->>'account_code'='3091'),-40::numeric,'debit-normal contra equity reduces equity');
SELECT is((SELECT (r->>'balance')::numeric FROM sign_report,jsonb_array_elements(report->'balance_sheet')r WHERE r->>'account_code'='1000'),-75::numeric,'overdrawn debit-normal cash retains its negative asset sign');
SELECT is((SELECT (r->>'balance')::numeric FROM sign_report,jsonb_array_elements(report->'balance_sheet')r WHERE r->>'account_code'='__UNCLOSED_RESULT__'),-175::numeric,'unclosed loss retains its negative equity sign');
SELECT is((SELECT sum(CASE WHEN r->>'account_type'='asset' THEN (r->>'balance')::numeric ELSE -(r->>'balance')::numeric END) FROM sign_report,jsonb_array_elements(report->'balance_sheet')r),0::numeric,'contra assets, contra equity and overdraft preserve the balanced accounting equation');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
