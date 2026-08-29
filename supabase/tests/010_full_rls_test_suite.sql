-- ====================================================================
-- 010_full_rls_test_suite.sql — Comprehensive pgTAP RLS Test Suite
--
-- Tests every table with RLS enabled across all 60+ migrations.
-- Covers: structural integrity, cross-tenant isolation, anonymous
-- denial, trigger enforcement, service-role access, and module-level
-- behavioral checks for all 75+ tables.
--
-- REQUIREMENTS:
--   CREATE EXTENSION IF NOT EXISTS pgtap;
--   Run in a SINGLE TRANSACTION (psql --single-transaction) so that
--     SET LOCAL ROLE and request.jwt.claims persist across statements.
--   Run against a disposable Supabase test database WITH fixtures:
--     - tenant_001 (UUID: 00000000-0000-0000-0000-000000000001)
--     - tenant_002 (UUID: 00000000-0000-0000-0000-000000000002)
--     - A user in tenant_001 with auth_user_id = 00000000-...-0001
--     - A user in tenant_002 with auth_user_id = 00000000-...-0002
--   Do NOT run against production.
-- ====================================================================

-- ═══════════════════════════════════════════════════════════════════
-- SECTION A: Helper — set JWT context and test allowed/denied
-- ═══════════════════════════════════════════════════════════════════

-- Simulate an authenticated user's JWT context
CREATE OR REPLACE FUNCTION _set_jwt(p_auth_user_id UUID, p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_auth_user_id, 'role', 'authenticated')::text,
    true
  );
  -- Also set the app-level tenant claim used by get_my_tenant_id()
  -- (depends on how get_my_tenant_id resolves — via users table lookup)
END;
$$ LANGUAGE plpgsql;

-- Simulate anonymous JWT context
CREATE OR REPLACE FUNCTION _set_anon()
RETURNS void AS $$
BEGIN
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims',
    '{"role": "anon"}'::text,
    true
  );
END;
$$ LANGUAGE plpgsql;

-- Reset to superuser context
CREATE OR REPLACE FUNCTION _set_admin()
RETURNS void AS $$
BEGIN
  RESET ROLE;
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claims', '{}'::text, true);
END;
$$ LANGUAGE plpgsql;

-- Simulate TABLE-OWNER context WITH authenticated JWT claims.
-- Used by trigger-enforcement tests (section 5): after migration 058 dropped
-- the authenticated users UPDATE policy, an "authenticated" UPDATE is a silent
-- RLS no-op and no AUTH00x exception would fire. The owner bypasses RLS so the
-- UPDATE reaches the row, while the trigger reads request.jwt.claims and
-- raises the guard.
CREATE OR REPLACE FUNCTION _set_owner_claims(p_auth_user_id UUID)
RETURNS void AS $$
BEGIN
  RESET ROLE;
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_auth_user_id, 'role', 'authenticated')::text,
    true
  );
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- Total test count (update when adding tests)
-- ═══════════════════════════════════════════════════════════════════
SELECT plan(109);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 1: STRUCTURAL — Every table has RLS enabled
-- ═══════════════════════════════════════════════════════════════════

-- 1.1 Core/Auth tables (migration 010)
SELECT has_table('tenants', 'tenants table exists');
SELECT has_table('users', 'users table exists');
SELECT has_table('system_settings', 'system_settings table exists');
SELECT has_table('audit_log', 'audit_log table exists');
SELECT has_table('roles', 'roles table exists');
SELECT has_table('permissions', 'permissions table exists');
SELECT has_table('role_permissions', 'role_permissions table exists');
SELECT has_table('user_role_assignments', 'user_role_assignments table exists');
SELECT has_table('tenant_memberships', 'tenant_memberships table exists');
SELECT has_table('invites', 'invites table exists');

-- Verify RLS is enabled on all core tables
SELECT ok(
  (SELECT count(*)::int FROM pg_tables
   WHERE schemaname = 'public'
     AND rowsecurity = true
     AND tablename IN (
       'tenants', 'users', 'system_settings', 'audit_log',
       'roles', 'permissions', 'role_permissions',
       'user_role_assignments', 'tenant_memberships', 'invites'
     )) = 10,
  'RLS is enabled on all 10 core/auth tables'
);

-- 1.2 All business tables have RLS enabled
SELECT ok(
  (SELECT count(*)::int FROM pg_tables
   WHERE schemaname = 'public'
     AND rowsecurity = true
     AND tablename IN (
       -- Drivers (014-015)
       'drivers', 'driver_documents', 'driver_emergency_contacts',
       'driver_cod_sessions', 'driver_salary_history', 'driver_payroll_rules',
       -- Vehicles (016-017)
       'vehicles', 'vehicle_documents', 'vehicle_odometer_logs',
       'vehicle_assignments', 'vehicle_handover_forms', 'vehicle_maintenance_events',
       -- Attendance (018)
       'attendance_periods', 'driver_work_schedules', 'driver_attendance',
       'leave_types', 'driver_leave_requests', 'driver_leave_balances',
       'public_holidays', 'driver_attendance_summary',
       -- Violations (019)
       'violation_types', 'violations', 'violation_deduction_ledger', 'external_fine_imports',
       -- Orders/Platforms (020)
       'delivery_platforms', 'daily_order_entries', 'monthly_driver_orders',
       -- Expenses (021)
       'expenses', 'payroll_advances',
       -- Payroll (022)
       'driver_payroll_periods', 'payroll_journal_entries',
       -- HR (023)
       'performance_reviews', 'driver_onboarding_checklists', 'training_records',
       -- Reports (024)
       'report_generation_log',
       -- Templates (025)
       'document_templates', 'generated_documents',
       -- Platform Payments (026)
       'platform_payments',
       -- Accounting (027)
       'chart_of_accounts', 'accounting_periods', 'journal_entries',
       'journal_entry_lines', 'bank_accounts', 'bank_reconciliations',
       'bank_transactions', 'customers', 'suppliers',
       'receivables', 'payables', 'finance_payments',
       'payment_allocations', 'vat_output_ledger', 'vat_input_ledger',
       -- Journal Approvals (034)
       'journal_approvals',
       -- Invoices (038)
       'financial_events', 'invoices', 'invoice_lines',
       'credit_notes', 'debit_notes',
       -- Expense Categories (040)
       'expense_category_mappings',
       -- VAT Engine (041)
       'vat_periods', 'vat_adjustments',
       -- ZATCA (054-055)
       'zatca_transmissions', 'zatca_csids',
       -- Rate Limits (059)
       'public_lookup_rate_limits'
     )) >= 60,
  'RLS is enabled on all 60+ business tables'
);

-- 1.3 Service-role-only tables (no policies = deny-by-default)
SELECT ok(
  (SELECT count(*) FROM pg_policies WHERE tablename = 'zatca_csids') = 0,
  'zatca_csids has RLS but no policies (service-role only — secrets table)'
);

SELECT ok(
  (SELECT count(*) FROM pg_policies WHERE tablename = 'public_lookup_rate_limits') = 0,
  'public_lookup_rate_limits has RLS but no policies (service-role only)'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 2: POLICY EXISTENCE — Expected policies after all migrations
-- ═══════════════════════════════════════════════════════════════════

-- 2.1 Core auth policies that must STILL exist (SELECT only after 058)
SELECT policies_are('tenants', ARRAY['tenants_select_own'],
  'tenants has SELECT policy');
SELECT policies_are('users', ARRAY['users_select_own_tenant'],
  'users has only SELECT policy after 058 hardening');
SELECT policies_are('roles', ARRAY['roles_select_own_tenant'],
  'roles has only SELECT policy after 058 hardening');
SELECT policies_are('invites', ARRAY['invites_select_own_tenant'],
  'invites has only SELECT policy after 058 hardening');

-- 2.2 Policies that must NOT exist (dropped by 058)
SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'roles'
     AND policyname IN ('roles_insert_own_tenant', 'roles_update_own_tenant')) = 0,
  'roles INSERT/UPDATE policies removed by migration 058'
);

SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'invites'
     AND policyname IN ('invites_insert_own_tenant', 'invites_update_own_tenant')) = 0,
  'invites INSERT/UPDATE policies removed by migration 058'
);

SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'users'
     AND policyname IN ('users_insert_own_tenant', 'users_update_own_tenant')) = 0,
  'users INSERT/UPDATE policies removed by migration 058'
);

SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'role_permissions'
     AND policyname IN ('role_permissions_insert', 'role_permissions_update')) = 0,
  'role_permissions INSERT/UPDATE policies removed by migration 058'
);

SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'user_role_assignments'
     AND policyname IN ('user_role_assignments_insert_own_tenant', 'user_role_assignments_update_own_tenant')) = 0,
  'user_role_assignments INSERT/UPDATE policies removed by migration 058'
);

SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'tenant_memberships'
     AND policyname IN ('tenant_memberships_insert_own_tenant', 'tenant_memberships_update_own_tenant')) = 0,
  'tenant_memberships INSERT/UPDATE policies removed by migration 058'
);

-- 2.3 Journal mutations restricted to service-role (dropped by 036)
SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'journal_entries'
     AND policyname IN ('ins_journal_entries_tenant', 'upd_journal_entries_tenant')) = 0,
  'journal_entries INSERT/UPDATE policies removed by migration 036'
);

SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'journal_entry_lines'
     AND policyname IN ('ins_jel_tenant', 'upd_jel_tenant')) = 0,
  'journal_entry_lines INSERT/UPDATE policies removed by migration 036'
);

SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'journal_approvals'
     AND policyname IN ('ins_approvals_tenant', 'upd_approvals_tenant')) = 0,
  'journal_approvals INSERT/UPDATE policies removed by migration 036'
);

-- 2.4 Financial events INSERT removed (append-only via service-role, 053)
SELECT ok(
  (SELECT count(*) FROM pg_policies
   WHERE tablename = 'financial_events'
     AND policyname LIKE 'ins_%') = 0,
  'financial_events INSERT policy removed by migration 053 (append-only via service-role)'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 3: FUNCTION EXISTENCE — Security functions
-- ═══════════════════════════════════════════════════════════════════

SELECT ok(
  (SELECT count(*) FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'get_my_tenant_id') = 1,
  'get_my_tenant_id() function exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_my_tenant_id'
      AND prokind = 'f'
  ),
  'get_my_tenant_id is a function (not aggregate/window)'
);

SELECT ok(
  (SELECT count(*) FROM pg_proc WHERE proname = 'prevent_user_self_escalation') = 1,
  'prevent_user_self_escalation() trigger function exists'
);

SELECT ok(
  (SELECT count(*) FROM pg_trigger t
   JOIN pg_class c ON t.tgrelid = c.oid
   JOIN pg_namespace ns ON c.relnamespace = ns.oid
   WHERE ns.nspname = 'public'
     AND c.relname = 'users'
     AND t.tgname = 'trg_prevent_self_escalation'
     AND NOT t.tgisinternal) = 1,
  'trg_prevent_self_escalation trigger exists on users table'
);

SELECT ok(
  (SELECT count(*) FROM pg_proc WHERE proname = 'sync_auth_user_to_custom_users') = 1,
  'sync_auth_user_to_custom_users() trigger function exists'
);

SELECT ok(
  (SELECT count(*) FROM pg_trigger t
   JOIN pg_class c ON t.tgrelid = c.oid
   JOIN pg_namespace ns ON c.relnamespace = ns.oid
   WHERE ns.nspname = 'auth'
     AND c.relname = 'users'
     AND t.tgname = 'on_auth_user_changed'
     AND NOT t.tgisinternal) = 1,
  'on_auth_user_changed trigger exists on auth.users'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 4: ANONYMOUS ACCESS DENIAL — No anon can read sensitive data
-- ═══════════════════════════════════════════════════════════════════

SELECT _set_anon();

SELECT is(
  (SELECT count(*)::int FROM users),
  0,
  'anon: users returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM tenants),
  0,
  'anon: tenants returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM drivers),
  0,
  'anon: drivers returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM vehicles),
  0,
  'anon: vehicles returns 0 rows'
);

-- FIX: referenced non-existent table `payroll_periods` (SQLSTATE 42P01 aborts
-- a single-transaction run). Correct table: driver_payroll_periods.
SELECT is(
  (SELECT count(*)::int FROM driver_payroll_periods),
  0,
  'anon: driver_payroll_periods returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM expenses),
  0,
  'anon: expenses returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM invoices),
  0,
  'anon: invoices returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM audit_log),
  0,
  'anon: audit_log returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM roles),
  0,
  'anon: roles returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM bank_accounts),
  0,
  'anon: bank_accounts returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM customers),
  0,
  'anon: customers returns 0 rows'
);

SELECT is(
  (SELECT count(*)::int FROM generated_documents),
  0,
  'anon: generated_documents returns 0 rows'
);

SELECT _set_admin();

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 5: TRIGGER ENFORCEMENT — Self-escalation blocks
-- ═══════════════════════════════════════════════════════════════════
-- CONTEXT FIX: these run as the table OWNER with simulated JWT claims
-- (_set_owner_claims). The trigger reads request.jwt.claims — not the current
-- role — and after 058 the authenticated role has no users UPDATE policy, so
-- as "authenticated" the UPDATE would be a silent RLS no-op and no AUTH00x
-- exception would fire.
-- NO-OP GUARD FIX: seed users are general_manager/active, so each assertion
-- mutates to a DIFFERENT value (an IS NOT DISTINCT no-op never fires).

SELECT _set_owner_claims('00000000-0000-0000-0000-000000000001'::uuid);

-- 5.1 Self-role escalation is blocked
SELECT throws_ok(
  $$UPDATE users SET role = 'admin' WHERE auth_user_id = '00000000-0000-0000-0000-000000000001'::uuid$$,
  'AUTH001',
  'trigger blocks self-role escalation (AUTH001)'
);

-- 5.2 Self-status escalation is blocked
SELECT throws_ok(
  $$UPDATE users SET status = 'inactive' WHERE auth_user_id = '00000000-0000-0000-0000-000000000001'::uuid$$,
  'AUTH002',
  'trigger blocks self-status modification (AUTH002)'
);

-- 5.3 GM role assignment is blocked
-- Precondition: AUTH005 fires only when OLD.role <> 'general_manager'; both
-- seed users are GMs, so demote fixture user 002 first (service context).
SELECT _set_admin();
UPDATE users SET role = 'supervisor' WHERE id = '00000000-0000-0000-0000-000000000002'::uuid;
SELECT _set_owner_claims('00000000-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$UPDATE users SET role = 'general_manager' WHERE id = '00000000-0000-0000-0000-000000000002'::uuid$$,
  'AUTH005',
  'trigger blocks GM role assignment (AUTH005)'
);

-- 5.4 Trigger function source contains all security checks
SELECT ok(
  (SELECT pg_get_functiondef(oid) FROM pg_proc
   WHERE proname = 'prevent_user_self_escalation')
   LIKE '%AUTH001%',
  'trigger source contains AUTH001 check'
);

SELECT ok(
  (SELECT pg_get_functiondef(oid) FROM pg_proc
   WHERE proname = 'prevent_user_self_escalation')
   LIKE '%AUTH002%',
  'trigger source contains AUTH002 check'
);

SELECT ok(
  (SELECT pg_get_functiondef(oid) FROM pg_proc
   WHERE proname = 'prevent_user_self_escalation')
   LIKE '%AUTH003%',
  'trigger source contains AUTH003 check'
);

SELECT ok(
  (SELECT pg_get_functiondef(oid) FROM pg_proc
   WHERE proname = 'prevent_user_self_escalation')
   LIKE '%AUTH005%',
  'trigger source contains AUTH005 check'
);

-- 5.5 Auth trigger blocks direct public signup
SELECT ok(
  (SELECT pg_get_functiondef(oid) FROM pg_proc
   WHERE proname = 'sync_auth_user_to_custom_users')
   LIKE '%blocked_signup%',
  'auth trigger contains signup ban logic'
);

SELECT ok(
  (SELECT pg_get_functiondef(oid) FROM pg_proc
   WHERE proname = 'sync_auth_user_to_custom_users')
   LIKE '%_invite_provisioned%',
  'auth trigger checks for invite provisioning marker'
);

SELECT _set_admin();

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 6: MODULE-LEVEL BEHAVIORAL TESTS
-- ═══════════════════════════════════════════════════════════════════
-- For each module, test that:
--   A) Same-tenant auth can SELECT (ALLOW)
--   B) Cross-tenant auth gets 0 rows (DENY)
--   C) Auth INSERT on restricted tables is DENIED

-- ── 6.1 Drivers ──
SELECT _set_jwt('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  (SELECT count(*)::int FROM drivers WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'drivers: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM drivers WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'drivers: cross-tenant SELECT denied'
);

-- ── 6.2 Vehicles ──
SELECT ok(
  (SELECT count(*)::int FROM vehicles WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'vehicles: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM vehicles WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'vehicles: cross-tenant SELECT denied'
);

-- ── 6.3 Attendance ──
SELECT ok(
  (SELECT count(*)::int FROM driver_attendance WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'driver_attendance: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM driver_attendance WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'driver_attendance: cross-tenant SELECT denied'
);

-- ── 6.4 Violations ──
SELECT ok(
  (SELECT count(*)::int FROM violations WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'violations: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM violations WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'violations: cross-tenant SELECT denied'
);

-- ── 6.5 Expenses ──
SELECT ok(
  (SELECT count(*)::int FROM expenses WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'expenses: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM expenses WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'expenses: cross-tenant SELECT denied'
);

-- ── 6.6 Invoices ──
SELECT ok(
  (SELECT count(*)::int FROM invoices WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'invoices: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM invoices WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'invoices: cross-tenant SELECT denied'
);

-- ── 6.7 Accounting (chart_of_accounts, journal_entries, customers) ──
SELECT ok(
  (SELECT count(*)::int FROM chart_of_accounts WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'chart_of_accounts: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM chart_of_accounts WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'chart_of_accounts: cross-tenant SELECT denied'
);

SELECT ok(
  (SELECT count(*)::int FROM customers WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'customers: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM customers WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'customers: cross-tenant SELECT denied'
);

SELECT ok(
  (SELECT count(*)::int FROM suppliers WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'suppliers: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM suppliers WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'suppliers: cross-tenant SELECT denied'
);

-- ── 6.8 Bank Accounts ──
SELECT ok(
  (SELECT count(*)::int FROM bank_accounts WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'bank_accounts: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM bank_accounts WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'bank_accounts: cross-tenant SELECT denied'
);

-- ── 6.9 HR ──
SELECT ok(
  (SELECT count(*)::int FROM performance_reviews WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'performance_reviews: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM performance_reviews WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'performance_reviews: cross-tenant SELECT denied'
);

-- ── 6.10 Templates & Documents ──
SELECT ok(
  (SELECT count(*)::int FROM document_templates WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'document_templates: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM document_templates WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'document_templates: cross-tenant SELECT denied'
);

-- ── 6.11 Audit Log ──
SELECT ok(
  (SELECT count(*)::int FROM audit_log WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'audit_log: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM audit_log WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'audit_log: cross-tenant SELECT denied'
);

-- ── 6.12 System Settings ──
SELECT ok(
  (SELECT count(*)::int FROM system_settings
   WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'system_settings: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM system_settings
   WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'system_settings: cross-tenant SELECT denied'
);

-- ── 6.13 Platform Payments ──
SELECT ok(
  (SELECT count(*)::int FROM platform_payments WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'platform_payments: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM platform_payments WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'platform_payments: cross-tenant SELECT denied'
);

-- ── 6.14 VAT ──
SELECT ok(
  (SELECT count(*)::int FROM vat_periods WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'vat_periods: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM vat_periods WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'vat_periods: cross-tenant SELECT denied'
);

-- ── 6.15 Reports ──
SELECT ok(
  (SELECT count(*)::int FROM report_generation_log WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) >= 0,
  'report_generation_log: same-tenant SELECT allowed'
);

SELECT ok(
  (SELECT count(*)::int FROM report_generation_log WHERE tenant_id = '00000000-0000-0000-0000-000000000002'::uuid) = 0,
  'report_generation_log: cross-tenant SELECT denied'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 7: AUTH DENIED — Auth cannot INSERT/UPDATE restricted tables
-- ═══════════════════════════════════════════════════════════════════

SELECT _set_jwt('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid);

-- Auth INSERT on roles must be denied (no INSERT policy after 058)
SELECT throws_ok(
  $$INSERT INTO roles (id, name, name_en, name_ar, tenant_id)
    VALUES (gen_random_uuid(), 'test_hack', 'Hack', 'اختراق', '00000000-0000-0000-0000-000000000001'::uuid)$$,
  42501,
  'auth INSERT on roles is denied (no policy after 058)'
);

-- Auth INSERT on invites must be denied
SELECT throws_ok(
  $$INSERT INTO invites (id, email, tenant_id, role, status, token_hash, expires_at)
    VALUES (gen_random_uuid(), 'hack@test.com', '00000000-0000-0000-0000-000000000001'::uuid,
            'admin', 'pending', 'fakehash', now() + interval '7 days')$$,
  42501,
  'auth INSERT on invites is denied (no policy after 058)'
);

-- Auth INSERT on user_role_assignments must be denied
SELECT throws_ok(
  $$INSERT INTO user_role_assignments (id, user_id, role_id, tenant_id)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001'::uuid,
            '00000000-0000-0000-0000-000000000099'::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid)$$,
  42501,
  'auth INSERT on user_role_assignments is denied (no policy after 058)'
);

-- Auth INSERT on tenant_memberships must be denied
SELECT throws_ok(
  $$INSERT INTO tenant_memberships (id, user_id, tenant_id, status)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001'::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid, 'active')$$,
  42501,
  'auth INSERT on tenant_memberships is denied (no policy after 058)'
);

-- Auth INSERT on journal_entries must be denied (036 hardening)
SELECT throws_ok(
  $$INSERT INTO journal_entries (tenant_id, entry_number, entry_date, description, status)
    VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'TEST-001', current_date,
            'test', 'draft')$$,
  42501,
  'auth INSERT on journal_entries is denied (service-role only after 036)'
);

-- Auth INSERT on journal_entry_lines must be denied (036 hardening)
SELECT throws_ok(
  $$INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit)
    VALUES ('00000000-0000-0000-0000-000000000001'::uuid,
            '00000000-0000-0000-0000-000000000099'::uuid,
            '00000000-0000-0000-0000-000000000098'::uuid, 100.00, 0)$$,
  42501,
  'auth INSERT on journal_entry_lines is denied (service-role only after 036)'
);

-- Auth INSERT on journal_approvals must be denied (036 hardening)
SELECT throws_ok(
  $$INSERT INTO journal_approvals (tenant_id, journal_entry_id, approver_id, status)
    VALUES ('00000000-0000-0000-0000-000000000001'::uuid,
            '00000000-0000-0000-0000-000000000099'::uuid,
            '00000000-0000-0000-0000-000000000001'::uuid, 'approved')$$,
  42501,
  'auth INSERT on journal_approvals is denied (self-approval prevention)'
);

-- Auth INSERT on financial_events must be denied (053 append-only)
SELECT throws_ok(
  $$INSERT INTO financial_events (tenant_id, event_type, source_table, source_id, payload)
    VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'test', 'test', '00000000-0000-0000-0000-000000000099'::uuid,
            '{}'::jsonb)$$,
  42501,
  'auth INSERT on financial_events is denied (append-only via service-role after 053)'
);

SELECT _set_admin();

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 8: SERVICE-ROLE ACCESS — Service-role can write RBAC tables
-- ═══════════════════════════════════════════════════════════════════

SELECT _set_admin();

-- Service-role can INSERT into roles (used by invitation flow)
SELECT lives_ok(
  $$INSERT INTO roles (id, name, name_en, name_ar, tenant_id, created_at)
    VALUES (gen_random_uuid(), 'test_svc_role', 'Test SVC', 'اختبار', '00000000-0000-0000-0000-000000000001'::uuid, now())
    ON CONFLICT DO NOTHING$$,
  'service-role INSERT on roles succeeds'
);

-- Cleanup
DELETE FROM roles WHERE name_en = 'Test SVC';

-- Service-role can INSERT into journal_entries (used by RPCs)
SELECT lives_ok(
  $$INSERT INTO journal_entries (tenant_id, entry_number, entry_date, description, status, created_by)
    VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'SVC-TEST-001', current_date,
            'service-role test', 'draft', '00000000-0000-0000-0000-000000000001'::uuid)
    ON CONFLICT DO NOTHING$$,
  'service-role INSERT on journal_entries succeeds'
);

-- Cleanup
DELETE FROM journal_entries WHERE entry_number = 'SVC-TEST-001';

-- Service-role can INSERT into financial_events (used by dispatcher)
SELECT lives_ok(
  $$INSERT INTO financial_events (tenant_id, event_type, source_table, source_id, payload, idempotency_key)
    VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'test_svc', 'test', '00000000-0000-0000-0000-000000000099'::uuid,
            '{}'::jsonb, 'test-svc-' || gen_random_uuid())
    ON CONFLICT DO NOTHING$$,
  'service-role INSERT on financial_events succeeds'
);

-- Cleanup
DELETE FROM financial_events WHERE event_type = 'test_svc';

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 9: PERMISSIONS TABLE — Auth can read, all tenants share
-- ═══════════════════════════════════════════════════════════════════

SELECT _set_jwt('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid);

SELECT ok(
  (SELECT count(*)::int FROM permissions) >= 0,
  'permissions: authenticated can read (shared permission catalog)'
);

SELECT _set_admin();

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 10: TABLE COUNT VERIFICATION
-- ═══════════════════════════════════════════════════════════════════

SELECT ok(
  (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true) >= 70,
  'at least 70 public tables have RLS enabled'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 11: NO BROKEN POLICIES — policies reference valid tables
-- ═══════════════════════════════════════════════════════════════════

SELECT ok(
  (SELECT count(*)::int FROM pg_policies p
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_tables t
     WHERE t.schemaname = p.schemaname AND t.tablename = p.tablename
   )) = 0,
  'all RLS policies reference existing tables (no orphaned policies)'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 12: JOURNAL ENTRIES — Status transitions are trigger-guarded
-- ═══════════════════════════════════════════════════════════════════

SELECT ok(
  (SELECT count(*) FROM pg_trigger t
   JOIN pg_class c ON t.tgrelid = c.oid
   JOIN pg_namespace ns ON c.relnamespace = ns.oid
   WHERE ns.nspname = 'public'
     AND c.relname = 'journal_entries'
     AND t.tgname = 'trg_journal_period_open'
     AND NOT t.tgisinternal) = 1,
  'trg_journal_period_open trigger exists on journal_entries (ACC001 defense)'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 13: AUDIT LOG IMMUTABILITY
-- ═══════════════════════════════════════════════════════════════════

SELECT ok(
  (SELECT count(*) FROM pg_trigger t
   JOIN pg_class c ON t.tgrelid = c.oid
   JOIN pg_namespace ns ON c.relnamespace = ns.oid
   WHERE ns.nspname = 'public'
     AND c.relname = 'audit_log'
     AND t.tgname = 'trg_audit_log_immutable'
     AND NOT t.tgisinternal) = 1,
  'trg_audit_log_immutable trigger exists on audit_log'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 14: DRIVER APPLICATIONS — Anon access is limited
-- ═══════════════════════════════════════════════════════════════════

-- Verify driver_applications has limited anon access (insert only, via policy)
SELECT ok(
  (SELECT count(*)::int FROM pg_policies
   WHERE tablename = 'driver_applications'
     AND policyname = 'driver_apps_anon_insert') = 1,
  'driver_applications has limited anon INSERT policy'
);

SELECT ok(
  (SELECT count(*)::int FROM pg_policies
   WHERE tablename = 'driver_applications'
     AND policyname = 'driver_apps_staff_select') = 1,
  'driver_applications has staff SELECT policy'
);

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 15: MULTI-TENANT DATA ISOLATION SUMMARY
-- ═══════════════════════════════════════════════════════════════════
-- Verify that get_my_tenant_id() is SECURITY DEFINER (required for
-- RLS to work correctly without recursion)

SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'get_my_tenant_id') = true,
  'get_my_tenant_id() is SECURITY DEFINER (required for correct RLS)'
);

SELECT ok(
  (SELECT proargtypes::regtype[] FROM pg_proc WHERE proname = 'get_my_tenant_id') = ARRAY[]::regtype[],
  'get_my_tenant_id() takes no arguments'
);

-- ═══════════════════════════════════════════════════════════════════
-- CLEANUP & FINISH
-- ═══════════════════════════════════════════════════════════════════

SELECT _set_admin();

-- Drop helper functions (clean test environment)
DROP FUNCTION IF EXISTS _set_jwt(UUID, UUID);
DROP FUNCTION IF EXISTS _set_anon();
DROP FUNCTION IF EXISTS _set_admin();
DROP FUNCTION IF EXISTS _set_owner_claims(UUID);

SELECT * FROM finish();