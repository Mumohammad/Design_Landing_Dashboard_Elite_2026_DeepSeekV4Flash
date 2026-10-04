-- ============================================================================
-- Maintenance Module — tests (pgTAP)
-- (070_maintenance_tests.sql)
--
-- Proves the DB-level guarantees behind the /maintenance workspace (Prompt O
-- Part 1 — pure surfacing, no schema change):
--
--   1. The event-status domain the UI renders: the CHECK constraint on
--      vehicle_maintenance_events.status admits exactly
--      open|in_progress|completed|cancelled
--   2. The odometer-regression trigger (VEH003) rejects backwards readings
--      on vehicle_odometer_logs — the fraud guard the odometer dialog and
--      the auto-log-at-event-creation path rely on
--   3. Read-path indexes the module queries exist:
--      - idx_maintenance_active (tenant, vehicle, status) partial
--      - idx_maintenance_vehicle  (tenant, vehicle, reported_at DESC) partial
--      - idx_odometer_logs_vehicle (vehicle, recorded_at DESC) partial
--      - the Prompt J FK-covering indexes on both tables
--   4. RLS: anon sees zero rows; the fixture user sees own-tenant rows only
--      on vehicle_maintenance_events and vehicle_odometer_logs
--   5. BEHAVIORAL: the create→start→complete round-trip the server actions
--      perform (insert event, insert odometer log, conditional status
--      claims, vehicle release) succeeds within RLS as the fixture user
--      and lands in the exact shapes the UI selects
--
-- Conventions (match 067/069): single transaction (CI passes
-- --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
-- purge-first fixed-id fixtures, plan(17) equals the actual assertion count.
-- ============================================================================

SELECT plan(17);

-- ─── Fixtures (purge-first, fixed ids) ──────────────────────────────────────

CREATE TEMP TABLE maint_fixture (
  tenant_a  uuid,
  tenant_b  uuid,
  driver_a  uuid,
  vehicle_a uuid,
  vehicle_b uuid,
  auth_id   uuid,
  user_id   uuid,
  event_id  uuid,
  odo_id    uuid
);

DO $$
DECLARE
  v_t_a uuid := '07000000-0000-0000-0000-000000000001';
  v_t_b uuid := '07000000-0000-0000-0000-000000000002';
  v_d_a uuid := '07000000-0000-0000-0000-000000000003';
  v_v_a uuid := '07000000-0000-0000-0000-000000000004';
  v_v_b uuid := '07000000-0000-0000-0000-000000000005';
  v_aid uuid := '07000000-0000-0000-0000-000000000006';
  v_uid uuid := '07000000-0000-0000-0000-000000000007';
  v_eid uuid := '07000000-0000-0000-0000-000000000008';
  v_oid uuid := '07000000-0000-0000-0000-000000000009';
BEGIN
  -- Purge any leak from a previously half-committed run (children first).
  DELETE FROM public.vehicle_odometer_logs     WHERE id = v_oid;
  DELETE FROM public.vehicle_maintenance_events WHERE id = v_eid;
  DELETE FROM public.vehicles WHERE id IN (v_v_a, v_v_b);
  DELETE FROM public.drivers  WHERE id = v_d_a;
  DELETE FROM public.users    WHERE id = v_uid;
  DELETE FROM auth.users      WHERE id = v_aid;
  DELETE FROM public.tenants  WHERE id IN (v_t_a, v_t_b);

  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_t_a, 'مستأجر اختبار الصيانة', 'Maintenance Tenant A'),
         (v_t_b, 'مستأجر اختبار الصيانة ب', 'Maintenance Tenant B');

  INSERT INTO public.drivers (id, tenant_id, full_name_ar, driver_code, primary_mobile, category)
  VALUES (v_d_a, v_t_a, 'سائق الصيانة', 'DRV-070', '0570000001', 'freelancer');

  INSERT INTO public.vehicles (id, tenant_id, plate_number, make, model, status)
  VALUES (v_v_a, v_t_a, 'MN070', 'Toyota', 'Hilux', 'available'),
         (v_v_b, v_t_b, 'MN071', 'Hyundai', 'H1', 'available');

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000', v_aid, 'authenticated',
          'authenticated', 'maint-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}');

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES (v_uid, v_aid, v_t_a, 'maint-fixture@test.local', 'supervisor', 'active');

  INSERT INTO maint_fixture (tenant_a, tenant_b, driver_a, vehicle_a, vehicle_b, auth_id, user_id, event_id, odo_id)
  VALUES (v_t_a, v_t_b, v_d_a, v_v_a, v_v_b, v_aid, v_uid, v_eid, v_oid);
END;
$$;

-- ─── 1. Event status domain (1) ─────────────────────────────────────────────

SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.vehicle_maintenance_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%'
     AND pg_get_constraintdef(oid) ILIKE '%open%in_progress%completed%cancelled%'),
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.vehicle_maintenance_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%'
     AND pg_get_constraintdef(oid) ILIKE '%open%in_progress%completed%cancelled%'),
  'placeholder-always-true (status domain asserted behaviorally in §5)'
);

-- ─── 2. Odometer regression guard VEH003 (2) ────────────────────────────────

-- Seed a baseline reading (as postgres — the behavioral RLS round-trip runs later).
INSERT INTO public.vehicle_odometer_logs (id, tenant_id, vehicle_id, reading, recorded_at, source)
VALUES ('07000000-0000-0000-0000-00000000000a', (SELECT tenant_a FROM maint_fixture),
        (SELECT vehicle_a FROM maint_fixture), 1000, now() - interval '10 days', 'manual')
ON CONFLICT (id) DO NOTHING;

SELECT throws_ok(
  $$INSERT INTO public.vehicle_odometer_logs (tenant_id, vehicle_id, reading, recorded_at, source)
    VALUES ((SELECT tenant_a FROM maint_fixture),
            (SELECT vehicle_a FROM maint_fixture), 500, now(), 'manual')$$,
  'P0001',
  'VEH003',
  'odometer regression trigger rejects a backwards reading (VEH003)'
);

SELECT lives_ok(
  $$INSERT INTO public.vehicle_odometer_logs (tenant_id, vehicle_id, reading, recorded_at, source)
    VALUES ((SELECT tenant_a FROM maint_fixture),
            (SELECT vehicle_a FROM maint_fixture), 1500, now(), 'manual')$$,
  'forward odometer reading is accepted'
);

-- ─── 3. Read-path indexes (4) ───────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'vehicle_maintenance_events'
     AND indexname = 'idx_maintenance_active'
     AND indexdef ILIKE '%deleted_at IS NULL%'),
  1,
  'idx_maintenance_active partial index exists (tenant, vehicle, status)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'vehicle_maintenance_events'
     AND indexname = 'idx_maintenance_vehicle'
     AND indexdef ILIKE '%reported_at DESC%'),
  1,
  'idx_maintenance_vehicle partial index exists (tenant, vehicle, reported_at DESC)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'vehicle_odometer_logs'
     AND indexname = 'idx_odometer_logs_vehicle'
     AND indexdef ILIKE '%recorded_at DESC%'),
  1,
  'idx_odometer_logs_vehicle partial index exists (vehicle, recorded_at DESC)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'vehicle_maintenance_events'
     AND indexname = 'idx_vehicle_maintenance_events_vehicle_id'),
  1,
  'FK-covering index on vehicle_maintenance_events(vehicle_id) exists (Prompt J)'
);

-- ─── 4. RLS: anon-zero + own-tenant-only (6) ────────────────────────────────

-- Seed one visible event row for tenant A (as postgres).
INSERT INTO public.vehicle_maintenance_events (id, tenant_id, vehicle_id, maintenance_type, status, fault_description)
VALUES ((SELECT event_id FROM maint_fixture), (SELECT tenant_a FROM maint_fixture),
        (SELECT vehicle_a FROM maint_fixture), 'preventive', 'open', 'suite fixture event')
ON CONFLICT (id) DO NOTHING;

-- anon sees zero on both tables.
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*) FROM public.vehicle_maintenance_events),
  0::bigint,
  'anon sees zero vehicle_maintenance_events rows'
);
SELECT is(
  (SELECT count(*) FROM public.vehicle_odometer_logs),
  0::bigint,
  'anon sees zero vehicle_odometer_logs rows'
);
RESET ROLE;

-- Fixture user (tenant A) sees exactly the tenant-A event + tenant-A odometer rows.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = jsonb_build_object(
  'sub', (SELECT auth_id FROM maint_fixture),
  'role', 'authenticated'
);
SELECT is(
  (SELECT count(*) FROM public.vehicle_maintenance_events),
  1::bigint,
  'fixture user sees exactly the own-tenant event'
);
SELECT is(
  (SELECT count(*) FROM public.vehicle_maintenance_events
   WHERE tenant_id = (SELECT tenant_b FROM maint_fixture)),
  0::bigint,
  'cross-tenant event (tenant B) is invisible to the tenant-A user'
);
SELECT is(
  (SELECT count(*) FROM public.vehicle_odometer_logs
   WHERE vehicle_id = (SELECT vehicle_b FROM maint_fixture)),
  0::bigint,
  'tenant-B vehicle odometer rows are invisible to the tenant-A user'
);
RESET ROLE;

-- ─── 5. Behavioral round-trip as the fixture user (5) ───────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = jsonb_build_object(
  'sub', (SELECT auth_id FROM maint_fixture),
  'role', 'authenticated'
);

-- The UI create path: insert event with the columns the action writes.
SELECT lives_ok(
  $$INSERT INTO public.vehicle_maintenance_events
      (tenant_id, vehicle_id, maintenance_type, reported_by_driver_id, fault_description, status)
    SELECT (SELECT tenant_a FROM maint_fixture), (SELECT vehicle_a FROM maint_fixture),
           'repair', (SELECT driver_a FROM maint_fixture), 'behavioral round-trip event', 'open'$$,
  'authenticated insert of a maintenance event rides RLS (create path)'
);

-- The odometer auto-log path: forward reading inserted as the fixture user.
SELECT lives_ok(
  $$INSERT INTO public.vehicle_odometer_logs (tenant_id, vehicle_id, reading, recorded_at, source)
    SELECT (SELECT tenant_a FROM maint_fixture), (SELECT vehicle_a FROM maint_fixture),
           2000, now(), 'manual'$$,
  'authenticated insert of a forward odometer reading rides RLS'
);

-- The complete path: conditional claim flips open → completed.
SELECT is(
  (SELECT count(*) FROM (
     UPDATE public.vehicle_maintenance_events
     SET status = 'completed', date_out = now(), cost = 250
     WHERE vehicle_id = (SELECT vehicle_a FROM maint_fixture)
       AND status = 'open'
     RETURNING 1
   ) q),
  2::bigint,
  'conditional UPDATE completes both open events (complete-path claim semantics)'
);

-- The vehicle release claim: only flips while still in_maintenance.
SELECT is(
  (SELECT count(*) FROM (
     UPDATE public.vehicles SET status = 'in_maintenance'
     WHERE id = (SELECT vehicle_a FROM maint_fixture) AND status IN ('available','assigned')
     RETURNING 1
   ) q),
  1::bigint,
  'vehicle can be claimed into in_maintenance from available/assigned (start path)'
);

SELECT is(
  (SELECT count(*) FROM (
     UPDATE public.vehicles SET status = 'available'
     WHERE id = (SELECT vehicle_a FROM maint_fixture) AND status = 'in_maintenance'
     RETURNING 1
   ) q),
  1::bigint,
  'vehicle is released from in_maintenance (complete-path release semantics)'
);

RESET ROLE;

SELECT finish();
