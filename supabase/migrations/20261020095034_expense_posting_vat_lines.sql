-- Keep strict journal validation. Omit zero VAT lines while preserving the
-- classified VAT ledger and existing expense/AP amounts; no historical rewrite.
CREATE OR REPLACE FUNCTION public.dispatch_expense_approved(p_ev public.financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
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
  v_lines        JSONB;
  v_period_year  SMALLINT := EXTRACT(YEAR FROM p_ev.event_date)::SMALLINT;
  v_period_month SMALLINT := EXTRACT(MONTH FROM p_ev.event_date)::SMALLINT;
BEGIN
  SELECT id, expense_code, expense_type, category, expense_date,
         amount, vat_rate, vat_amount, vat_recoverability, coa_account_code
  INTO v_exp
  FROM public.expenses
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL AND is_approved
  FOR SHARE;

  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'DSP001: source expense % not found', p_ev.source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE tenant_id = p_ev.tenant_id AND source_module = 'accounting'
      AND entry_type = 'expense'
      AND source_entity_type = 'expense'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  v_code        := COALESCE(NULLIF(v_exp.coa_account_code, ''), '5800');
  v_exp_id      := public.resolve_coa_account(p_ev.tenant_id, v_code);
  v_ap_id       := public.resolve_coa_account(p_ev.tenant_id, '2000');
  v_recoverable := (v_exp.vat_recoverability = 'recoverable');

  IF v_recoverable THEN
    v_dr_expense := v_exp.amount;
    v_dr_vat     := v_exp.vat_amount;
  ELSE
    v_dr_expense := v_exp.amount + v_exp.vat_amount;
    v_dr_vat     := 0;
  END IF;

  -- A journal line must have a real debit or credit. Zero VAT and
  -- non-recoverable VAT need two balanced lines, not a zero-value VAT line.
  v_lines := jsonb_build_array(jsonb_build_object('account_id',v_exp_id,
    'description','مصروف — '||COALESCE(v_exp.expense_code,'EXP'),'debit',v_dr_expense,'credit',0));
  IF v_dr_vat>0 THEN
    v_vatin_id := public.resolve_coa_account(p_ev.tenant_id,'2600');
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id',v_vatin_id,
      'description','ضريبة مدخلات — '||COALESCE(v_exp.expense_code,'EXP'),'debit',v_dr_vat,'credit',0));
  END IF;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id',v_ap_id,
    'description','ذمم موردين — '||COALESCE(v_exp.expense_code,'EXP'),'debit',0,'credit',v_exp.amount+v_exp.vat_amount));

  SELECT * FROM public.post_journal_entry(
    p_ev.tenant_id,
    v_exp.expense_date,
    'مصروف ' || COALESCE(v_exp.expense_type, 'other') || ' — ' || COALESCE(v_exp.expense_code, 'EXP'),
    v_lines,
    NULL,
    NULL,
    'expense',
    'expense',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  INSERT INTO public.vat_input_ledger
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
REVOKE ALL ON FUNCTION public.dispatch_expense_approved(public.financial_events) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_expense_approved(public.financial_events) TO service_role;
NOTIFY pgrst,'reload schema';
