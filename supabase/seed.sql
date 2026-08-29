-- ====================================================================
-- seed.sql — Test fixture data for pgTAP behavioral tests
--
-- Creates:
--   - 2 tenants (tenant_001, tenant_002)
--   - 2 auth.users entries (user_001 in tenant_001, user_002 in tenant_002)
--   - 2 public.users entries
--   - 2 roles (general_manager in each tenant)
--   - 2 tenant_memberships
--   - 2 user_role_assignments
--
-- UUIDs are deterministic so pgTAP tests can reference them:
--   tenant_001: 00000000-0000-0000-0000-000000000001
--   tenant_002: 00000000-0000-0000-0000-000000000002
--   user_001:   00000000-0000-0000-0000-000000000001 (auth_user_id)
--   user_002:   00000000-0000-0000-0000-000000000002 (auth_user_id)
--
-- This seed runs AFTER all migrations via `supabase db reset`.
-- ====================================================================

-- ═══════════════════════════════════════════════════════════════════
-- Auth trigger handling during seeding
--
-- DO NOT use ALTER TABLE auth.users DISABLE TRIGGER — that requires
-- OWNING auth.users (owned by supabase_auth_admin, not the migration role)
-- and fails with SQLSTATE 42501 "must be owner of table users".
--
-- Instead, fixture auth.users carry the "_invite_provisioned": true marker
-- in raw_user_meta_data — the hardened auth trigger (migration 060)
-- explicitly lets invite-provisioned inserts pass through, so seeding works
-- WITH the guard instead of around it.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- 1. Tenants
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO tenants (id, name_ar, name_en, legal_name, country, status, plan, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'شركة النخبة للنقل', 'Elite Transport Co.',
   'Elite Transport Company LLC', 'SA', 'active', 'single_tenant', now()),
  ('00000000-0000-0000-0000-000000000002', 'شركة الفجر للخدمات', 'Al Fajr Services Co.',
   'Al Fajr Services Company LLC', 'SA', 'active', 'single_tenant', now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Auth users (Supabase Auth)
-- ═══════════════════════════════════════════════════════════════════
-- These are the identities that auth.uid() returns.
-- The password hash is bcrypt of "Test1234!" — used only for testing.
-- raw_user_meta_data carries _invite_provisioned: true (see header note).

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, raw_app_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
)
VALUES
  -- User 001: admin of tenant_001
  (
    '00000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'admin@tenant001.test',
    crypt('Test1234!', gen_salt('bf')),
    now(),
    '{"full_name": "Admin User 001", "email": "admin@tenant001.test", "_invite_provisioned": true}'::jsonb,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    now(), now(), '', ''
  ),
  -- User 002: admin of tenant_002
  (
    '00000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'admin@tenant002.test',
    crypt('Test1234!', gen_salt('bf')),
    now(),
    '{"full_name": "Admin User 002", "email": "admin@tenant002.test", "_invite_provisioned": true}'::jsonb,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    now(), now(), '', ''
  )
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Public users (application users table)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO users (
  id, auth_user_id, tenant_id, email, full_name_en, full_name_ar,
  role, status, must_change_password, created_at, updated_at
)
VALUES
  -- User 001: general_manager in tenant_001
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'admin@tenant001.test',
    'Admin User 001',
    'المدير الأول',
    'general_manager',
    'active',
    false,
    now(), now()
  ),
  -- User 002: general_manager in tenant_002
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'admin@tenant002.test',
    'Admin User 002',
    'المدير الثاني',
    'general_manager',
    'active',
    false,
    now(), now()
  )
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Roles (general_manager in each tenant)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO roles (id, tenant_id, name, name_en, name_ar, is_system_role, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'general_manager', 'General Manager', 'المدير العام', true, now(), now()),
  ('00000000-0000-0000-0000-000000000020',
   '00000000-0000-0000-0000-000000000002',
   'general_manager', 'General Manager', 'المدير العام', true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 5. Tenant memberships
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO tenant_memberships (id, tenant_id, user_id, is_primary, joined_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   true, now(), now(), now()),
  ('00000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000002',
   true, now(), now(), now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 6. User role assignments
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO user_role_assignments (id, tenant_id, user_id, role_id, assigned_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010',
   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000020',
   now(), now(), now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 7. Permissions (system-wide catalog)
-- ═══════════════════════════════════════════════════════════════════
-- Ensure the permissions table has at least some rows for the
-- permissions_select_all policy test.
INSERT INTO permissions (id, module, action, description, created_at)
VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'drivers',   'read',   'View drivers',   now()),
  ('00000000-0000-0000-0000-0000000000f2', 'drivers',   'create', 'Create drivers', now()),
  ('00000000-0000-0000-0000-0000000000f3', 'payroll',   'read',   'View payroll',   now()),
  ('00000000-0000-0000-0000-0000000000f4', 'invoices',  'read',   'View invoices',  now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 8. System settings (at least one public, one private)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO system_settings (id, tenant_id, key, value, is_public, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-000000000001',
   'company_name', 'Elite Transport Co.', true, now(), now()),
  ('00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-000000000001',
   'api_key', 'sk-test-fake-key', false, now(), now()),
  ('00000000-0000-0000-0000-0000000000a3',
   '00000000-0000-0000-0000-000000000002',
   'company_name', 'Al Fajr Services Co.', true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 9. Audit log entries (at least one per tenant for SEL test)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO audit_log (id, tenant_id, actor_id, module, entity_type, entity_id, action, created_at)
VALUES
  ('00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'settings', 'system_setting', '00000000-0000-0000-0000-0000000000a1', 'created', now()),
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000002',
   'settings', 'system_setting', '00000000-0000-0000-0000-0000000000a3', 'created', now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 10. Some business table rows for cross-tenant SEL tests
-- ═══════════════════════════════════════════════════════════════════

-- Drivers
INSERT INTO drivers (id, tenant_id, first_name_en, first_name_ar, status, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-000000000001',
   'Ahmed', 'أحمد', 'active', now(), now()),
  ('00000000-0000-0000-0000-0000000000c2',
   '00000000-0000-0000-0000-000000000002',
   'Mohammed', 'محمد', 'active', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Vehicles
INSERT INTO vehicles (id, tenant_id, make, model, plate_number, status, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-000000000001',
   'Toyota', 'Camry', 'ABC-1234', 'active', now(), now()),
  ('00000000-0000-0000-0000-0000000000d2',
   '00000000-0000-0000-0000-000000000002',
   'Honda', 'Accord', 'XYZ-5678', 'active', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Expenses
INSERT INTO expenses (id, tenant_id, driver_id, expense_type, amount, expense_date, description, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c1',
   'fuel', 150.00, current_date, 'Fuel expense', now(), now()),
  ('00000000-0000-0000-0000-0000000000e2',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000c2',
   'maintenance', 200.00, current_date, 'Tire change', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Document templates
INSERT INTO document_templates (id, tenant_id, code, name_en, name_ar, category, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-000000000001',
   'HR-CONTRACT-001', 'Employment Contract', 'عقد عمل', 'hr', now(), now()),
  ('00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-000000000002',
   'HR-CONTRACT-001', 'Employment Contract', 'عقد عمل', 'hr', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Report generation log
INSERT INTO report_generation_log (id, tenant_id, report_type, report_params, output_format, generated_by, status, expires_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000g1',
   '00000000-0000-0000-0000-000000000001',
   'payroll_summary', '{}'::jsonb, 'pdf',
   '00000000-0000-0000-0000-000000000001',
   'completed', now() + interval '24 hours', now(), now()),
  ('00000000-0000-0000-0000-0000000000g2',
   '00000000-0000-0000-0000-000000000002',
   'payroll_summary', '{}'::jsonb, 'pdf',
   '00000000-0000-0000-0000-000000000002',
   'completed', now() + interval '24 hours', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- Done — seed data ready for pgTAP tests
-- (No trigger re-enable needed: the auth trigger was never disabled —
-- fixture users pass through via the _invite_provisioned marker.)
-- ═══════════════════════════════════════════════════════════════════