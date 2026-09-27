-- ============================================================================
-- Payroll / Vehicles Cross-Wiring — surface (Prompt F)
-- (20260927120000_payroll_vehicles_wiring.sql)
--
-- Scope: schema support for the operational triangle closure between the
-- drivers, vehicles, and payroll surfaces. NO NEW TABLES — everything composes
-- over pre-existing tables (verified against the live schema):
--
--   Reads/writes the wiring introduces (per surface):
--     * /vehicles fleet list  — current-driver join chip + docs-expiry chips
--                               (reads drivers via current_driver_id, existing
--                               vehicle date columns)
--     * /vehicles/[id]        — assignment-history timeline (existing
--                               vehicle_assignments reads) + assign/unassign
--                               from the vehicle side (writes vehicles.status,
--                               vehicle_assignments, drivers.current_vehicle_id)
--     * /payroll              — per-driver monthly-orders KPI (reads
--                               monthly_driver_orders) and COD sessions rollup
--                               (reads driver_cod_sessions by session_date);
--                               guarded status transitions on
--                               driver_payroll_periods (status, cancel_reason)
--
--   1. Availability-claim index — the assign action's race arbiter is a
--      conditional UPDATE on vehicles (tenant_id, status) filtered by
--      deleted_at IS NULL; no existing index leads with that shape for the
--      claim path (idx_vehicles_active leads with tenant,status,condition).
--      This partial index is the narrow claim predicate.
--   2. Orders rollup index — the payroll page reads monthly_driver_orders by
--      (period_year, period_month) across the loaded drivers. The existing
--      indexes lead with tenant_id or driver_id; the page-level rollup reads
--      period-first. Partial on deleted_at IS NULL to match the read.
--   3. COD session-period index — the COD rollup filters driver_cod_sessions
--      by an IN-list of session_date month starts; idx_cod_sessions_driver_date
--      leads with (tenant_id, driver_id) so a page-level date-first read has
--      no supporting index. Covers (session_date, driver_id) WHERE pending-
--      agnostic (the rollup counts pending AND reconciled).
--   4. Payroll status-queue index — guarded transitions + the WPS/CSV reads
--      filter driver_payroll_periods by (tenant_id, status, period_year);
--      idx_payroll_periods_active already covers (tenant_id, period_year,
--      period_month, status) — re-asserted as a no-op for drift-proofing and
--      a narrower partial index for the transition claim predicate is added.
--   5. Integrity constraint — cancel transitions REQUIRE a reason at the DB
--      level (parity with the server-action guard; users-module idiom). A
--      constraint trigger on driver_payroll_periods refuses status →
--      'cancelled' when cancel_reason is NULL/blank (PAY004).
--
-- Conventions (Track 1): idempotent (IF NOT EXISTS / CREATE OR REPLACE /
-- guarded DO blocks), SECURITY DEFINER helpers with pinned search_path
-- (rule from 061), no data seeds, no table grants changed.
--
-- Rollback (forward-only repo, notes only):
--   DROP FUNCTION IF EXISTS public.rollback_cancelled_payroll_guard() CASCADE;
--   DROP INDEX IF EXISTS public.idx_vehicles_availability_claim;
--   DROP INDEX IF EXISTS public.idx_monthly_orders_period_read;
--   DROP INDEX IF EXISTS public.idx_cod_sessions_session_date_driver;
--   DROP INDEX IF EXISTS public.idx_payroll_periods_transition_claim;
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Availability-claim index (idempotent)
--    Narrow predicate of the assign action's conditional UPDATE: the claim
--    flips an AVAILABLE, live, in-tenant vehicle to 'assigned'.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_vehicles_availability_claim
  ON vehicles(tenant_id, status)
  WHERE deleted_at IS NULL AND status = 'available';

COMMENT ON INDEX idx_vehicles_availability_claim IS
  'Vehicles wiring: availability-claim predicate for the shared assign action (vehicles.status available → assigned, race arbiter)';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Orders rollup index (idempotent)
--    Payroll page reads monthly_driver_orders period-first across its
--    drivers. idx_monthly_orders_unique / idx_monthly_orders_driver_period
--    both lead with tenant/driver; this serves the page-level rollup read.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_monthly_orders_period_read
  ON monthly_driver_orders(period_year, period_month, driver_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_monthly_orders_period_read IS
  'Payroll wiring: period-first rollup of monthly orders per driver (payroll list KPI)';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. COD session-period index (idempotent)
--    The COD rollup reads driver_cod_sessions by session_date IN (month
--    starts); existing indexes lead with tenant/driver. Date-first, driver
--    second — the group key.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cod_sessions_session_date_driver
  ON driver_cod_sessions(session_date, driver_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_cod_sessions_session_date_driver IS
  'Payroll wiring: COD sessions rollup by session month per driver';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Payroll transition-claim index (idempotent)
--    The guarded transition's conditional UPDATE claims a row by
--    (tenant_id, id, status). The PK already finds the row; this partial
--    index additionally serves the /payroll queue reads that filter live
--    rows by status within a year. idx_payroll_periods_active (022) is
--    re-asserted as a no-op for drift-proofing.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payroll_periods_active
  ON driver_payroll_periods(tenant_id, period_year, period_month, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_periods_transition_claim
  ON driver_payroll_periods(tenant_id, status)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_payroll_periods_transition_claim IS
  'Payroll wiring: status-scoped reads and transition claim predicate';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Cancel-reason integrity (constraint trigger, idempotent)
--    Parity with the server-action guard: a payroll period may only reach
--    'cancelled' WITH a reason (PAY004). The users-module idiom keeps the
--    mandatory reason enforced at BOTH layers; the DB trigger is the hard
--    boundary, exactly like the 058 self-escalation trigger for users.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_payroll_cancel_reason()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (NEW.cancel_reason IS NULL OR btrim(NEW.cancel_reason) = '') THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE = 'PAY004: cancellation reason required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_cancel_reason ON driver_payroll_periods;
CREATE TRIGGER trg_payroll_cancel_reason
  BEFORE INSERT OR UPDATE OF status, cancel_reason ON driver_payroll_periods
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payroll_cancel_reason();

COMMENT ON FUNCTION enforce_payroll_cancel_reason() IS
  'Payroll wiring: refuses status → cancelled without a cancel_reason (PAY004) — DB-level parity with the server-action guard (users-module idiom).';
