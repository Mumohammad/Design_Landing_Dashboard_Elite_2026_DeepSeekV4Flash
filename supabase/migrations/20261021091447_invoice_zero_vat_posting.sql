BEGIN;
-- Keep strict journal validation: zero VAT invoices need two balanced lines,
-- taxable invoices need three. Preserve complete VAT ledger bases and amounts.
-- These consumers run under the existing tenant dispatcher, never directly
-- from browser roles. Parent locks also serialize posting against status edits.
CREATE OR REPLACE FUNCTION public.dispatch_sales_finalized(p_ev public.financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inv          RECORD;
  v_lines        JSONB;
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
  FROM public.invoices
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL
    AND status IN ('finalized','paid','partially_paid','overdue') FOR SHARE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source invoice % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE tenant_id = p_ev.tenant_id AND source_module = 'accounting'
      AND entry_type = 'invoice'
      AND source_entity_type = 'invoice'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  v_ar_id     := public.resolve_coa_account(p_ev.tenant_id, '1200');
  v_rev_id    := public.resolve_coa_account(p_ev.tenant_id, '4000');


  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_ar_id,     'description', 'ذمم عملاء — ' || v_inv.invoice_number, 'debit', v_inv.total,    'credit', 0),
    jsonb_build_object('account_id', v_rev_id,    'description', 'إيراد مبيعات — ' || v_inv.invoice_number, 'debit', 0,            'credit', v_inv.subtotal));
  IF v_inv.vat_amount>0 THEN
    v_vatout_id := public.resolve_coa_account(p_ev.tenant_id, '2500');
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_id', v_vatout_id, 'description', 'ضريبة مخرجات — ' || v_inv.invoice_number, 'debit', 0,            'credit', v_inv.vat_amount));
  END IF;

  SELECT * FROM public.post_journal_entry(
    p_ev.tenant_id,
    v_inv.issue_date,
    'ترحيل فاتورة مبيعات ' || v_inv.invoice_number,
    v_lines,
    NULL,
    NULL,
    'invoice',
    'invoice',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  INSERT INTO public.vat_output_ledger
    (tenant_id, period_year, period_month, invoice_ref, invoice_date,
     vat_base_amount, vat_rate, vat_amount, customer_id,
     source_entity_type, source_entity_id)
  VALUES
    (p_ev.tenant_id, v_period_year, v_period_month, v_inv.invoice_number,
     v_inv.issue_date, v_inv.subtotal, v_inv.vat_rate, v_inv.vat_amount,
     v_inv.customer_id, 'invoice', p_ev.source_id);

  INSERT INTO public.receivables
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

CREATE OR REPLACE FUNCTION public.dispatch_purchase_approved(p_ev public.financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inv          RECORD;
  v_lines        JSONB;
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
  FROM public.invoices
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL
    AND status IN ('finalized','paid','partially_paid','overdue') FOR SHARE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source invoice % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE tenant_id = p_ev.tenant_id AND source_module = 'accounting'
      AND entry_type = 'expense'
      AND source_entity_type = 'purchase_invoice'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  v_exp_id   := public.resolve_coa_account(p_ev.tenant_id, '5800');

  v_ap_id    := public.resolve_coa_account(p_ev.tenant_id, '2000');

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_exp_id,   'description', 'مصروف مشتريات — ' || v_inv.invoice_number, 'debit', v_inv.subtotal,   'credit', 0),
    jsonb_build_object('account_id', v_ap_id,    'description', 'ذمم موردين — ' || v_inv.invoice_number,   'debit', 0,               'credit', v_inv.total));
  IF v_inv.vat_amount>0 THEN
    v_vatin_id := public.resolve_coa_account(p_ev.tenant_id, '2600');
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_id', v_vatin_id, 'description', 'ضريبة مدخلات — ' || v_inv.invoice_number, 'debit', v_inv.vat_amount, 'credit', 0));
  END IF;

  SELECT * FROM public.post_journal_entry(
    p_ev.tenant_id,
    v_inv.issue_date,
    'مشتريات — ' || v_inv.invoice_number,
    v_lines,
    NULL,
    NULL,
    'expense',
    'purchase_invoice',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  INSERT INTO public.vat_input_ledger
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
REVOKE ALL ON FUNCTION public.dispatch_sales_finalized(public.financial_events),
  public.dispatch_purchase_approved(public.financial_events) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_sales_finalized(public.financial_events),
  public.dispatch_purchase_approved(public.financial_events) TO service_role;
COMMIT;
