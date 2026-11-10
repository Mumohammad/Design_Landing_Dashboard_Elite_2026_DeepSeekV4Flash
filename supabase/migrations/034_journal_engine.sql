-- 034_journal_engine.sql
-- Phase 3 — Journal Engine.
--
-- Scope:
--   1. journal_approvals — optional approval workflow (draft → submitted →
--      approved → posted / rejected). Entry status stays 'draft' while under
--      review; ONLY approve_journal_entry() transitions it to 'posted'
--      (balance-checked). Rejection returns it to editable draft.
--   2. trg_journal_balance_on_post — BEFORE UPDATE balance check whenever an
--      entry transitions TO 'posted' (closes the draft→posted tamper hole:
--      an authenticated client could otherwise PATCH an unbalanced draft's
--      status directly, bypassing the line-level deferred check).
--   3. RPCs (all service-role only):
--        create_journal_draft    — validated lines, unbalanced OK (draft)
--        submit_journal_entry    — draft → submitted (approval row)
--        approve_journal_entry   — submitted → posted (balance + period checks)
--        reject_journal_entry    — submitted → rejected (entry stays draft)
--        reverse_journal_entry   — posted → reversed (negated linked entry)
--        close_accounting_period — open → closed (blocks on pending drafts)
--        reopen_accounting_period— closed → reopened (requires reason)
--
-- Error codes: JRN010-013 (workflow/reversal), ACC003-006 (period actions).
-- Verification: scripts/verify-journal-phase3-rest.mjs (live REST).

-- ═══ 1. journal_approvals ═══
CREATE TYPE journal_approval_status AS ENUM ('submitted', 'approved', 'rejected');

CREATE TABLE journal_approvals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  status           journal_approval_status NOT NULL DEFAULT 'submitted',
  submitted_by     UUID REFERENCES auth.users(id),
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by      UUID REFERENCES auth.users(id),
  approved_at      TIMESTAMPTZ,
  rejected_by      UUID REFERENCES auth.users(id),
  rejected_at      TIMESTAMPTZ,
  comment          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_journal_approval_entry UNIQUE (journal_entry_id)
);
CREATE INDEX idx_journal_approvals_tenant_status
  ON journal_approvals(tenant_id, status) WHERE status = 'submitted';

CREATE TRIGGER trg_journal_approvals_updated_at BEFORE UPDATE ON journal_approvals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS — 4-policy pattern (no deleted_at → explicit policies like 027's
-- journal_entry_lines).
ALTER TABLE journal_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sel_approvals_tenant" ON journal_approvals FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_approvals_tenant" ON journal_approvals FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "upd_approvals_tenant" ON journal_approvals FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- ═══ 2. Balance-on-post header trigger (defense-in-depth) ═══
-- Any transition INTO 'posted' must already have balanced lines. Covers the
-- approval path (draft → posted via approve_journal_entry) AND any direct
-- status tamper. Exact NUMERIC comparison.
CREATE OR REPLACE FUNCTION enforce_journal_balance_on_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_total_debit  NUMERIC(12,2);
  v_total_credit NUMERIC(12,2);
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
      INTO v_total_debit, v_total_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = NEW.id;

    IF v_total_debit <> v_total_credit OR v_total_debit <= 0 THEN
      RAISE EXCEPTION
        'JRN004: posted journal entry % does not balance (debits % <> credits %)',
        NEW.id, v_total_debit, v_total_credit;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_balance_on_post ON journal_entries;
CREATE TRIGGER trg_journal_balance_on_post
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  WHEN (NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted')
  EXECUTE FUNCTION enforce_journal_balance_on_post();

-- ═══ 3. Internal helper: resolve (or create) an open period ═══
-- Shared by approve_journal_entry + reverse_journal_entry. Raises ACC001 when
-- the entry date falls in a closing/closed period.
CREATE OR REPLACE FUNCTION get_or_create_period(
  p_tenant_id UUID,
  p_entry_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_year    SMALLINT := EXTRACT(YEAR FROM p_entry_date)::SMALLINT;
  v_month   SMALLINT := EXTRACT(MONTH FROM p_entry_date)::SMALLINT;
  v_id      UUID;
  v_status  accounting_period_status;
BEGIN
  SELECT id, status INTO v_id, v_status
  FROM accounting_periods
  WHERE tenant_id = p_tenant_id
    AND period_year = v_year
    AND period_month = v_month
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO accounting_periods (tenant_id, period_year, period_month, status)
    VALUES (p_tenant_id, v_year, v_month, 'open')
    ON CONFLICT (tenant_id, period_year, period_month) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT id, status INTO v_id, v_status
      FROM accounting_periods
      WHERE tenant_id = p_tenant_id
        AND period_year = v_year
        AND period_month = v_month;
    END IF;
  END IF;

  IF v_status IN ('closing', 'closed') THEN
    RAISE EXCEPTION 'ACC001: the accounting period for this date is closed';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION get_or_create_period(UUID, DATE) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION get_or_create_period(UUID, DATE) TO service_role;

-- ═══ 4. create_journal_draft ═══
CREATE OR REPLACE FUNCTION create_journal_draft(
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
  v_line           JSONB;
  v_account_id     UUID;
  v_account_ok     BOOLEAN;
  v_debit          NUMERIC(12,2);
  v_credit         NUMERIC(12,2);
  v_entry_id       UUID;
  v_entry_ref      TEXT;
BEGIN
  IF p_entry_date IS NULL OR p_description_ar IS NULL OR p_description_ar = '' THEN
    RAISE EXCEPTION 'JRN005: entry date and an Arabic description are required';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'JRN006: a journal entry needs at least two lines';
  END IF;

  -- Validate line structure + tenant accounts (balance NOT required for a draft).
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_account_id := (v_line->>'account_id')::UUID;
    v_debit      := COALESCE((v_line->>'debit')::NUMERIC(12,2), 0);
    v_credit     := COALESCE((v_line->>'credit')::NUMERIC(12,2), 0);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'JRN006: every line needs an account';
    END IF;
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
  END LOOP;

  INSERT INTO journal_entries
    (tenant_id, entry_date, entry_type, status, description_ar,
     description_en, source_module, source_entity_type, created_by)
  VALUES
    (p_tenant_id, p_entry_date, 'manual', 'draft',
     p_description_ar, p_description_en, 'accounting', 'manual_entry',
     p_created_by)
  RETURNING id, entry_ref INTO v_entry_id, v_entry_ref;

  INSERT INTO journal_entry_lines
    (tenant_id, journal_entry_id, account_id, description, debit_amount, credit_amount)
  SELECT
    p_tenant_id,
    v_entry_id,
    (src_line->>'account_id')::UUID,
    NULLIF(src_line->>'description', ''),
    COALESCE((src_line->>'debit')::NUMERIC(12,2), 0),
    COALESCE((src_line->>'credit')::NUMERIC(12,2), 0)
  FROM jsonb_array_elements(p_lines) AS src_line;

  out_entry_id  := v_entry_id;
  out_entry_ref := v_entry_ref;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION create_journal_draft(UUID, DATE, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION create_journal_draft(UUID, DATE, TEXT, JSONB, TEXT, UUID) TO service_role;

-- ═══ 5. submit_journal_entry ═══
CREATE OR REPLACE FUNCTION submit_journal_entry(
  p_tenant_id      UUID,
  p_entry_id       UUID,
  p_submitted_by   UUID DEFAULT NULL
)
RETURNS TABLE (out_entry_id UUID, out_status journal_approval_status)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status journal_entry_status;
BEGIN
  SELECT status INTO v_status
  FROM journal_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'JRN010: journal entry not found or does not belong to this tenant';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'JRN013: only draft entries can be submitted for approval';
  END IF;

  INSERT INTO journal_approvals (tenant_id, journal_entry_id, status, submitted_by)
  VALUES (p_tenant_id, p_entry_id, 'submitted', p_submitted_by)
  ON CONFLICT (journal_entry_id) DO UPDATE
    SET status = 'submitted',
        submitted_by = EXCLUDED.submitted_by,
        submitted_at = now(),
        approved_by = NULL,
        approved_at = NULL,
        rejected_by = NULL,
        rejected_at = NULL,
        comment = NULL;

  out_entry_id := p_entry_id;
  out_status   := 'submitted';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION submit_journal_entry(UUID, UUID, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION submit_journal_entry(UUID, UUID, UUID) TO service_role;

-- ═══ 6. approve_journal_entry ═══
CREATE OR REPLACE FUNCTION approve_journal_entry(
  p_tenant_id     UUID,
  p_entry_id      UUID,
  p_approved_by   UUID DEFAULT NULL,
  p_comment       TEXT DEFAULT NULL
)
RETURNS TABLE (out_entry_id UUID, out_entry_ref TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_entry       journal_entries%ROWTYPE;
  v_approval    journal_approval_status;
  v_period_id   UUID;
  v_total_debit NUMERIC(12,2);
  v_total_credit NUMERIC(12,2);
BEGIN
  SELECT * INTO v_entry
  FROM journal_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'JRN010: journal entry not found or does not belong to this tenant';
  END IF;

  SELECT status INTO v_approval
  FROM journal_approvals
  WHERE journal_entry_id = p_entry_id;
  IF v_approval IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'JRN013: entry must be submitted for approval before it can be approved';
  END IF;

  -- Exact NUMERIC balance (drafts may be unbalanced; approval requires balance).
  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO v_total_debit, v_total_credit
  FROM journal_entry_lines
  WHERE journal_entry_id = p_entry_id;

  IF v_total_debit <> v_total_credit OR v_total_debit <= 0 THEN
    RAISE EXCEPTION 'JRN004: posted journal entry does not balance (debits % <> credits %)',
      v_total_debit, v_total_credit;
  END IF;

  v_period_id := get_or_create_period(p_tenant_id, v_entry.entry_date);

  UPDATE journal_entries
    SET status = 'posted',
        period_id = v_period_id,
        posted_at = now(),
        posted_by = p_approved_by,
        updated_by = p_approved_by
  WHERE id = p_entry_id;

  UPDATE journal_approvals
    SET status = 'approved',
        approved_by = p_approved_by,
        approved_at = now(),
        comment = COALESCE(p_comment, comment)
  WHERE journal_entry_id = p_entry_id;

  out_entry_id  := v_entry.id;
  out_entry_ref := v_entry.entry_ref;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION approve_journal_entry(UUID, UUID, UUID, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION approve_journal_entry(UUID, UUID, UUID, TEXT) TO service_role;

-- ═══ 7. reject_journal_entry ═══
CREATE OR REPLACE FUNCTION reject_journal_entry(
  p_tenant_id     UUID,
  p_entry_id      UUID,
  p_reason        TEXT,
  p_rejected_by   UUID DEFAULT NULL
)
RETURNS TABLE (out_entry_id UUID, out_status journal_approval_status)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status journal_entry_status;
  v_approval journal_approval_status;
BEGIN
  SELECT status INTO v_status
  FROM journal_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'JRN010: journal entry not found or does not belong to this tenant';
  END IF;

  SELECT status INTO v_approval
  FROM journal_approvals
  WHERE journal_entry_id = p_entry_id;
  IF v_approval IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'JRN013: entry must be submitted before it can be rejected';
  END IF;
  IF p_reason IS NULL OR p_reason = '' THEN
    RAISE EXCEPTION 'JRN013: a rejection reason is required';
  END IF;

  UPDATE journal_approvals
    SET status = 'rejected',
        rejected_by = p_rejected_by,
        rejected_at = now(),
        comment = p_reason
  WHERE journal_entry_id = p_entry_id;

  -- Entry returns to draft (editable again).

  out_entry_id := p_entry_id;
  out_status   := 'rejected';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION reject_journal_entry(UUID, UUID, TEXT, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION reject_journal_entry(UUID, UUID, TEXT, UUID) TO service_role;

-- ═══ 8. reverse_journal_entry ═══
-- Reversal of a POSTED entry: creates a new posted entry with NEGATED lines
-- (debit↔credit swapped) linked via reversal_of_entry_id, then marks the
-- original as 'reversed' with reversed_entry_id. Atomic. The reversal is
-- balanced by construction; the deferred line trigger re-verifies at COMMIT.
CREATE OR REPLACE FUNCTION reverse_journal_entry(
  p_tenant_id       UUID,
  p_entry_id        UUID,
  p_description_ar  TEXT,
  p_description_en  TEXT DEFAULT NULL,
  p_reversal_date   DATE DEFAULT NULL,
  p_created_by      UUID DEFAULT NULL
)
RETURNS TABLE (out_entry_id UUID, out_entry_ref TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_entry        journal_entries%ROWTYPE;
  v_period_id    UUID;
  v_rev_date     DATE;
  v_new_id       UUID;
  v_new_ref      TEXT;
BEGIN
  SELECT * INTO v_entry
  FROM journal_entries
  WHERE id = p_entry_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'JRN010: journal entry not found or does not belong to this tenant';
  END IF;
  IF v_entry.status <> 'posted' THEN
    RAISE EXCEPTION 'JRN012: only posted journal entries can be reversed';
  END IF;
  IF v_entry.reversed_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'JRN011: journal entry is already reversed';
  END IF;

  v_rev_date := COALESCE(p_reversal_date, v_entry.entry_date);
  v_period_id := get_or_create_period(p_tenant_id, v_rev_date);

  -- New reversed entry (negated lines).
  INSERT INTO journal_entries
    (tenant_id, entry_date, period_id, entry_type, status, description_ar,
     description_en, source_module, source_entity_type, reversal_of_entry_id,
     posted_at, posted_by, created_by)
  VALUES
    (p_tenant_id, v_rev_date, v_period_id, 'reversal', 'posted',
     COALESCE(p_description_ar, 'عكس القيد ' || v_entry.entry_ref),
     COALESCE(p_description_en, 'Reversal of ' || v_entry.entry_ref),
     'accounting', 'journal_reversal', v_entry.id,
     now(), p_created_by, p_created_by)
  RETURNING id, entry_ref INTO v_new_id, v_new_ref;

  INSERT INTO journal_entry_lines
    (tenant_id, journal_entry_id, account_id, description, debit_amount, credit_amount)
  SELECT
    p_tenant_id,
    v_new_id,
    account_id,
    description,
    credit_amount,  -- swap: credit becomes debit
    debit_amount    -- swap: debit becomes credit
  FROM journal_entry_lines
  WHERE journal_entry_id = p_entry_id;

  -- Mark the original reversed (immutability trigger allows posted → reversed).
  UPDATE journal_entries
    SET status = 'reversed',
        reversed_entry_id = v_new_id,
        updated_by = p_created_by
  WHERE id = p_entry_id;

  out_entry_id  := v_new_id;
  out_entry_ref := v_new_ref;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION reverse_journal_entry(UUID, UUID, TEXT, TEXT, DATE, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION reverse_journal_entry(UUID, UUID, TEXT, TEXT, DATE, UUID) TO service_role;

-- ═══ 9. close_accounting_period ═══
CREATE OR REPLACE FUNCTION close_accounting_period(
  p_tenant_id  UUID,
  p_period_id  UUID,
  p_closed_by  UUID DEFAULT NULL
)
RETURNS TABLE (out_period_id UUID, out_status accounting_period_status)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status  accounting_period_status;
  v_drafts  BIGINT;
BEGIN
  SELECT status INTO v_status
  FROM accounting_periods
  WHERE id = p_period_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'ACC003: accounting period not found or does not belong to this tenant';
  END IF;
  IF v_status NOT IN ('open', 'closing') THEN
    RAISE EXCEPTION 'ACC005: only open (or closing) periods can be closed';
  END IF;

  -- A period with pending drafts cannot be closed: drafts must be posted,
  -- reversed or deleted first (they would otherwise be stuck forever).
  SELECT COUNT(*) INTO v_drafts
  FROM journal_entries
  WHERE period_id = p_period_id AND status = 'draft' AND deleted_at IS NULL;
  IF v_drafts > 0 THEN
    RAISE EXCEPTION 'ACC004: period has % pending draft entries; post or remove them before closing', v_drafts;
  END IF;

  UPDATE accounting_periods
    SET status = 'closed',
        closing_started_at = COALESCE(closing_started_at, now()),
        closed_at = now(),
        closed_by = p_closed_by,
        updated_by = p_closed_by
  WHERE id = p_period_id;

  out_period_id := p_period_id;
  out_status    := 'closed';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION close_accounting_period(UUID, UUID, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION close_accounting_period(UUID, UUID, UUID) TO service_role;

-- ═══ 10. reopen_accounting_period ═══
CREATE OR REPLACE FUNCTION reopen_accounting_period(
  p_tenant_id   UUID,
  p_period_id   UUID,
  p_reason      TEXT,
  p_reopened_by UUID DEFAULT NULL
)
RETURNS TABLE (out_period_id UUID, out_status accounting_period_status)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status accounting_period_status;
BEGIN
  SELECT status INTO v_status
  FROM accounting_periods
  WHERE id = p_period_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'ACC003: accounting period not found or does not belong to this tenant';
  END IF;
  IF v_status <> 'closed' THEN
    RAISE EXCEPTION 'ACC005: only closed periods can be reopened';
  END IF;
  IF p_reason IS NULL OR p_reason = '' THEN
    RAISE EXCEPTION 'ACC006: a reopen reason is required';
  END IF;

  UPDATE accounting_periods
    SET status = 'reopened',
        reopen_reason = p_reason,
        updated_by = p_reopened_by
  WHERE id = p_period_id;

  out_period_id := p_period_id;
  out_status    := 'reopened';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION reopen_accounting_period(UUID, UUID, TEXT, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION reopen_accounting_period(UUID, UUID, TEXT, UUID) TO service_role;
