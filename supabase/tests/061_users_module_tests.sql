-- ============================================================================
-- Users Module — surface tests (pgTAP)
-- (061_users_module_tests.sql)
--
-- Proves the guarantees of 20260924120000_users_module_surface.sql:
--
--   1. user_consents exists, RLS enabled, tenant SELECT/INSERT policies via
--      get_my_tenant_id(), and NO UPDATE/DELETE policy (append-only ledger)
--   2. consent_type is constrained to terms/privacy/marketing
--   3. UNIQUE (tenant_id, user_id, consent_type, version) exists
--   4. has_user_pdpl_consent: SECURITY DEFINER, pinned search_path,
--      anon denied, authenticated + service_role granted
--   5. BEHAVIORAL (definer helper): false without any consent, true after an
--      accepted consent, false again after a NEWER unaccepted version —
--      the masking gate follows the latest version only
--   6. user_employee_code_seq + next_employee_code(uuid): SECURITY DEFINER,
--      authenticated + service_role granted, anon denied, SEQUENCE itself
--      revoked, and mints monotonic EDU-NNNNNN codes
--
-- Conventions (match 012): single transaction (CI passes
-- --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
-- fixtures in a TEMP table, finish() at the end. Fixture rows roll back with
-- the test transaction.
-- ============================================================================

SELECT plan(28);

-- ─── Fixtures (run as postgres; bypass RLS) ─────────────────────────────────

CREATE TEMP TABLE users_module_fixture (
  tenant_id uuid,
  user_id   uuid
);

DO $$
DECLARE
  v_t uuid;
  v_u uuid;
BEGIN
  INSERT INTO public.tenants (name_ar, name_en)
  VALUES ('مستأجر اختبار المستخدمين', 'Users Fixture Tenant')
  RETURNING id INTO v_t;

  -- users requires an auth.users row (auth_user_id NOT NULL UNIQUE FK).
  -- raw_user_meta_data carries the same _invite_provisioned marker the
  -- acceptInvite() flow uses — migration 060's hardened trigger (AUTH010)
  -- rejects direct auth.users INSERTs without it.
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
          'authenticated', 'users-module-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}')
  RETURNING id INTO v_u;

  INSERT INTO public.users (auth_user_id, tenant_id, email, role, status)
  VALUES (v_u, v_t, 'users-module-fixture@test.local', 'supervisor', 'active')
  RETURNING id INTO v_u;

  INSERT INTO users_module_fixture (tenant_id, user_id) VALUES (v_t, v_u);
END;
$$;

-- ─── 1. Table + RLS + policy shape (5) ──────────────────────────────────────

SELECT has_table('public', 'user_consents', 'user_consents exists');

SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'user_consents'),
          'RLS enabled on user_consents');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'user_consents'
     AND (qual LIKE '%get_my_tenant_id()%' OR with_check LIKE '%get_my_tenant_id()%')),
  2,
  'user_consents has exactly 2 tenant policies (SELECT + INSERT) via get_my_tenant_id()'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'user_consents'
     AND cmd IN ('UPDATE', 'DELETE')),
  0,
  'no UPDATE/DELETE policies on user_consents (append-only PDPL ledger)'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'user_consents_consent_type_check'
            AND conrelid = 'public.user_consents'::regclass),
  'consent_type CHECK constraint exists'
);

-- ─── 2. consent_type domain (1) ─────────────────────────────────────────────

SELECT lives_ok(
  $$INSERT INTO public.user_consents (tenant_id, user_id, consent_type, version, accepted, accepted_at)
    SELECT f.tenant_id, f.user_id, 'privacy', '2026.1', true, now() FROM users_module_fixture f$$,
  'consent_type accepts privacy'
);

SELECT throws_ok(
  $$INSERT INTO public.user_consents (tenant_id, user_id, consent_type, version, accepted)
    SELECT f.tenant_id, f.user_id, 'spam', '2026.1', false FROM users_module_fixture f$$,
  '23514', NULL,
  'consent_type rejects unknown values'
);

-- ─── 3. Uniqueness (1) ──────────────────────────────────────────────────────

SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'user_consents'
            AND indexdef ILIKE 'CREATE UNIQUE INDEX%tenant_id%user_id%consent_type%version%'),
  'UNIQUE (tenant_id, user_id, consent_type, version) exists'
);

-- ─── 4. has_user_pdpl_consent security (4) ──────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT ok(
  (SELECT p.prosecdef
     AND p.proconfig IS NOT NULL
     AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_user_pdpl_consent'),
  'has_user_pdpl_consent is SECURITY DEFINER with pinned search_path'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.has_user_pdpl_consent(uuid, text)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE has_user_pdpl_consent'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.has_user_pdpl_consent(uuid, text)', 'EXECUTE'),
  true,
  'authenticated can EXECUTE has_user_pdpl_consent'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_function_privilege('service_role', 'public.has_user_pdpl_consent(uuid, text)', 'EXECUTE'),
  true,
  'service_role can EXECUTE has_user_pdpl_consent'
);

-- ─── 5. BEHAVIORAL: consent gate follows latest version only (3) ────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT is(
  (SELECT public.has_user_pdpl_consent(f.user_id, 'terms') FROM users_module_fixture f),
  false,
  'consent gate is false without any user terms consent'
);

-- Accepted terms v2026.1 → gate opens. Version 2026.1 outranks the
-- (tenant, system.tenants, terms, 1, accepted) row supabase/seed.sql
-- pre-seeds for every tenant, so this becomes the user's latest version.
INSERT INTO public.user_consents (tenant_id, user_id, consent_type, version, accepted, accepted_at)
SELECT f.tenant_id, f.user_id, 'terms', '2026.1', true, now() FROM users_module_fixture f;

SELECT is(
  (SELECT public.has_user_pdpl_consent(f.user_id, 'terms') FROM users_module_fixture f),
  true,
  'consent gate is true after an accepted terms consent'
);

-- A NEWER unaccepted terms version must close the gate again (masking
-- follows the LATEST version, not "any version ever accepted"), while the
-- seed's version 1 row stays accepted below it.
INSERT INTO public.user_consents (tenant_id, user_id, consent_type, version, accepted)
SELECT f.tenant_id, f.user_id, 'terms', '2026.2', false FROM users_module_fixture f;

SELECT is(
  (SELECT public.has_user_pdpl_consent(f.user_id, 'terms') FROM users_module_fixture f),
  false,
  'consent gate closes when the newest terms version is unaccepted (2026.2)'
);

-- ─── 6. next_employee_code security + grants (5) ────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT ok(
  (SELECT p.prosecdef
     AND p.proconfig IS NOT NULL
     AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'next_employee_code'),
  'next_employee_code is SECURITY DEFINER with pinned search_path'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.next_employee_code(uuid)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE next_employee_code'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.next_employee_code(uuid)', 'EXECUTE'),
  true,
  'authenticated can EXECUTE next_employee_code'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_function_privilege('service_role', 'public.next_employee_code(uuid)', 'EXECUTE'),
  true,
  'service_role can EXECUTE next_employee_code'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_usage_grants
   WHERE object_schema = 'public'
     AND object_name = 'user_employee_code_seq'
     AND grantee IN ('anon', 'authenticated', 'service_role')),
  0,
  'no USAGE grant on the raw sequence for anon/authenticated/service_role'
);

-- ─── 7. BEHAVIORAL: code minting (3) ────────────────────────────────────────

SELECT is(
  (SELECT left(public.next_employee_code(f.tenant_id), 4) FROM users_module_fixture f),
  'EDU-',
  'next_employee_code returns EDU- prefixed codes'
);

SELECT is(
  (SELECT length(public.next_employee_code(f.tenant_id)) FROM users_module_fixture f),
  10,
  'next_employee_code returns 10-char codes (EDU-NNNNNN)'
);

SELECT ok(
  (SELECT public.next_employee_code(f.tenant_id) <> public.next_employee_code(f.tenant_id)
   FROM users_module_fixture f),
  'next_employee_code mints monotonic (distinct) codes'
);

-- ─── 8. FK integrity (1) ────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE contype = 'f'
     AND conrelid = 'public.user_consents'::regclass
     AND confrelid IN ('public.tenants'::regclass, 'public.users'::regclass)),
  2,
  'user_consents references tenants + users'
);

-- ─── Cleanup & finish ───────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT * FROM finish();
