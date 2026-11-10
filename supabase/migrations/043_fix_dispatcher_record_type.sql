-- =====================================================================
-- 043 — Fix: dispatch_pending_events RECORD → financial_events cast
--
-- The 042 orchestrator declared `v_ev RECORD`, and passing a generic
-- RECORD to the consumer helpers (typed `financial_events`) raised
-- "cannot cast type record to financial_events" for every event.
-- Declaring the loop variable as the table composite type fixes it.
-- =====================================================================

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
