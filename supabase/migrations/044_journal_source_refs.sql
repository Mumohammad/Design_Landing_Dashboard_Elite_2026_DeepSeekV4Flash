-- =====================================================================
-- 044 — post_journal_entry source refs (signature unification)
--
-- The dispatcher consumers (042) must stamp entry_type + source refs onto
-- journal entries at INSERT time, because posted entries are immutable
-- (JRN001 blocks any UPDATE that keeps status 'posted').
--
-- Migration 033 already rebuilt post_journal_entry as the 7-arg form
-- (UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT) with p_entry_type TEXT gated
-- by JRN009 to ('manual','opening') — too narrow for the dispatcher's
-- invoice/expense/reversal entries. This migration drops that overload and
-- recreates ONE unified signature:
--
--   post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT, TEXT, UUID)
--     p_entry_type         TEXT  DEFAULT 'manual'   — full enum set (JRN009)
--     p_source_entity_type TEXT  DEFAULT NULL       → 'manual_entry' fallback
--     p_source_entity_id   UUID  DEFAULT NULL
--
-- 045 re-asserts the function + dispatcher consumers with the final bodies
-- (this file is the clean history for fresh installs).
-- =====================================================================

DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID);
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID, journal_entry_type, TEXT, UUID);

CREATE OR REPLACE FUNCTION post_journal_entry(
  p_tenant_id       UUID,
  p_entry_date      DATE,
  p_description_ar  TEXT,
  p_lines           JSONB,
  p_description_en  TEXT DEFAULT NULL,
  p_created_by      UUID DEFAULT NULL,
  p_entry_type      TEXT DEFAULT 'manual',
  p_source_entity_type TEXT DEFAULT NULL,
  p_source_entity_id   UUID DEFAULT NULL
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
  v_entry_type     journal_entry_type;
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
  IF p_entry_type IS NULL OR p_entry_type NOT IN
     ('manual', 'payroll', 'cod_settlement', 'invoice', 'expense', 'bank', 'vat', 'reversal', 'opening') THEN
    RAISE EXCEPTION 'JRN009: unsupported journal entry type %', COALESCE(p_entry_type, 'null');
  END IF;
  v_entry_type := p_entry_type::journal_entry_type;

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

  -- Insert header + lines atomically (single transaction); source refs are
  -- stamped here because posted entries are immutable.
  INSERT INTO journal_entries
    (tenant_id, entry_date, period_id, entry_type, status, description_ar,
     description_en, source_module, source_entity_type, source_entity_id,
     posted_at, posted_by, created_by)
  VALUES
    (p_tenant_id, p_entry_date, v_period_id, v_entry_type, 'posted',
     p_description_ar, p_description_en, 'accounting',
     COALESCE(p_source_entity_type, 'manual_entry'), p_source_entity_id,
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
  FROM jsonb_array_elements(p_lines) AS src_line;

  out_entry_id  := v_entry_id;
  out_entry_ref := v_entry_ref;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT, TEXT, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT, TEXT, UUID) TO service_role;
