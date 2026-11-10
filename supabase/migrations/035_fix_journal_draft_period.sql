-- 035_fix_journal_draft_period.sql
-- Fix: create_journal_draft() (migration 034) inserted drafts with a NULL
-- period_id. close_accounting_period() blocks closing while drafts exist
-- (ACC004) by matching journal_entries.period_id — but NULL-period drafts
-- were invisible to that check, so a period could close while a draft was
-- pending, permanently stranding it (its later approval would then hit
-- ACC001). Drafts now resolve their period at creation via
-- get_or_create_period() (same as posting and approval), and closed periods
-- reject new drafts at creation (ACC001) so nothing is ever stranded.
--
-- Signature is UNCHANGED; REVOKE/GRANT from 034 are preserved by
-- CREATE OR REPLACE (re-asserted for self-documentation).

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
  v_period_id      UUID;
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

  -- Resolve the draft's period up-front (raises ACC001 for closing/closed
  -- periods) so it can never be stranded by a later period close.
  v_period_id := get_or_create_period(p_tenant_id, p_entry_date);

  INSERT INTO journal_entries
    (tenant_id, entry_date, period_id, entry_type, status, description_ar,
     description_en, source_module, source_entity_type, created_by)
  VALUES
    (p_tenant_id, p_entry_date, v_period_id, 'manual', 'draft',
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
