-- 077 — Repository-wide RBAC completion, account state, grants, and RPC guards.
-- Runs in one disposable transaction via `supabase test db`.

BEGIN;

CREATE TEMP TABLE rbac_matrix (
  table_name text NOT NULL,
  command_name text NOT NULL,
  module_name text NOT NULL,
  action_name text NOT NULL,
  tenant_scoped boolean NOT NULL DEFAULT true,
  PRIMARY KEY (table_name, command_name, module_name, action_name)
);

WITH standard(table_name, module_name) AS (
  VALUES
    ('accounting_periods', 'accounting'),
    ('attendance_periods', 'attendance'),
    ('bank_accounts', 'accounting'),
    ('bank_reconciliations', 'accounting'),
    ('bank_transactions', 'accounting'),
    ('chart_of_accounts', 'accounting'),
    ('credit_notes', 'invoices'),
    ('customers', 'accounting'),
    ('daily_order_entries', 'platforms'),
    ('debit_notes', 'invoices'),
    ('delivery_platforms', 'platforms'),
    ('document_templates', 'templates'),
    ('driver_assets', 'drivers'),
    ('driver_attendance', 'attendance'),
    ('driver_calendar_events', 'attendance'),
    ('driver_cards', 'drivers'),
    ('driver_cod_sessions', 'platforms'),
    ('driver_compliance_overrides', 'drivers'),
    ('driver_consents', 'drivers'),
    ('driver_documents', 'drivers'),
    ('driver_emergency_contacts', 'drivers'),
    ('driver_leave_requests', 'attendance'),
    ('driver_onboarding_checklists', 'drivers'),
    ('driver_payroll_rules', 'payroll'),
    ('driver_salary_history', 'payroll'),
    ('driver_work_schedules', 'attendance'),
    ('drivers', 'drivers'),
    ('expense_category_mappings', 'accounting'),
    ('expenses', 'expenses'),
    ('external_fine_imports', 'violations'),
    ('finance_payments', 'accounting'),
    ('invoice_lines', 'invoices'),
    ('invoices', 'invoices'),
    ('leave_types', 'attendance'),
    ('monthly_driver_orders', 'platforms'),
    ('payables', 'accounting'),
    ('payment_allocations', 'accounting'),
    ('payroll_advances', 'payroll'),
    ('performance_reviews', 'hr'),
    ('platform_payments', 'platforms'),
    ('public_holidays', 'attendance'),
    ('receivables', 'accounting'),
    ('suppliers', 'accounting'),
    ('training_records', 'hr'),
    ('vat_adjustments', 'accounting'),
    ('vat_input_ledger', 'accounting'),
    ('vat_output_ledger', 'accounting'),
    ('vat_periods', 'accounting'),
    ('vehicle_assignments', 'assignments'),
    ('vehicle_documents', 'vehicles'),
    ('vehicle_handover_forms', 'assignments'),
    ('vehicle_maintenance_events', 'maintenance'),
    ('vehicle_odometer_logs', 'vehicles'),
    ('vehicles', 'vehicles'),
    ('violation_types', 'violations'),
    ('violations', 'violations')
)
INSERT INTO rbac_matrix (table_name, command_name, module_name, action_name)
SELECT table_name, command_name, module_name, action_name
FROM (
  SELECT table_name, 'SELECT' AS command_name, module_name, 'read' AS action_name FROM standard
  UNION ALL
  SELECT table_name, 'INSERT', module_name, 'create' FROM standard
  UNION ALL
  SELECT table_name, 'UPDATE', module_name, 'update' FROM standard
) matrix;

-- These four resources are append-only in the approved schema. They have no
-- UPDATE policy, so the matrix must not manufacture a write surface for them.
DELETE FROM rbac_matrix
WHERE command_name = 'UPDATE'
  AND table_name IN (
    'credit_notes', 'debit_notes', 'driver_salary_history',
    'vehicle_odometer_logs', 'driver_consents'
  );

INSERT INTO rbac_matrix
  (table_name, command_name, module_name, action_name, tenant_scoped)
VALUES
  ('audit_log', 'SELECT', 'audit_log', 'read', true),
  ('driver_application_documents', 'SELECT', 'hr', 'read', true),
  ('driver_applications', 'SELECT', 'hr', 'read', true),
  ('driver_attendance_summary', 'SELECT', 'attendance', 'read', true),
  ('driver_card_prints', 'SELECT', 'drivers', 'read', true),
  ('driver_card_prints', 'INSERT', 'drivers', 'print', true),
  ('driver_compliance_results', 'SELECT', 'drivers', 'read', true),
  ('driver_leave_balances', 'SELECT', 'attendance', 'read', true),
  ('financial_events', 'SELECT', 'accounting', 'read', true),
  ('generated_documents', 'SELECT', 'templates', 'read', true),
  ('invites', 'SELECT', 'users', 'read', true),
  ('journal_approvals', 'SELECT', 'accounting', 'read', true),
  ('journal_entries', 'SELECT', 'accounting', 'read', true),
  ('journal_entry_lines', 'SELECT', 'accounting', 'read', true),
  ('payroll_journal_entries', 'SELECT', 'payroll', 'read', true),
  ('permissions', 'SELECT', 'roles', 'read', false),
  ('report_generation_log', 'SELECT', 'reports', 'read', true),
  ('report_generation_log', 'INSERT', 'reports', 'export', true),
  ('roles', 'SELECT', 'roles', 'read', true),
  ('system_settings', 'SELECT', 'settings', 'read', true),
  ('system_settings', 'INSERT', 'settings', 'manage', true),
  ('system_settings', 'UPDATE', 'settings', 'manage', true),
  ('tenant_memberships', 'SELECT', 'users', 'read', true),
  ('tenants', 'SELECT', 'settings', 'read', true),
  ('tenants', 'UPDATE', 'settings', 'manage', true),
  ('user_role_assignments', 'SELECT', 'roles', 'read', true),
  ('users', 'SELECT', 'users', 'read', true),
  ('violation_deduction_ledger', 'SELECT', 'violations', 'read', true),
  ('zatca_transmissions', 'SELECT', 'accounting', 'read', true)
ON CONFLICT DO NOTHING;

-- A tenant-B role with no permissions makes denial assertions non-vacuous.
INSERT INTO public.roles
  (id, tenant_id, name, name_ar, name_en, is_system_role)
VALUES
  ('77000000-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   'readonly_auditor', 'No permissions', 'No permissions', false)
ON CONFLICT DO NOTHING;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '77000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'rbac-none@test.local',
  crypt('x', gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"_invite_provisioned":true}'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (
  id, auth_user_id, tenant_id, email, role, status,
  must_change_password
)
VALUES (
  '77000000-0000-4000-8000-000000000003',
  '77000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  'rbac-none@test.local', 'readonly_auditor', 'active', false
)
ON CONFLICT (id) DO UPDATE
SET status = 'active', deleted_at = NULL, locked_until = NULL,
    role = 'readonly_auditor';

INSERT INTO public.drivers
  (id, tenant_id, full_name_ar, primary_mobile, category, hire_date)
VALUES
  ('77000000-0000-4000-8000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'Tenant A driver', '+966500000771', 'freelancer', '2020-01-01'),
  ('77000000-0000-4000-8000-000000000012',
   '00000000-0000-0000-0000-000000000002',
   'Tenant B driver', '+966500000772', 'freelancer', '2020-01-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.driver_consents
  (tenant_id, driver_id, consent_type, version, accepted, accepted_at)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   '77000000-0000-4000-8000-000000000011', 'photo', '077', true, now()),
  ('00000000-0000-0000-0000-000000000001',
   '77000000-0000-4000-8000-000000000011', 'sensitive_docs', '077', true, now()),
  ('00000000-0000-0000-0000-000000000002',
   '77000000-0000-4000-8000-000000000012', 'photo', '077', true, now()),
  ('00000000-0000-0000-0000-000000000002',
   '77000000-0000-4000-8000-000000000012', 'sensitive_docs', '077', true, now())
ON CONFLICT DO NOTHING;

INSERT INTO public.user_consents
  (tenant_id, user_id, consent_type, version, accepted, accepted_at)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'terms', '077', true, now()),
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000002', 'terms', '077', true, now())
ON CONFLICT DO NOTHING;

SELECT plan((SELECT count(*)::integer * 9 FROM rbac_matrix) + 24);

-- Every approved row must have an authenticated policy with the exact key.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = m.table_name
      AND p.cmd = m.command_name
      AND 'authenticated' = ANY(p.roles)
      AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE
          ('%user_has_permission(''' || m.module_name || '''::text, ''' ||
           m.action_name || '''::text)%')
  ),
  format('%s %s requires %s:%s', m.table_name, m.command_name,
         m.module_name, m.action_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

-- Tenant resources must retain a caller-derived tenant boundary.
SELECT ok(
  NOT m.tenant_scoped OR EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = m.table_name
      AND p.cmd = m.command_name
      AND 'authenticated' = ANY(p.roles)
      AND (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
          LIKE '%get_my_tenant_id()%'
  ),
  format('%s %s remains caller-tenant bound', m.table_name, m.command_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

SELECT ok(
  has_table_privilege(
    'authenticated', format('public.%I', m.table_name), m.command_name
  ),
  format('authenticated has only the required %s grant on %s',
         m.command_name, m.table_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

SELECT ok(
  NOT has_table_privilege(
    'anon', format('public.%I', m.table_name), m.command_name
  ),
  format('anon lacks %s on %s', m.command_name, m.table_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.permissions p
    WHERE p.module = m.module_name AND p.action = m.action_name
  ),
  format('permission catalog contains %s:%s', m.module_name, m.action_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

-- General manager is the approved all-permissions role.
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT ok(
  public.user_has_permission(m.module_name, m.action_name),
  format('authorized role has %s:%s for %s %s', m.module_name,
         m.action_name, m.table_name, m.command_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

-- Active tenant-B role has no role_permissions rows.
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);
SELECT ok(
  NOT public.user_has_permission(m.module_name, m.action_name),
  format('insufficient role lacks %s:%s for %s %s', m.module_name,
         m.action_name, m.table_name, m.command_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'inactive'
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);
SELECT ok(
  NOT public.user_has_permission(m.module_name, m.action_name),
  format('inactive user lacks %s:%s for %s %s', m.module_name,
         m.action_name, m.table_name, m.command_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = now() + interval '1 hour'
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);
SELECT ok(
  NOT public.user_has_permission(m.module_name, m.action_name),
  format('locked user lacks %s:%s for %s %s', m.module_name,
         m.action_name, m.table_name, m.command_name)
)
FROM rbac_matrix m ORDER BY m.table_name, m.command_name;

-- Repository-wide structural and grant postconditions.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND 'authenticated' = ANY(p.roles)
      AND p.tablename NOT IN (
        'driver_application_platforms', 'platform_admins', 'platform_invoices'
      )
      AND (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
          NOT LIKE '%user_has_permission%'
      AND (COALESCE(p.qual, '') || COALESCE(p.with_check, ''))
          NOT LIKE '%auth.uid()%'
  ),
  'no unapproved broad authenticated policy remains'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('anon', 'authenticated')
      AND g.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
  ),
  'Data API roles have no TRUNCATE, TRIGGER, or REFERENCES grants'
);

SELECT is(
  has_table_privilege('authenticated', 'public.audit_log', 'INSERT'),
  false,
  'ordinary authenticated users cannot INSERT audit_log'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT lives_ok(
  $$INSERT INTO public.audit_log
      (tenant_id, actor_id, module, action, entity_type, entity_id)
    VALUES
      ('00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000001',
       'security', 'rbac_test', 'user',
       '00000000-0000-0000-0000-000000000001')$$,
  'service-role audit writer succeeds'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = NULL, deleted_at = NULL
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);

SELECT is(public.get_my_tenant_id(),
  '00000000-0000-0000-0000-000000000002'::uuid,
  'active user resolves their tenant');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'inactive'
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);
SELECT is(public.get_my_tenant_id(), NULL::uuid,
  'inactive user resolves no tenant');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = now() + interval '1 hour'
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);
SELECT is(public.get_my_tenant_id(), NULL::uuid,
  'locked user resolves no tenant');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET locked_until = NULL, deleted_at = now()
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);
SELECT is(public.get_my_tenant_id(), NULL::uuid,
  'deleted user resolves no tenant');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = NULL, deleted_at = NULL
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);
SELECT is(public.storage_path_in_current_tenant(
    '00000000-0000-0000-0000-000000000002/file.pdf'), true,
  'active user may address a valid own-tenant Storage path');
SELECT is(public.storage_path_in_current_tenant(
    '00000000-0000-0000-0000-000000000001/file.pdf'), false,
  'foreign-tenant Storage prefix is rejected');
SELECT is(public.storage_path_in_current_tenant(
    '00000000-0000-0000-0000-000000000002/../file.pdf'), false,
  'Storage path traversal is rejected');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'locked'
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);
SELECT is(public.storage_path_in_current_tenant(
    '00000000-0000-0000-0000-000000000002/file.pdf'), false,
  'disabled user is denied by the Storage tenant helper');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = NULL, deleted_at = NULL
WHERE auth_user_id = '77000000-0000-4000-8000-000000000002';
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('balance_sheet', 'cash_flow', 'profit_loss',
                       'trial_balance', 'vat_reconciliation',
                       'vehicle_active_documents')
     AND 'security_invoker=on' = ANY(c.reloptions)),
  6,
  'all application views execute with caller RLS'
);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'inactive'
WHERE auth_user_id = '00000000-0000-0000-0000-000000000001';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT is(
  (SELECT count(*)::integer FROM public.drivers
   WHERE tenant_id = '00000000-0000-0000-0000-000000000001'),
  0,
  'inactive user with a valid JWT sees zero Data API rows'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = now() + interval '1 hour'
WHERE auth_user_id = '00000000-0000-0000-0000-000000000001';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"00000000-0000-0000-0000-000000000001"}',
  true
);
SELECT is(
  (SELECT count(*)::integer FROM public.drivers
   WHERE tenant_id = '00000000-0000-0000-0000-000000000001'),
  0,
  'locked user with a valid JWT sees zero Data API rows'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.users SET status = 'active', locked_until = NULL
WHERE auth_user_id = '00000000-0000-0000-0000-000000000001';

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","aal":"aal2","sub":"77000000-0000-4000-8000-000000000002"}',
  true
);

SELECT is(public.has_pdpl_consent(
    '77000000-0000-4000-8000-000000000012'), false,
  'has_pdpl_consent denies same-tenant caller without drivers:read');
SELECT is(public.has_pdpl_consent(
    '77000000-0000-4000-8000-000000000011'), false,
  'has_pdpl_consent denies a cross-tenant caller');
SELECT is(public.has_user_pdpl_consent(
    '00000000-0000-0000-0000-000000000002', 'terms'), false,
  'has_user_pdpl_consent denies same-tenant caller without users:read');
SELECT is(public.has_user_pdpl_consent(
    '00000000-0000-0000-0000-000000000001', 'terms'), false,
  'has_user_pdpl_consent denies a cross-tenant caller');

SELECT throws_ok(
  $$SELECT public.validate_leave_request(
    '77000000-0000-4000-8000-000000000012', 'annual', 1, 2026)$$,
  '42501', 'AUTH008: attendance:create permission required',
  'validate_leave_request denies same-tenant caller without permission'
);
SELECT throws_ok(
  $$SELECT public.validate_leave_request(
    '77000000-0000-4000-8000-000000000011', 'annual', 1, 2026)$$,
  '42501', 'AUTH008: attendance:create permission required',
  'validate_leave_request denies cross-tenant caller'
);
SELECT throws_ok(
  $$SELECT public.next_employee_code(
    '00000000-0000-0000-0000-000000000002')$$,
  '42501', 'AUTH009: users:create permission required',
  'next_employee_code denies same-tenant caller without permission'
);
SELECT throws_ok(
  $$SELECT public.next_employee_code(
    '00000000-0000-0000-0000-000000000001')$$,
  '42501', 'AUTH009: users:create permission required',
  'next_employee_code denies cross-tenant caller'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege(
    'anon', 'public.storage_path_in_current_tenant(text)', 'EXECUTE'
  ),
  false,
  'anonymous role cannot execute the Storage tenant helper'
);

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT * FROM finish();
ROLLBACK;
