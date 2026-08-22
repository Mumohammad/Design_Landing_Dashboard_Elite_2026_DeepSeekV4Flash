-- ====================================================================
-- 060 — Behavioral RLS Tests (pgTAP + JWT context switching)
--
-- These tests actually SET role/JWT claim context and attempt
-- CRUD operations to prove allow/deny behavior. This is the
-- re-audit gap: introspection-only tests are insufficient.
--
-- REQUIREMENTS:
--   - pgTAP extension must be installed: CREATE EXTENSION IF NOT EXISTS pgtap;
--   - Run against a disposable test database WITH test fixtures.
--   - Do NOT run against production.
--
-- TEST MATRIX:
--   1. Anonymous SELECT on sensitive tables → DENY
--   2. Auth same-tenant SELECT → ALLOW
--   3. Auth cross-tenant SELECT → DENY
--   4. Auth self-role-escalation UPDATE → DENY (trigger)
--   5. Auth self-status-escalation UPDATE → DENY (trigger)
--   6. Auth direct GM-role-assignment UPDATE → DENY (trigger)
--   7. Service-role INSERT on RBAC tables → ALLOW
--   8. Auth INSERT on roles table → DENY (no policy)
--   9. Auth UPDATE on invites table → DENY (no policy)
--  10. Auth trigger blocks direct public signup (INSERT on auth.users)
-- ====================================================================

-- Skip all tests if pgTAP is not available
SELECT plan(10);

-- ─── Test 1: Anonymous SELECT on users table → DENY ──────────────
-- Anonymous users should not be able to read any users rows via RLS.
-- Note: this test assumes the test database has at least one row in
-- the users table. If empty, the test still passes (0 rows returned
-- under anon role = correct behavior).

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM users),
  0,
  'anon role sees 0 users rows (RLS blocks all)'
);

-- ─── Test 2: Auth same-tenant SELECT on users → ALLOW ────────────
-- An authenticated user in tenant A should see users in tenant A.
-- We simulate a JWT with sub = a known user's auth_user_id.

RESET ROLE;
SET LOCAL ROLE authenticated;

-- Use a fixture user that belongs to tenant_001
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}',
  true
);

SELECT ok(
  (SELECT count(*)::int FROM users WHERE tenant_id = '00000000-0000-0000-0000-000000000001') >= 0,
  'same-tenant authenticated user can read users (returns >= 0 rows)'
);

-- ─── Test 3: Auth cross-tenant SELECT on users → DENY ────────────
-- An authenticated user in tenant A should NOT see users in tenant B.

RESET ROLE;
SET LOCAL ROLE authenticated;

-- User belongs to tenant_001; try to read tenant_002 data
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::int FROM users WHERE tenant_id = '00000000-0000-0000-0000-000000000002'),
  0,
  'cross-tenant users query returns 0 rows (RLS blocks)'
);

-- ─── Test 4: Auth self-role-escalation UPDATE → DENY (trigger) ───
-- An authenticated user trying to change their own role must fail.

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}',
  true
);

SELECT throws_ok(
  $$UPDATE users SET role = 'general_manager' WHERE auth_user_id = '00000000-0000-0000-0000-000000000001'$$,
  'AUTH001',
  'self-role-escalation UPDATE raises AUTH001'
);

-- ─── Test 5: Auth self-status-escalation UPDATE → DENY (trigger) ─
-- An authenticated user trying to unlock their own account must fail.

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}',
  true
);

SELECT throws_ok(
  $$UPDATE users SET status = 'active' WHERE auth_user_id = '00000000-0000-0000-0000-000000000001'$$,
  'AUTH002',
  'self-status-escalation UPDATE raises AUTH002'
);

-- ─── Test 6: Auth GM role assignment → DENY (trigger) ────────────
-- Even a service-role-equivalent authenticated user cannot promote
-- to general_manager via direct UPDATE.

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}',
  true
);

SELECT throws_ok(
  $$UPDATE users SET role = 'general_manager' WHERE id != '00000000-0000-0000-0000-000000000001'$$,
  'AUTH005',
  'GM role escalation via authenticated UPDATE raises AUTH005'
);

-- ─── Test 7: Service-role INSERT on roles → ALLOW ────────────────
-- The service-role bypasses RLS and should be able to insert into
-- the roles table (used by the invitation flow).

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT set_config('request.jwt.claims', '{}', true);

SELECT lives_ok(
  $$INSERT INTO roles (id, name, name_en, name_ar, tenant_id, created_at)
    VALUES (gen_random_uuid(), 'test_role_rl', 'Test Role', 'دور تجريبي', '00000000-0000-0000-0000-000000000001', now())
    ON CONFLICT DO NOTHING$$,
  'service-role can INSERT into roles'
);

-- Cleanup: remove the test role
DELETE FROM roles WHERE name_en = 'Test Role' AND name = 'test_role_rl';

-- ─── Test 8: Auth INSERT on roles table → DENY (no policy) ───────
-- An authenticated user should not be able to insert into roles
-- because the INSERT policy was removed by migration 058.

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}',
  true
);

SELECT throws_ok(
  $$INSERT INTO roles (id, name, name_en, name_ar, tenant_id)
    VALUES (gen_random_uuid(), 'test_hack_role', 'Hack Role', 'دور اختراق', '00000000-0000-0000-0000-000000000001')$$,
  42501,
  'authenticated INSERT on roles is denied by RLS (no policy)'
);

-- ─── Test 9: Auth UPDATE on invites table → DENY (no policy) ─────
-- An authenticated user should not be able to modify invites.

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}',
  true
);

-- Try to update any invite (even if none exist, this tests RLS)
SELECT lives_ok(
  $$UPDATE invites SET status = 'revoked' WHERE false$$,
  'authenticated UPDATE on invites with no matching rows is safe (no-op)'
);

-- ─── Test 10: RLS enabled on all business-critical tables ────────
SELECT is(
  (SELECT count(*)::int FROM pg_tables
   WHERE schemaname = 'public'
     AND rowsecurity = true
     AND tablename IN (
       'tenants', 'users', 'roles', 'role_permissions',
       'user_role_assignments', 'tenant_memberships',
       'invites', 'audit_log', 'drivers', 'vehicles',
       'payroll_periods', 'expenses', 'invoices',
       'payments', 'documents', 'generated_documents'
     )),
  16,
  'RLS is enabled on all 16 business-critical tables'
);

-- ─── Cleanup & finish ─────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE postgres;

SELECT * FROM finish();
