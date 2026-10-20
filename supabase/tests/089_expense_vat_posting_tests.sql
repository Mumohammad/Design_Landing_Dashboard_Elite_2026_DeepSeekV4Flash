BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('89000000-0000-4000-8000-000000000001','expense-vat-posting@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE expense_vat_company AS SELECT (public.provision_company_atomic(
 '89000000-0000-4000-8000-000000000001','{"name":"Expense VAT Fixture","domain":"expense-vat-posting.example.test","slug":"expense-vat-posting"}')->>'id')::uuid AS id;
CREATE TEMP TABLE expense_vat_cases(id uuid DEFAULT gen_random_uuid(),label text,net numeric,rate numeric,vat numeric,total numeric,classification text,line_count int);
INSERT INTO expense_vat_cases(label,net,rate,vat,total,classification,line_count) VALUES
 ('zero VAT',100,0,0,100,'recoverable',2),
 ('nonrecoverable VAT',100,15,15,115,'non_recoverable',2),
 ('recoverable VAT',100,15,15,115,'recoverable',3),
 ('VAT pending review',100,15,15,115,'pending_review',2),
 ('VAT rounds to zero',0.01,15,0,0.01,'recoverable',2);
INSERT INTO public.expenses(id,tenant_id,expense_type,amount,expense_date)
SELECT c.id,t.id,'fuel',c.net,CURRENT_DATE FROM expense_vat_cases c CROSS JOIN expense_vat_company t;
SELECT lives_ok(format('SELECT public.approve_expense_atomic(%L,%L,%s,%L,%L)',t.id,c.id,c.rate,c.classification,'89000000-0000-4000-8000-000000000001'),c.label||' approval commits')
FROM expense_vat_cases c CROSS JOIN expense_vat_company t;
SELECT lives_ok(format('SELECT public.dispatch_expense_approved(e) FROM public.financial_events e WHERE e.tenant_id=%L AND e.source_id=%L',t.id,c.id),c.label||' posts successfully')
FROM expense_vat_cases c CROSS JOIN expense_vat_company t;
SELECT is((SELECT count(*)::int FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.source_entity_type='expense' AND j.source_entity_id=c.id),c.line_count,c.label||' has only nonzero lines') FROM expense_vat_cases c;
SELECT is((SELECT sum(l.debit_amount) FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.source_entity_type='expense' AND j.source_entity_id=c.id),c.total,c.label||' debit equals payable total') FROM expense_vat_cases c;
SELECT is((SELECT sum(l.credit_amount) FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.source_entity_type='expense' AND j.source_entity_id=c.id),c.total,c.label||' credit balances debit') FROM expense_vat_cases c;
SELECT is((SELECT COALESCE(sum(l.debit_amount),0) FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id JOIN public.chart_of_accounts a ON a.id=l.account_id WHERE j.source_entity_id=c.id AND a.account_code='2600'),CASE WHEN c.classification='recoverable' THEN c.vat ELSE 0 END,c.label||' claims only recoverable input VAT') FROM expense_vat_cases c;
SELECT is((SELECT sum(l.debit_amount) FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id JOIN public.chart_of_accounts a ON a.id=l.account_id WHERE j.source_entity_id=c.id AND a.account_code='5000'),CASE WHEN c.classification='recoverable' THEN c.net ELSE c.total END,c.label||' expense debit follows classification') FROM expense_vat_cases c;
SELECT is((SELECT vat_amount FROM public.vat_input_ledger WHERE source_entity_type='expense' AND source_entity_id=c.id),c.vat,c.label||' retains actual VAT amount') FROM expense_vat_cases c;
SELECT is((SELECT vat_recoverability FROM public.vat_input_ledger WHERE source_entity_type='expense' AND source_entity_id=c.id),c.classification,c.label||' retains VAT classification') FROM expense_vat_cases c;
SELECT is((SELECT public.dispatch_expense_approved(e) FROM public.financial_events e WHERE e.source_id=c.id),'skipped',c.label||' replay skips the existing posting') FROM expense_vat_cases c;
SELECT is((SELECT count(*)::int FROM public.vat_input_ledger l JOIN expense_vat_cases c ON c.id=l.source_entity_id),5,'replay does not duplicate VAT rows');
SELECT is((SELECT count(*)::int FROM public.journal_entries j JOIN expense_vat_cases c ON c.id=j.source_entity_id),5,'replay does not duplicate journals');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id JOIN expense_vat_cases c ON c.id=j.source_entity_id WHERE l.debit_amount=0 AND l.credit_amount=0),0,'consumer emits no empty journal line');

SELECT throws_ok($$SELECT public.post_journal_entry((SELECT id FROM expense_vat_company),CURRENT_DATE,'Strict zero line fixture',
 jsonb_build_array(
  jsonb_build_object('account_id',(SELECT id FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM expense_vat_company) AND account_code='5000'),'debit',100,'credit',0),
  jsonb_build_object('account_id',(SELECT id FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM expense_vat_company) AND account_code='2000'),'debit',0,'credit',100),
  jsonb_build_object('account_id',(SELECT id FROM public.chart_of_accounts WHERE tenant_id=(SELECT id FROM expense_vat_company) AND account_code='2600'),'debit',0,'credit',0)))$$,
 'P0001','JRN007: each line must be single-sided (debit XOR credit)','journal engine still refuses zero-value lines');

CREATE TEMP TABLE expense_vat_edges(label text,id uuid DEFAULT gen_random_uuid());
INSERT INTO expense_vat_edges(label) VALUES('closed'),('unapproved');
INSERT INTO public.expenses(id,tenant_id,expense_type,amount,expense_date)
SELECT e.id,t.id,'fuel',100,CASE WHEN e.label='closed' THEN '2099-11-01'::date ELSE CURRENT_DATE END FROM expense_vat_edges e CROSS JOIN expense_vat_company t;
SELECT public.approve_expense_atomic((SELECT id FROM expense_vat_company),(SELECT id FROM expense_vat_edges WHERE label='closed'),0,'recoverable','89000000-0000-4000-8000-000000000001');
INSERT INTO public.accounting_periods(tenant_id,period_year,period_month,status) SELECT id,2099,11,'closed' FROM expense_vat_company;
SELECT throws_ok($$SELECT public.dispatch_expense_approved(e) FROM public.financial_events e WHERE e.source_id=(SELECT id FROM expense_vat_edges WHERE label='closed')$$,'P0001','ACC001: the accounting period for this date is closed','zero VAT does not bypass closed-period protection');
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE source_entity_id=(SELECT id FROM expense_vat_edges WHERE label='closed')),0,'closed period leaves no journal');
SELECT is((SELECT count(*)::int FROM public.vat_input_ledger WHERE source_entity_id=(SELECT id FROM expense_vat_edges WHERE label='closed')),0,'closed period leaves no VAT row');
INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
SELECT t.id,gen_random_uuid(),'expense:'||e.id::text||':unapproved-fixture','expense',e.id,'ExpenseApprovedEvent',CURRENT_DATE,'{}' FROM expense_vat_edges e CROSS JOIN expense_vat_company t WHERE e.label='unapproved';
SELECT throws_ok($$SELECT public.dispatch_expense_approved(e) FROM public.financial_events e WHERE e.source_id=(SELECT id FROM expense_vat_edges WHERE label='unapproved')$$,'P0001',format('DSP001: source expense %s not found',(SELECT id FROM expense_vat_edges WHERE label='unapproved')),'unapproved source cannot post');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.dispatch_expense_approved(NULL::public.financial_events)$$,'42501',NULL,'anonymous consumer execution denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.dispatch_expense_approved(NULL::public.financial_events)$$,'42501',NULL,'browser consumer execution denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
