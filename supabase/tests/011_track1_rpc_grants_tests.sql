-- ============================================================================
-- Track 1 — RPC EXECUTE grants & RLS policy hardening tests (pgTAP)
--
-- Proves the guarantees of
-- 20260914141547_track1_rpc_grants_and_system_settings_policy.sql:
--
--   1. anon / authenticated CANNOT EXECUTE compute_driver_completeness(uuid);
--      service_role CAN — conditional: the function may be absent on a
--      fresh/reset database (the migration itself skips with a NOTICE there)
--   2. anon / authenticated CANNOT EXECUTE validate_chart_account() —
--      conditional on the same grounds
--   3. anon CANNOT EXECUTE get_my_tenant_id(); authenticated + service_role CAN
--   4. ONE conditional assertion: authenticated + service_role can EXECUTE
--      is_platform_admin() when the production-only function exists
--   5. anon CAN EXECUTE the two intentional public token verifiers
--   6. BEHAVIORAL contract: as anon, each public verifier stays executable
--      and returns a neutral not-found (or rate_limited) response for a
--      deliberately nonmatching opaque token — no fixtures, no PII
--   7. anon / authenticated CANNOT SELECT public_lookup_rate_limits /
--      zatca_csids directly; service_role keeps access
--   8. exactly ONE authenticated SELECT policy on system_settings, containing
--      the own-tenant + deleted_at protections; INSERT/UPDATE policies intact
--
-- Conventions (match 060): single transaction (CI passes
-- --single-transaction), SET LOCAL ROLE + set_config('request.jwt.claims'),
-- RESET ROLE between role switches, finish() at the end.
--
-- Privilege introspection (not function invocation) is used so missing
-- fixtures cannot produce false results — we assert the boundary itself.
-- Every has_*_privilege call is a SELF-check under the matching SET LOCAL
-- ROLE (Postgres rejects cross-role introspection for roles you are not a
-- member of). Conditional assertions use CASE (Postgres guarantees CASE
-- evaluates in order), so has_function_privilege is never reached for a
-- function that does not exist in the environment.
-- ============================================================================

SELECT plan(25);

-- ─── 1. compute_driver_completeness(uuid): service-role only ───────────────

SET LOCAL ROLE anon;
SELECT ok(
  (SELECT CASE
     WHEN to_regprocedure('public.compute_driver_completeness(uuid)') IS NULL THEN true
     WHEN has_function_privilege('anon', 'public.compute_driver_completeness(uuid)', 'EXECUTE') THEN false
     ELSE true END),
  'anon cannot EXECUTE compute_driver_completeness(uuid) (or function absent on reset DB)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT ok(
  (SELECT CASE
     WHEN to_regprocedure('public.compute_driver_completeness(uuid)') IS NULL THEN true
     WHEN has_function_privilege('authenticated', 'public.compute_driver_completeness(uuid)', 'EXECUTE') THEN false
     ELSE true END),
  'authenticated cannot EXECUTE compute_driver_completeness(uuid) (or function absent on reset DB)'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT ok(
  (SELECT CASE
     WHEN to_regprocedure('public.compute_driver_completeness(uuid)') IS NULL THEN true
     WHEN has_function_privilege('service_role', 'public.compute_driver_completeness(uuid)', 'EXECUTE') THEN true
     ELSE false END),
  'service_role can EXECUTE compute_driver_completeness(uuid) (or function absent on reset DB)'
);

-- ─── 2. validate_chart_account(): trigger function, no client EXECUTE ──────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT ok(
  (SELECT CASE
     WHEN to_regprocedure('public.validate_chart_account()') IS NULL THEN true
     WHEN has_function_privilege('anon', 'public.validate_chart_account()', 'EXECUTE') THEN false
     ELSE true END),
  'anon cannot EXECUTE validate_chart_account() (or function absent on reset DB)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT ok(
  (SELECT CASE
     WHEN to_regprocedure('public.validate_chart_account()') IS NULL THEN true
     WHEN has_function_privilege('authenticated', 'public.validate_chart_account()', 'EXECUTE') THEN false
     ELSE true END),
  'authenticated cannot EXECUTE validate_chart_account() (or function absent on reset DB)'
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

-- ─── 4. is_platform_admin(): one conditional grant assertion ───────────────
-- Production-only function (platform invoice RLS policy); absent on a fresh
-- reset DB. When present, BOTH authenticated and service_role must hold
-- EXECUTE. Checked as postgres (CI pgtap runs as superuser) because it
-- introspects two roles.
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT ok(
  (SELECT CASE
     WHEN to_regprocedure('public.is_platform_admin()') IS NULL THEN true
     WHEN has_function_privilege('authenticated', 'public.is_platform_admin()', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.is_platform_admin()', 'EXECUTE') THEN true
     ELSE false END),
  'authenticated and service_role can EXECUTE is_platform_admin() (or function absent on reset DB)'
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

-- ─── 6. BEHAVIORAL: the anonymous public contract is retained ──────────────
-- As anon, call each verifier with a deliberately nonmatching opaque token
-- (64 hex chars — realistic shape, matches no seeded hash). The only
-- acceptable responses are the neutral not-found shape or the built-in
-- rate_limited guard — never an error, never row data, never PII.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT ok(
  (SELECT (v ->> 'found') = 'false' OR v ->> 'error' = 'rate_limited'
   FROM (SELECT public_verify_document(repeat('f', 64)) AS v) s),
  'anon public_verify_document: neutral not-found contract retained (no PII)'
);
SELECT ok(
  (SELECT (v ->> 'found') = 'false' OR v ->> 'error' = 'rate_limited'
   FROM (SELECT public_application_status(repeat('f', 64)) AS v) s),
  'anon public_application_status: neutral not-found contract retained (no PII)'
);

-- ─── 7. Direct table access: operational tables are client-proof ───────────
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

-- ─── 8. system_settings: exactly one authenticated SELECT policy, with the ─
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
