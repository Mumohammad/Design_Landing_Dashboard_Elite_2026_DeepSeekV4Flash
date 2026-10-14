BEGIN;
SELECT no_plan();
INSERT INTO public.chart_of_accounts(id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance) VALUES
('83000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','8301','Cash fixture','Cash fixture','asset','debit'),
('83000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001','8302','Revenue fixture','Revenue fixture','income','credit'),
('83000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000002','8301','Other tenant','Other tenant','asset','debit');
CREATE TEMP TABLE journal_fixture(input jsonb,result jsonb);
INSERT INTO journal_fixture(input) VALUES ('{
 "entry_date":"2026-10-14","description_ar":"Journal draft fixture",
 "tenant_id":"00000000-0000-0000-0000-000000000002",
 "lines":[{"account_id":"83000000-0000-4000-8000-000000000001","debit":10,"credit":0},
 {"account_id":"83000000-0000-4000-8000-000000000002","debit":0,"credit":10}]
}');
GRANT ALL ON journal_fixture TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","aal":"aal2"}',true);
UPDATE journal_fixture SET result=public.save_journal_draft(input);
SELECT is((SELECT tenant_id FROM public.journal_entries WHERE id=(SELECT (result->>'id')::uuid FROM journal_fixture)),'00000000-0000-0000-0000-000000000001'::uuid,'tenant is derived from identity');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines WHERE journal_entry_id=(SELECT (result->>'id')::uuid FROM journal_fixture)),2,'draft persists both lines');
SELECT throws_ok($$SELECT public.save_journal_draft(input,(result->>'id')::uuid,'2000-01-01') FROM journal_fixture$$,'P0001','JRN014: journal changed; reload before saving','stale edit rejected');
SELECT throws_ok($$SELECT public.save_journal_draft(jsonb_set(input,'{lines,0,account_id}','"83000000-0000-4000-8000-000000000003"'),(result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM journal_fixture$$,'P0001','JRN008: active tenant account required','cross-tenant account rejected');
SELECT throws_ok($$SELECT public.save_journal_draft(jsonb_set(input,'{lines,0,debit}','1.005')) FROM journal_fixture$$,'P0001','JRN007: each line needs one positive amount with at most two decimal places','excess precision rejected rather than rounded');
SELECT throws_ok($$SELECT public.save_journal_draft(jsonb_set(input,'{lines,0,credit}','1')) FROM journal_fixture$$,'P0001','JRN007: each line needs one positive amount with at most two decimal places','two-sided line rejected');
SELECT throws_ok($$UPDATE public.journal_entries SET description_ar='bypass' WHERE id=(SELECT (result->>'id')::uuid FROM journal_fixture)$$,'42501',NULL,'direct API edits denied');
SELECT lives_ok($$UPDATE journal_fixture SET result=public.save_journal_draft(jsonb_set(input,'{lines,0,debit}','20'),(result->>'id')::uuid,(result->>'updated_at')::timestamptz)$$,'unbalanced draft can be edited before review');
SELECT is((SELECT sum(debit_amount) FROM public.journal_entry_lines WHERE journal_entry_id=(SELECT (result->>'id')::uuid FROM journal_fixture)),20::numeric,'edit replaces lines');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines WHERE journal_entry_id=(SELECT (result->>'id')::uuid FROM journal_fixture)),2,'edit does not duplicate lines');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_journal_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action='journal_draft_updated' THEN RAISE EXCEPTION 'audit fault'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER trg_journal_test_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_journal_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_journal_draft(input,(result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM journal_fixture$$,'P0001','audit fault','audit failure aborts edit');
SELECT is((SELECT sum(debit_amount) FROM public.journal_entry_lines WHERE journal_entry_id=(SELECT (result->>'id')::uuid FROM journal_fixture)),20::numeric,'audit failure restores old lines');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.delete_journal_draft((result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM journal_fixture$$,'P0001','JRN010: journal entry not found or does not belong to this tenant','cross-tenant deletion rejected');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","aal":"aal1"}',true);
SELECT throws_ok($$SELECT public.save_journal_draft(input) FROM journal_fixture$$,'P0001','AUTH007: accounting permission required','owner MFA required');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001","aal":"aal2"}',true);
SELECT throws_ok($$SELECT public.delete_journal_draft((result->>'id')::uuid,'2000-01-01') FROM journal_fixture$$,'P0001','JRN014: journal changed; reload before deleting','stale deletion rejected');
RESET ROLE;
DROP TRIGGER trg_journal_test_audit ON public.audit_log;
SELECT throws_ok($$UPDATE public.accounting_periods SET status='closed' WHERE id=(SELECT period_id FROM public.journal_entries WHERE id=(SELECT (result->>'id')::uuid FROM journal_fixture))$$,'P0001','ACC004: period has pending draft entries','period closure rechecks pending drafts');
INSERT INTO public.journal_approvals(tenant_id,journal_entry_id,status,submitted_by)
SELECT '00000000-0000-0000-0000-000000000001',(result->>'id')::uuid,'submitted','00000000-0000-0000-0000-000000000001' FROM journal_fixture;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_journal_draft(input,(result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM journal_fixture$$,'P0001','JRN013: only unsubmitted manual drafts can be changed','submitted draft cannot be edited');
SELECT throws_ok($$SELECT public.delete_journal_draft((result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM journal_fixture$$,'P0001','JRN013: only unsubmitted manual drafts can be changed','submitted draft cannot be deleted');
RESET ROLE;
UPDATE public.journal_approvals SET status='rejected' WHERE journal_entry_id=(SELECT (result->>'id')::uuid FROM journal_fixture);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.delete_journal_draft((result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM journal_fixture$$,'rejected draft can be deleted');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.journal_entries WHERE id=(SELECT (result->>'id')::uuid FROM journal_fixture)),'soft delete preserves header');
SELECT is((SELECT count(*)::int FROM public.journal_entry_lines WHERE journal_entry_id=(SELECT (result->>'id')::uuid FROM journal_fixture)),2,'deletion preserves lines');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_id=(SELECT (result->>'id')::uuid FROM journal_fixture) AND action IN ('journal_draft_created','journal_draft_updated','journal_draft_deleted')),3,'audit covers full CRUD lifecycle');
SELECT throws_ok($$UPDATE public.journal_approvals SET status='submitted' WHERE journal_entry_id=(SELECT (result->>'id')::uuid FROM journal_fixture)$$,'P0001','JRN010: journal entry not found or does not belong to this tenant','late submission cannot resurrect deleted draft');
UPDATE public.journal_entry_lines SET credit_amount=20 WHERE credit_amount>0 AND journal_entry_id=(SELECT (result->>'id')::uuid FROM journal_fixture);
UPDATE public.journal_entries SET deleted_at=NULL,status='posted' WHERE id=(SELECT (result->>'id')::uuid FROM journal_fixture);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_journal_draft(input,(result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM journal_fixture$$,'P0001','JRN013: only unsubmitted manual drafts can be changed','posted journal cannot be edited');
SELECT throws_ok($$SELECT public.delete_journal_draft((result->>'id')::uuid,(result->>'updated_at')::timestamptz) FROM journal_fixture$$,'P0001','JRN013: only unsubmitted manual drafts can be changed','posted journal cannot be deleted');
RESET ROLE;
INSERT INTO public.accounting_periods(tenant_id,period_year,period_month,status) VALUES ('00000000-0000-0000-0000-000000000001',2099,12,'closed');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_journal_draft(input || '{"entry_date":"2099-12-01"}') FROM journal_fixture$$,'P0001','ACC001: the accounting period for this date is closed','closed period rejects creation');
SELECT throws_ok($$SELECT public.save_journal_draft(input || '{"lines":[]}') FROM journal_fixture$$,'P0001','JRN006: journal needs between 2 and 200 lines','empty draft rejected');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.save_journal_draft('{}')$$,'42501',NULL,'anonymous caller cannot execute draft RPC');
SELECT * FROM finish();
ROLLBACK;

