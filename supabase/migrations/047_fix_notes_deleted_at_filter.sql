-- =====================================================================
-- 047 — Fix: credit/debit-note consumers reference a non-existent column
--
-- credit_notes / debit_notes are immutable documents with no soft-delete
-- (they have no deleted_at column), but dispatch_credit_note /
-- dispatch_debit_note filtered `deleted_at IS NULL` on them → runtime
-- error "column deleted_at does not exist" for every note event.
-- Recreate both consumers without the filter.
-- =====================================================================

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
