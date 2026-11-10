-- ============================================================================
-- 20260907183154_fix_security_definer_view_and_admin_read_policy.sql
-- RECONSTRUCTED BACKFILL (2026-09-15)
--
-- Applied to production out-of-band on 2026-09-07; original SQL was never
-- committed. Reconstructed from the live production catalog (pg_class
-- reloptions, pg_policies).
--
-- Effect: sets security_invoker=true on the six reporting views. Without it,
-- views run as their owner (SECURITY DEFINER semantics) and bypass the
-- querying user's RLS; with it, view queries execute with the caller's
-- rights so tenant RLS applies. Also re-asserts the admin read policy in its
-- final initplan form.
-- Guarded via to_regclass() so environments lacking a view skip it.
-- ============================================================================

DO $$
DECLARE
  v_view text;
  v_views text[] := ARRAY[
    'public.vat_reconciliation',
    'public.profit_loss',
    'public.balance_sheet',
    'public.cash_flow',
    'public.vehicle_active_documents',
    'public.trial_balance'
  ];
BEGIN
  FOREACH v_view IN ARRAY v_views LOOP
    IF to_regclass(v_view) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW %s SET (security_invoker = on)', v_view);
    ELSE
      RAISE NOTICE 'backfill 20260907183154: % not present; security_invoker skipped', v_view;
    END IF;
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS platform_invoices_admin_read ON public.platform_invoices;
CREATE POLICY platform_invoices_admin_read
  ON public.platform_invoices
  FOR SELECT
  TO authenticated
  USING ((SELECT is_platform_admin()));
