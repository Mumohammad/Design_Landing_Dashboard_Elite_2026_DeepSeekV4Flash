-- =====================================================================
-- 045 — Unify post_journal_entry signature + full entry-type support
--
-- History: 031 created post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT,
-- UUID); 033 rebuilt it as (UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT)
-- with p_entry_type TEXT gated by JRN009 to ('manual','opening'); 044
-- then added a THIRD overload with p_entry_type journal_entry_type plus
-- source-ref params — leaving PostgREST unable to resolve the named-arg
-- RPC (PGRST203 ambiguity) and the dispatcher's entry types blocked by
-- JRN009.
--
-- This migration drops every overload and recreates ONE function:
--
--   post_journal_entry(UUID, DATE, TEXT, JSONB, TEXT, UUID, TEXT, TEXT, UUID)
--     p_entry_type         TEXT  DEFAULT 'manual'   — full enum set (JRN009)
--     p_source_entity_type TEXT  DEFAULT NULL       → 'manual_entry' fallback
--     p_source_entity_id   UUID  DEFAULT NULL
--
-- Posted entries are immutable (JRN001), so the dispatcher consumers stamp
-- entry_type + source refs at INSERT time through these parameters.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Single unified post_journal_entry
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 2. Dispatcher consumers — pass entry_type + source refs at insert time
--    (identical bodies to 042's final state; re-asserted here so the live
--    DB's functions match after the signature change)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dispatch_sales_finalized(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inv          RECORD;
  v_ar_id        UUID;
  v_rev_id       UUID;
  v_vatout_id    UUID;
  v_entry_id     UUID;
  v_entry_ref    TEXT;
  v_period_year  SMALLINT := EXTRACT(YEAR FROM p_ev.event_date)::SMALLINT;
  v_period_month SMALLINT := EXTRACT(MONTH FROM p_ev.event_date)::SMALLINT;
BEGIN
  SELECT id, invoice_number, customer_id, issue_date, due_date,
         subtotal, vat_amount, total, vat_rate
  INTO v_inv
  FROM invoices
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source invoice % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE source_module = 'accounting'
      AND entry_type = 'invoice'
      AND source_entity_type = 'invoice'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  v_ar_id     := resolve_coa_account(p_ev.tenant_id, '1200');
  v_rev_id    := resolve_coa_account(p_ev.tenant_id, '4000');
  v_vatout_id := resolve_coa_account(p_ev.tenant_id, '2500');

  SELECT * FROM post_journal_entry(
    p_ev.tenant_id,
    v_inv.issue_date,
    'ترحيل فاتورة مبيعات ' || v_inv.invoice_number,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar_id,     'description', 'ذمم عملاء — ' || v_inv.invoice_number, 'debit', v_inv.total,    'credit', 0),
      jsonb_build_object('account_id', v_rev_id,    'description', 'إيراد مبيعات — ' || v_inv.invoice_number, 'debit', 0,            'credit', v_inv.subtotal),
      jsonb_build_object('account_id', v_vatout_id, 'description', 'ضريبة مخرجات — ' || v_inv.invoice_number, 'debit', 0,            'credit', v_inv.vat_amount)
    ),
    NULL,
    NULL,
    'invoice',
    'invoice',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  INSERT INTO vat_output_ledger
    (tenant_id, period_year, period_month, invoice_ref, invoice_date,
     vat_base_amount, vat_rate, vat_amount, customer_id,
     source_entity_type, source_entity_id)
  VALUES
    (p_ev.tenant_id, v_period_year, v_period_month, v_inv.invoice_number,
     v_inv.issue_date, v_inv.subtotal, v_inv.vat_rate, v_inv.vat_amount,
     v_inv.customer_id, 'invoice', p_ev.source_id);

  INSERT INTO receivables
    (tenant_id, customer_id, invoice_ref, invoice_date, due_date,
     amount, vat_amount, total_amount, paid_amount, status,
     source_entity_type, source_entity_id)
  VALUES
    (p_ev.tenant_id, v_inv.customer_id, v_inv.invoice_number, v_inv.issue_date,
     v_inv.due_date, v_inv.subtotal, v_inv.vat_amount, v_inv.total, 0, 'open',
     'invoice', p_ev.source_id);

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_purchase_approved(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inv          RECORD;
  v_exp_id       UUID;
  v_vatin_id     UUID;
  v_ap_id        UUID;
  v_entry_id     UUID;
  v_entry_ref    TEXT;
  v_period_year  SMALLINT := EXTRACT(YEAR FROM p_ev.event_date)::SMALLINT;
  v_period_month SMALLINT := EXTRACT(MONTH FROM p_ev.event_date)::SMALLINT;
BEGIN
  SELECT id, invoice_number, supplier_id, issue_date, subtotal,
         vat_amount, total, vat_rate
  INTO v_inv
  FROM invoices
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source invoice % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE source_module = 'accounting'
      AND entry_type = 'expense'
      AND source_entity_type = 'purchase_invoice'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  v_exp_id   := resolve_coa_account(p_ev.tenant_id, '5800');
  v_vatin_id := resolve_coa_account(p_ev.tenant_id, '2600');
  v_ap_id    := resolve_coa_account(p_ev.tenant_id, '2000');

  SELECT * FROM post_journal_entry(
    p_ev.tenant_id,
    v_inv.issue_date,
    'مشتريات — ' || v_inv.invoice_number,
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp_id,   'description', 'مصروف مشتريات — ' || v_inv.invoice_number, 'debit', v_inv.subtotal,   'credit', 0),
      jsonb_build_object('account_id', v_vatin_id, 'description', 'ضريبة مدخلات — ' || v_inv.invoice_number, 'debit', v_inv.vat_amount, 'credit', 0),
      jsonb_build_object('account_id', v_ap_id,    'description', 'ذمم موردين — ' || v_inv.invoice_number,   'debit', 0,               'credit', v_inv.total)
    ),
    NULL,
    NULL,
    'expense',
    'purchase_invoice',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  INSERT INTO vat_input_ledger
    (tenant_id, period_year, period_month, invoice_ref, invoice_date,
     vat_base_amount, vat_rate, vat_amount, supplier_id,
     source_entity_type, source_entity_id, vat_recoverability)
  VALUES
    (p_ev.tenant_id, v_period_year, v_period_month, v_inv.invoice_number,
     v_inv.issue_date, v_inv.subtotal, v_inv.vat_rate, v_inv.vat_amount,
     v_inv.supplier_id, 'purchase_invoice', p_ev.source_id, 'recoverable');

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_expense_approved(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_exp          RECORD;
  v_exp_id       UUID;
  v_vatin_id     UUID;
  v_ap_id        UUID;
  v_entry_id     UUID;
  v_entry_ref    TEXT;
  v_recoverable  BOOLEAN;
  v_dr_expense   NUMERIC(12,2);
  v_dr_vat       NUMERIC(12,2);
  v_code         TEXT;
  v_period_year  SMALLINT := EXTRACT(YEAR FROM p_ev.event_date)::SMALLINT;
  v_period_month SMALLINT := EXTRACT(MONTH FROM p_ev.event_date)::SMALLINT;
BEGIN
  SELECT id, expense_code, expense_type, category, expense_date,
         amount, vat_rate, vat_amount, vat_recoverability, coa_account_code
  INTO v_exp
  FROM expenses
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source expense % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE source_module = 'accounting'
      AND entry_type = 'expense'
      AND source_entity_type = 'expense'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  v_code        := COALESCE(NULLIF(v_exp.coa_account_code, ''), '5800');
  v_exp_id      := resolve_coa_account(p_ev.tenant_id, v_code);
  v_vatin_id    := resolve_coa_account(p_ev.tenant_id, '2600');
  v_ap_id       := resolve_coa_account(p_ev.tenant_id, '2000');
  v_recoverable := (v_exp.vat_recoverability = 'recoverable');

  IF v_recoverable THEN
    v_dr_expense := v_exp.amount;
    v_dr_vat     := v_exp.vat_amount;
  ELSE
    v_dr_expense := v_exp.amount + v_exp.vat_amount;
    v_dr_vat     := 0;
  END IF;

  SELECT * FROM post_journal_entry(
    p_ev.tenant_id,
    v_exp.expense_date,
    'مصروف ' || COALESCE(v_exp.expense_type, 'other') || ' — ' || COALESCE(v_exp.expense_code, 'EXP'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp_id,   'description', 'مصروف — ' || COALESCE(v_exp.expense_code, 'EXP'), 'debit', v_dr_expense, 'credit', 0),
      jsonb_build_object('account_id', v_vatin_id, 'description', 'ضريبة مدخلات — ' || COALESCE(v_exp.expense_code, 'EXP'), 'debit', v_dr_vat, 'credit', 0),
      jsonb_build_object('account_id', v_ap_id,    'description', 'ذمم موردين — ' || COALESCE(v_exp.expense_code, 'EXP'), 'debit', 0, 'credit', v_exp.amount + v_exp.vat_amount)
    ),
    NULL,
    NULL,
    'expense',
    'expense',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  INSERT INTO vat_input_ledger
    (tenant_id, period_year, period_month, invoice_ref, invoice_date,
     vat_base_amount, vat_rate, vat_amount,
     source_entity_type, source_entity_id, vat_recoverability)
  VALUES
    (p_ev.tenant_id, v_period_year, v_period_month,
     COALESCE(v_exp.expense_code, 'EXP'), v_exp.expense_date,
     v_exp.amount, v_exp.vat_rate, v_exp.vat_amount,
     'expense', p_ev.source_id, v_exp.vat_recoverability);

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_credit_note(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_note         RECORD;
  v_ar_id        UUID;
  v_rev_id       UUID;
  v_vatout_id    UUID;
  v_entry_id     UUID;
  v_entry_ref    TEXT;
  v_period_year  SMALLINT := EXTRACT(YEAR FROM p_ev.event_date)::SMALLINT;
  v_period_month SMALLINT := EXTRACT(MONTH FROM p_ev.event_date)::SMALLINT;
BEGIN
  SELECT id, credit_note_number, reference_invoice_id, customer_id,
         issue_date, subtotal, vat_amount, total, reason
  INTO v_note
  FROM credit_notes
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id;

  IF v_note.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source credit note % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE source_module = 'accounting'
      AND entry_type = 'reversal'
      AND source_entity_type = 'credit_note'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  v_ar_id     := resolve_coa_account(p_ev.tenant_id, '1200');
  v_rev_id    := resolve_coa_account(p_ev.tenant_id, '4000');
  v_vatout_id := resolve_coa_account(p_ev.tenant_id, '2500');

  SELECT * FROM post_journal_entry(
    p_ev.tenant_id,
    v_note.issue_date,
    'إشعار دائن — ' || v_note.credit_note_number,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar_id,     'description', 'عكس ذمم عملاء — ' || v_note.credit_note_number, 'debit', 0,            'credit', v_note.total),
      jsonb_build_object('account_id', v_rev_id,    'description', 'عكس إيراد — ' || v_note.credit_note_number,    'debit', v_note.subtotal, 'credit', 0),
      jsonb_build_object('account_id', v_vatout_id, 'description', 'عكس ضريبة مخرجات — ' || v_note.credit_note_number, 'debit', v_note.vat_amount, 'credit', 0)
    ),
    NULL,
    NULL,
    'reversal',
    'credit_note',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  INSERT INTO vat_adjustments
    (tenant_id, period_year, period_month, adjustment_type, direction,
     base_amount, vat_amount, reason, status, finalized_at,
     source_entity_type, source_entity_id)
  VALUES
    (p_ev.tenant_id, v_period_year, v_period_month, 'credit_note', 'output',
     v_note.subtotal, -v_note.vat_amount,
     COALESCE(v_note.reason, 'إشعار دائن ' || v_note.credit_note_number),
     'finalized', now(), 'credit_note', p_ev.source_id);

  UPDATE receivables
  SET amount       = GREATEST(0, amount - v_note.subtotal),
      vat_amount   = GREATEST(0, vat_amount - v_note.vat_amount),
      total_amount = GREATEST(0, total_amount - v_note.total),
      updated_at   = now()
  WHERE tenant_id = p_ev.tenant_id
    AND source_entity_type = 'invoice'
    AND source_entity_id = v_note.reference_invoice_id
    AND deleted_at IS NULL;

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_debit_note(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_note         RECORD;
  v_inv          RECORD;
  v_ar_id        UUID;
  v_rev_id       UUID;
  v_vatout_id    UUID;
  v_entry_id     UUID;
  v_entry_ref    TEXT;
  v_period_year  SMALLINT := EXTRACT(YEAR FROM p_ev.event_date)::SMALLINT;
  v_period_month SMALLINT := EXTRACT(MONTH FROM p_ev.event_date)::SMALLINT;
BEGIN
  SELECT id, debit_note_number, reference_invoice_id, customer_id,
         issue_date, subtotal, vat_amount, total, reason
  INTO v_note
  FROM debit_notes
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id;

  IF v_note.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source debit note % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE source_module = 'accounting'
      AND entry_type = 'invoice'
      AND source_entity_type = 'debit_note'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  SELECT due_date INTO v_inv
  FROM invoices
  WHERE id = v_note.reference_invoice_id AND tenant_id = p_ev.tenant_id;

  v_ar_id     := resolve_coa_account(p_ev.tenant_id, '1200');
  v_rev_id    := resolve_coa_account(p_ev.tenant_id, '4000');
  v_vatout_id := resolve_coa_account(p_ev.tenant_id, '2500');

  SELECT * FROM post_journal_entry(
    p_ev.tenant_id,
    v_note.issue_date,
    'إشعار مدين — ' || v_note.debit_note_number,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar_id,     'description', 'ذمم عملاء — ' || v_note.debit_note_number, 'debit', v_note.total,    'credit', 0),
      jsonb_build_object('account_id', v_rev_id,    'description', 'إيراد إضافي — ' || v_note.debit_note_number, 'debit', 0,            'credit', v_note.subtotal),
      jsonb_build_object('account_id', v_vatout_id, 'description', 'ضريبة مخرجات — ' || v_note.debit_note_number, 'debit', 0,            'credit', v_note.vat_amount)
    ),
    NULL,
    NULL,
    'invoice',
    'debit_note',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  INSERT INTO vat_adjustments
    (tenant_id, period_year, period_month, adjustment_type, direction,
     base_amount, vat_amount, reason, status, finalized_at,
     source_entity_type, source_entity_id)
  VALUES
    (p_ev.tenant_id, v_period_year, v_period_month, 'debit_note', 'output',
     v_note.subtotal, v_note.vat_amount,
     COALESCE(v_note.reason, 'إشعار مدين ' || v_note.debit_note_number),
     'finalized', now(), 'debit_note', p_ev.source_id);

  INSERT INTO receivables
    (tenant_id, customer_id, invoice_ref, invoice_date, due_date,
     amount, vat_amount, total_amount, paid_amount, status,
     source_entity_type, source_entity_id)
  VALUES
    (p_ev.tenant_id, v_note.customer_id, v_note.debit_note_number, v_note.issue_date,
     COALESCE(v_inv.due_date, v_note.issue_date), v_note.subtotal,
     v_note.vat_amount, v_note.total, 0, 'open',
     'debit_note', p_ev.source_id);

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_invoice_cancelled(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inv          RECORD;
  v_ar_id        UUID;
  v_rev_id       UUID;
  v_vatout_id    UUID;
  v_vatin_id     UUID;
  v_ap_id        UUID;
  v_exp_id       UUID;
  v_entry_id     UUID;
  v_entry_ref    TEXT;
  v_effect_exists BOOLEAN;
  v_period_year  SMALLINT := EXTRACT(YEAR FROM p_ev.event_date)::SMALLINT;
  v_period_month SMALLINT := EXTRACT(MONTH FROM p_ev.event_date)::SMALLINT;
BEGIN
  SELECT id, invoice_number, invoice_type, issue_date, subtotal,
         vat_amount, total
  INTO v_inv
  FROM invoices
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source invoice % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE source_module = 'accounting'
      AND entry_type = 'reversal'
      AND source_entity_type = 'invoice'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  IF v_inv.invoice_type = 'purchase' THEN
    SELECT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE source_module = 'accounting'
        AND entry_type = 'expense'
        AND source_entity_type = 'purchase_invoice'
        AND source_entity_id = p_ev.source_id
    ) INTO v_effect_exists;

    IF NOT v_effect_exists THEN
      RETURN 'skipped';
    END IF;

    v_ap_id    := resolve_coa_account(p_ev.tenant_id, '2000');
    v_exp_id   := resolve_coa_account(p_ev.tenant_id, '5800');
    v_vatin_id := resolve_coa_account(p_ev.tenant_id, '2600');

    SELECT * FROM post_journal_entry(
      p_ev.tenant_id,
      v_inv.issue_date,
      'إلغاء فاتورة مشتريات — ' || v_inv.invoice_number,
      jsonb_build_array(
        jsonb_build_object('account_id', v_ap_id,    'description', 'عكس ذمم موردين — ' || v_inv.invoice_number, 'debit', v_inv.total,    'credit', 0),
        jsonb_build_object('account_id', v_exp_id,   'description', 'عكس مصروف مشتريات — ' || v_inv.invoice_number, 'debit', 0,            'credit', v_inv.subtotal),
        jsonb_build_object('account_id', v_vatin_id, 'description', 'عكس ضريبة مدخلات — ' || v_inv.invoice_number, 'debit', 0,            'credit', v_inv.vat_amount)
      ),
      NULL,
      NULL,
      'reversal',
      'invoice',
      p_ev.source_id
    ) INTO v_entry_id, v_entry_ref;

    INSERT INTO vat_adjustments
      (tenant_id, period_year, period_month, adjustment_type, direction,
       base_amount, vat_amount, reason, status, finalized_at,
       source_entity_type, source_entity_id)
    VALUES
      (p_ev.tenant_id, v_period_year, v_period_month, 'correction', 'input',
       v_inv.subtotal, -v_inv.vat_amount,
       'إلغاء فاتورة مشتريات ' || v_inv.invoice_number,
       'finalized', now(), 'invoice', p_ev.source_id);
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE source_module = 'accounting'
        AND entry_type = 'invoice'
        AND source_entity_type = 'invoice'
        AND source_entity_id = p_ev.source_id
    ) INTO v_effect_exists;

    IF NOT v_effect_exists THEN
      RETURN 'skipped';
    END IF;

    v_ar_id     := resolve_coa_account(p_ev.tenant_id, '1200');
    v_rev_id    := resolve_coa_account(p_ev.tenant_id, '4000');
    v_vatout_id := resolve_coa_account(p_ev.tenant_id, '2500');

    SELECT * FROM post_journal_entry(
      p_ev.tenant_id,
      v_inv.issue_date,
      'إلغاء فاتورة مبيعات — ' || v_inv.invoice_number,
      jsonb_build_array(
        jsonb_build_object('account_id', v_ar_id,     'description', 'عكس ذمم عملاء — ' || v_inv.invoice_number, 'debit', 0,            'credit', v_inv.total),
        jsonb_build_object('account_id', v_rev_id,    'description', 'عكس إيراد — ' || v_inv.invoice_number,    'debit', v_inv.subtotal, 'credit', 0),
        jsonb_build_object('account_id', v_vatout_id, 'description', 'عكس ضريبة مخرجات — ' || v_inv.invoice_number, 'debit', v_inv.vat_amount, 'credit', 0)
      ),
      NULL,
      NULL,
      'reversal',
      'invoice',
      p_ev.source_id
    ) INTO v_entry_id, v_entry_ref;

    INSERT INTO vat_adjustments
      (tenant_id, period_year, period_month, adjustment_type, direction,
       base_amount, vat_amount, reason, status, finalized_at,
       source_entity_type, source_entity_id)
    VALUES
      (p_ev.tenant_id, v_period_year, v_period_month, 'correction', 'output',
       v_inv.subtotal, -v_inv.vat_amount,
       'إلغاء فاتورة مبيعات ' || v_inv.invoice_number,
       'finalized', now(), 'invoice', p_ev.source_id);

    UPDATE receivables
    SET deleted_at = now(),
        updated_at = now()
    WHERE tenant_id = p_ev.tenant_id
      AND source_entity_type = 'invoice'
      AND source_entity_id = p_ev.source_id
      AND deleted_at IS NULL;
  END IF;

  RETURN 'ok';
END;
$$;
