-- ====================================================================
-- seed.sql — MINIMAL validated fixture set for pgTAP behavioral tests
--
-- Provides exactly what the RLS suites need:
--   - 2 tenants (tenant_001, tenant_002)
--   - 2 auth.users + 2 public.users (general_manager per tenant)
--   - 2 roles + 2 tenant_memberships + 2 user_role_assignments
--   - 4 permissions (shared catalog)
--
-- UUIDs are deterministic so pgTAP tests can reference them:
--   tenant_001 / tenant_002: 00000000-...-0001 / ...-0002
--   user_001   / user_002:   00000000-...-0001 / ...-0002 (auth_user_id)
--
-- SCOPE NOTE (round-9/10 CI): earlier, richer sections (system_settings,
-- audit_log, drivers/vehicles/expenses/templates/reports) were REMOVED —
-- they were written against an imagined schema (system_settings missed the
-- NOT NULL `category` column → 23502; drivers used first_name_* while the
-- real table has full_name_* → 42703). TODO: re-introduce business fixtures
-- written strictly against the real migration schemas.
--
-- IDEMPOTENCY: every INSERT uses plain ON CONFLICT DO NOTHING (earlier
-- migrations like 013_seed_defaults may pre-seed some of these rows),
-- and role assignments resolve role_id by natural key (tenant_id + name).
--
-- AUTH TRIGGER: fixture auth.users carry "_invite_provisioned": true in
-- raw_user_meta_data so the hardened trigger (060) lets them pass. NEVER
-- ALTER TABLE auth.users DISABLE TRIGGER (requires ownership → 42501).
-- ====================================================================

-- ═══════════════════════════════════════════════════════════════════
-- 1. Tenants
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO tenants (id, name_ar, name_en, legal_name, country, status, plan, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'شركة النخبة للنقل', 'Elite Transport Co.',
   'Elite Transport Company LLC', 'SA', 'active', 'single_tenant', now()),
  ('00000000-0000-0000-0000-000000000002', 'شركة الفجر للخدمات', 'Al Fajr Services Co.',
   'Al Fajr Services Company LLC', 'SA', 'active', 'single_tenant', now())
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Auth users (Supabase Auth)
--    Password hash = bcrypt of "Test1234!" (testing only).
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, raw_app_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
)
VALUES
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
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Public users (application users table)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO users (
  id, auth_user_id, tenant_id, email, full_name_en, full_name_ar,
  role, status, must_change_password, created_at, updated_at
)
VALUES
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
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Roles (general_manager per tenant)
--    May already exist from 013_seed_defaults → plain ON CONFLICT DO NOTHING
--    (covers idx_roles_tenant_name, not just the PK).
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO roles (id, tenant_id, name, name_en, name_ar, is_system_role, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'general_manager', 'General Manager', 'المدير العام', true, now(), now()),
  ('00000000-0000-0000-0000-000000000020',
   '00000000-0000-0000-0000-000000000002',
   'general_manager', 'General Manager', 'المدير العام', true, now(), now())
ON CONFLICT DO NOTHING;

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
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 6. User role assignments
--    role_id resolved by natural key (tenant_id + name) so the assignment
--    binds to whichever GM role row actually exists (ours or the one
--    pre-seeded by 013_seed_defaults with a different id).
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO user_role_assignments (id, tenant_id, user_id, role_id, assigned_at, created_at, updated_at)
SELECT
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  r.id,
  now(), now(), now()
FROM roles r
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001' AND r.name = 'general_manager'
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO user_role_assignments (id, tenant_id, user_id, role_id, assigned_at, created_at, updated_at)
SELECT
  '00000000-0000-0000-0000-000000000022',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  r.id,
  now(), now(), now()
FROM roles r
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000002' AND r.name = 'general_manager'
LIMIT 1
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 7. Permissions (shared catalog — a few rows so read-access tests are
--    non-vacuous)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO permissions (id, module, action, description, created_at)
VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'drivers',   'read',   'View drivers',   now()),
  ('00000000-0000-0000-0000-0000000000f2', 'drivers',   'create', 'Create drivers', now()),
  ('00000000-0000-0000-0000-0000000000f3', 'payroll',   'read',   'View payroll',   now()),
  ('00000000-0000-0000-0000-0000000000f4', 'invoices',  'read',   'View invoices',  now())
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- Done — minimal validated fixture set ready for pgTAP tests
-- (No trigger re-enable needed: the auth trigger was never disabled —
-- fixture users pass through via the _invite_provisioned marker.)
-- ═══════════════════════════════════════════════════════════════════