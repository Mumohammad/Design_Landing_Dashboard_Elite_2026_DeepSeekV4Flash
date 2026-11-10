BEGIN;
SELECT no_plan();
-- Fresh synthetic real-schema fixtures, rolled back after this suite. The
-- separate native runner installs the guard immediately after legacy 038.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('95000000-0000-4000-8000-000000000001','legacy-finance-guard@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE legacy_finance_tenant AS SELECT (public.provision_company_atomic(
 '95000000-0000-4000-8000-000000000001',
 '{"name":"Legacy Finance Guard Fixture","domain":"legacy-finance-guard.example.test","slug":"legacy-finance-guard"}')->>'id')::uuid AS id;
UPDATE public.users SET must_change_password=false WHERE auth_user_id='95000000-0000-4000-8000-000000000001';
INSERT INTO public.customers(id,tenant_id,name_ar)
 SELECT '95000000-0000-4000-8000-000000000002',id,'Guard customer' FROM legacy_finance_tenant;
INSERT INTO public.suppliers(id,tenant_id,name_ar)
 SELECT '95000000-0000-4000-8000-000000000003',id,'Guard supplier' FROM legacy_finance_tenant;
CREATE TEMP TABLE legacy_finance_cases(kind text PRIMARY KEY,input jsonb,draft jsonb,id uuid);
INSERT INTO legacy_finance_cases(kind,input) SELECT kind,jsonb_build_object(
 'invoice_type',kind,'currency','SAR','vat_rate',15,
 'customer_id',CASE WHEN kind='sales' THEN '95000000-0000-4000-8000-000000000002' END,
 'supplier_id',CASE WHEN kind='purchase' THEN '95000000-0000-4000-8000-000000000003' END,
 'issue_date',(now() AT TIME ZONE 'Asia/Riyadh')::date,'due_date',(now() AT TIME ZONE 'Asia/Riyadh')::date,
 'lines','[{"description":"Guard item","quantity":1,"unit_price":100,"vat_rate":15}]'::jsonb)
 FROM (VALUES('sales'),('purchase')) kinds(kind);
CREATE TEMP TABLE legacy_finance_balances(kind text,source text,id uuid DEFAULT gen_random_uuid());
INSERT INTO legacy_finance_balances(kind,source) VALUES
 ('receivables','invoice'),('receivables','debit_note'),('payables','purchase_invoice'),('payables','expense'),
 ('receivables','manual'),('payables','manual');
INSERT INTO public.receivables(id,tenant_id,invoice_ref,invoice_date,due_date,source_entity_type)
 SELECT b.id,t.id,'Guard AR '||source,current_date,current_date,source
 FROM legacy_finance_balances b CROSS JOIN legacy_finance_tenant t WHERE kind='receivables';
INSERT INTO public.payables(id,tenant_id,invoice_ref,invoice_date,due_date,source_entity_type)
 SELECT b.id,t.id,'Guard AP '||source,current_date,current_date,source
 FROM legacy_finance_balances b CROSS JOIN legacy_finance_tenant t WHERE kind='payables';
GRANT SELECT ON legacy_finance_tenant,legacy_finance_balances TO service_role,authenticated;
GRANT ALL ON legacy_finance_cases TO service_role,authenticated;
SELECT ok(NOT prosecdef,'guard uses invoking execution role') FROM pg_proc
 WHERE oid IN ('public.block_legacy_finance_service_write()'::regprocedure,'public.block_legacy_document_balance_write()'::regprocedure);
SELECT is(proconfig,ARRAY['search_path=""']::text[],'guard pins an empty search path') FROM pg_proc
 WHERE oid IN ('public.block_legacy_finance_service_write()'::regprocedure,'public.block_legacy_document_balance_write()'::regprocedure);
SELECT ok(NOT has_function_privilege(r,f,'EXECUTE'),r||' cannot call trigger function '||f)
 FROM (VALUES('anon'),('authenticated'),('service_role')) roles(r)
 CROSS JOIN (VALUES('public.block_legacy_finance_service_write()'),('public.block_legacy_document_balance_write()')) funcs(f);
SELECT ok(has_table_privilege('service_role','public.'||t,'UPDATE'),'source UPDATE privilege retained for FOR SHARE: '||t)
 FROM (VALUES('invoices'),('credit_notes'),('debit_notes')) tables(t);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"95000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT lives_ok($$UPDATE legacy_finance_cases SET draft=public.save_invoice_draft(input)$$,'actual caller-bound draft engines pass the service guard');
UPDATE legacy_finance_cases SET id=(draft->>'id')::uuid;
RESET ROLE;
CREATE TEMP TABLE legacy_finance_before AS SELECT c.id,i.updated_at,i.status,
 (SELECT count(*) FROM public.invoice_lines WHERE invoice_id=i.id) AS lines,
 (SELECT count(*) FROM public.payables WHERE source_entity_id=i.id) AS payables,
 (SELECT count(*) FROM public.financial_events WHERE source_id=i.id) AS events,
 (SELECT count(*) FROM public.audit_log WHERE entity_id=i.id) AS audits
 FROM legacy_finance_cases c JOIN public.invoices i ON i.id=c.id;
SET LOCAL ROLE service_role;
SELECT throws_ok(format('INSERT INTO public.%I DEFAULT VALUES',t),'42501',
 'FIN_LEGACY_WRITE: use the guarded finance workflow','service insert denied before effects: '||t)
 FROM (VALUES('invoices'),('invoice_lines'),('credit_notes'),('debit_notes'),('financial_events')) tables(t);
SELECT throws_ok(format('UPDATE public.%I SET id=id WHERE false',t),'42501',
 'FIN_LEGACY_WRITE: use the guarded finance workflow','empty service update denied: '||t)
 FROM (VALUES('invoices'),('invoice_lines'),('credit_notes'),('debit_notes'),('financial_events')) tables(t);
SELECT throws_ok(format('DELETE FROM public.%I WHERE false',t),'42501',
 'FIN_LEGACY_WRITE: use the guarded finance workflow','empty service delete denied: '||t)
 FROM (VALUES('invoices'),('invoice_lines'),('credit_notes'),('debit_notes'),('financial_events')) tables(t);
-- Existing FK dependencies can reject TRUNCATE during privilege checks before
-- a trigger runs. In either case no service truncate may erase finance rows.
SELECT throws_ok(format('TRUNCATE public.%I CASCADE',t),'42501',NULL,'service truncate denied: '||t)
 FROM (VALUES('invoices'),('invoice_lines'),('credit_notes'),('debit_notes'),('financial_events'),('receivables'),('payables')) tables(t);
SELECT throws_ok(format('UPDATE public.invoices SET status=%L WHERE id=(SELECT id FROM legacy_finance_cases WHERE kind=''purchase'')',s),
 '42501','FIN_LEGACY_WRITE: use the guarded finance workflow','old direct invoice transition denied: '||s)
 FROM (VALUES('issued'),('finalized'),('cancelled'),('credited')) statuses(s);
SELECT throws_ok($$UPDATE public.invoice_lines SET description='Legacy line mutation' WHERE invoice_id IN(SELECT id FROM legacy_finance_cases)$$,
 '42501','FIN_LEGACY_WRITE: use the guarded finance workflow','old line edit rejected before parent version changes');
SELECT throws_ok($$INSERT INTO public.payables(tenant_id,invoice_ref,invoice_date,due_date,source_entity_type,source_entity_id)
 SELECT t.id,'Old AP before header',current_date,current_date,'purchase_invoice',c.id
 FROM legacy_finance_tenant t CROSS JOIN legacy_finance_cases c WHERE c.kind='purchase'$$,
 '42501','FIN_LEGACY_WRITE: use the guarded finance workflow','old purchase AP-first write blocked before header update');
SELECT throws_ok(format('INSERT INTO public.%I(tenant_id,invoice_ref,invoice_date,due_date,source_entity_type) SELECT id,''Legacy source'',current_date,current_date,%L FROM legacy_finance_tenant',kind,source),
 '42501','FIN_LEGACY_WRITE: use the guarded finance workflow','managed balance insert denied: '||source)
 FROM legacy_finance_balances WHERE source<>'manual';
SELECT throws_ok(format('UPDATE public.%I SET paid_amount=1 WHERE id=%L',kind,id),
 '42501','FIN_LEGACY_WRITE: use the guarded finance workflow','managed balance update denied: '||source)
 FROM legacy_finance_balances WHERE source<>'manual';
SELECT throws_ok(format('UPDATE public.%I SET source_entity_type=NULL WHERE id=%L',kind,id),
 '42501','FIN_LEGACY_WRITE: use the guarded finance workflow','OLD source cannot be laundered: '||source)
 FROM legacy_finance_balances WHERE source<>'manual';
SELECT throws_ok(format('DELETE FROM public.%I WHERE id=%L',kind,id),
 '42501','FIN_LEGACY_WRITE: use the guarded finance workflow','managed balance delete denied: '||source)
 FROM legacy_finance_balances WHERE source<>'manual';
SELECT throws_ok(format('UPDATE public.%I SET source_entity_type=%L WHERE id=(SELECT id FROM legacy_finance_balances WHERE kind=%L AND source=''manual'')',kind,source,kind),
 '42501','FIN_LEGACY_WRITE: use the guarded finance workflow','NEW source cannot retarget manual balance: '||source)
 FROM legacy_finance_balances WHERE source<>'manual';
SELECT lives_ok($$SELECT id FROM public.invoices WHERE id IN(SELECT id FROM legacy_finance_cases) FOR SHARE$$,
 'trusted ZATCA invoker can still lock original source rows for reading');
SELECT lives_ok($$SELECT id FROM public.credit_notes FOR SHARE$$,'credit note FOR SHARE retains table privilege');
SELECT lives_ok($$SELECT id FROM public.debit_notes FOR SHARE$$,'debit note FOR SHARE retains table privilege');
SELECT lives_ok(format('UPDATE public.%I SET notes=''Manual legacy compatibility'' WHERE id=%L',kind,id),'manual balance updates preserved: '||kind)
 FROM legacy_finance_balances WHERE source='manual';
SELECT lives_ok(format('DELETE FROM public.%I WHERE id=%L',kind,id),'manual balance deletes preserved: '||kind)
 FROM legacy_finance_balances WHERE source='manual';
SELECT lives_ok(format('INSERT INTO public.%I(tenant_id,invoice_ref,invoice_date,due_date) SELECT id,''Manual insert preserved'',current_date,current_date FROM legacy_finance_tenant',kind),
 'manual balance inserts preserved: '||kind) FROM (VALUES('receivables'),('payables')) tables(kind);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invoices i JOIN legacy_finance_before b ON b.id=i.id
 WHERE i.status IS DISTINCT FROM b.status OR i.updated_at IS DISTINCT FROM b.updated_at
 OR (SELECT count(*) FROM public.invoice_lines WHERE invoice_id=i.id)<>b.lines
 OR (SELECT count(*) FROM public.payables WHERE source_entity_id=i.id)<>b.payables
 OR (SELECT count(*) FROM public.financial_events WHERE source_id=i.id)<>b.events
 OR (SELECT count(*) FROM public.audit_log WHERE entity_id=i.id)<>b.audits),0,
 'all failed old actions preserve exact source version, status, lines, AP, events and audit');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$UPDATE legacy_finance_cases c SET draft=public.transition_my_invoice(c.id,'issue',i.updated_at)
 FROM public.invoices i WHERE i.id=c.id$$,'actual issue SECDEF engine passes installed service guard');
SELECT lives_ok($$UPDATE legacy_finance_cases c SET draft=public.transition_my_invoice(c.id,'finalize',i.updated_at)
 FROM public.invoices i WHERE i.id=c.id$$,'actual finalize SECDEF engine commits managed AP and financial events');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invoices WHERE id IN(SELECT id FROM legacy_finance_cases) AND status='finalized'),2,'both actual invoice transactions finalize');
SELECT is((SELECT count(*)::int FROM public.financial_events WHERE source_id IN(SELECT id FROM legacy_finance_cases)),2,'both transactions retain their atomic outbox');
SELECT is((SELECT count(*)::int FROM public.payables WHERE source_entity_id=(SELECT id FROM legacy_finance_cases WHERE kind='purchase')),1,'actual purchase transaction creates one payable');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT * FROM public.dispatch_my_financial_events(50)$$,
 'current JWT-bound SECDEF dispatcher can post the real guarded events');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.financial_events WHERE source_id IN(SELECT id FROM legacy_finance_cases)
 AND processing_status='processed'),2,'current dispatcher updates both event statuses under its trusted owner');
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE source_entity_id IN(SELECT id FROM legacy_finance_cases)
 AND status='posted'),2,'current dispatcher posts both invoice journals');
SELECT is((SELECT count(*)::int FROM public.receivables WHERE source_entity_id=(SELECT id FROM legacy_finance_cases WHERE kind='sales')),1,
 'current dispatcher creates the managed sales receivable');
SELECT is((SELECT count(*)::int FROM public.vat_output_ledger WHERE source_entity_id=(SELECT id FROM legacy_finance_cases WHERE kind='sales')),1,
 'current dispatcher retains sales VAT effects');
SELECT is((SELECT count(*)::int FROM public.vat_input_ledger WHERE source_entity_id=(SELECT id FROM legacy_finance_cases WHERE kind='purchase')),1,
 'current dispatcher retains purchase VAT effects');
SELECT * FROM finish();
ROLLBACK;
