-- =====================================================================
-- 042 — Financial Phase 9: Event Dispatcher (Accounting/VAT consumers)
--
-- Phase 5–7 producers only *record* events in `financial_events` with
-- stable idempotency keys (EVENT-MODEL.md §2). This migration is the
-- consuming engine: `dispatch_pending_events()` polls `pending` rows in
-- creation order and materialises, exactly once per event:
--
--   InvoiceFinalizedEvent        → journal Dr AR / Cr Revenue / Cr VAT Out
--                                  + vat_output_ledger + receivables row
--   PurchaseInvoiceApprovedEvent → journal Dr Expense / Dr VAT In / Cr AP
--                                  + vat_input_ledger (payable is created
--                                  by the producer, Phase 7)
--   ExpenseApprovedEvent         → journal Dr Expense (CoA mapping) [+ Dr
--                                  VAT In when recoverable] / Cr AP
--                                  + vat_input_ledger (classified)
--   CreditNoteIssuedEvent        → reversal journal + vat_adjustments
--                                  (output −) + AR reduction on the
--                                  reference invoice's receivable
--   DebitNoteIssuedEvent         → additional-AR journal + vat_adjustments
--                                  (output +) + new receivable row
--   InvoiceCancelledEvent        → reversal of the finalized effect (sales
--                                  or purchase) + vat_adjustments + AR void
--
-- Idempotency: each consumer checks for its journal via
-- (entry_type, source_entity_type, source_entity_id); an already-present
-- effect marks the event `skipped_duplicate`. Each event is dispatched
-- atomically (savepoint); a failure marks the event `failed` with the
-- error message and is retried on the next run. Period mapping uses the
-- event's business `event_date` (EVENT-MODEL §5), never processing time.
--
-- NOTE (migration history): 043 fixed the orchestrator's loop-variable
-- type (RECORD → financial_events) and 044 extended post_journal_entry
-- with source-ref parameters so the consumers can stamp the journal at
-- INSERT time (posted entries are immutable, JRN001). This file is the
-- final fixed state of all three.
--
-- Execution: SECURITY INVOKER, EXECUTE revoked from PUBLIC/authenticated/
-- anon and granted to service_role only — the app-layer requirePermission
-- check on the Server Action stays the authorization boundary.
--
-- Verification: scripts/verify-event-dispatcher-phase9-rest.mjs
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Account resolution (CoA per tenant; DSP003 if not configured)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_coa_account(
  p_tenant_id UUID,
  p_code      TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  SELECT id INTO v_account_id
  FROM chart_of_accounts
  WHERE tenant_id = p_tenant_id
    AND account_code = p_code
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'DSP003: CoA account % is not configured for this tenant', p_code;
  END IF;

  RETURN v_account_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Consumer: sales invoice finalization (EVENT-MODEL §3.1)
--    Dr AR total / Cr Revenue subtotal / Cr VAT Out vat
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

  -- Idempotency: effect already posted → skip (replay-safe).
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

-- ---------------------------------------------------------------------
-- 3. Consumer: purchase invoice approval (EVENT-MODEL §3.6)
--    Dr Expense subtotal / Dr VAT In vat / Cr AP total
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 4. Consumer: expense approval (EVENT-MODEL §3.7)
--    Dr Expense (CoA mapping) [+ Dr VAT In when recoverable] / Cr AP
-- ---------------------------------------------------------------------
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

  -- Recoverable VAT: Dr Expense + Dr VAT In / Cr AP. Otherwise the VAT is
  -- capitalised into the expense (non-recoverable or pending review).
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

-- ---------------------------------------------------------------------
-- 5. Consumer: credit note (EVENT-MODEL §3.3)
--    Cr AR total / Dr Revenue subtotal / Dr VAT Out vat
--    + vat_adjustments (output −) + AR reduction on the reference invoice
-- ---------------------------------------------------------------------
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

  -- Reduce the reference invoice's receivable (CHECK forbids negatives, so
  -- reduce in place; floors at zero — a fully-credited invoice nets to 0).
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

-- ---------------------------------------------------------------------
-- 6. Consumer: debit note (EVENT-MODEL §3.4)
--    Dr AR total / Cr Revenue subtotal / Cr VAT Out vat
--    + vat_adjustments (output +) + new receivable row
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 7. Consumer: invoice cancellation (EVENT-MODEL §3.2) — reverses the
--    finalized effect (sales or purchase) that the dispatcher posted.
--    Only posts if the original effect exists; otherwise skipped.
-- ---------------------------------------------------------------------
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

  -- Already reversed → replay-safe skip.
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
    -- Original effect posted by the purchase consumer (entry_type expense).
    SELECT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE source_module = 'accounting'
        AND entry_type = 'expense'
        AND source_entity_type = 'purchase_invoice'
        AND source_entity_id = p_ev.source_id
    ) INTO v_effect_exists;

    IF NOT v_effect_exists THEN
      RETURN 'skipped';  -- nothing posted yet, nothing to reverse
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
    -- Sales: original effect posted by the sales consumer (entry_type invoice).
    SELECT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE source_module = 'accounting'
        AND entry_type = 'invoice'
        AND source_entity_type = 'invoice'
        AND source_entity_id = p_ev.source_id
    ) INTO v_effect_exists;

    IF NOT v_effect_exists THEN
      RETURN 'skipped';  -- nothing posted yet, nothing to reverse
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

    -- Void the receivable created for this invoice.
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

-- ---------------------------------------------------------------------
-- 8. Orchestrator: poll pending events → dispatch → mark processed /
--    skipped_duplicate / failed. Atomic per event (implicit savepoint).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dispatch_pending_events(p_batch_size INT DEFAULT 50)
RETURNS TABLE (out_processed INT, out_skipped INT, out_failed INT, out_last_error TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ev        financial_events;
  v_result    TEXT;
  v_processed INT := 0;
  v_skipped   INT := 0;
  v_failed    INT := 0;
  v_last_error TEXT := NULL;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 50;
  END IF;

  FOR v_ev IN
    SELECT fe.*
    FROM financial_events fe
    WHERE fe.processing_status = 'pending'
    ORDER BY fe.created_at, fe.id
    LIMIT p_batch_size
  LOOP
    BEGIN
      v_result := 'ok';

      IF v_ev.event_type = 'InvoiceFinalizedEvent' THEN
        v_result := dispatch_sales_finalized(v_ev);
      ELSIF v_ev.event_type = 'PurchaseInvoiceApprovedEvent' THEN
        v_result := dispatch_purchase_approved(v_ev);
      ELSIF v_ev.event_type = 'ExpenseApprovedEvent' THEN
        v_result := dispatch_expense_approved(v_ev);
      ELSIF v_ev.event_type = 'CreditNoteIssuedEvent' THEN
        v_result := dispatch_credit_note(v_ev);
      ELSIF v_ev.event_type = 'DebitNoteIssuedEvent' THEN
        v_result := dispatch_debit_note(v_ev);
      ELSIF v_ev.event_type = 'InvoiceCancelledEvent' THEN
        v_result := dispatch_invoice_cancelled(v_ev);
      ELSE
        RAISE EXCEPTION 'DSP002: unknown event_type %', v_ev.event_type;
      END IF;

      IF v_result = 'skipped' THEN
        UPDATE financial_events
        SET processing_status = 'skipped_duplicate', processed_at = now()
        WHERE id = v_ev.id;
        v_skipped := v_skipped + 1;
      ELSE
        UPDATE financial_events
        SET processing_status = 'processed', processed_at = now()
        WHERE id = v_ev.id;
        v_processed := v_processed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_last_error := SQLERRM;
      v_failed := v_failed + 1;
      UPDATE financial_events
      SET processing_status = 'failed', error_message = SQLERRM
      WHERE id = v_ev.id;
    END;
  END LOOP;

  out_processed    := v_processed;
  out_skipped      := v_skipped;
  out_failed       := v_failed;
  out_last_error   := v_last_error;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------
-- 9. Execution boundary: service-role only (app-layer requirePermission
--    stays the authorization boundary — same pattern as post_journal_entry).
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION resolve_coa_account(UUID, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_sales_finalized(financial_events) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_purchase_approved(financial_events) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_expense_approved(financial_events) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_credit_note(financial_events) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_debit_note(financial_events) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_invoice_cancelled(financial_events) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_pending_events(INT) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION resolve_coa_account(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_sales_finalized(financial_events) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_purchase_approved(financial_events) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_expense_approved(financial_events) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_credit_note(financial_events) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_debit_note(financial_events) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_invoice_cancelled(financial_events) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_pending_events(INT) TO service_role;
