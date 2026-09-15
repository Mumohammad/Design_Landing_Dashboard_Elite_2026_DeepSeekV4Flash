-- ============================================================================
-- 20260906220134_hot_fk_indexes_and_admin_policy_initplan.sql
-- RECONSTRUCTED BACKFILL (2026-09-15)
--
-- Applied to production out-of-band on 2026-09-06; original SQL was never
-- committed. Reconstructed from the live production catalog (pg_indexes,
-- pg_policies).
--
-- Verified effects:
--   * FK/hot-path indexes on platform_invoices
--   * admin policies rewritten to initplan form — wrapping auth.uid() and
--     is_platform_admin() in SELECT subqueries makes Postgres evaluate them
--     once per statement instead of once per row.
--
-- LIMITATION: any further FK indexes the original migration added to
-- repo-tracked tables cannot be distinguished in the catalog from indexes
-- already created by repo migrations (012, 036, …) and are therefore not
-- reconstructed here. Run a dedicated index audit if local query-plan parity
-- matters.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_platform_invoices_tenant
  ON public.platform_invoices (tenant_id);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_status
  ON public.platform_invoices (status);

-- Initplan rewrite of the platform admin policies (final production form).
DROP POLICY IF EXISTS platform_admins_self_read ON public.platform_admins;
CREATE POLICY platform_admins_self_read
  ON public.platform_admins
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS platform_invoices_admin_read ON public.platform_invoices;
CREATE POLICY platform_invoices_admin_read
  ON public.platform_invoices
  FOR SELECT
  TO authenticated
  USING ((SELECT is_platform_admin()));
