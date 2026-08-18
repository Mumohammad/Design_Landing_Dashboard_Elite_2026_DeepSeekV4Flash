-- 050_fix_payment_guards.sql
-- Code-review hardening for the Phase 10 payments engine:
--
--   1. guard_payment_allocation now also enforces:
--        PMT004  allocation type must match the payment direction
--                ('in' → receivable only, 'out' → payable only)
--        PMT004  the allocation's party must match the payment's party
--                (when the receivable/payable names a customer/supplier)
--   2. dispatch_payment_allocated returns 'skipped' (not PMT002) when the
--      payment is void — a replay after a void should not leave a failed
--      event; the guard still protects live allocation inserts.
--
-- Final-state source of truth: supabase/migrations/048_payments_engine.sql.

CREATE OR REPLACE FUNCTION guard_payment_allocation() RETURNS trigger AS $$
DECLARE
  v_pay       finance_payments%ROWTYPE;
  v_outstand  NUMERIC;
  v_party_id  UUID;
BEGIN
  SELECT * INTO v_pay
  FROM finance_payments
  WHERE id = NEW.finance_payment_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;

  IF v_pay.id IS NULL THEN
    RAISE EXCEPTION 'PMT002: payment % not found', NEW.finance_payment_id;
  END IF;
  IF v_pay.status = 'void' THEN
    RAISE EXCEPTION 'PMT002: payment % is void; allocations are frozen', v_pay.payment_ref;
  END IF;

  -- Direction ↔ allocation-type consistency.
  IF v_pay.direction = 'in' AND NEW.payable_id IS NOT NULL THEN
    RAISE EXCEPTION 'PMT004: receipt (in) payments allocate to receivables only';
  ELSIF v_pay.direction = 'out' AND NEW.receivable_id IS NOT NULL THEN
    RAISE EXCEPTION 'PMT004: payment (out) allocates to payables only';
  END IF;

  IF NEW.receivable_id IS NOT NULL THEN
    SELECT total_amount - paid_amount, customer_id INTO v_outstand, v_party_id
    FROM receivables
    WHERE id = NEW.receivable_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;
    IF v_outstand IS NULL THEN
      RAISE EXCEPTION 'PMT001: receivable % not found', NEW.receivable_id;
    END IF;
    -- Party consistency (enforced when the receivable names a customer).
    IF v_party_id IS NOT NULL AND v_party_id IS DISTINCT FROM v_pay.customer_id THEN
      RAISE EXCEPTION 'PMT004: allocation targets another customer''s receivable';
    END IF;
  ELSE
    SELECT total_amount - paid_amount, supplier_id INTO v_outstand, v_party_id
    FROM payables
    WHERE id = NEW.payable_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;
    IF v_outstand IS NULL THEN
      RAISE EXCEPTION 'PMT001: payable % not found', NEW.payable_id;
    END IF;
    IF v_party_id IS NOT NULL AND v_party_id IS DISTINCT FROM v_pay.supplier_id THEN
      RAISE EXCEPTION 'PMT004: allocation targets another supplier''s payable';
    END IF;
  END IF;

  IF NEW.allocated_amount > v_outstand + 0.001 THEN
    RAISE EXCEPTION 'PMT001: allocation % exceeds outstanding balance %', NEW.allocated_amount, v_outstand;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replay-safe void handling: if the payment is already void when the
-- :allocated event is (re)dispatched, the effect is intentionally absent.
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

-- Execution boundary: service-role only (re-assert for the replaced bodies).
REVOKE ALL ON FUNCTION guard_payment_allocation() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_payment_allocated(financial_events) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION guard_payment_allocation() TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_payment_allocated(financial_events) TO service_role;
