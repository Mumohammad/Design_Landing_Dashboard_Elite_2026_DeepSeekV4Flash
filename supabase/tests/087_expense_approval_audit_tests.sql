BEGIN;
SELECT no_plan();
CREATE TEMP TABLE expense_approval_fixture(label text,id uuid,result jsonb);
INSERT INTO expense_approval_fixture(label,id) VALUES('rate',gen_random_uuid()),('audit',gen_random_uuid()),('event',gen_random_uuid()),('legacy',gen_random_uuid()),('inbox',gen_random_uuid());
INSERT INTO public.expenses(id,tenant_id,expense_type,amount,expense_date)
SELECT id,'00000000-0000-0000-0000-000000000001','fuel',100,'2026-10-19' FROM expense_approval_fixture;
GRANT SELECT ON expense_approval_fixture TO authenticated;
SELECT lives_ok($$UPDATE expense_approval_fixture SET result=public.approve_expense_atomic('00000000-0000-0000-0000-000000000001',id,15.555,'recoverable','00000000-0000-0000-0000-000000000001') WHERE label='rate'$$,'approval commits with retained rate precision');
SELECT is((SELECT vat_rate FROM public.expenses WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='rate')),15.56::numeric,'retained rate is canonical');
SELECT is((SELECT vat_amount FROM public.expenses WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='rate')),15.56::numeric,'expense VAT uses retained rate');
SELECT is((SELECT total_amount FROM public.payables WHERE source_entity_type='expense' AND source_entity_id=(SELECT id FROM expense_approval_fixture WHERE label='rate')),115.56::numeric,'payable agrees with retained rate');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id=(SELECT id FROM expense_approval_fixture WHERE label='rate') AND action='expense_approved'),1,'approval audit is atomic and singular');
SELECT is((SELECT payload->>'vat_rate' FROM public.financial_events WHERE event_id=(SELECT (result->>'event_id')::uuid FROM expense_approval_fixture WHERE label='rate')),'15.56','receipt identifies exact retained event');
SELECT throws_ok($$SELECT public.approve_expense_atomic('00000000-0000-0000-0000-000000000001',(SELECT id FROM expense_approval_fixture WHERE label='rate'),15,'recoverable','00000000-0000-0000-0000-000000000001')$$,'P0001','EXP002: expense already approved','repeat approval does not create effects');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id=(SELECT id FROM expense_approval_fixture WHERE label='rate') AND action='expense_approved'),1,'repeat does not duplicate audit');
CREATE FUNCTION pg_temp.fail_expense_approval_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action='expense_approved' AND NEW.entity_id=(SELECT id FROM expense_approval_fixture WHERE label='audit') THEN
  RAISE EXCEPTION 'synthetic approval audit fault';END IF;RETURN NEW;END $$;
CREATE TRIGGER trg_expense_approval_test_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_expense_approval_audit();
SELECT throws_ok($$SELECT public.approve_expense_atomic('00000000-0000-0000-0000-000000000001',(SELECT id FROM expense_approval_fixture WHERE label='audit'),15,'recoverable','00000000-0000-0000-0000-000000000001')$$,'P0001','synthetic approval audit fault','audit failure aborts approval');
SELECT is((SELECT is_approved FROM public.expenses WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='audit')),false,'audit failure preserves pending expense');
SELECT is((SELECT count(*)::int FROM public.payables WHERE source_entity_type='expense' AND source_entity_id=(SELECT id FROM expense_approval_fixture WHERE label='audit')),0,'audit failure leaves no payable');
SELECT is((SELECT count(*)::int FROM public.financial_events WHERE source_type='expense' AND source_id=(SELECT id FROM expense_approval_fixture WHERE label='audit')),0,'audit failure leaves no accounting event');
DROP TRIGGER trg_expense_approval_test_audit ON public.audit_log;
SELECT lives_ok($$SELECT public.approve_expense_atomic('00000000-0000-0000-0000-000000000001',(SELECT id FROM expense_approval_fixture WHERE label='audit'),15,'recoverable','00000000-0000-0000-0000-000000000001')$$,'retry after rolled-back audit failure succeeds');
INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
SELECT '00000000-0000-0000-0000-000000000001',gen_random_uuid(),'expense:'||id::text||':approved','expense',id,'ExpenseApprovedEvent','2026-10-19','{}' FROM expense_approval_fixture WHERE label='event';
SELECT throws_ok($$SELECT public.approve_expense_atomic('00000000-0000-0000-0000-000000000001',(SELECT id FROM expense_approval_fixture WHERE label='event'),15,'recoverable','00000000-0000-0000-0000-000000000001')$$,'P0001','EXP_EVENT_REVIEW: approval event already exists; review the original expense','stale event cannot be silently reused');
SELECT is((SELECT is_approved FROM public.expenses WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='event')),false,'event conflict rolls back approval');
SELECT is((SELECT count(*)::int FROM public.payables WHERE source_entity_type='expense' AND source_entity_id=(SELECT id FROM expense_approval_fixture WHERE label='event')),0,'event conflict rolls back payable');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id=(SELECT id FROM expense_approval_fixture WHERE label='event') AND action='expense_approved'),0,'event conflict rolls back audit');
SELECT throws_ok($$SELECT public.approve_expense_atomic('00000000-0000-0000-0000-000000000001',(SELECT id FROM expense_approval_fixture WHERE label='legacy'),15,'recoverable','00000000-0000-0000-0000-000000000002')$$,'42501','EXP_AUTH: active tenant approver required','service cannot accidentally assign another tenant actor');
SELECT throws_ok($$SELECT public.approve_expense_with_context_atomic('00000000-0000-0000-0000-000000000001',(SELECT id FROM expense_approval_fixture WHERE label='inbox'),15,'recoverable','00000000-0000-0000-0000-000000000001',NULL,'approvals_inbox')$$,'22023','EXP_INPUT: valid approval context and reason required','inbox requires an audited reason at database boundary');
UPDATE public.expenses SET vat_rate=0 WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='inbox');
SELECT lives_ok($$SELECT public.approve_expense_with_context_atomic('00000000-0000-0000-0000-000000000001',(SELECT id FROM expense_approval_fixture WHERE label='inbox'),NULL,'recoverable','00000000-0000-0000-0000-000000000001','Receipts checked','approvals_inbox')$$,'inbox reason commits with approval');
SELECT is((SELECT new_values->>'reason' FROM public.audit_log WHERE entity_id=(SELECT id FROM expense_approval_fixture WHERE label='inbox') AND action='expense_approved'),'Receipts checked','inbox reason is retained in singular audit');
SELECT is((SELECT vat_amount FROM public.expenses WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='inbox')),0::numeric,'inbox preserves stored zero VAT instead of defaulting to fifteen percent');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$UPDATE public.expenses SET is_approved=true,approved_by='00000000-0000-0000-0000-000000000001',approved_at=now() WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='legacy')$$,'42501',NULL,'direct legacy approval denied');
SELECT throws_ok($$UPDATE public.expenses SET amount=1 WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='rate')$$,'42501',NULL,'direct edit of approved expense denied');
SELECT throws_ok($$DELETE FROM public.expenses WHERE id=(SELECT id FROM expense_approval_fixture WHERE label='rate')$$,'42501',NULL,'direct deletion of approved expense denied');
SELECT throws_ok($$SELECT public.approve_expense_atomic('00000000-0000-0000-0000-000000000001',(SELECT id FROM expense_approval_fixture WHERE label='legacy'),15,'recoverable','00000000-0000-0000-0000-000000000001')$$,'42501',NULL,'approval RPC remains private to trusted server');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
