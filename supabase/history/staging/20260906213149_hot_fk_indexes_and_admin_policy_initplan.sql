-- 1) Hot-path FK indexes flagged by Supabase performance advisors (idempotent)
CREATE INDEX IF NOT EXISTS idx_daily_order_entries_driver_id ON public.daily_order_entries (driver_id);
CREATE INDEX IF NOT EXISTS idx_violations_driver_id ON public.violations (driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_vehicle_id ON public.vehicle_assignments (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_zatca_transmissions_invoice_id ON public.zatca_transmissions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_period_id ON public.journal_entries (period_id);

-- 2) Fix auth_rls_initplan on platform_admins_self_read — identical predicate,
--    wrapped in (select ...) so Postgres evaluates auth.uid() once per query instead of per row.
DROP POLICY IF EXISTS platform_admins_self_read ON public.platform_admins;
CREATE POLICY platform_admins_self_read ON public.platform_admins
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));
