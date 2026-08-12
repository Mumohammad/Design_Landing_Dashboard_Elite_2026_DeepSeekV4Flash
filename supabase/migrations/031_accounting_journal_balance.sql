-- 031_accounting_journal_balance.sql
-- Phase 1 (Accounting foundation) hardening: DB-level journal balance
-- enforcement — defense-in-depth on top of the Server Action validation
-- already present in src/lib/accounting/actions.ts.
--
-- Rules enforced here:
--   * A POSTED journal entry must balance: Σ(debit_amount) = Σ(credit_amount)
--     across its journal_entry_lines.
--   * Draft entries may be temporarily unbalanced (they are posted later via
--     the postJournalEntry flow, which inserts rows as 'posted' in one batch).
--   * Reversal entries are ordinary entries and must balance too.
--
-- Components:
--   1. enforce_journal_balance() — DEFERRABLE constraint trigger on
--      journal_entry_lines (JRN004). FOR EACH ROW (the function reads
--      OLD/NEW), DEFERRABLE INITIALLY DEFERRED so the check runs at COMMIT —
--      after every line of the entry is written — and an unbalanced POSTED
--      entry aborts the commit with JRN004, which IS surfaced to the caller
--      (nothing unbalanced ever persists). Drafts may be temporarily
--      unbalanced. Reversal entries are ordinary entries and must balance too.
--   2. post_journal_entry(...) — atomic entry + lines insert in ONE
--      transaction, called by the Server Action through admin.rpc(). Removes
--      the orphaned-entry risk of two separate inserts. Validates balance
--      with exact NUMERIC comparison (no floating point). Raises JRN004-008 /
--      ACC001. EXECUTE is revoked from PUBLIC/authenticated — only the
--      service role can run it, so the app-layer requirePermission() check
--      stays the authorization boundary.
--
-- Verification: run scripts/verify-accounting-phase1.sql against a real
-- database (Supabase SQL editor or psql) after applying 027 + 031.

-- ═══ 1. Balance enforcement function + deferred constraint trigger ═══
CREATE OR REPLACE FUNCTION enforce_journal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_entry_id     UUID;
  v_status       journal_entry_status;
  v_total_debit  NUMERIC(12,2);
  v_total_credit NUMERIC(12,2);
BEGIN
  -- Affected entry: DELETE fires on OLD, INSERT/UPDATE on NEW.
  IF TG_OP = 'DELETE' THEN
    v_entry_id := OLD.journal_entry_id;
  ELSE
    v_entry_id := NEW.journal_entry_id;
  END IF;

  -- Only posted entries must balance; drafts may be mid-edit.
  SELECT status INTO v_status
  FROM journal_entries
  WHERE id = v_entry_id;

  IF v_status <> 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO v_total_debit, v_total_credit
  FROM journal_entry_lines
  WHERE journal_entry_id = v_entry_id;

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION
      'JRN004: posted journal entry % does not balance (debits % <> credits %)',
      v_entry_id, v_total_debit, v_total_credit;
  END IF;

  RETURN NULL;
END;
$$;

-- DEFERRABLE INITIALLY DEFERRED constraint trigger, FOR EACH ROW. The check
-- runs at COMMIT — after every line of the entry is written — so the atomic
-- post_journal_entry() (header + all lines in one transaction) is validated
-- as a whole. If a posted entry is unbalanced at COMMIT, the commit aborts
-- with JRN004, which IS surfaced to the caller (nothing unbalanced ever
-- persists). FOR EACH ROW is required because the trigger function reads
-- OLD/NEW; statement-level triggers have no per-row records.
DROP TRIGGER IF EXISTS trg_journal_balance_check ON journal_entry_lines;
CREATE CONSTRAINT TRIGGER trg_journal_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION enforce_journal_balance();

-- ═══ 2. Atomic journal posting function ═══
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_tenant_id       UUID,
  p_entry_date      DATE,
  p_description_ar  TEXT,
  p_lines           JSONB,
  p_description_en  TEXT DEFAULT NULL,
  p_created_by      UUID DEFAULT NULL
)
RETURNS TABLE (out_entry_id UUID, out_entry_ref TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_period_id      UUID;
  v_period_status  accounting_period_status;
  v_period_year    SMALLINT := EXTRACT(YEAR FROM p_entry_date)::SMALLINT;
  v_period_month   SMALLINT := EXTRACT(MONTH FROM p_entry_date)::SMALLINT;
  v_line           JSONB;
  v_account_id     UUID;
  v_account_ok     BOOLEAN;
  v_debit          NUMERIC(12,2);
  v_credit         NUMERIC(12,2);
  v_total_debit    NUMERIC(12,2) := 0;
  v_total_credit   NUMERIC(12,2) := 0;
  v_entry_id       UUID;
  v_entry_ref      TEXT;
BEGIN
  -- Validation
  IF p_entry_date IS NULL OR p_description_ar IS NULL OR p_description_ar = '' THEN
    RAISE EXCEPTION 'JRN005: entry date and an Arabic description are required';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'JRN006: a journal entry needs at least two lines';
  END IF;

  -- Resolve the open accounting period for the entry date (create if missing,
  -- atomically: ON CONFLICT handles two concurrent first-postings into the
  -- same month — the UNIQUE(tenant_id, period_year, period_month) constraint
  -- from migration 027 is the arbiter).
  SELECT id, status INTO v_period_id, v_period_status
  FROM accounting_periods
  WHERE tenant_id = p_tenant_id
    AND period_year = v_period_year
    AND period_month = v_period_month
  LIMIT 1;

  IF v_period_id IS NULL THEN
    INSERT INTO accounting_periods (tenant_id, period_year, period_month, status)
    VALUES (p_tenant_id, v_period_year, v_period_month, 'open')
    ON CONFLICT (tenant_id, period_year, period_month) DO NOTHING
    RETURNING id INTO v_period_id;

    IF v_period_id IS NULL THEN
      -- A concurrent transaction created the period between our SELECT and
      -- INSERT; re-read it so the closed-period check still applies.
      SELECT id, status INTO v_period_id, v_period_status
      FROM accounting_periods
      WHERE tenant_id = p_tenant_id
        AND period_year = v_period_year
        AND period_month = v_period_month;
    END IF;
  END IF;

  -- Postings into a period that is closing or closed are rejected (defense-
  -- in-depth; the app layer performs the period-close flow).
  IF v_period_status IN ('closing', 'closed') THEN
    RAISE EXCEPTION 'ACC001: the accounting period for this date is closed';
  END IF;

  -- Validate + sum lines (exact NUMERIC, no floating point)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_account_id := (v_line->>'account_id')::UUID;
    v_debit      := COALESCE((v_line->>'debit')::NUMERIC(12,2), 0);
    v_credit     := COALESCE((v_line->>'credit')::NUMERIC(12,2), 0);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'JRN006: every line needs an account';
    END IF;
    -- Account must belong to the same tenant (defense-in-depth)
    SELECT EXISTS (
      SELECT 1 FROM chart_of_accounts
      WHERE id = v_account_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
    ) INTO v_account_ok;
    IF NOT v_account_ok THEN
      RAISE EXCEPTION 'JRN008: account % does not belong to this tenant', v_account_id;
    END IF;

    IF (v_debit > 0 AND v_credit > 0) OR (v_debit = 0 AND v_credit = 0) THEN
      RAISE EXCEPTION 'JRN007: each line must be single-sided (debit XOR credit)';
    END IF;
    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'JRN007: line amounts cannot be negative';
    END IF;

    v_total_debit  := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF v_total_debit <= 0 THEN
    RAISE EXCEPTION 'JRN007: entry amounts must be greater than zero';
  END IF;
  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION
      'JRN004: posted journal entry does not balance (debits % <> credits %)',
      v_total_debit, v_total_credit;
  END IF;

  -- Insert header + lines atomically (single transaction)
  INSERT INTO journal_entries
    (tenant_id, entry_date, period_id, entry_type, status, description_ar,
     description_en, source_module, source_entity_type, posted_at, posted_by,
     created_by)
  VALUES
    (p_tenant_id, p_entry_date, v_period_id, 'manual', 'posted',
     p_description_ar, p_description_en, 'accounting', 'manual_entry',
     now(), p_created_by, p_created_by)
  RETURNING id, entry_ref INTO v_entry_id, v_entry_ref;

  INSERT INTO journal_entry_lines
    (tenant_id, journal_entry_id, account_id, description, debit_amount, credit_amount)
  SELECT
    p_tenant_id,
    v_entry_id,
    (v_line->>'account_id')::UUID,
    NULLIF(v_line->>'description', ''),
    COALESCE((v_line->>'debit')::NUMERIC(12,2), 0),
    COALESCE((v_line->>'credit')::NUMERIC(12,2), 0)
  FROM jsonb_array_elements(p_lines) AS v_line;

  out_entry_id  := v_entry_id;
  out_entry_ref := v_entry_ref;
  RETURN NEXT;
END;
$$;

-- Only the service role may execute (app-layer requirePermission is the
-- authorization boundary; RPC is not exposed to regular clients).
-- NOTE: Supabase's service_role is NOT a superuser (BYPASSRLS only), so the
-- default PUBLIC grant must be revoked AND re-granted explicitly to
-- service_role, otherwise the Server Action's admin.rpc() call would fail
-- with permission denied.
REVOKE ALL ON FUNCTION post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID) TO service_role;
