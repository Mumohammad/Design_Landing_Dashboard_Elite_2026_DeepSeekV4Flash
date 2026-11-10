-- 036_harden_journal_rls.sql
-- Phase 3 hardening — closes RLS holes identified in code review:
--
--   1. journal_approvals / journal_entries / journal_entry_lines previously
--      had authenticated INSERT + UPDATE policies (4-policy pattern). A
--      tenant user could therefore:
--        (a) INSERT a journal_approvals row with status='approved' directly
--            (self-approval — bypasses the approve_journal_entry() workflow),
--        (b) PATCH journal_entries.status='posted' directly (bypassing the
--            ACC001 closed-period check that lives only inside the RPCs),
--        (c) INSERT a journal_entry_lines row with THEIR tenant_id but a
--            FOREIGN account_id (RLS checks the line's tenant, not the
--            referenced account's tenant — the JRN008 guard exists only
--            inside post_journal_entry()).
--
--   Fix: all journal mutations now flow exclusively through the service-role
--   RPCs (create_journal_draft / post_journal_entry / approve / reject /
--   reverse / close / reopen) which re-validate tenant, accounts, balance and
--   period. Authenticated clients keep SELECT only.
--
--   2. trg_journal_period_open — ACC001 defense-in-depth on ANY path into
--      'posted' (INSERT or UPDATE), so a posted entry can never land in a
--      closing/closed period even if a future code path forgets the RPC-level
--      check.

-- ═══ 1. Restrict authenticated journal-table mutations to service role ═══
-- journal_entries (policy names from apply_accounting_rls in 027)
DROP POLICY IF EXISTS "ins_journal_entries_tenant" ON journal_entries;
DROP POLICY IF EXISTS "upd_journal_entries_tenant" ON journal_entries;

-- journal_entry_lines (explicit policies in 027)
DROP POLICY IF EXISTS "ins_jel_tenant" ON journal_entry_lines;
DROP POLICY IF EXISTS "upd_jel_tenant" ON journal_entry_lines;

-- journal_approvals (explicit policies in 034)
DROP POLICY IF EXISTS "ins_approvals_tenant" ON journal_approvals;
DROP POLICY IF EXISTS "upd_approvals_tenant" ON journal_approvals;

-- ═══ 2. Period-open guard on any transition into 'posted' ═══
CREATE OR REPLACE FUNCTION enforce_journal_period_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_period_status accounting_period_status;
  v_year          SMALLINT;
  v_month         SMALLINT;
BEGIN
  IF NEW.status <> 'posted' THEN
    RETURN NEW;
  END IF;

  IF NEW.period_id IS NOT NULL THEN
    SELECT status INTO v_period_status
    FROM accounting_periods
    WHERE id = NEW.period_id AND tenant_id = NEW.tenant_id;
  ELSE
    v_year  := EXTRACT(YEAR FROM NEW.entry_date)::SMALLINT;
    v_month := EXTRACT(MONTH FROM NEW.entry_date)::SMALLINT;
    SELECT status INTO v_period_status
    FROM accounting_periods
    WHERE tenant_id = NEW.tenant_id
      AND period_year = v_year
      AND period_month = v_month;
  END IF;

  IF v_period_status IN ('closing', 'closed') THEN
    RAISE EXCEPTION 'ACC001: the accounting period for this date is closed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_period_open ON journal_entries;
CREATE TRIGGER trg_journal_period_open
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW
  WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION enforce_journal_period_open();
