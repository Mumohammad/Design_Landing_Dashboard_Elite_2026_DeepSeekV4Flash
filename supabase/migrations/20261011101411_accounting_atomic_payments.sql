-- Payments are recorded with a durable outbox, not four independent writes.
-- Existing event consumers remain the source of ledger/accounting semantics.
ALTER TABLE public.finance_payments ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.finance_payments ADD COLUMN IF NOT EXISTS request_payload jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS finance_payments_tenant_request
  ON public.finance_payments(tenant_id, request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_finance_payment_atomic(
  p_payment jsonb, p_allocations jsonb, p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
  v_actor uuid := auth.uid();
  v_request jsonb;
  v_pay public.finance_payments%ROWTYPE;
  v_direction text;
  v_method public.finance_payment_method;
  v_amount numeric(12,2);
  v_date date;
  v_customer uuid;
  v_supplier uuid;
  v_bank uuid;
  v_line jsonb;
  v_alloc numeric(12,2);
  v_sum numeric := 0;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'PMT_AUTH: active tenant account required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_permission('accounting', 'create') THEN
    RAISE EXCEPTION 'PMT_PERMISSION: accounting:create required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_payment IS NULL OR jsonb_typeof(p_payment) <> 'object'
    OR p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'PMT004: invalid payment payload';
  END IF;
  IF jsonb_array_length(p_allocations) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'PMT004: payment requires 1 to 1000 allocations';
  END IF;
  v_direction := p_payment->>'direction';
  IF COALESCE(p_payment->>'currency','SAR') <> 'SAR' THEN
    RAISE EXCEPTION 'ACC_CURRENCY: accounting supports SAR only';
  END IF;
  IF v_direction IS NULL OR v_direction NOT IN ('in', 'out')
    OR COALESCE(p_payment->>'method', '') NOT IN ('cash', 'transfer', 'cheque', 'wps', 'card')
    OR COALESCE(p_payment->>'amount', '') !~ '^\d+(\.\d+)?$'
    OR COALESCE(p_payment->>'payment_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'PMT004: invalid payment details';
  END IF;
  v_method := (p_payment->>'method')::public.finance_payment_method;
  v_amount := (p_payment->>'amount')::numeric;
  v_date := (p_payment->>'payment_date')::date;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'PMT004: amount must be positive'; END IF;
  v_customer := NULLIF(p_payment->>'customer_id', '')::uuid;
  v_supplier := NULLIF(p_payment->>'supplier_id', '')::uuid;
  v_bank := NULLIF(p_payment->>'bank_account_id', '')::uuid;
  IF (v_direction = 'in' AND (v_customer IS NULL OR v_supplier IS NOT NULL))
    OR (v_direction = 'out' AND (v_supplier IS NULL OR v_customer IS NOT NULL))
    OR (v_method <> 'cash' AND v_bank IS NULL)
    OR (v_method = 'cash' AND v_bank IS NOT NULL) THEN
    RAISE EXCEPTION 'PMT004: invalid party or bank';
  END IF;
  v_request := jsonb_build_object('payment', p_payment, 'allocations', p_allocations);
  -- Same-tenant request serialization handles simultaneous HTTP retries.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_request_id::text, 0));
  SELECT * INTO v_pay FROM public.finance_payments
    WHERE tenant_id = v_tenant AND request_id = p_request_id;
  IF FOUND THEN
    IF v_pay.request_payload IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'PMT_RETRY: request identifier already used for different details';
    END IF;
    IF v_pay.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'PMT005: payment not found'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.financial_events WHERE tenant_id = v_tenant
      AND source_id = v_pay.id AND event_type = 'PaymentAllocatedEvent'
      AND idempotency_key = 'payment:' || v_pay.id::text || ':allocated') THEN
      RAISE EXCEPTION 'PMT_RETRY: original payment provisioning is incomplete';
    END IF;
    RETURN jsonb_build_object('id', v_pay.id, 'payment_ref', v_pay.payment_ref, 'status', v_pay.status, 'replayed', true);
  END IF;
  IF v_customer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers
    WHERE id = v_customer AND tenant_id = v_tenant AND deleted_at IS NULL AND is_active) THEN
    RAISE EXCEPTION 'CUS001: customer not found in caller tenant';
  END IF;
  IF v_supplier IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers
    WHERE id = v_supplier AND tenant_id = v_tenant AND deleted_at IS NULL AND is_active) THEN
    RAISE EXCEPTION 'SUP001: supplier not found in caller tenant';
  END IF;
  IF v_bank IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bank_accounts
    WHERE id = v_bank AND tenant_id = v_tenant AND deleted_at IS NULL AND is_active) THEN
    RAISE EXCEPTION 'PMT006: bank account not found in caller tenant';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    IF jsonb_typeof(v_line) <> 'object' OR COALESCE(v_line->>'amount', '') !~ '^\d+(\.\d+)?$'
      OR num_nonnulls(NULLIF(v_line->>'receivable_id', ''), NULLIF(v_line->>'payable_id', '')) <> 1
      OR (v_direction = 'in' AND NULLIF(v_line->>'receivable_id', '') IS NULL)
      OR (v_direction = 'out' AND NULLIF(v_line->>'payable_id', '') IS NULL) THEN
      RAISE EXCEPTION 'PMT004: invalid payment allocation';
    END IF;
    v_alloc := (v_line->>'amount')::numeric;
    IF v_alloc <= 0 THEN RAISE EXCEPTION 'PMT004: allocation must be positive'; END IF;
    v_sum := v_sum + v_alloc;
  END LOOP;
  IF v_sum <> v_amount THEN RAISE EXCEPTION 'PMT003: allocations must equal payment amount'; END IF;
  -- Lock all targets in deterministic order before reservation checks. A
  -- pending outbox payment reserves its amount even before posting.
  PERFORM r.id FROM public.receivables r WHERE r.tenant_id = v_tenant AND r.id IN
    (SELECT NULLIF(value->>'receivable_id', '')::uuid FROM jsonb_array_elements(p_allocations))
    ORDER BY r.id FOR UPDATE;
  PERFORM p.id FROM public.payables p WHERE p.tenant_id = v_tenant AND p.id IN
    (SELECT NULLIF(value->>'payable_id', '')::uuid FROM jsonb_array_elements(p_allocations))
    ORDER BY p.id FOR UPDATE;
  INSERT INTO public.finance_payments (tenant_id, direction, customer_id, supplier_id,
    payment_date, amount, method, bank_account_id, reference, status, created_by, request_id, request_payload)
  VALUES (v_tenant, v_direction, v_customer, v_supplier, v_date, v_amount, v_method,
    v_bank, NULLIF(btrim(p_payment->>'reference'), ''), 'pending', v_actor, p_request_id, v_request)
  RETURNING * INTO v_pay;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    INSERT INTO public.payment_allocations (tenant_id, finance_payment_id,
      receivable_id, payable_id, allocated_amount, allocated_by)
    VALUES (v_tenant, v_pay.id, NULLIF(v_line->>'receivable_id', '')::uuid,
      NULLIF(v_line->>'payable_id', '')::uuid, (v_line->>'amount')::numeric, v_actor);
  END LOOP;
  INSERT INTO public.financial_events (tenant_id, event_id, idempotency_key,
    source_type, source_id, event_type, event_date, payload)
  VALUES (v_tenant, gen_random_uuid(), 'payment:' || v_pay.id::text || ':allocated',
    'payment', v_pay.id, 'PaymentAllocatedEvent', v_date,
    jsonb_build_object('payment_ref', v_pay.payment_ref, 'direction', v_direction,
      'amount', v_amount, 'method', v_method, 'allocations', p_allocations));
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
  VALUES (v_tenant, v_actor, 'accounting', 'finance_payments', v_pay.id, 'payment_recorded',
    jsonb_build_object('payment_ref', v_pay.payment_ref, 'amount', v_amount,
      'direction', v_direction, 'allocations', jsonb_array_length(p_allocations)));
  RETURN jsonb_build_object('id', v_pay.id, 'payment_ref', v_pay.payment_ref, 'status', v_pay.status, 'replayed', false);
END $$;

-- Lock payment then its targets for posting/reversal, consistently across all
-- dispatcher consumers. Only internal/service code may call this helper.
CREATE OR REPLACE FUNCTION public.lock_payment_targets(p_id uuid, p_tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN
  PERFORM id FROM public.finance_payments WHERE id = p_id AND tenant_id = p_tenant FOR UPDATE;
  PERFORM r.id FROM public.receivables r WHERE r.tenant_id = p_tenant AND EXISTS
    (SELECT 1 FROM public.payment_allocations a WHERE a.finance_payment_id = p_id AND a.tenant_id = p_tenant AND a.receivable_id = r.id)
    ORDER BY r.id FOR UPDATE;
  PERFORM p.id FROM public.payables p WHERE p.tenant_id = p_tenant AND EXISTS
    (SELECT 1 FROM public.payment_allocations a WHERE a.finance_payment_id = p_id AND a.tenant_id = p_tenant AND a.payable_id = p.id)
    ORDER BY p.id FOR UPDATE;
END $$;

CREATE OR REPLACE FUNCTION public.guard_payment_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_pay public.finance_payments%ROWTYPE;
  v_outstanding numeric;
  v_reserved numeric;
  v_party uuid;
BEGIN
  SELECT * INTO v_pay FROM public.finance_payments
    WHERE id = NEW.finance_payment_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PMT002: payment not found'; END IF;
  IF v_pay.status <> 'pending' THEN RAISE EXCEPTION 'PMT002: allocations are frozen after posting or voiding'; END IF;
  IF EXISTS (SELECT 1 FROM public.financial_events WHERE source_type = 'payment'
    AND source_id = v_pay.id AND tenant_id = v_pay.tenant_id AND event_type = 'PaymentAllocatedEvent') THEN
    RAISE EXCEPTION 'PMT002: queued allocations are immutable';
  END IF;
  IF (v_pay.direction = 'in' AND NEW.receivable_id IS NULL)
    OR (v_pay.direction = 'out' AND NEW.payable_id IS NULL) THEN
    RAISE EXCEPTION 'PMT004: allocation direction mismatch';
  END IF;
  IF NEW.receivable_id IS NOT NULL THEN
    SELECT total_amount - paid_amount, customer_id INTO v_outstanding, v_party
      FROM public.receivables WHERE id = NEW.receivable_id AND tenant_id = NEW.tenant_id
        AND deleted_at IS NULL AND status IN ('open', 'partially_paid', 'overdue') FOR UPDATE;
    SELECT COALESCE(sum(a.allocated_amount), 0) INTO v_reserved
      FROM public.payment_allocations a JOIN public.finance_payments p ON p.id = a.finance_payment_id
      WHERE a.receivable_id = NEW.receivable_id AND a.tenant_id = NEW.tenant_id AND a.id <> NEW.id
        AND p.tenant_id = NEW.tenant_id AND p.status = 'pending' AND p.deleted_at IS NULL;
    IF v_party IS NOT NULL AND v_party IS DISTINCT FROM v_pay.customer_id THEN RAISE EXCEPTION 'PMT004: allocation party mismatch'; END IF;
  ELSE
    SELECT total_amount - paid_amount, supplier_id INTO v_outstanding, v_party
      FROM public.payables WHERE id = NEW.payable_id AND tenant_id = NEW.tenant_id
        AND deleted_at IS NULL AND status IN ('open', 'partially_paid', 'overdue') FOR UPDATE;
    SELECT COALESCE(sum(a.allocated_amount), 0) INTO v_reserved
      FROM public.payment_allocations a JOIN public.finance_payments p ON p.id = a.finance_payment_id
      WHERE a.payable_id = NEW.payable_id AND a.tenant_id = NEW.tenant_id AND a.id <> NEW.id
        AND p.tenant_id = NEW.tenant_id AND p.status = 'pending' AND p.deleted_at IS NULL;
    IF v_party IS NOT NULL AND v_party IS DISTINCT FROM v_pay.supplier_id THEN RAISE EXCEPTION 'PMT004: allocation party mismatch'; END IF;
  END IF;
  IF v_outstanding IS NULL THEN RAISE EXCEPTION 'PMT001: target not open in payment tenant'; END IF;
  IF NEW.allocated_amount > v_outstanding - v_reserved THEN
    RAISE EXCEPTION 'PMT001: allocation exceeds unreserved outstanding balance';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.protect_managed_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.request_id IS NOT NULL AND current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'PMT002: use the guarded payment lifecycle';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.request_id IS NOT NULL OR OLD.status <> 'pending' THEN
    IF TG_OP = 'DELETE' OR current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'PMT002: use the guarded payment lifecycle';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status','updated_at','updated_by']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','updated_at','updated_by']) THEN
      RAISE EXCEPTION 'PMT002: recorded financial details are immutable';
    END IF;
    IF OLD.status = 'void' AND NEW.status <> 'void' THEN
      RAISE EXCEPTION 'PMT002: void payment cannot be reopened';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.protect_managed_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN
  PERFORM id FROM public.finance_payments WHERE id = OLD.finance_payment_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.finance_payments WHERE id = OLD.finance_payment_id
    AND (request_id IS NOT NULL OR status <> 'pending')) THEN
    RAISE EXCEPTION 'PMT002: recorded allocations are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.finance_payment_id IS DISTINCT FROM OLD.finance_payment_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.receivable_id IS DISTINCT FROM OLD.receivable_id
    OR NEW.payable_id IS DISTINCT FROM OLD.payable_id THEN
    RAISE EXCEPTION 'PMT004: allocation identity cannot be reassigned';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_managed_payment ON public.finance_payments;
CREATE TRIGGER protect_managed_payment BEFORE INSERT OR UPDATE OR DELETE ON public.finance_payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_managed_payment();
DROP TRIGGER IF EXISTS protect_managed_allocation ON public.payment_allocations;
CREATE TRIGGER protect_managed_allocation BEFORE UPDATE OR DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.protect_managed_allocation();

CREATE OR REPLACE FUNCTION public.void_finance_payment_atomic(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
  v_actor uuid := auth.uid();
  v_pay public.finance_payments%ROWTYPE;
  v_ev public.financial_events%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'PMT_AUTH: active tenant account required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_permission('accounting', 'approve') THEN
    RAISE EXCEPTION 'PMT_PERMISSION: accounting:approve required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_pay FROM public.finance_payments
    WHERE id = p_id AND tenant_id = v_tenant AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PMT005: payment not found'; END IF;
  IF v_pay.status = 'void' THEN RETURN jsonb_build_object('id', p_id, 'status', 'void', 'replayed', true); END IF;
  PERFORM public.lock_payment_targets(p_id, v_tenant);
  UPDATE public.finance_payments SET status = 'void', updated_by = v_actor WHERE id = p_id AND tenant_id = v_tenant;
  -- Reverse actual posted effects, not an untrusted status label. If period,
  -- journal, event or audit insertion fails, the whole void rolls back.
  IF EXISTS (SELECT 1 FROM public.journal_entries WHERE tenant_id = v_tenant
    AND source_entity_type = 'payment' AND source_entity_id = p_id AND entry_type = 'bank' AND status = 'posted') THEN
    INSERT INTO public.financial_events (tenant_id, event_id, idempotency_key, source_type,
      source_id, event_type, event_date, payload)
    VALUES (v_tenant, gen_random_uuid(), 'payment:' || p_id::text || ':voided', 'payment', p_id,
      'PaymentVoidedEvent', v_pay.payment_date, jsonb_build_object('payment_ref', v_pay.payment_ref))
    RETURNING * INTO v_ev;
    PERFORM public.dispatch_payment_voided(v_ev);
    UPDATE public.financial_events SET processing_status = 'processed', processed_at = now() WHERE id = v_ev.id;
  END IF;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
  VALUES (v_tenant, v_actor, 'accounting', 'finance_payments', p_id, 'payment_voided',
    jsonb_build_object('payment_ref', v_pay.payment_ref, 'status', 'void'));
  RETURN jsonb_build_object('id', p_id, 'status', 'void', 'replayed', false);
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_my_financial_events(p_batch_size integer DEFAULT 50)
RETURNS TABLE (out_processed integer, out_skipped integer, out_failed integer, out_last_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
  v_ev public.financial_events%ROWTYPE;
  v_result text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'DSP_AUTH: active tenant account required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_permission('accounting', 'approve') THEN
    RAISE EXCEPTION 'DSP_PERMISSION: accounting:approve required' USING ERRCODE = '42501';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'DSP002: batch size must be between 1 and 100';
  END IF;
  out_processed := 0; out_skipped := 0; out_failed := 0; out_last_error := NULL;
  FOR v_ev IN SELECT * FROM public.financial_events
    WHERE tenant_id = v_tenant AND processing_status IN ('pending', 'failed')
    ORDER BY created_at, id LIMIT p_batch_size FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      CASE v_ev.event_type
        WHEN 'InvoiceFinalizedEvent' THEN v_result := public.dispatch_sales_finalized(v_ev);
        WHEN 'PurchaseInvoiceApprovedEvent' THEN v_result := public.dispatch_purchase_approved(v_ev);
        WHEN 'ExpenseApprovedEvent' THEN v_result := public.dispatch_expense_approved(v_ev);
        WHEN 'CreditNoteIssuedEvent' THEN v_result := public.dispatch_credit_note(v_ev);
        WHEN 'DebitNoteIssuedEvent' THEN v_result := public.dispatch_debit_note(v_ev);
        WHEN 'InvoiceCancelledEvent' THEN v_result := public.dispatch_invoice_cancelled(v_ev);
        WHEN 'PaymentAllocatedEvent' THEN v_result := public.dispatch_payment_allocated(v_ev);
        WHEN 'PaymentVoidedEvent' THEN v_result := public.dispatch_payment_voided(v_ev);
        ELSE RAISE EXCEPTION 'DSP002: unknown event type';
      END CASE;
      UPDATE public.financial_events SET processing_status = CASE WHEN v_result = 'skipped'
        THEN 'skipped_duplicate'::public.financial_event_status ELSE 'processed'::public.financial_event_status END,
        processed_at = now(), error_message = NULL
        WHERE id = v_ev.id AND tenant_id = v_tenant;
      IF v_result = 'skipped' THEN out_skipped := out_skipped + 1;
      ELSE out_processed := out_processed + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      out_failed := out_failed + 1;
      -- Avoid returning raw internal SQL/financial payloads to browsers.
      out_last_error := 'Financial posting failed; review accounting configuration and retry.';
      UPDATE public.financial_events SET processing_status = 'failed', error_message = out_last_error
        WHERE id = v_ev.id AND tenant_id = v_tenant;
    END;
  END LOOP;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.record_finance_payment_atomic(jsonb,jsonb,uuid),
  public.void_finance_payment_atomic(uuid), public.dispatch_my_financial_events(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_finance_payment_atomic(jsonb,jsonb,uuid),
  public.void_finance_payment_atomic(uuid), public.dispatch_my_financial_events(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.lock_payment_targets(uuid,uuid), public.guard_payment_allocation(),
  public.protect_managed_payment(), public.protect_managed_allocation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_payment_targets(uuid,uuid), public.guard_payment_allocation(),
  public.protect_managed_payment(), public.protect_managed_allocation() TO service_role;
-- Retain existing engine semantics/grants; serialize the effects themselves.
CREATE OR REPLACE FUNCTION public.dispatch_payment_allocated(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay        finance_payments%ROWTYPE;
  v_alloc      RECORD;
  v_account_id UUID;
  v_cash_id    UUID;
  v_ar_id      UUID;
  v_ap_id      UUID;
  v_bank_code  TEXT;
  v_lines      JSONB := '[]'::jsonb;
  v_total      NUMERIC := 0;
  v_entry_id   UUID;
  v_entry_ref  TEXT;
BEGIN
  PERFORM public.lock_payment_targets(p_ev.source_id, p_ev.tenant_id);
  SELECT * INTO v_pay
  FROM finance_payments
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

  IF v_pay.id IS NULL THEN
    RAISE EXCEPTION 'PMT005: payment % not found', p_ev.source_id;
  END IF;

  -- Idempotency: effect already posted → replay-safe.
  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE source_module = 'accounting'
      AND entry_type = 'bank'
      AND source_entity_type = 'payment'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  -- A voided payment has no effect to materialise; a replay of a pre-void
  -- event must not fail (the guard already blocked any live insert).
  IF v_pay.status = 'void' THEN
    RETURN 'skipped';
  END IF;

  v_cash_id := resolve_coa_account(p_ev.tenant_id, '1000');
  v_ar_id   := resolve_coa_account(p_ev.tenant_id, '1200');
  v_ap_id   := resolve_coa_account(p_ev.tenant_id, '2000');

  IF v_pay.method = 'cash' THEN
    v_account_id := v_cash_id;
  ELSE
    SELECT COALESCE(b.coa_account_code, '1100') INTO v_bank_code
    FROM bank_accounts b WHERE b.id = v_pay.bank_account_id;
    v_account_id := resolve_coa_account(p_ev.tenant_id, COALESCE(v_bank_code, '1100'));
  END IF;

  FOR v_alloc IN
    SELECT pa.receivable_id, pa.payable_id, pa.allocated_amount
    FROM payment_allocations pa
    WHERE pa.finance_payment_id = p_ev.source_id AND pa.tenant_id = p_ev.tenant_id
    ORDER BY pa.created_at, pa.id
  LOOP
    v_total := v_total + v_alloc.allocated_amount;

    IF v_pay.direction = 'in' THEN
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_ar_id,
        'description', 'تحصيل من عميل — ' || v_pay.payment_ref,
        'debit', 0, 'credit', v_alloc.allocated_amount
      );
      UPDATE receivables SET
        paid_amount = paid_amount + v_alloc.allocated_amount,
        status = CASE WHEN paid_amount + v_alloc.allocated_amount >= total_amount - 0.001
                      THEN 'paid'::ar_ap_status ELSE 'partially_paid'::ar_ap_status END,
        updated_at = now()
      WHERE id = v_alloc.receivable_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

      -- Mirror onto the linked sales invoice (source ref set by 042).
      UPDATE invoices i SET status = CASE r.status
        WHEN 'paid' THEN 'paid'::invoice_status
        WHEN 'partially_paid' THEN 'partially_paid'::invoice_status
        WHEN 'overdue' THEN 'overdue'::invoice_status
        ELSE 'finalized'::invoice_status
      END
      FROM receivables r
      WHERE r.id = v_alloc.receivable_id
        AND i.id = r.source_entity_id
        AND r.source_entity_type = 'invoice'
        AND i.tenant_id = p_ev.tenant_id
        AND i.status IN ('finalized', 'paid', 'partially_paid', 'overdue');
    ELSE
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_ap_id,
        'description', 'سداد مورد — ' || v_pay.payment_ref,
        'debit', v_alloc.allocated_amount, 'credit', 0
      );
      UPDATE payables SET
        paid_amount = paid_amount + v_alloc.allocated_amount,
        status = CASE WHEN paid_amount + v_alloc.allocated_amount >= total_amount - 0.001
                      THEN 'paid'::ar_ap_status ELSE 'partially_paid'::ar_ap_status END,
        updated_at = now()
      WHERE id = v_alloc.payable_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;
    END IF;
  END LOOP;

  IF v_pay.direction = 'in' THEN
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_account_id,
      'description', 'إيداع — ' || v_pay.payment_ref,
      'debit', v_total, 'credit', 0
    );
  ELSE
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_account_id,
      'description', 'سحب — ' || v_pay.payment_ref,
      'debit', 0, 'credit', v_total
    );
  END IF;

  SELECT * FROM post_journal_entry(
    p_ev.tenant_id,
    v_pay.payment_date,
    CASE WHEN v_pay.direction = 'in' THEN 'تحصيل ' ELSE 'سداد ' END || v_pay.payment_ref,
    v_lines,
    NULL,
    NULL,
    'bank',
    'payment',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  UPDATE finance_payments SET
    status = CASE WHEN v_total >= v_pay.amount - 0.001
                  THEN 'allocated'::finance_payment_status ELSE 'partially_allocated'::finance_payment_status END,
    updated_at = now()
  WHERE id = p_ev.source_id;

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_payment_voided(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay        finance_payments%ROWTYPE;
  v_alloc      RECORD;
  v_account_id UUID;
  v_cash_id    UUID;
  v_ar_id      UUID;
  v_ap_id      UUID;
  v_bank_code  TEXT;
  v_lines      JSONB := '[]'::jsonb;
  v_total      NUMERIC := 0;
  v_entry_id   UUID;
  v_entry_ref  TEXT;
BEGIN
  PERFORM public.lock_payment_targets(p_ev.source_id, p_ev.tenant_id);
  SELECT * INTO v_pay
  FROM finance_payments
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

  IF v_pay.id IS NULL THEN
    RAISE EXCEPTION 'PMT005: payment % not found', p_ev.source_id;
  END IF;

  -- Idempotency: reversal already posted → replay-safe.
  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE source_module = 'accounting'
      AND entry_type = 'reversal'
      AND source_entity_type = 'payment'
      AND source_entity_id = p_ev.source_id
  ) THEN
    RETURN 'skipped';
  END IF;

  v_cash_id := resolve_coa_account(p_ev.tenant_id, '1000');
  v_ar_id   := resolve_coa_account(p_ev.tenant_id, '1200');
  v_ap_id   := resolve_coa_account(p_ev.tenant_id, '2000');

  IF v_pay.method = 'cash' THEN
    v_account_id := v_cash_id;
  ELSE
    SELECT COALESCE(b.coa_account_code, '1100') INTO v_bank_code
    FROM bank_accounts b WHERE b.id = v_pay.bank_account_id;
    v_account_id := resolve_coa_account(p_ev.tenant_id, COALESCE(v_bank_code, '1100'));
  END IF;

  FOR v_alloc IN
    SELECT pa.receivable_id, pa.payable_id, pa.allocated_amount
    FROM payment_allocations pa
    WHERE pa.finance_payment_id = p_ev.source_id AND pa.tenant_id = p_ev.tenant_id
    ORDER BY pa.created_at, pa.id
  LOOP
    v_total := v_total + v_alloc.allocated_amount;

    IF v_pay.direction = 'in' THEN
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_ar_id,
        'description', 'عكس تحصيل — ' || v_pay.payment_ref,
        'debit', v_alloc.allocated_amount, 'credit', 0
      );
      UPDATE receivables SET
        paid_amount = GREATEST(0, paid_amount - v_alloc.allocated_amount),
        status = CASE WHEN paid_amount - v_alloc.allocated_amount <= 0.001 THEN 'open'::ar_ap_status
                      WHEN paid_amount - v_alloc.allocated_amount >= total_amount - 0.001 THEN 'paid'::ar_ap_status
                      ELSE 'partially_paid'::ar_ap_status END,
        updated_at = now()
      WHERE id = v_alloc.receivable_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

      -- Restore invoice status (finalized once the receivable is reopened).
      UPDATE invoices i SET status = CASE r.status
        WHEN 'paid' THEN 'paid'::invoice_status
        WHEN 'partially_paid' THEN 'partially_paid'::invoice_status
        WHEN 'overdue' THEN 'overdue'::invoice_status
        ELSE 'finalized'::invoice_status
      END
      FROM receivables r
      WHERE r.id = v_alloc.receivable_id
        AND i.id = r.source_entity_id
        AND r.source_entity_type = 'invoice'
        AND i.tenant_id = p_ev.tenant_id
        AND i.status IN ('finalized', 'paid', 'partially_paid', 'overdue');
    ELSE
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_ap_id,
        'description', 'عكس سداد — ' || v_pay.payment_ref,
        'debit', 0, 'credit', v_alloc.allocated_amount
      );
      UPDATE payables SET
        paid_amount = GREATEST(0, paid_amount - v_alloc.allocated_amount),
        status = CASE WHEN paid_amount - v_alloc.allocated_amount <= 0.001 THEN 'open'::ar_ap_status
                      WHEN paid_amount - v_alloc.allocated_amount >= total_amount - 0.001 THEN 'paid'::ar_ap_status
                      ELSE 'partially_paid'::ar_ap_status END,
        updated_at = now()
      WHERE id = v_alloc.payable_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;
    END IF;
  END LOOP;

  IF v_pay.direction = 'in' THEN
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_account_id,
      'description', 'عكس إيداع — ' || v_pay.payment_ref,
      'debit', 0, 'credit', v_total
    );
  ELSE
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_account_id,
      'description', 'عكس سحب — ' || v_pay.payment_ref,
      'debit', v_total, 'credit', 0
    );
  END IF;

  SELECT * FROM post_journal_entry(
    p_ev.tenant_id,
    v_pay.payment_date,
    'عكس سداد ' || v_pay.payment_ref,
    v_lines,
    NULL,
    NULL,
    'reversal',
    'payment',
    p_ev.source_id
  ) INTO v_entry_id, v_entry_ref;

  RETURN 'ok';
END;
$$;
-- Invoker engines are now called below a guarded definer boundary. Ensure
-- unqualified legacy relations resolve to public before any temporary schema.
DO $$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('resolve_coa_account', 'post_journal_entry',
      'dispatch_sales_finalized', 'dispatch_purchase_approved', 'dispatch_expense_approved',
      'dispatch_credit_note', 'dispatch_debit_note', 'dispatch_invoice_cancelled',
      'dispatch_payment_allocated', 'dispatch_payment_voided')
  LOOP EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f); END LOOP;
  IF has_function_privilege('anon', 'public.record_finance_payment_atomic(jsonb,jsonb,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.dispatch_my_financial_events(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Payment RPC grant postcondition failed';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
