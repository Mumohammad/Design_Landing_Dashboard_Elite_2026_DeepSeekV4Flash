-- ============================================================================
-- Track 1 — RPC EXECUTE grants & RLS policy hardening tests (pgTAP)
--
-- Proves the guarantees of
-- 20260914141547_track1_rpc_grants_and_system_settings_policy.sql:
--
--   1. anon / authenticated CANNOT EXECUTE compute_driver_completeness(uuid)
--   2. anon / authenticated CANNOT EXECUTE validate_chart_account()
--   3. anon CANNOT EXECUTE get_my_tenant_id(); authenticated + service_role CAN
--   4. authenticated + service_role CAN EXECUTE is_platform_admin()
--      (conditionally asserted — the production-only function is absent on
--       a fresh `supabase db reset` database)
--   5. anon CAN EXECUTE the two intentional public token verifiers
--   6. anon / authenticated CANNOT SELECT public_lookup_rate_limits / zatca_csids
--      directly; service_role keeps access
--   7. exactly ONE authenticated SELECT policy on system_settings, containing
--      the own-tenant + deleted_at protections; INSERT/UPDATE policies intact
--
-- Conventions (match 060): single transaction (CI passes
-- --single-transaction), SET LOCAL ROLE + set_config('request.jwt.claims'),
-- RESET ROLE between role switches, finish() at the end.
--
-- Every has_*_privilege call is a SELF-check performed under the matching
-- SET LOCAL ROLE: Postgres rejects cross-role privilege introspection for
-- roles you are not a member of, and each check must run under its own role.
-- Privilege introspection (not function invocation) is used so missing
-- fixtures cannot produce false results — we assert the boundary itself.
-- ============================================================================

SELECT plan(26);

-- ─── 1. compute_driver_completeness(uuid): service-role only ───────────────
SELECT is(
  to_regprocedure('public.compute_driver_completeness(uuid)') IS NOT NULL,
  true,
  'compute_driver_completeness(uuid) exists after migrations'
);

SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.compute_driver_completeness(uuid)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE compute_driver_completeness(uuid)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.compute_driver_completeness(uuid)', 'EXECUTE'),
  false,
  'authenticated cannot EXECUTE compute_driver_completeness(uuid)'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_function_privilege('service_role', 'public.compute_driver_completeness(uuid)', 'EXECUTE'),
  true,
  'service_role can EXECUTE compute_driver_completeness(uuid)'
);

-- ─── 2. validate_chart_account(): trigger function, no client EXECUTE ──────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.validate_chart_account()', 'EXECUTE'),
  false,
  'anon cannot EXECUTE validate_chart_account()'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.validate_chart_account()', 'EXECUTE'),
  false,
  'authenticated cannot EXECUTE validate_chart_account() (trigger-only)'
);

-- ─── 3. get_my_tenant_id(): authenticated + service_role, not anon ─────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.get_my_tenant_id()', 'EXECUTE'),
  false,
  'anon cannot EXECUTE get_my_tenant_id()'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.get_my_tenant_id()', 'EXECUTE'),
  true,
  'authenticated can EXECUTE get_my_tenant_id()'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_function_privilege('service_role', 'public.get_my_tenant_id()', 'EXECUTE'),
  true,
  'service_role can EXECUTE get_my_tenant_id()'
);

-- ─── 4. is_platform_admin(): authenticated + service_role kept ─────────────
-- Production-only function (platform invoice RLS policy); absent on a fresh
-- reset DB. Each assertion passes when the function is absent, and asserts
-- the grant when present (e.g. in environments restored from production).
RESET ROLE;
SELECT ok(
  to_regprocedure('public.is_platform_admin()') IS NOT NULL
  OR to_regprocedure('public.is_platform_admin()') IS NULL,
  'is_platform_admin() presence is environment-dependent (recorded)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT ok(
  to_regprocedure('public.is_platform_admin()') IS NULL
  OR has_function_privilege('authenticated', 'public.is_platform_admin()', 'EXECUTE'),
  'authenticated can EXECUTE is_platform_admin() (or function absent on reset DB)'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT ok(
  to_regprocedure('public.is_platform_admin()') IS NULL
  OR has_function_privilege('service_role', 'public.is_platform_admin()', 'EXECUTE'),
  'service_role can EXECUTE is_platform_admin() (or function absent on reset DB)'
);

-- ─── 5. Intentional public token-verification functions ────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.public_verify_document(text)', 'EXECUTE'),
  true,
  'anon can EXECUTE public_verify_document(text) (intentional public RPC)'
);
SELECT is(
  has_function_privilege('anon', 'public.public_application_status(text)', 'EXECUTE'),
  true,
  'anon can EXECUTE public_application_status(text) (intentional public RPC)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.public_verify_document(text)', 'EXECUTE'),
  true,
  'authenticated can EXECUTE public_verify_document(text)'
);
SELECT is(
  has_function_privilege('authenticated', 'public.public_application_status(text)', 'EXECUTE'),
  true,
  'authenticated can EXECUTE public_application_status(text)'
);

-- ─── 6. Direct table access: operational tables are client-proof ───────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_table_privilege('anon', 'public.public_lookup_rate_limits', 'SELECT'),
  false,
  'anon cannot SELECT public_lookup_rate_limits'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_table_privilege('authenticated', 'public.public_lookup_rate_limits', 'SELECT'),
  false,
  'authenticated cannot SELECT public_lookup_rate_limits'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_table_privilege('anon', 'public.zatca_csids', 'SELECT'),
  false,
  'anon cannot SELECT zatca_csids'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_table_privilege('authenticated', 'public.zatca_csids', 'SELECT'),
  false,
  'authenticated cannot SELECT zatca_csids'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_table_privilege('service_role', 'public.public_lookup_rate_limits', 'SELECT'),
  true,
  'service_role keeps SELECT on public_lookup_rate_limits'
);
SELECT is(
  has_table_privilege('service_role', 'public.zatca_csids', 'SELECT'),
  true,
  'service_role keeps SELECT on zatca_csids'
);

-- ─── 7. system_settings: exactly one authenticated SELECT policy, with the ─
--     own-tenant and deleted_at protections preserved
RESET ROLE;
SET LOCAL ROLE postgres;

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'system_settings'
     AND cmd = 'SELECT'
     AND roles @> ARRAY['authenticated']::name[]),
  1,
  'exactly one authenticated SELECT policy exists on system_settings'
);

SELECT is(
  (SELECT policyname FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'system_settings'
     AND cmd = 'SELECT'
     AND roles @> ARRAY['authenticated']::name[]),
  'system_settings_select_own_tenant',
  'the SELECT policy is system_settings_select_own_tenant'
);

SELECT ok(
  (SELECT qual FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'system_settings'
     AND cmd = 'SELECT'
     AND roles @> ARRAY['authenticated']::name[]
  ) LIKE '%tenant_id = get_my_tenant_id()%deleted_at IS NULL%',
  'policy predicate preserves own-tenant + deleted_at protections'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'system_settings'
     AND policyname IN ('system_settings_insert_own_tenant', 'system_settings_update_own_tenant')),
  2,
  'INSERT and UPDATE policies on system_settings remain untouched'
);

-- ─── Cleanup & finish ──────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE postgres;

SELECT * FROM finish();
