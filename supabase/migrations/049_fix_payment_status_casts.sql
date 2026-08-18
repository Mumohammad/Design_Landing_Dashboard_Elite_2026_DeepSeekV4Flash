-- 049_fix_payment_status_casts.sql
-- Fixes the Phase 10 consumers shipped in 048: text literals assigned to
-- enum-typed columns raised
--   "column \"status\" is of type ar_ap_status but expression is of type text"
--
-- Fix: explicit ::ar_ap_status / ::finance_payment_status casts, and the
-- invoice-status mirror now maps ar_ap_status → invoice_status explicitly
-- (paid/partially_paid/overdue/finalized).
--
-- Final-state source of truth: supabase/migrations/048_payments_engine.sql.

-- ═══ Consumer: PaymentAllocatedEvent (fixed) ═════════════════════════════
CREATE OR REPLACE FUNCTION dispatch_payment_allocated(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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
  SELECT * INTO v_pay
  FROM finance_payments
  WHERE id = p_ev.source_id AND tenant_id = p_ev.tenant_id AND deleted_at IS NULL;

  IF v_pay.id IS NULL THEN
    RAISE EXCEPTION 'PMT005: payment % not found', p_ev.source_id;
  END IF;
  IF v_pay.status = 'void' THEN
    RAISE EXCEPTION 'PMT002: payment % is void', v_pay.payment_ref;
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

-- ═══ Consumer: PaymentVoidedEvent (fixed) ════════════════════════════════
CREATE OR REPLACE FUNCTION dispatch_payment_voided(p_ev financial_events)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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

-- Execution boundary: service-role only (re-assert for the replaced bodies).
REVOKE ALL ON FUNCTION dispatch_payment_allocated(financial_events) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_payment_voided(financial_events) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION dispatch_payment_allocated(financial_events) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_payment_voided(financial_events) TO service_role;
