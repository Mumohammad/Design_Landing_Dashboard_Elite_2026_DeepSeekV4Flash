-- ============================================================================
-- Vehicles current_driver FK — constraint, index, embed path + RLS (pgTAP)
-- (069_vehicles_fk_tests.sql)
--
-- Proves the DB-level guarantees behind the /vehicles current-driver embed:
--
--   1. `vehicles_current_driver_id_fkey` exists on vehicles → drivers — the
--      exact constraint name the PostgREST embed hint
--      `current_driver:drivers!vehicles_current_driver_id_fkey(...)` resolves
--      against (20261001230000). Its absence is what 400'd /vehicles in prod.
--   2. ON DELETE SET NULL semantics (confdeltype = 'n') + the FK join path
--      is exactly (vehicles.current_driver_id → drivers.id)
--   3. Supporting index idx_vehicles_current_driver_id exists (Prompt J
--      convention: every FK column gets an index)
--   4. BEHAVIORAL: a vehicle may be assigned to a real driver (FK accepts),
--      a bogus driver id is rejected 23503 (FK enforced), and the
--      PostgREST-shape join resolves with the driver fields the page reads
--   5. BEHAVIORAL: hard-deleting the driver SET NULLs the vehicle (fleet row
--      survives, unassigned — matches the free-the-vehicle semantics in
--      src/lib/vehicles/assignments.ts)
--   6. RLS re-asserted on vehicles: anon sees zero; the fixture user sees
--      own-tenant rows only (no cross-tenant leak)
--
-- Conventions (match 061/063/067): single transaction (CI passes
-- --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
-- idempotent fixed-id fixtures with a purge-first pattern (a failed run
-- COMMITS at EOF and can leak — purge by fixed id so a re-run is a clean
-- no-op). plan(11) equals the actual assertion count.
-- ============================================================================

SELECT plan(11);

-- ─── Fixtures (purge-first, fixed ids) ──────────────────────────────────────

CREATE TEMP TABLE veh_fk_fixture (
  tenant_a  uuid,
  tenant_b  uuid,
  driver_a  uuid,
  vehicle_a uuid,
  vehicle_b uuid,
  auth_id   uuid,
  user_id   uuid
);

DO $$
DECLARE
  v_t_a uuid := '06900000-0000-0000-0000-000000000001';
  v_t_b uuid := '06900000-0000-0000-0000-000000000002';
  v_d_a uuid := '06900000-0000-0000-0000-000000000003';
  v_v_a uuid := '06900000-0000-0000-0000-000000000004';
  v_v_b uuid := '06900000-0000-0000-0000-000000000005';
  v_aid uuid := '06900000-0000-0000-0000-000000000006';
  v_uid uuid := '06900000-0000-0000-0000-000000000007';
BEGIN
  -- Purge any leak from a previously half-committed run (delete order:
  -- referencing rows first — none inserted by this suite, but be safe).
  DELETE FROM public.vehicles WHERE id IN (v_v_a, v_v_b);
  DELETE FROM public.drivers  WHERE id = v_d_a;
  DELETE FROM public.users    WHERE id IN (v_uid, '06900000-0000-0000-0000-000000000008');
  DELETE FROM auth.users      WHERE id = v_aid;
  DELETE FROM public.tenants  WHERE id IN (v_t_a, v_t_b);

  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_t_a, 'مستأجر اختبار المركبات', 'Vehicles FK Tenant A'),
         (v_t_b, 'مستأجر اختبار المركبات ب', 'Vehicles FK Tenant B');

  INSERT INTO public.drivers (id, tenant_id, full_name_ar, driver_code, primary_mobile, category)
  VALUES (v_d_a, v_t_a, 'سائق المركبات', 'DRV-069', '0569000000', 'freelancer');

  -- vehicle_a: tenant A, later assigned to driver_a (the FK lives_ok case).
  INSERT INTO public.vehicles (id, tenant_id, plate_number, make, model, status)
  VALUES (v_v_a, v_t_a, 'FK069', 'Toyota', 'Hilux', 'available');

  -- vehicle_b: tenant B (cross-tenant RLS control), unassigned.
  INSERT INTO public.vehicles (id, tenant_id, plate_number, make, model, status)
  VALUES (v_v_b, v_t_b, 'FK070', 'Hyundai', 'H1', 'available');

  -- Fixture user (tenant A) — mirrors 067: supervisor, active.
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000', v_aid, 'authenticated',
          'authenticated', 'veh-fk-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}');

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES (v_uid, v_aid, v_t_a, 'veh-fk-fixture@test.local', 'supervisor', 'active');

  INSERT INTO veh_fk_fixture (tenant_a, tenant_b, driver_a, vehicle_a, vehicle_b, auth_id, user_id)
  VALUES (v_t_a, v_t_b, v_d_a, v_v_a, v_v_b, v_aid, v_uid);
END;
$$;

-- ─── 1. Constraint exists with the exact PostgREST embed name (1) ──────────

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conname  = 'vehicles_current_driver_id_fkey'
     AND conrelid = 'public.vehicles'::regclass
     AND confrelid = 'public.drivers'::regclass
     AND contype  = 'f'),
  1,
  'vehicles_current_driver_id_fkey FK exists (vehicles → drivers) — the exact name the /vehicles embed hint resolves'
);

-- ─── 2. ON DELETE SET NULL + exact join path (2) ────────────────────────────

SELECT is(
  (SELECT confdeltype FROM pg_constraint
   WHERE conname  = 'vehicles_current_driver_id_fkey'
     AND conrelid = 'public.vehicles'::regclass),
  'n',
  'FK is ON DELETE SET NULL (hard-deleted driver unassigns the vehicle, row survives)'
);

SELECT is(
  (SELECT (conkey = (SELECT ARRAY[attnum] FROM pg_attribute
                     WHERE attrelid = 'public.vehicles'::regclass AND attname = 'current_driver_id')
       AND confkey = (SELECT ARRAY[attnum] FROM pg_attribute
                      WHERE attrelid = 'public.drivers'::regclass AND attname = 'id'))::int
   FROM pg_constraint
   WHERE conname  = 'vehicles_current_driver_id_fkey'
     AND conrelid = 'public.vehicles'::regclass),
  1,
  'FK join path is exactly (vehicles.current_driver_id → drivers.id) — the PostgREST relationship'
);

-- ─── 3. Supporting index (1) ────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE tablename  = 'vehicles'
     AND schemaname = 'public'
     AND indexname  = 'idx_vehicles_current_driver_id'
     AND indexdef ILIKE '%current_driver_id%'),
  1,
  'supporting index idx_vehicles_current_driver_id exists on vehicles(current_driver_id)'
);

-- ─── 4. Behavioral: FK accepts valid, rejects bogus (2) ─────────────────────

SELECT lives_ok(
  $$UPDATE public.vehicles
    SET current_driver_id = '06900000-0000-0000-0000-000000000003'::uuid,
        status = 'assigned'
    WHERE id = '06900000-0000-0000-0000-000000000004'::uuid$$,
  'vehicle may be assigned to a real driver (FK accepts the join path)'
);

SELECT throws_ok(
  $$INSERT INTO public.vehicles
      (id, tenant_id, plate_number, make, model, current_driver_id)
    VALUES ('06900000-0000-0000-0000-000000000008'::uuid,
            '06900000-0000-0000-0000-000000000001'::uuid,
            'FK069X', 'X', 'Y',
            '99999999-9999-9999-9999-999999999999'::uuid)$$,
  '23503', NULL,
  'bogus current_driver_id is FK-rejected (23503) — constraint is enforced, not cosmetic'
);

-- ─── 5. Behavioral: PostgREST-shape embed join resolves (1) ─────────────────
-- Mirrors src/app/(dashboard)/vehicles/page.tsx:
--   current_driver:drivers!vehicles_current_driver_id_fkey(full_name_ar, full_name_en, driver_code)

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "06900000-0000-0000-0000-000000000006", "role": "authenticated"}', true);

SELECT is(
  (SELECT count(*)::int
   FROM public.vehicles v
   JOIN public.drivers d ON d.id = v.current_driver_id
   WHERE v.tenant_id = '06900000-0000-0000-0000-000000000001'::uuid
     AND d.full_name_ar = 'سائق المركبات'
     AND d.driver_code  = 'DRV-069'),
  1,
  'PostgREST-shape join (vehicles → drivers on current_driver_id) resolves the current-driver chip fields as the authenticated user'
);

-- ─── 6. RLS re-asserted on vehicles (3) ─────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM public.vehicles
   WHERE tenant_id = '06900000-0000-0000-0000-000000000001'::uuid),
  1,
  'authenticated user sees own-tenant vehicle (RLS tenant filter passes)'
);

SELECT is(
  (SELECT count(*)::int FROM public.vehicles
   WHERE tenant_id = '06900000-0000-0000-0000-000000000002'::uuid),
  0,
  'authenticated user sees zero cross-tenant vehicles (RLS blocks tenant B)'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);

SELECT is(
  (SELECT count(*)::int FROM public.vehicles),
  0,
  'anon sees zero vehicles (RLS anon-zero re-asserted)'
);

RESET ROLE;
SET LOCAL ROLE postgres;

-- ─── 7. Behavioral: ON DELETE SET NULL round-trip (1) ───────────────────────

DELETE FROM public.drivers WHERE id = '06900000-0000-0000-0000-000000000003'::uuid;

SELECT is(
  (SELECT (current_driver_id IS NULL AND status IS NOT NULL)::int
   FROM public.vehicles
   WHERE id = '06900000-0000-0000-0000-000000000004'::uuid),
  1,
  'hard-deleting the driver SET NULLs the vehicle assignment — fleet row survives, unassigned'
);

-- ─── Cleanup & finish ───────────────────────────────────────────────────────

RESET ROLE;

SELECT * FROM finish();
