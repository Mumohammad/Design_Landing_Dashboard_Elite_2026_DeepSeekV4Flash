BEGIN;
-- New unposted cancellations commit their audit/receipt without an outbox
-- event. Any InvoiceCancelledEvent therefore belongs to the older multi-write
-- workflow. Its historical GL, AR/AP, payment and VAT effects must be reviewed
-- together; neither replay nor a duplicate skip proves they reconcile.
-- Retain events and all business data for that review. The dispatcher records
-- this failure through its existing per-event exception boundary.
CREATE OR REPLACE FUNCTION public.dispatch_invoice_cancelled(p_ev public.financial_events)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'INV_CANCEL_REVIEW: legacy cancellation events require accounting review before further processing';
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_invoice_cancelled(public.financial_events) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_invoice_cancelled(public.financial_events) TO service_role;
COMMIT;
