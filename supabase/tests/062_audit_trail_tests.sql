-- ============================================================================
-- Audit-Trail — surface tests (pgTAP)
-- (062_audit_trail_tests.sql)
--
-- Proves the guarantees of 20260924140000_audit_trail_surface.sql plus the
-- pre-existing audit_log contract the /audit-log surface depends on:
--
--   1. audit_log exists, RLS enabled, exactly one SELECT policy, and NO
--      UPDATE/DELETE policies (append-only, ADR-007)
--   2. All four list/filter indexes exist ((tenant_id, created_at DESC),
--      actor, entity, module/action)
--   3. Grant-layer append-only: anon + authenticated hold NO UPDATE/DELETE/
--      TRUNCATE privilege on audit_log (TRUNCATE bypasses RLS + the 009
--      row trigger — 20260924140000 revokes it)
--   4. fetch_audit_trail_page: SECURITY DEFINER + pinned search_path, anon
--      denied, authenticated + service_role granted, hard cap at 100 rows
--   5. BEHAVIORAL: tenant isolation (definer still never crosses tenants),
--      newest-first ordering, reason projection, action/entity/actor/date
--      filters (the surface's filter set)
--   6. Append-only enforcement: authenticated UPDATE/DELETE/TRUNCATE/INSERT
--      all fail (42501); the 009 immutability trigger still fires for
--      privileged roles (P0001)
--   7. Role-scoped reads: anon sees 0 rows; authenticated sees only their
--      tenant's rows via audit_log_select_own_tenant
--
-- Conventions (match 060/061): single transaction (CI passes
-- --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
-- fixtures in a TEMP table + fixed UUIDs for role-switched statements
-- (TEMP tables are not readable by non-owner roles), finish() at the end.
-- Fixture rows roll back with the test transaction.
-- ============================================================================

SELECT plan(25);

-- ─── Fixtures (run as postgres; bypass RLS) ─────────────────────────────────
-- Fixed UUIDs so role-switched statements need no fixture-table access:
--   tenant A  11111111-1111-1111-1111-111111111111
--   tenant B  22222222-2222-2222-2222-222222222222
--   auth user 33333333-3333-3333-3333-333333333333
--   users row 55555555-5555-5555-5555-555555555555
--   entity    44444444-4444-4444-4444-444444444444

CREATE TEMP TABLE audit_trail_fixture (
  tenant_id uuid,
  user_id   uuid,
  auth_id   uuid,
  entity_id uuid
);

DO $$
BEGIN
  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES ('11111111-1111-1111-1111-111111111111', 'مستأجر تدقيق أ', 'Audit Fixture Tenant A');

  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES ('22222222-2222-2222-2222-222222222222', 'مستأجر تدقيق ب', 'Audit Fixture Tenant B');

  -- users requires an auth.users row (auth_user_id NOT NULL UNIQUE FK).
  -- raw_user_meta_data carries the _invite_provisioned marker — migration
  -- 060's hardened trigger (AUTH010) rejects auth.users INSERTs without it.
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000',
          '33333333-3333-3333-3333-333333333333', 'authenticated',
          'authenticated', 'audit-trail-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}');

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES ('55555555-5555-5555-5555-555555555555',
          '33333333-3333-3333-3333-333333333333',
          '11111111-1111-1111-1111-111111111111',
          'audit-trail-fixture@test.local', 'supervisor', 'active');

  -- Tenant A: created (with reason + sensitive payload), system (no actor),
  -- updated (newest). Tenant B: 1 semantic row + 120 cap-probe rows.
  INSERT INTO public.audit_log
    (tenant_id, actor_id, module, entity_type, entity_id, action, new_values, created_at)
  VALUES
    ('11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333',
     'seed', 'driver', '44444444-4444-4444-4444-444444444444', 'created',
     '{"reason":"seed reason","primary_mobile":"0551234567"}',
     now() - interval '3 hours'),
    ('11111111-1111-1111-1111-111111111111',
     NULL,
     'seed', 'tenant', NULL, 'deleted',
     NULL,
     now() - interval '2 hours'),
    ('11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333',
     'seed', 'driver', '44444444-4444-4444-4444-444444444444', 'updated',
     '{"status":"active"}',
     now() - interval '1 hour'),
    ('22222222-2222-2222-2222-222222222222',
     NULL, 'other', 'invoice', NULL, 'created', NULL,
     now() - interval '30 minutes');

  INSERT INTO public.audit_log
    (tenant_id, actor_id, module, action, created_at)
  SELECT '22222222-2222-2222-2222-222222222222', NULL, 'cap_probe', 'created',
         now() - (g || ' minutes')::interval
  FROM generate_series(1, 120) AS g;

  INSERT INTO audit_trail_fixture VALUES
    ('11111111-1111-1111-1111-111111111111',
     '55555555-5555-5555-5555-555555555555',
     '33333333-3333-3333-3333-333333333333',
     '44444444-4444-4444-4444-444444444444');
END;
$$;

-- ─── 1. Table + RLS + policy shape (5) ──────────────────────────────────────

SELECT has_table('public', 'audit_log', 'audit_log exists');

SELECT ok((SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'audit_log'),
          'RLS enabled on audit_log');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'audit_log' AND cmd = 'SELECT'),
  1,
  'audit_log has exactly 1 SELECT policy (tenant isolation)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'audit_log'
     AND cmd IN ('UPDATE', 'DELETE')),
  0,
  'no UPDATE/DELETE policies on audit_log (append-only, ADR-007)'
);

SELECT ok(
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'audit_log'
     AND indexname IN ('idx_audit_log_tenant_created', 'idx_audit_log_actor',
                       'idx_audit_log_entity', 'idx_audit_log_module_action')) = 4,
  'all 4 list/filter indexes exist (tenant+created DESC, actor, entity, module+action)'
);

-- ─── 2. Grant-layer append-only (1) ─────────────────────────────────────────
-- TRUNCATE bypasses RLS and row triggers entirely; UPDATE/DELETE are revoked
-- alongside it for 058-style discipline.

SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'audit_log'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')),
  0,
  'anon + authenticated hold no UPDATE/DELETE/TRUNCATE privilege on audit_log'
);

-- ─── 3. fetch_audit_trail_page security (4) ─────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT ok(
  (SELECT p.prosecdef
     AND p.proconfig IS NOT NULL
     AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fetch_audit_trail_page'),
  'fetch_audit_trail_page is SECURITY DEFINER with pinned search_path'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.fetch_audit_trail_page(uuid, timestamptz, timestamptz, uuid, text, text, text, uuid, integer)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE fetch_audit_trail_page'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.fetch_audit_trail_page(uuid, timestamptz, timestamptz, uuid, text, text, text, uuid, integer)', 'EXECUTE'),
  true,
  'authenticated can EXECUTE fetch_audit_trail_page'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_function_privilege('service_role', 'public.fetch_audit_trail_page(uuid, timestamptz, timestamptz, uuid, text, text, text, uuid, integer)', 'EXECUTE'),
  true,
  'service_role can EXECUTE fetch_audit_trail_page'
);

-- ─── 4. BEHAVIORAL: cap, isolation, ordering, filters (8) ───────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

-- Hard cap: tenant B holds 121 rows; p_limit=500 must clamp to 100.
SELECT is(
  (SELECT count(*)::int FROM public.fetch_audit_trail_page(
     '22222222-2222-2222-2222-222222222222',
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, 500)),
  100,
  'fetch_audit_trail_page clamps p_limit to the hard cap of 100'
);

-- Tenant isolation: tenant A sees exactly its 3 rows even though the
-- definer function bypasses RLS (tenant B holds 121 more).
SELECT is(
  (SELECT count(*)::int FROM public.fetch_audit_trail_page(
     (SELECT f.tenant_id FROM audit_trail_fixture f),
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, 500)),
  3,
  'fetch_audit_trail_page returns only the requested tenant rows'
);

-- Newest-first ordering: tenant A's newest row is the 'updated' event.
SELECT is(
  (SELECT action FROM public.fetch_audit_trail_page(
     (SELECT f.tenant_id FROM audit_trail_fixture f),
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, 10)
   LIMIT 1),
  'updated',
  'fetch_audit_trail_page orders newest-first'
);

-- Reason projection: created event surfaces new_values->>'reason'.
SELECT is(
  (SELECT reason FROM public.fetch_audit_trail_page(
     (SELECT f.tenant_id FROM audit_trail_fixture f),
     NULL, NULL, NULL, 'created', NULL, NULL, NULL, 10)),
  'seed reason',
  'reason is projected from new_values->>reason'
);

-- Action filter.
SELECT is(
  (SELECT count(*)::int FROM public.fetch_audit_trail_page(
     (SELECT f.tenant_id FROM audit_trail_fixture f),
     NULL, NULL, NULL, 'created', NULL, NULL, NULL, 50)),
  1,
  'action filter returns only matching events'
);

-- Entity drill-down filter (type + id — the per-entity history view).
SELECT is(
  (SELECT count(*)::int FROM public.fetch_audit_trail_page(
     (SELECT f.tenant_id FROM audit_trail_fixture f),
     NULL, NULL, NULL, NULL, NULL, 'driver',
     (SELECT f.entity_id FROM audit_trail_fixture f), 50)),
  2,
  'entity type + id filter returns the full entity history'
);

-- Actor filter (users.id is resolved to the auth.users actor inside the RPC).
SELECT is(
  (SELECT count(*)::int FROM public.fetch_audit_trail_page(
     (SELECT f.tenant_id FROM audit_trail_fixture f),
     NULL, NULL, (SELECT f.user_id FROM audit_trail_fixture f),
     NULL, NULL, NULL, NULL, 50)),
  2,
  'actor filter excludes system events (NULL actor) and other actors'
);

-- Date-range filter: only the 1-hour-old event is inside the last 90 minutes.
SELECT is(
  (SELECT count(*)::int FROM public.fetch_audit_trail_page(
     (SELECT f.tenant_id FROM audit_trail_fixture f),
     now() - interval '90 minutes', NULL, NULL, NULL, NULL, NULL, NULL, 50)),
  1,
  'date-range filter (p_from) bounds the result set'
);

-- ─── 5. Append-only enforcement (5) ─────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);

SELECT throws_ok(
  $$UPDATE public.audit_log SET action = 'tampered' WHERE module = 'seed'$$,
  '42501', NULL,
  'authenticated UPDATE on audit_log is denied (grant revoked)'
);

SELECT throws_ok(
  $$DELETE FROM public.audit_log WHERE module = 'seed'$$,
  '42501', NULL,
  'authenticated DELETE on audit_log is denied (grant revoked)'
);

SELECT throws_ok(
  $$TRUNCATE public.audit_log$$,
  '42501', NULL,
  'authenticated TRUNCATE on audit_log is denied (bypasses RLS + row trigger)'
);

SELECT throws_ok(
  $$INSERT INTO public.audit_log (tenant_id, module, action)
    VALUES ('11111111-1111-1111-1111-111111111111', 'seed', 'forged')$$,
  '42501', NULL,
  'authenticated INSERT on audit_log is denied (no INSERT policy)'
);

RESET ROLE;
SET LOCAL ROLE postgres;
-- Privileged roles bypass RLS, so the 009 trigger remains the last guard.
SELECT throws_ok(
  $$UPDATE public.audit_log SET action = 'tampered' WHERE module = 'seed'$$,
  'P0001',
  'audit_log is immutable: UPDATE and DELETE are not permitted',
  'immutability trigger blocks privileged UPDATE (009)'
);

-- ─── 6. Role-scoped reads (2) ───────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.audit_log),
  0,
  'anon sees 0 audit rows (no policy grants anon access)'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"33333333-3333-3333-3333-333333333333"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.audit_log),
  3,
  'authenticated sees only their tenant audit rows (RLS tenant isolation)'
);

-- ─── Cleanup & finish ───────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT * FROM finish();
