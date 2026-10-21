BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('90000000-0000-4000-8000-000000000001','expense-decisions@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE expense_decision_company AS SELECT (public.provision_company_atomic(
 '90000000-0000-4000-8000-000000000001','{"name":"Decision Fixture","domain":"expense-decisions.example.test","slug":"expense-decisions"}')->>'id')::uuid AS id;
CREATE TEMP TABLE expense_decision_cases(label text,id uuid DEFAULT gen_random_uuid());
INSERT INTO expense_decision_cases(label) VALUES('reject'),('audit'),('stale'),('approved'),('event'),('payable'),('journal'),('input'),('pending queue'),('legacy VAT');
GRANT SELECT ON expense_decision_company,expense_decision_cases TO authenticated;
INSERT INTO public.expenses(id,tenant_id,expense_type,amount,expense_date)
SELECT c.id,t.id,'fuel',100,CURRENT_DATE FROM expense_decision_cases c CROSS JOIN expense_decision_company t;
SELECT lives_ok($$SELECT public.reject_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='reject'),'  Duplicate receipt  ','90000000-0000-4000-8000-000000000001')$$,'rejection commits with its audit');
SELECT ok((SELECT NOT is_approved AND rejected_at IS NOT NULL AND rejected_by='90000000-0000-4000-8000-000000000001' AND rejection_reason='Duplicate receipt' FROM public.expenses WHERE id=(SELECT id FROM expense_decision_cases WHERE label='reject')),'rejection has explicit actor/time/reason and is not approval');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id=(SELECT id FROM expense_decision_cases WHERE label='reject') AND action='expense_rejected'),1,'rejection has one audit');
SELECT is((SELECT new_values->>'reason' FROM public.audit_log WHERE entity_id=(SELECT id FROM expense_decision_cases WHERE label='reject') AND action='expense_rejected'),'Duplicate receipt','trimmed reason is retained in the decision audit');
SELECT is((SELECT count(*)::int FROM public.payables WHERE source_entity_id=(SELECT id FROM expense_decision_cases WHERE label='reject')),0,'rejection creates no payable');
SELECT is((SELECT count(*)::int FROM public.financial_events WHERE source_id=(SELECT id FROM expense_decision_cases WHERE label='reject')),0,'rejection creates no financial event');
SELECT throws_ok($$SELECT public.reject_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='reject'),'Another reason','90000000-0000-4000-8000-000000000001')$$,'P0001','EXP_REJECTED: expense already rejected','repeat cannot rewrite the original rejection');
SELECT throws_ok($$SELECT public.approve_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='reject'),15,'recoverable','90000000-0000-4000-8000-000000000001')$$,'P0001','EXP_REJECTED: expense already rejected','rejected source cannot subsequently approve');

CREATE FUNCTION pg_temp.fail_rejection_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.entity_id=(SELECT id FROM expense_decision_cases WHERE label='audit') AND NEW.action='expense_rejected' THEN
 RAISE EXCEPTION 'synthetic rejection audit fault';END IF;RETURN NEW;END $$;
CREATE TRIGGER trg_test_rejection_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_rejection_audit();
SELECT throws_ok($$SELECT public.reject_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='audit'),'Duplicate receipt','90000000-0000-4000-8000-000000000001')$$,'P0001','synthetic rejection audit fault','audit failure rolls back the rejection');
SELECT ok((SELECT rejected_at IS NULL AND rejected_by IS NULL AND rejection_reason IS NULL AND NOT is_approved FROM public.expenses WHERE id=(SELECT id FROM expense_decision_cases WHERE label='audit')),'audit failure leaves a clean pending decision');
DROP TRIGGER trg_test_rejection_audit ON public.audit_log;
SELECT lives_ok($$SELECT public.reject_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='audit'),'Duplicate receipt','90000000-0000-4000-8000-000000000001')$$,'retry after audit rollback succeeds');
SELECT throws_ok($$SELECT public.reject_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='input'),'no','90000000-0000-4000-8000-000000000001')$$,'22023',NULL,'short rejection reason denied at database boundary');
SELECT throws_ok($$SELECT public.reject_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='input'),'Duplicate receipt','90000000-0000-4000-8000-000000000002')$$,'42501','EXP_AUTH: active tenant approver required','foreign or missing actor denied');
SELECT throws_ok($$UPDATE public.expenses SET rejected_at=now() WHERE id=(SELECT id FROM expense_decision_cases WHERE label='stale')$$,'23514',NULL,'partial rejection metadata is invalid');

SELECT public.approve_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='approved'),15,'recoverable','90000000-0000-4000-8000-000000000001');
SELECT throws_ok($$SELECT public.reject_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='approved'),'Duplicate receipt','90000000-0000-4000-8000-000000000001')$$,'P0001','EXP002: expense already approved','approved source cannot subsequently reject');
INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
SELECT t.id,gen_random_uuid(),'expense:'||c.id::text||':legacy','expense',c.id,'ExpenseApprovedEvent',CURRENT_DATE,'{}' FROM expense_decision_cases c CROSS JOIN expense_decision_company t WHERE c.label='event';
INSERT INTO public.payables(tenant_id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status,source_entity_type,source_entity_id)
SELECT t.id,'Legacy decision fixture',CURRENT_DATE,CURRENT_DATE,100,0,100,0,'open','expense',c.id FROM expense_decision_cases c CROSS JOIN expense_decision_company t WHERE c.label='payable';
INSERT INTO public.journal_entries(tenant_id,entry_date,entry_type,status,description_ar,source_module,source_entity_type,source_entity_id)
SELECT t.id,CURRENT_DATE,'expense','draft','Legacy decision fixture','accounting','expense',c.id FROM expense_decision_cases c CROSS JOIN expense_decision_company t WHERE c.label='journal';
UPDATE public.expenses SET vat_amount=1 WHERE id=(SELECT id FROM expense_decision_cases WHERE label='legacy VAT');
SELECT throws_ok(format('SELECT public.reject_expense_atomic(%L,%L,%L,%L)',t.id,c.id,'Duplicate receipt','90000000-0000-4000-8000-000000000001'),'P0001','EXP_FINANCE_REVIEW: existing approval or accounting evidence requires review',c.label||' evidence requires review instead of rejection')
FROM expense_decision_cases c CROSS JOIN expense_decision_company t WHERE c.label IN('event','payable','journal','legacy VAT');
SELECT is((SELECT count(*)::int FROM public.expenses e JOIN expense_decision_cases c ON c.id=e.id WHERE c.label IN('event','payable','journal','legacy VAT') AND e.rejected_at IS NOT NULL),0,'financial review does not invent terminal decisions');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((SELECT count(*)::int FROM public.fetch_pending_approvals((SELECT id FROM expense_decision_company),'expense',NULL,NULL,100) WHERE item_id=(SELECT id FROM expense_decision_cases WHERE label='reject')),0,'rejected expense leaves the pending queue');
SELECT is((SELECT count(*)::int FROM public.fetch_pending_approvals((SELECT id FROM expense_decision_company),'expense',NULL,NULL,100) WHERE item_id=(SELECT id FROM expense_decision_cases WHERE label='pending queue')),1,'undecided expense stays in queue');
SELECT throws_ok($$SELECT public.reject_expense_atomic((SELECT id FROM expense_decision_company),(SELECT id FROM expense_decision_cases WHERE label='stale'),'Duplicate receipt','90000000-0000-4000-8000-000000000001')$$,'42501',NULL,'browser cannot call trusted rejection RPC');
SELECT throws_ok($$UPDATE public.expenses SET rejected_at=now(),rejected_by='90000000-0000-4000-8000-000000000001',rejection_reason='Bypass fixture' WHERE id=(SELECT id FROM expense_decision_cases WHERE label='stale')$$,'42501',NULL,'direct browser rejection denied');
SELECT throws_ok($$UPDATE public.expenses SET rejected_at=NULL,rejected_by=NULL,rejection_reason=NULL WHERE id=(SELECT id FROM expense_decision_cases WHERE label='reject')$$,'42501',NULL,'direct browser reopening denied');
SELECT throws_ok($$DELETE FROM public.expenses WHERE id=(SELECT id FROM expense_decision_cases WHERE label='reject')$$,'42501',NULL,'direct browser deletion of rejected evidence denied');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.reject_expense_atomic(NULL,NULL,'Duplicate receipt',NULL)$$,'42501',NULL,'anonymous rejection RPC denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
