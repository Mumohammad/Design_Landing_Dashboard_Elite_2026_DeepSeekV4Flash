-- 048_payments_engine.sql
-- Phase 10 — Payments Engine.
--
-- Completes the payment flow designed in 027 (finance_payments /
-- payment_allocations / bank_accounts) into a full engine:
--
--   1. bank_accounts.coa_account_code  — each bank account maps to a CoA
--      account (default 1100 Bank); cash payments post to 1000 Cash.
--   2. payment_allocations integrity:
--        PMT001  allocation exceeds the receivable/payable outstanding
--        PMT002  payment missing or void
--        PMT003  total allocations exceed the payment amount
--   3. protect_finalized_invoice extended so the payments engine may move
--      an invoice between finalized / paid / partially_paid / overdue, and
--      back to finalized only when its receivable is fully reopened.
--   4. Event consumers (EVENT-MODEL §3.5):
--        PaymentAllocatedEvent → Dr Bank / Cr AR   (receipt)
--                                Dr AP   / Cr Bank (supplier payment)
--                                + paid_amount / status updates (AR, AP,
--                                and the linked sales invoice)
--        PaymentVoidedEvent    → reversal journal + paid_amount restore
--      Both idempotent (journal source ref) and atomic per event.
--   5. Demo seeds for tenant 0001 (bank account + a payment against the
--      INV-2026-000001 receivable, left pending for the dispatcher).

-- ═══ 1. Bank account → CoA account ═══════════════════════════════════════
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS coa_account_code TEXT NOT NULL DEFAULT '1100';

-- ═══ 2. payment_allocations integrity ════════════════════════════════════
ALTER TABLE payment_allocations
  DROP CONSTRAINT IF EXISTS chk_alloc_target,
  DROP CONSTRAINT IF EXISTS chk_alloc_amount;

ALTER TABLE payment_allocations
  ADD CONSTRAINT chk_alloc_target CHECK (num_nonnulls(receivable_id, payable_id) = 1),
  ADD CONSTRAINT chk_alloc_amount CHECK (allocated_amount > 0);

-- PMT001 / PMT002 — per-row guard: the allocation must target an open
-- receivable/payable with sufficient outstanding balance, and the payment
-- must exist and not be void.
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

DROP TRIGGER IF EXISTS trg_payment_alloc_guard ON payment_allocations;
CREATE TRIGGER trg_payment_alloc_guard
  BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_payment_allocation();

-- PMT003 — the payment can never be over-allocated.
CREATE OR REPLACE FUNCTION enforce_payment_alloc_totals() RETURNS trigger AS $$
DECLARE
  v_amount     NUMERIC;
  v_allocated  NUMERIC;
BEGIN
  SELECT amount INTO v_amount
  FROM finance_payments
  WHERE id = COALESCE(NEW.finance_payment_id, OLD.finance_payment_id);

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_allocated
  FROM payment_allocations
  WHERE finance_payment_id = COALESCE(NEW.finance_payment_id, OLD.finance_payment_id);

  IF v_allocated > v_amount + 0.001 THEN
    RAISE EXCEPTION 'PMT003: allocations % exceed payment amount %', v_allocated, v_amount;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_alloc_totals ON payment_allocations;
CREATE TRIGGER trg_payment_alloc_totals
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_alloc_totals();

-- ═══ 3. Invoice status transitions for the payments engine ═══════════════
CREATE OR REPLACE FUNCTION protect_finalized_invoice() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('finalized', 'paid', 'partially_paid', 'overdue', 'credited', 'cancelled') THEN
    -- Financial columns immutable once finalized (corrections via notes).
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount IS DISTINCT FROM OLD.discount
       OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'INV003: finalized invoices are immutable; use a credit/debit note';
    END IF;

    -- Legal status transitions once finalized:
    --   - the payments engine (048) moves invoices between finalized /
    --     paid / partially_paid / overdue; reverting to finalized requires
    --     the invoice's receivable to be fully reopened (voided payment)
    --   - finalized → cancelled / credited (notes) as before
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status IN ('finalized', 'paid', 'partially_paid', 'overdue')
         AND NEW.status IN ('finalized', 'paid', 'partially_paid', 'overdue') THEN
        IF NEW.status = 'finalized' AND EXISTS (
          SELECT 1 FROM receivables r
          WHERE r.tenant_id = OLD.tenant_id
            AND r.source_entity_type = 'invoice'
            AND r.source_entity_id = OLD.id
            AND r.deleted_at IS NULL
            AND r.paid_amount > 0
        ) THEN
          RAISE EXCEPTION 'INV006: invoice still has an outstanding receivable';
        END IF;
        RETURN NEW;
      END IF;
      IF OLD.status = 'finalized' AND NEW.status IN ('cancelled', 'credited') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'INV006: invoice state does not permit this change';
    END IF;

    -- No soft-delete of immutable documents.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'INV003: finalized invoices are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══ 4a. Consumer: PaymentAllocatedEvent (EVENT-MODEL §3.5) ══════════════
--    Receipt  (direction 'in'):  Dr Bank/Cash / Cr AR   per allocation
--    Payment  (direction 'out'): Dr AP   / Cr Bank/Cash per allocation
--    + receivable/payable paid_amount + status; linked invoice status.
--    Idempotent via journal (entry_type 'bank', source 'payment').
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

      -- Mirror onto the linked sales invoice (source ref set by 042). The
      -- receivable's ar_ap_status maps onto invoice_status explicitly.
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

-- ═══ 4b. Consumer: PaymentVoidedEvent ═════════════════════════════════════
--    Reverses the allocation effects (paid_amount restore, AR/AP status
--    recalculation, invoice status back toward finalized) and posts a
--    reversal journal. Idempotent via journal (entry_type 'reversal',
--    source 'payment').
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

-- ═══ 5. Orchestrator: route the two new event types ═══════════════════════
CREATE OR REPLACE FUNCTION dispatch_pending_events(p_batch_size INT DEFAULT 50)
RETURNS TABLE (out_processed INT, out_skipped INT, out_failed INT, out_last_error TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ev         financial_events;
  v_result     TEXT;
  v_processed  INT := 0;
  v_skipped    INT := 0;
  v_failed     INT := 0;
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
      ELSIF v_ev.event_type = 'PaymentAllocatedEvent' THEN
        v_result := dispatch_payment_allocated(v_ev);
      ELSIF v_ev.event_type = 'PaymentVoidedEvent' THEN
        v_result := dispatch_payment_voided(v_ev);
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

-- ═══ 6. Execution boundary: service-role only ═════════════════════════════
REVOKE ALL ON FUNCTION guard_payment_allocation() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION enforce_payment_alloc_totals() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_payment_allocated(financial_events) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION dispatch_payment_voided(financial_events) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION guard_payment_allocation() TO service_role;
GRANT EXECUTE ON FUNCTION enforce_payment_alloc_totals() TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_payment_allocated(financial_events) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_payment_voided(financial_events) TO service_role;

-- ═══ 7. Demo seed (tenant 0001 — the demo tenant) ═══════════════════════
-- Bank account → CoA 1100. (A demo payment is NOT seeded: the flagship
-- INV-2026-000001 is credited with a zeroed receivable — record a payment
-- against an open receivable from the UI to demo the engine.)
INSERT INTO bank_accounts
  (id, tenant_id, bank_name, account_name, iban, account_number, currency,
   opening_balance, is_active, coa_account_code, created_at, deleted_at)
VALUES
  ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-000000000001',
   'البنك الأهلي السعودي', 'حساب التشغيل — ريال', 'SA0380000000608010167519', '608010167519',
   'SAR', 0, true, '1100', now(), NULL)
ON CONFLICT (id) DO NOTHING;
