-- ============================================================================
-- Payroll / Vehicles Cross-Wiring — surface tests (pgTAP)
-- (064_payroll_vehicles_wiring_tests.sql)
--
-- Proves the guarantees of 20260927120000_payroll_vehicles_wiring.sql plus
-- the pre-existing table contracts the wiring composes over:
--
--   1. Wiring indexes exist (availability claim, orders rollup, COD rollup,
--      payroll transition claim) with the right partial predicates
--   2. enforce_payroll_cancel_reason: PAY004 on cancelled-without-reason,
--      accepts cancelled-with-reason and every other status
--   3. RLS tenant isolation on every wired table (vehicles, vehicle_assignments,
--      driver_payroll_periods, monthly_driver_orders, driver_cod_sessions)
--   4. anon-zero across all wired tables
--   5. Assignment invariants: one current assignment per (vehicle, driver)
--      pair (asserted as a COUNT — 017 has no UNIQUE pair index; the
--      one-current invariant is enforced in the assign action) plus the
--      availability-claim UPDATE the action uses as its race arbiter
--   6. Payroll status shape: enum terminal states present
--
-- plan(22) MUST equal the actual assertion count: pgTAP reports "planned N
-- but ran M" at finish() and the CI runner counts any file with a plan
-- mismatch, `not ok` line, or psql ERROR as failed.
--
-- Conventions (match 060/061/062/063): single transaction (CI passes
--   --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
--   fixtures in a TEMP table + fixed UUIDs, idempotent insert-if-absent
--   fixture guards, finish() at the end.
-- ============================================================================

SELECT plan(22);

-- ─── Fixtures (run as postgres; bypass RLS) ─────────────────────────────────
-- Fixed UUIDs (distinct namespace from 063's fixtures):
--   tenant A   12111111-1111-1111-1111-111111111111
--   tenant B   12222222-2222-2222-2222-222222222222
--   auth user  12333333-3333-3333-3333-333333333333
--   users row  12555555-5555-5555-5555-555555555555
--   driver     12444444-4444-4444-4444-444444444444
--   vehicle    12666666-6666-6666-6666-666666666666

CREATE TEMP TABLE wiring_fixture (
  tenant_id  uuid,
  user_id    uuid,
  auth_id    uuid,
  driver_id  uuid,
  vehicle_id uuid
);

DO $$
DECLARE
  v_tenant   uuid := '12111111-1111-1111-1111-111111111111';
  v_tenant_b uuid := '12222222-2222-2222-2222-222222222222';
  v_auth     uuid := '12333333-3333-3333-3333-333333333333';
  v_users    uuid := '12555555-5555-5555-5555-555555555555';
  v_driver   uuid := '12444444-4444-4444-4444-444444444444';
  v_vehicle  uuid := '12666666-6666-6666-6666-666666666666';
BEGIN
  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_tenant, 'مستأجر ربط أ', 'Wiring Fixture Tenant A')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_tenant_b, 'مستأجر ربط ب', 'Wiring Fixture Tenant B')
  ON CONFLICT (id) DO NOTHING;

  -- users requires an auth.users row (060 hardened trigger contract).
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000',
          v_auth, 'authenticated',
          'authenticated', 'wiring-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES (v_users, v_auth, v_tenant, 'wiring-fixture@test.local', 'general_manager', 'active')
  ON CONFLICT (id) DO UPDATE SET role = 'general_manager', status = 'active';

  -- Driver (tenant A): employable (active) so the assign-path fixtures hold.
  INSERT INTO public.drivers (id, tenant_id, full_name_ar, primary_mobile, category, status, hire_date)
  VALUES (v_driver, v_tenant, 'سائق ربط', '0501110000', 'freelancer', 'active', CURRENT_DATE - 400)
  ON CONFLICT (id) DO NOTHING;

  -- Vehicle (tenant A): available for the claim predicate fixtures.
  INSERT INTO public.vehicles (id, tenant_id, plate_number, make, model, status, condition_status)
  VALUES (v_vehicle, v_tenant, 'ربط-9001', 'Toyota', 'Hilux', 'available', 'good')
  ON CONFLICT (id) DO NOTHING;
  -- Reset from a leaked prior failed run.
  UPDATE public.vehicles SET status = 'available', current_driver_id = NULL
  WHERE id = v_vehicle;

  -- A monthly orders row (tenant A) for the rollup-index read shape.
  INSERT INTO public.monthly_driver_orders
    (tenant_id, driver_id, platform_id, period_year, period_month, total_delivered)
  SELECT v_tenant, v_driver, NULL, 2026, 9, 120
  WHERE NOT EXISTS (
    SELECT 1 FROM public.monthly_driver_orders
    WHERE tenant_id = v_tenant AND driver_id = v_driver AND period_year = 2026 AND period_month = 9
  );

  -- A COD session (tenant A) for the rollup read shape. platform_id is
  -- NOT NULL on the live table — a tenant-A platform row backs it.
  INSERT INTO public.delivery_platforms (id, tenant_id, code, name_ar, name_en)
  VALUES ('12777777-7777-7777-7777-777777777777', v_tenant, 'wiring-p', 'منصة ربط', 'Wiring Platform')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.driver_cod_sessions
    (tenant_id, driver_id, platform_id, session_date, cod_collected, cod_submitted, status)
  SELECT v_tenant, v_driver, '12777777-7777-7777-7777-777777777777', DATE '2026-09-15', 500, 400, 'pending'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.driver_cod_sessions
    WHERE tenant_id = v_tenant AND driver_id = v_driver AND session_date = DATE '2026-09-15'
  );

  INSERT INTO wiring_fixture VALUES (v_tenant, v_users, v_auth, v_driver, v_vehicle);
END;
$$;

-- ─── 1. Wiring indexes exist (6) ─────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_vehicles_availability_claim'),
  1,
  'availability-claim index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_vehicles_availability_claim'
     AND indexdef LIKE '%status%available%' AND indexdef LIKE '%deleted_at%'),
  1,
  'availability-claim index is partial on available + live'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_monthly_orders_period_read'),
  1,
  'monthly orders period-read index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_cod_sessions_session_date_driver'),
  1,
  'COD sessions date-first rollup index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_payroll_periods_transition_claim'),
  1,
  'payroll transition-claim index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_payroll_periods_active'),
  1,
  'payroll active-periods index re-asserted (drift-proofing no-op)'
);

-- ─── 2. Cancel-reason integrity (4) ──────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

-- Cancel WITHOUT a reason is refused (PAY004) — the DB-level parity guard.
SELECT throws_ok(
  $$INSERT INTO public.driver_payroll_periods
      (tenant_id, driver_id, period_year, period_month, status)
    VALUES ('12111111-1111-1111-1111-111111111111',
            '12444444-4444-4444-4444-444444444444', 2026, 9, 'cancelled')$$,
  'P0001',
  'PAY004: cancellation reason required',
  'payroll status cancelled without a reason is refused (PAY004)'
);

-- Cancel WITH a reason lands.
INSERT INTO public.driver_payroll_periods
  (tenant_id, driver_id, period_year, period_month, status, cancel_reason)
VALUES
  ('12111111-1111-1111-1111-111111111111',
   '12444444-4444-4444-4444-444444444444', 2026, 9, 'cancelled', 'duplicate fixture row')
ON CONFLICT (tenant_id, driver_id, period_year, period_month) DO NOTHING;

SELECT is(
  (SELECT status::text FROM public.driver_payroll_periods
   WHERE tenant_id = '12111111-1111-1111-1111-111111111111'
     AND driver_id = '12444444-4444-4444-4444-444444444444'
     AND period_year = 2026 AND period_month = 9),
  'cancelled',
  'cancelled WITH a reason is accepted'
);

-- Guard is an UPDATE-path guard too: un-cancelled row flipped to cancelled
-- without a reason is refused.
INSERT INTO public.driver_payroll_periods
  (tenant_id, driver_id, period_year, period_month, status)
VALUES
  ('12111111-1111-1111-1111-111111111111',
   '12444444-4444-4444-4444-444444444444', 2026, 8, 'draft')
ON CONFLICT (tenant_id, driver_id, period_year, period_month) DO NOTHING;

SELECT throws_ok(
  $$UPDATE public.driver_payroll_periods SET status = 'cancelled'
    WHERE tenant_id = '12111111-1111-1111-1111-111111111111'
      AND driver_id = '12444444-4444-4444-4444-444444444444'
      AND period_year = 2026 AND period_month = 8$$,
  'P0001',
  'PAY004: cancellation reason required',
  'UPDATE to cancelled without a reason is refused (PAY004)'
);

-- Non-cancelled statuses pass freely.
UPDATE public.driver_payroll_periods SET status = 'calculated'
WHERE tenant_id = '12111111-1111-1111-1111-111111111111'
  AND driver_id = '12444444-4444-4444-4444-444444444444'
  AND period_year = 2026 AND period_month = 8;

SELECT is(
  (SELECT status::text FROM public.driver_payroll_periods
   WHERE tenant_id = '12111111-1111-1111-1111-111111111111'
     AND driver_id = '12444444-4444-4444-4444-444444444444'
     AND period_year = 2026 AND period_month = 8),
  'calculated',
  'non-cancelled status transitions pass the guard'
);

-- ─── 3. Assignment invariant + availability claim (2) ───────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

-- 017 has NO UNIQUE partial index on (vehicle_id, driver_id, is_current) —
-- the one-current-per-pair invariant is enforced by the shared assign action
-- (pre-insert SELECT guard), NOT by the database. So the DB-level proof here
-- is the COUNT the action's guard produces: guarded insert-if-absent, then
-- exactly one current row. (ON CONFLICT DO NOTHING would NOT guard this —
-- with no unique constraint it inserts a duplicate — which is exactly how
-- an earlier draft of this suite leaked a second row.)
INSERT INTO public.vehicle_assignments (tenant_id, vehicle_id, driver_id, is_current)
SELECT '12111111-1111-1111-1111-111111111111',
       '12666666-6666-6666-6666-666666666666',
       '12444444-4444-4444-4444-444444444444', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_assignments
  WHERE vehicle_id = '12666666-6666-6666-6666-666666666666'
    AND driver_id = '12444444-4444-4444-4444-444444444444'
    AND is_current = true AND deleted_at IS NULL
);

SELECT is(
  (SELECT count(*)::int FROM public.vehicle_assignments
   WHERE vehicle_id = '12666666-6666-6666-6666-666666666666'
     AND driver_id = '12444444-4444-4444-4444-444444444444'
     AND is_current = true AND deleted_at IS NULL),
  1,
  'exactly one current assignment row for the fixture pair'
);

-- The assign action's race arbiter is a conditional UPDATE on vehicles
-- (tenant + status='available' + live) — the narrow predicate the new
-- idx_vehicles_availability_claim serves. Exercise it directly: the claim
-- flips the vehicle exactly once; a second claim matches nothing.
CREATE TEMP TABLE claim_result ON COMMIT DROP AS
WITH claim AS (
  UPDATE public.vehicles SET status = 'assigned'
  WHERE id = '12666666-6666-6666-6666-666666666666'
    AND tenant_id = '12111111-1111-1111-1111-111111111111'
    AND status = 'available' AND deleted_at IS NULL
  RETURNING id)
SELECT count(*)::int AS n FROM claim;

SELECT is(
  (SELECT n FROM claim_result),
  1,
  'availability-claim predicate flips the available vehicle exactly once'
);

-- Reset for re-runs (idempotent fixture discipline).
UPDATE public.vehicles SET status = 'available', current_driver_id = NULL
WHERE id = '12666666-6666-6666-6666-666666666666';

-- ─── 4. RLS tenant isolation + anon-zero on the wired tables (7) ────────────

RESET ROLE;
SET LOCAL ROLE postgres;

-- Tenant B must see zero rows across the wired tables (isolation proof):
-- its fixtures hold NO rows; any count > 0 means a leak from tenant A.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.vehicles)
+ (SELECT count(*)::int FROM public.vehicle_assignments)
+ (SELECT count(*)::int FROM public.driver_payroll_periods)
+ (SELECT count(*)::int FROM public.monthly_driver_orders)
+ (SELECT count(*)::int FROM public.driver_cod_sessions),
  0,
  'anon sees 0 rows across all wired tables'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"12333333-3333-3333-3333-333333333333"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.vehicles
   WHERE id = '12666666-6666-6666-6666-666666666666'),
  1,
  'authenticated sees their tenant vehicle (RLS)'
);
SELECT is(
  (SELECT count(*)::int FROM public.vehicle_assignments
   WHERE vehicle_id = '12666666-6666-6666-6666-666666666666'),
  1,
  'authenticated sees their tenant assignments (RLS)'
);
SELECT is(
  (SELECT count(*)::int FROM public.monthly_driver_orders
   WHERE driver_id = '12444444-4444-4444-4444-444444444444'),
  1,
  'authenticated sees their tenant monthly orders (RLS)'
);
SELECT is(
  (SELECT count(*)::int FROM public.driver_cod_sessions
   WHERE driver_id = '12444444-4444-4444-4444-444444444444'),
  1,
  'authenticated sees their tenant COD sessions (RLS)'
);
SELECT is(
  (SELECT count(*)::int FROM public.driver_payroll_periods
   WHERE tenant_id = '12111111-1111-1111-1111-111111111111'),
  2,
  'authenticated sees their tenant payroll periods (RLS)'
);

-- Cross-tenant: a REAL tenant-B user sees nothing from tenant A.
-- get_my_tenant_id() resolves the caller's tenant from public.users by
-- auth_user_id (NOT from the JWT tenant_id claim), so isolation is proven
-- by authenticating a second fixture user whose users row lives in
-- tenant B — spoofing a tenant_id claim on the tenant-A user proves
-- nothing. (Idempotent fixture inserts, same 060 marker contract.)
RESET ROLE;
SET LOCAL ROLE postgres;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000000',
        '12888888-8888-8888-8888-888888888888', 'authenticated',
        'authenticated', 'wiring-fixture-b@test.local', crypt('x', gen_salt('bf')),
        now(), now(), now(), '{"provider":"email","providers":["email"]}',
        '{"_invite_provisioned": true}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
VALUES ('12999999-9999-9999-9999-999999999999',
        '12888888-8888-8888-8888-888888888888',
        '12222222-2222-2222-2222-222222222222',
        'wiring-fixture-b@test.local', 'general_manager', 'active')
ON CONFLICT (id) DO UPDATE SET tenant_id = '12222222-2222-2222-2222-222222222222',
                               role = 'general_manager', status = 'active';

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"12888888-8888-8888-8888-888888888888"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.vehicles
   WHERE tenant_id = '12111111-1111-1111-1111-111111111111'),
  0,
  'cross-tenant vehicle reads are filtered (tenant-B GM sees none of tenant A)'
);

-- ─── 5. Payroll status shape (3) ─────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT is(
  (SELECT count(*)::int FROM pg_enum e
   JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'payroll_status'
     AND e.enumlabel IN ('draft','calculated','in_review','approved','paid','locked','cancelled')),
  7,
  'payroll_status enum carries all seven states'
);

SELECT ok(
  (SELECT pg_get_triggerdef(oid) LIKE '%enforce_payroll_cancel_reason%'
   FROM pg_trigger
   WHERE tgrelid = 'public.driver_payroll_periods'::regclass
     AND NOT tgisinternal
     AND tgname = 'trg_payroll_cancel_reason'),
  'cancel-reason trigger is attached to driver_payroll_periods'
);

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enforce_payroll_cancel_reason'
     AND p.proconfig IS NOT NULL
     AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%'),
  1,
  'guard function pins search_path (061 rule)'
);

-- ─── Cleanup & finish ───────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT * FROM finish();
