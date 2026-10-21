BEGIN;
SELECT no_plan();

-- Full-schema release gate: real provisioning, RBAC, MFA, document triggers,
-- accounting consumers and foreign keys. All fixtures roll back; no hosted data.
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('94000000-0000-4000-8000-000000000001','invoice-release-owner@example.test','{"_invite_provisioned":true}'),
 ('94000000-0000-4000-8000-000000000002','invoice-release-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE invoice_release_tenants AS
SELECT 'owner'::text AS label,(public.provision_company_atomic(
 '94000000-0000-4000-8000-000000000001',
 '{"name":"Invoice Release Fixture","domain":"invoice-release.example.test","slug":"invoice-release"}')->>'id')::uuid AS id
UNION ALL
SELECT 'foreign',(public.provision_company_atomic(
 '94000000-0000-4000-8000-000000000002',
 '{"name":"Invoice Foreign Fixture","domain":"invoice-release-foreign.example.test","slug":"invoice-release-foreign"}')->>'id')::uuid;
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN(
 '94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002');
INSERT INTO public.customers(id,tenant_id,name_ar)
SELECT '94000000-0000-4000-8000-000000000003',id,'Invoice release customer' FROM invoice_release_tenants WHERE label='owner';
INSERT INTO public.suppliers(id,tenant_id,name_ar)
SELECT '94000000-0000-4000-8000-000000000004',id,'Invoice release supplier' FROM invoice_release_tenants WHERE label='owner';

CREATE TEMP TABLE invoice_release_cases(
 label text PRIMARY KEY,kind text NOT NULL,rate numeric NOT NULL,input jsonb,
 draft jsonb,invoice_id uuid,issue_version timestamptz,final_version timestamptz,result jsonb
);
INSERT INTO invoice_release_cases(label,kind,rate) VALUES
 ('sales_tax','sales',15),('sales_zero','sales',0),('sales_mixed','sales',15),
 ('purchase_zero','purchase',0),('note_rollback','sales',15),
 ('cancel_draft','sales',15),('cancel_issued','purchase',15),('cancel_rollback','sales',15),
 ('issue_rollback','sales',15),('finalize_rollback','purchase',15);
UPDATE invoice_release_cases SET input=jsonb_build_object(
 'invoice_type',kind,'currency','SAR','vat_rate',rate,
 'customer_id',CASE WHEN kind='sales' THEN '94000000-0000-4000-8000-000000000003' END,
 'supplier_id',CASE WHEN kind='purchase' THEN '94000000-0000-4000-8000-000000000004' END,
 'issue_date',(now() AT TIME ZONE 'Asia/Riyadh')::date,
 'due_date',(now() AT TIME ZONE 'Asia/Riyadh')::date,
 'lines',CASE WHEN label='sales_mixed' THEN
  '[{"description":"Zero rate","quantity":1,"unit_price":100,"vat_rate":0},{"description":"Standard rate","quantity":1,"unit_price":100,"vat_rate":15}]'::jsonb
 ELSE jsonb_build_array(jsonb_build_object('description','Release contract item','quantity',1,'unit_price',100,'vat_rate',rate)) END);
GRANT SELECT ON invoice_release_tenants TO authenticated;
GRANT ALL ON invoice_release_cases TO authenticated;

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.invoice_transition_receipts'::regclass),'transition receipts have RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.invoice_note_requests'::regclass),'note receipts have RLS');
SELECT ok(NOT has_table_privilege(r,t,p),r||' cannot '||p||' '||t)
FROM (VALUES('anon'),('authenticated')) roles(r)
CROSS JOIN (VALUES('public.invoice_transition_receipts'),('public.invoice_note_requests')) tables(t)
CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(p);
SELECT ok(NOT has_table_privilege('service_role',t,p),'service cannot directly '||p||' '||t)
FROM (VALUES('public.invoice_transition_receipts'),('public.invoice_note_requests')) tables(t)
CROSS JOIN (VALUES('INSERT'),('UPDATE'),('DELETE')) privileges(p);
SELECT ok(has_function_privilege('authenticated',f,'EXECUTE'),'authenticated may execute '||f)
FROM (VALUES('public.transition_my_invoice(uuid,text,timestamptz)'),
 ('public.create_invoice_note_atomic(uuid,uuid,timestamptz,text,jsonb)'),
 ('public.cancel_unposted_invoice_atomic(uuid,timestamptz,text)')) functions(f);
SELECT ok(NOT has_function_privilege(r,f,'EXECUTE'),r||' cannot execute '||f)
FROM (VALUES('anon'),('service_role')) roles(r)
CROSS JOIN (VALUES('public.transition_my_invoice(uuid,text,timestamptz)'),
 ('public.create_invoice_note_atomic(uuid,uuid,timestamptz,text,jsonb)'),
 ('public.cancel_unposted_invoice_atomic(uuid,timestamptz,text)')) functions(f);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"94000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is(public.user_has_permission('invoices','approve'),true,'provisioned AAL2 owner has real invoice approval permission');
SELECT lives_ok($$UPDATE invoice_release_cases SET draft=public.save_invoice_draft(input)$$,'all invoice fixtures use the actual draft RPC');
UPDATE invoice_release_cases SET invoice_id=(draft->>'id')::uuid,issue_version=(draft->>'updated_at')::timestamptz;
SELECT is((SELECT count(*)::int FROM invoice_release_cases c JOIN public.invoices i ON i.id=c.invoice_id
 WHERE c.issue_version IS DISTINCT FROM i.updated_at),0,'draft returned versions match persisted versions after line triggers');
SELECT lives_ok($$UPDATE invoice_release_cases SET draft=public.save_invoice_draft(input,invoice_id,issue_version) WHERE label='sales_tax'$$,
 'returned create version permits an immediate draft update');
UPDATE invoice_release_cases SET issue_version=(draft->>'updated_at')::timestamptz WHERE label='sales_tax';
SELECT is((SELECT c.issue_version=i.updated_at FROM invoice_release_cases c JOIN public.invoices i ON i.id=c.invoice_id WHERE c.label='sales_tax'),true,
 'updated draft returns the persisted version after replacement lines');
SELECT throws_ok($$SELECT public.transition_my_invoice(invoice_id,'issue','2000-01-01') FROM invoice_release_cases WHERE label='sales_tax'$$,
 'P0001','INV015: invoice changed; reload before transition','issuing rejects a stale reviewed version');
SELECT lives_ok($$UPDATE invoice_release_cases SET result=public.transition_my_invoice(invoice_id,'issue',issue_version)
 WHERE label NOT IN('cancel_draft','cancel_rollback','issue_rollback')$$,'issue accepts returned draft versions with the real invoice trigger');
SELECT is((SELECT count(*)::int FROM public.invoices i JOIN invoice_release_cases c ON c.invoice_id=i.id WHERE i.status='issued'),7,'seven intended documents are issued');
SELECT is((SELECT count(*)::int FROM public.financial_events e JOIN invoice_release_cases c ON c.invoice_id=e.source_id),0,'issue emits no financial posting event');
SELECT is((public.transition_my_invoice(invoice_id,'issue',issue_version)->>'replayed')::boolean,true,label||' issue exact replay is idempotent')
 FROM invoice_release_cases WHERE label IN('sales_tax','purchase_zero');
SELECT throws_ok($$SELECT public.transition_my_invoice(invoice_id,'finalize','2000-01-01') FROM invoice_release_cases WHERE label='sales_tax'$$,
 'P0001','INV015: invoice changed; reload before transition','finalizing rejects a stale reviewed version');
RESET ROLE;

CREATE FUNCTION pg_temp.invoice_release_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action=current_setting('test.invoice_release_fault',true) THEN RAISE EXCEPTION 'synthetic invoice audit fault'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_invoice_release_audit_fault BEFORE INSERT ON public.audit_log
 FOR EACH ROW EXECUTE FUNCTION pg_temp.invoice_release_audit_fault();
SELECT set_config('test.invoice_release_fault','invoice_issued',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.transition_my_invoice(invoice_id,'issue',issue_version) FROM invoice_release_cases WHERE label='issue_rollback'$$,
 'P0001','synthetic invoice audit fault','failed issue audit aborts the document transition');
RESET ROLE;
SELECT is((SELECT i.status::text FROM public.invoices i JOIN invoice_release_cases c ON c.invoice_id=i.id WHERE c.label='issue_rollback'),'draft','failed issue leaves a draft');
SELECT is((SELECT count(*)::int FROM public.invoice_transition_receipts r JOIN invoice_release_cases c ON c.invoice_id=r.invoice_id WHERE c.label='issue_rollback'),0,'failed issue leaves no receipt');
-- This fixture is a purchase, so its specific audit action must fail after AP insertion.
SELECT set_config('test.invoice_release_fault','purchase_invoice_approved',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.transition_my_invoice(c.invoice_id,'finalize',i.updated_at)
 FROM invoice_release_cases c JOIN public.invoices i ON i.id=c.invoice_id WHERE c.label='finalize_rollback'$$,
 'P0001','synthetic invoice audit fault','failed purchase approval audit aborts AP, event and status together');
RESET ROLE;
SELECT is((SELECT i.status::text FROM public.invoices i JOIN invoice_release_cases c ON c.invoice_id=i.id WHERE c.label='finalize_rollback'),'issued','failed approval leaves issued status');
SELECT is((SELECT count(*)::int FROM public.payables p JOIN invoice_release_cases c ON c.invoice_id=p.source_entity_id WHERE c.label='finalize_rollback'),0,'failed approval leaves no payable');
SELECT is((SELECT count(*)::int FROM public.financial_events e JOIN invoice_release_cases c ON c.invoice_id=e.source_id WHERE c.label='finalize_rollback'),0,'failed approval leaves no event');
SELECT is((SELECT count(*)::int FROM public.invoice_transition_receipts r JOIN invoice_release_cases c ON c.invoice_id=r.invoice_id WHERE c.label='finalize_rollback' AND r.operation='finalize'),0,'failed approval leaves no finalization receipt');
SELECT set_config('test.invoice_release_fault','',true);
SET LOCAL ROLE authenticated;
UPDATE invoice_release_cases c SET final_version=i.updated_at FROM public.invoices i WHERE i.id=c.invoice_id;
SELECT lives_ok($$UPDATE invoice_release_cases SET result=public.transition_my_invoice(invoice_id,'finalize',final_version)
 WHERE label IN('sales_tax','sales_zero','sales_mixed','purchase_zero','note_rollback')$$,'sales and purchase finalization use the caller-bound transaction');
SELECT is((public.transition_my_invoice(invoice_id,'finalize',final_version)->>'event_id'),result->>'event_id',label||' finalization replay retains the same event')
 FROM invoice_release_cases WHERE label IN('sales_tax','purchase_zero');
SELECT throws_ok($$SELECT public.cancel_unposted_invoice_atomic(c.invoice_id,i.updated_at,'Posted document correction')
 FROM invoice_release_cases c JOIN public.invoices i ON i.id=c.invoice_id WHERE c.label='sales_tax'$$,
 'P0001','INV_CANCEL_POSTED: posted invoices require the credit or review workflow','posted invoices cannot enter unposted cancellation');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invoice_transition_receipts r JOIN invoice_release_cases c ON c.invoice_id=r.invoice_id WHERE r.operation='finalize'),5,'exactly five finalization receipts exist');
SELECT is((SELECT count(*)::int FROM public.payables p JOIN invoice_release_cases c ON c.invoice_id=p.source_entity_id WHERE c.label='purchase_zero'),1,'purchase finalization creates exactly one real payable');
SELECT is(public.dispatch_sales_finalized(e),'ok',c.label||' posts with the actual sales consumer')
 FROM public.financial_events e JOIN invoice_release_cases c ON c.invoice_id=e.source_id WHERE c.label IN('sales_tax','sales_zero','sales_mixed','note_rollback');
SELECT is(public.dispatch_purchase_approved(e),'ok','zero VAT purchase posts with the actual purchase consumer')
 FROM public.financial_events e JOIN invoice_release_cases c ON c.invoice_id=e.source_id WHERE c.label='purchase_zero';
UPDATE public.financial_events e SET processing_status='processed',processed_at=now()
 FROM invoice_release_cases c WHERE e.source_id=c.invoice_id;
SELECT is((SELECT count(*)::int FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.source_entity_id=c.invoice_id),
 CASE WHEN c.rate=0 THEN 2 ELSE 3 END,c.label||' has the expected nonzero balanced journal lines')
 FROM invoice_release_cases c WHERE c.label IN('sales_tax','sales_zero','sales_mixed','purchase_zero');
SELECT is((SELECT sum(l.debit_amount)-sum(l.credit_amount) FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.source_entity_id=c.invoice_id),
 0::numeric,c.label||' real journal balances') FROM invoice_release_cases c WHERE c.label IN('sales_tax','sales_zero','sales_mixed','purchase_zero');
SELECT is((SELECT vat_amount FROM public.vat_output_ledger WHERE source_entity_id=(SELECT invoice_id FROM invoice_release_cases WHERE label='sales_zero')),0::numeric,'zero VAT sale retains a zero VAT ledger row');
SELECT is((SELECT vat_amount FROM public.vat_input_ledger WHERE source_entity_id=(SELECT invoice_id FROM invoice_release_cases WHERE label='purchase_zero')),0::numeric,'zero VAT purchase retains a zero input VAT ledger row');

CREATE TEMP TABLE invoice_release_notes(label text PRIMARY KEY,case_label text,kind text,request_id uuid DEFAULT gen_random_uuid(),input jsonb,result jsonb);
INSERT INTO invoice_release_notes(label,case_label,kind,input) VALUES
 ('tax_debit','sales_tax','debit',jsonb_build_object('reason','Additional documented service','issue_date',(now() AT TIME ZONE 'Asia/Riyadh')::date,'amount',4.10,'vat_rate',15)),
 ('zero_debit','sales_zero','debit',jsonb_build_object('reason','Additional zero-rated service','issue_date',(now() AT TIME ZONE 'Asia/Riyadh')::date,'amount',4.10,'vat_rate',0)),
 ('zero_credit','sales_zero','credit',jsonb_build_object('reason','Complete zero-rated cancellation','issue_date',(now() AT TIME ZONE 'Asia/Riyadh')::date)),
 ('mixed_credit','sales_mixed','credit',jsonb_build_object('reason','Complete mixed-rate cancellation','issue_date',(now() AT TIME ZONE 'Asia/Riyadh')::date)),
 ('rollback_credit','note_rollback','credit',jsonb_build_object('reason','Complete cancellation rollback fixture','issue_date',(now() AT TIME ZONE 'Asia/Riyadh')::date));
GRANT ALL ON invoice_release_notes TO authenticated;
SET LOCAL ROLE authenticated;
UPDATE invoice_release_cases c SET final_version=i.updated_at FROM public.invoices i WHERE i.id=c.invoice_id;
SELECT lives_ok($$UPDATE invoice_release_notes n SET result=public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input)
 FROM invoice_release_cases c WHERE c.label=n.case_label AND n.kind='debit'$$,'taxable and zero VAT debit notes post atomically');
SELECT lives_ok($$UPDATE invoice_release_notes n SET result=public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input)
 FROM invoice_release_cases c WHERE c.label=n.case_label AND n.kind='credit' AND n.label<>'rollback_credit'$$,'zero VAT and mixed-rate full credits post atomically');
SELECT is((public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input)->>'id'),n.result->>'id',n.label||' exact replay retains the note')
 FROM invoice_release_notes n JOIN invoice_release_cases c ON c.label=n.case_label WHERE n.result IS NOT NULL;
SELECT is((public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input)->>'replayed')::boolean,true,n.label||' exact replay is reported')
 FROM invoice_release_notes n JOIN invoice_release_cases c ON c.label=n.case_label WHERE n.result IS NOT NULL;
SELECT throws_ok($$SELECT public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input||'{"reason":"Different reason conflicts with request"}')
 FROM invoice_release_notes n JOIN invoice_release_cases c ON c.label=n.case_label WHERE n.label='tax_debit'$$,
 'P0001','INV_NOTE_RETRY: request already identifies a different decision','note UUID cannot identify a different decision');
SELECT throws_ok($$SELECT * FROM public.invoice_note_requests$$,'42501',NULL,'browser cannot read private note request payloads');
SELECT throws_ok($$SELECT * FROM public.invoice_transition_receipts$$,'42501',NULL,'browser cannot read private lifecycle receipts');
SELECT throws_ok($$UPDATE public.credit_notes SET reason='Direct edit forbidden'$$,'42501',NULL,'browser cannot mutate finalized credit notes');
SELECT throws_ok($$UPDATE public.financial_events SET payload='{}'$$,'42501',NULL,'browser cannot forge the financial outbox');
SELECT throws_ok($$UPDATE public.receivables SET notes='Bypass attempt' WHERE source_entity_id=(SELECT invoice_id FROM invoice_release_cases WHERE label='sales_tax')$$,
 'P0001','INV_MANAGED_AR: use the guarded document or payment workflow','browser cannot rewrite managed invoice AR');
SELECT throws_ok($$UPDATE public.payables SET notes='Bypass attempt' WHERE source_entity_id=(SELECT invoice_id FROM invoice_release_cases WHERE label='purchase_zero')$$,
 'P0001','INV_MANAGED_AP: use the guarded document or payment workflow','browser cannot rewrite managed purchase AP');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"94000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input)
 FROM invoice_release_notes n JOIN invoice_release_cases c ON c.label=n.case_label WHERE n.label='rollback_credit'$$,
 'P0001','AUTH007: active invoice approver required','AAL1 cannot create a financial correction');
SELECT throws_ok($$SELECT public.transition_my_invoice(invoice_id,'issue',issue_version) FROM invoice_release_cases WHERE label='issue_rollback'$$,
 'P0001','AUTH007: active invoice permission required','AAL1 cannot issue an invoice');
SELECT throws_ok($$SELECT public.cancel_unposted_invoice_atomic(invoice_id,issue_version,'Correct cancellation reason') FROM invoice_release_cases WHERE label='cancel_draft'$$,
 'P0001','AUTH007: active invoice update permission required','AAL1 cannot cancel a draft');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"94000000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.transition_my_invoice(invoice_id,'issue',issue_version) FROM invoice_release_cases WHERE label='issue_rollback'$$,
 'P0001','INV001: invoice not found','foreign tenant cannot transition a known invoice UUID');
SELECT throws_ok($$SELECT public.cancel_unposted_invoice_atomic(invoice_id,issue_version,'Correct cancellation reason') FROM invoice_release_cases WHERE label='cancel_draft'$$,
 'P0001','INV001: invoice not found','foreign tenant cannot cancel a known invoice UUID');
SELECT throws_ok($$SELECT public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input)
 FROM invoice_release_notes n JOIN invoice_release_cases c ON c.label=n.case_label WHERE n.label='rollback_credit'$$,
 'P0001','INV_NOTE_POSTING: original invoice must be fully posted','foreign tenant cannot create a note for a known invoice UUID');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"94000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invoice_note_requests r JOIN invoice_release_notes n ON n.request_id=r.request_id),4,'note retries create exactly four receipts');
SELECT is((SELECT count(*)::int FROM public.financial_events e JOIN invoice_release_notes n ON e.event_id=(n.result->>'event_id')::uuid WHERE e.processing_status='processed'),4,'each successful note has a processed event in the same transaction');
SELECT is((SELECT count(*)::int FROM public.audit_log a JOIN invoice_release_notes n ON a.entity_id=(n.result->>'id')::uuid WHERE a.action IN('credit_note_issued','debit_note_issued')),4,'note replays create one audit per legal correction');
SELECT is((SELECT count(*)::int FROM public.journal_entries j JOIN invoice_release_notes n ON j.source_entity_id=(n.result->>'id')::uuid WHERE j.entry_date<>(n.input->>'issue_date')::date),0,'all note journal dates match the reviewed legal document date');
SELECT is((SELECT count(*)::int FROM public.invoices i JOIN invoice_release_cases c ON c.invoice_id=i.id WHERE c.label IN('sales_zero','sales_mixed') AND i.status='credited'),2,'full credits update both real invoice references');
SELECT is((SELECT count(*)::int FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.source_entity_id=(n.result->>'id')::uuid),
 CASE WHEN n.label LIKE 'zero_%' THEN 2 ELSE 3 END,n.label||' posts only nonzero journal lines') FROM invoice_release_notes n WHERE n.result IS NOT NULL;
SELECT is((SELECT sum(l.debit_amount)-sum(l.credit_amount) FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.source_entity_id=(n.result->>'id')::uuid),
 0::numeric,n.label||' correction journal balances') FROM invoice_release_notes n WHERE n.result IS NOT NULL;
SELECT is((SELECT total FROM public.debit_notes WHERE id=(SELECT (result->>'id')::uuid FROM invoice_release_notes WHERE label='tax_debit')),4.72::numeric,'taxable debit uses exact 4.10 plus rounded 0.62 VAT');
SELECT is((SELECT vat_amount FROM public.vat_adjustments WHERE source_entity_id=(SELECT (result->>'id')::uuid FROM invoice_release_notes WHERE label='mixed_credit')),-15::numeric,'mixed-rate full credit reverses actual original VAT');
SELECT is((SELECT jsonb_path_query_array(lines,'$[*].vat_rate') FROM public.credit_notes WHERE id=(SELECT (result->>'id')::uuid FROM invoice_release_notes WHERE label='mixed_credit')),'[0.00,15.00]'::jsonb,'full credit preserves both original line VAT rates');
SELECT is((SELECT count(*)::int FROM public.receivables r JOIN invoice_release_cases c ON c.invoice_id=r.source_entity_id WHERE c.label IN('sales_zero','sales_mixed') AND r.deleted_at IS NOT NULL),2,'full credits archive original receivables');
SELECT is((SELECT count(*)::int FROM public.receivables r JOIN invoice_release_notes n ON r.source_entity_id=(n.result->>'id')::uuid WHERE n.kind='debit' AND r.deleted_at IS NULL),2,'separate debit receivables remain after base invoice credit');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines reversed
 JOIN public.journal_entries rj ON rj.id=reversed.journal_entry_id
 WHERE rj.source_entity_id=(SELECT (result->>'id')::uuid FROM invoice_release_notes WHERE label='mixed_credit')
 AND NOT EXISTS(SELECT 1 FROM public.journal_entry_lines original JOIN public.journal_entries oj ON oj.id=original.journal_entry_id
  WHERE oj.source_entity_id=(SELECT invoice_id FROM invoice_release_cases WHERE label='sales_mixed')
   AND original.account_id=reversed.account_id AND original.debit_amount=reversed.credit_amount AND original.credit_amount=reversed.debit_amount)),0,
 'full credit swaps the actual original journal accounts and amounts');

SELECT set_config('test.invoice_release_fault','credit_note_issued',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input)
 FROM invoice_release_notes n JOIN invoice_release_cases c ON c.label=n.case_label WHERE n.label='rollback_credit'$$,
 'P0001','synthetic invoice audit fault','credit audit failure rolls back already-created journal, VAT, outbox and document');
RESET ROLE;
SELECT is((SELECT i.status::text FROM public.invoices i JOIN invoice_release_cases c ON c.invoice_id=i.id WHERE c.label='note_rollback'),'finalized','failed credit restores finalized reference status');
SELECT is((SELECT count(*)::int FROM public.credit_notes WHERE reference_invoice_id=(SELECT invoice_id FROM invoice_release_cases WHERE label='note_rollback')),0,'failed credit leaves no note');
SELECT is((SELECT count(*)::int FROM public.invoice_note_requests WHERE invoice_id=(SELECT invoice_id FROM invoice_release_cases WHERE label='note_rollback')),0,'failed credit leaves no request receipt');
SELECT is((SELECT count(*)::int FROM public.financial_events WHERE payload->>'reference_invoice_id'=(SELECT invoice_id::text FROM invoice_release_cases WHERE label='note_rollback')),0,'failed credit leaves no correction outbox');
SELECT is((SELECT count(*)::int FROM public.receivables WHERE source_entity_id=(SELECT invoice_id FROM invoice_release_cases WHERE label='note_rollback') AND deleted_at IS NULL),1,'failed credit restores original active AR');
SELECT is((SELECT count(*)::int FROM public.journal_entries j JOIN invoice_release_tenants t ON t.id=j.tenant_id WHERE t.label='owner' AND j.source_entity_type='credit_note'),2,'failed credit leaves no extra reversal journal');
SELECT is((SELECT count(*)::int FROM public.vat_adjustments v JOIN invoice_release_tenants t ON t.id=v.tenant_id WHERE t.label='owner' AND v.source_entity_type='credit_note'),2,'failed credit leaves no extra VAT adjustment');
SELECT set_config('test.invoice_release_fault','',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$UPDATE invoice_release_notes n SET result=public.create_invoice_note_atomic(n.request_id,c.invoice_id,c.final_version,n.kind,n.input)
 FROM invoice_release_cases c WHERE c.label=n.case_label AND n.label='rollback_credit'$$,'same failed credit request can safely retry after rollback');
SELECT throws_ok($$SELECT public.cancel_unposted_invoice_atomic(invoice_id,'2000-01-01','Correct cancellation reason') FROM invoice_release_cases WHERE label='cancel_draft'$$,
 'P0001','INV015: invoice changed; reload before cancellation','unposted cancellation requires the reviewed version');
UPDATE invoice_release_cases c SET final_version=i.updated_at FROM public.invoices i WHERE i.id=c.invoice_id AND c.label IN('cancel_draft','cancel_issued');
SELECT lives_ok($$UPDATE invoice_release_cases c SET result=public.cancel_unposted_invoice_atomic(c.invoice_id,c.final_version,'  Correct cancellation reason  ')
 FROM public.invoices i WHERE i.id=c.invoice_id AND c.label IN('cancel_draft','cancel_issued')$$,'draft and issued invoices cancel through the caller transaction');
SELECT is((public.cancel_unposted_invoice_atomic(invoice_id,final_version,'Correct cancellation reason')->>'replayed')::boolean,true,
 label||' cancellation exact normalized replay succeeds') FROM invoice_release_cases WHERE label IN('cancel_draft','cancel_issued');
SELECT throws_ok($$SELECT public.cancel_unposted_invoice_atomic(invoice_id,final_version,'Changed cancellation reason') FROM invoice_release_cases WHERE label='cancel_draft'$$,
 'P0001','INV015: another cancellation decision exists; reload invoice','cancellation retry cannot change the committed reason');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.invoice_transition_receipts r JOIN invoice_release_cases c ON c.invoice_id=r.invoice_id WHERE c.label IN('cancel_draft','cancel_issued') AND r.operation='cancel' AND r.event_id IS NULL),2,'unposted cancellations have receipts without financial events');
SELECT is((SELECT count(*)::int FROM public.audit_log a JOIN invoice_release_cases c ON c.invoice_id=a.entity_id WHERE c.label IN('cancel_draft','cancel_issued') AND a.action='invoice_cancelled'),2,'replayed cancellations record one audit per document');
SELECT is((SELECT count(*)::int FROM public.financial_events e JOIN invoice_release_cases c ON c.invoice_id=e.source_id WHERE c.label IN('cancel_draft','cancel_issued')),0,'unposted cancellation emits no accounting reversal');
SELECT set_config('test.invoice_release_fault','invoice_cancelled',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.cancel_unposted_invoice_atomic(invoice_id,issue_version,'Correct cancellation reason') FROM invoice_release_cases WHERE label='cancel_rollback'$$,
 'P0001','synthetic invoice audit fault','cancellation audit failure rolls back status and receipt');
RESET ROLE;
SELECT is((SELECT i.status::text FROM public.invoices i JOIN invoice_release_cases c ON c.invoice_id=i.id WHERE c.label='cancel_rollback'),'draft','failed cancellation restores draft status');
SELECT is((SELECT count(*)::int FROM public.invoice_transition_receipts r JOIN invoice_release_cases c ON c.invoice_id=r.invoice_id WHERE c.label='cancel_rollback'),0,'failed cancellation leaves no receipt');
SELECT set_config('test.invoice_release_fault','',true);
DROP TRIGGER trg_invoice_release_audit_fault ON public.audit_log;
SELECT * FROM finish();
ROLLBACK;
