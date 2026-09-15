-- ============================================================================
-- Drivers Module — Phase A tests (pgTAP)
-- Proves the guarantees of
-- 20260915120000_drivers_module_foundation.sql:
--
--   1. driver_document_type includes the 10 Saudi-2026 document types
--   2. drivers carries the new identity/card/assignment columns (+ checks)
--   3. All 7 new tables exist with RLS enabled, tenant sel/ins/upd policies,
--      and NO hard-DELETE policy
--   4. compute_driver_compliance(uuid): SECURITY DEFINER, pinned search_path,
--      service_role only (anon/authenticated denied)
--   5. driver_calendar_has_conflict: authenticated + service_role, not anon
--   6. driver_cards.card_serial unique; 6 child FKs reference drivers
--   7. BEHAVIORAL: a fixture driver with no identity/licence evaluates to
--      critical_block, persists a results row, and is not dispatch_eligible;
--      the calendar conflict helper detects overlaps and ignores disjoint
--      windows
--
-- Conventions (match 011): single transaction (CI passes
-- --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
-- fixtures in a TEMP table, finish() at the end. Fixture rows roll back with
-- the test transaction.
-- ============================================================================

SELECT plan(41);

-- ─── Fixtures (run as postgres; bypass RLS) ─────────────────────────────────

CREATE TEMP TABLE drivers_module_fixture (
  tenant_id uuid,
  driver_id uuid
);

DO $$
DECLARE
  v_t uuid;
  v_d uuid;
BEGIN
  INSERT INTO public.tenants (name_ar, name_en)
  VALUES ('مستأجر اختبار', 'Fixture Tenant')
  RETURNING id INTO v_t;

  INSERT INTO public.drivers (tenant_id, full_name_ar, primary_mobile, category)
  VALUES (v_t, 'سائق اختبار', '0500000000', 'freelancer')
  RETURNING id INTO v_d;

  INSERT INTO drivers_module_fixture (tenant_id, driver_id) VALUES (v_t, v_d);

  INSERT INTO public.driver_calendar_events
    (tenant_id, driver_id, event_type, starts_at, ends_at)
  VALUES
    (v_t, v_d, 'driver_shift',
     '2026-10-01 08:00:00+00'::timestamptz,
     '2026-10-01 16:00:00+00'::timestamptz);
END;
$$;

-- ─── 1. Document type enum (1) ──────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int
   FROM pg_enum e
   JOIN pg_type t ON t.oid = e.enumtypid
   JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public'
     AND t.typname = 'driver_document_type'
     AND e.enumlabel IN (
       'national_id', 'health_certificate', 'home_delivery_permit',
       'ajeer_permit', 'food_handling_certificate', 'vehicle_lease_agreement',
       'driver_card', 'work_permit', 'authorization_letter',
       'training_certificate')),
  10,
  'driver_document_type includes the 10 Saudi-2026 document types'
);

-- ─── 2. drivers columns (8) ─────────────────────────────────────────────────

SELECT has_column('public', 'drivers', 'identity_type',       'drivers.identity_type exists');
SELECT has_column('public', 'drivers', 'rider_id',            'drivers.rider_id exists');
SELECT has_column('public', 'drivers', 'blood_type',          'drivers.blood_type exists');
SELECT has_column('public', 'drivers', 'preferred_language',  'drivers.preferred_language exists');
SELECT has_column('public', 'drivers', 'branch_hub',          'drivers.branch_hub exists');
SELECT has_column('public', 'drivers', 'vendor_name',         'drivers.vendor_name exists');
SELECT has_column('public', 'drivers', 'delivery_zones',      'drivers.delivery_zones exists');
SELECT has_column('public', 'drivers', 'card_status',         'drivers.card_status exists');

-- ─── 3. New tables (7) + RLS (7) ────────────────────────────────────────────

SELECT has_table('public', 'driver_consents',             'driver_consents exists');
SELECT has_table('public', 'driver_compliance_results',   'driver_compliance_results exists');
SELECT has_table('public', 'driver_compliance_overrides', 'driver_compliance_overrides exists');
SELECT has_table('public', 'driver_calendar_events',      'driver_calendar_events exists');
SELECT has_table('public', 'driver_assets',               'driver_assets exists');
SELECT has_table('public', 'driver_cards',                'driver_cards exists');
SELECT has_table('public', 'driver_card_prints',          'driver_card_prints exists');

SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'driver_consents'),             'RLS enabled on driver_consents');
SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'driver_compliance_results'),   'RLS enabled on driver_compliance_results');
SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'driver_compliance_overrides'), 'RLS enabled on driver_compliance_overrides');
SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'driver_calendar_events'),      'RLS enabled on driver_calendar_events');
SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'driver_assets'),               'RLS enabled on driver_assets');
SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'driver_cards'),                'RLS enabled on driver_cards');
SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'driver_card_prints'),          'RLS enabled on driver_card_prints');

-- ─── 4. Policy shape (2) ────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('driver_consents','driver_compliance_results','driver_compliance_overrides',
                       'driver_calendar_events','driver_assets','driver_cards','driver_card_prints')
     AND (qual LIKE '%get_my_tenant_id()%' OR with_check LIKE '%get_my_tenant_id()%')),
  21,
  'each new table has exactly sel/ins/upd tenant policies via get_my_tenant_id()'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('driver_consents','driver_compliance_results','driver_compliance_overrides',
                       'driver_calendar_events','driver_assets','driver_cards','driver_card_prints')
     AND cmd = 'DELETE'),
  0,
  'no hard-DELETE policies on new tables (soft delete via deleted_at only)'
);

-- ─── 5. compute_driver_compliance security (4) ──────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT ok(
  (SELECT p.prosecdef
     AND p.proconfig IS NOT NULL
     AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'compute_driver_compliance'),
  'compute_driver_compliance is SECURITY DEFINER with pinned search_path'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.compute_driver_compliance(uuid)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE compute_driver_compliance'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.compute_driver_compliance(uuid)', 'EXECUTE'),
  false,
  'authenticated cannot EXECUTE compute_driver_compliance (service_role only)'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_function_privilege('service_role', 'public.compute_driver_compliance(uuid)', 'EXECUTE'),
  true,
  'service_role can EXECUTE compute_driver_compliance'
);

-- ─── 6. driver_calendar_has_conflict grants (3) ─────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.driver_calendar_has_conflict(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE driver_calendar_has_conflict'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.driver_calendar_has_conflict(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE'),
  true,
  'authenticated can EXECUTE driver_calendar_has_conflict'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_function_privilege('service_role', 'public.driver_calendar_has_conflict(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE'),
  true,
  'service_role can EXECUTE driver_calendar_has_conflict'
);

-- ─── 7. Integrity (4) ───────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'driver_cards'
            AND indexdef ILIKE 'CREATE UNIQUE INDEX%card_serial%'),
  'driver_cards.card_serial is unique'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE contype = 'f'
     AND confrelid = 'public.drivers'::regclass
     AND conrelid IN ('public.driver_consents'::regclass,
                      'public.driver_compliance_results'::regclass,
                      'public.driver_compliance_overrides'::regclass,
                      'public.driver_calendar_events'::regclass,
                      'public.driver_assets'::regclass,
                      'public.driver_cards'::regclass)),
  6,
  'all six new child tables reference drivers'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'drivers_identity_type_check'
            AND conrelid = 'public.drivers'::regclass),
  'drivers identity_type CHECK exists'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'drivers_card_status_check'
            AND conrelid = 'public.drivers'::regclass),
  'drivers card_status CHECK exists'
);

-- ─── 8. BEHAVIORAL: compliance engine (3) ───────────────────────────────────
-- Fixture driver has no identity number and no licence → identity + licence
-- are blockers → level must be critical_block, a results row is persisted,
-- and the driver must not be dispatch_eligible.

SELECT is(
  (SELECT (public.compute_driver_compliance(f.driver_id) ->> 'level')
   FROM drivers_module_fixture f),
  'critical_block',
  'driver with no identity/licence evaluates to critical_block'
);

SELECT ok(
  EXISTS (SELECT 1
          FROM public.driver_compliance_results r
          JOIN drivers_module_fixture f ON f.driver_id = r.driver_id),
  'compliance run is persisted to driver_compliance_results'
);

SELECT is(
  (SELECT d.dispatch_eligible
   FROM public.drivers d
   JOIN drivers_module_fixture f ON f.driver_id = d.id),
  false,
  'non-compliant driver is not dispatch_eligible'
);

-- ─── 9. BEHAVIORAL: calendar conflict helper (2) ────────────────────────────

SELECT is(
  (SELECT public.driver_calendar_has_conflict(
     f.driver_id,
     '2026-10-01 12:00:00+00'::timestamptz,
     '2026-10-01 18:00:00+00'::timestamptz)
   FROM drivers_module_fixture f),
  true,
  'overlap with existing shift is detected'
);

SELECT is(
  (SELECT public.driver_calendar_has_conflict(
     f.driver_id,
     '2026-10-02 12:00:00+00'::timestamptz,
     '2026-10-02 18:00:00+00'::timestamptz)
   FROM drivers_module_fixture f),
  false,
  'disjoint window reports no conflict'
);

-- ─── Cleanup & finish ───────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT * FROM finish();
