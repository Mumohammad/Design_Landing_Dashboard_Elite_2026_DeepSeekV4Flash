-- 013_seed_defaults.sql
-- Seed data for Phase 2. Uses ON CONFLICT DO NOTHING for idempotency.
-- Source: docs/phase-2-schema-plan.md section 12

-- ═══ Default tenant ═══
INSERT INTO tenants (id, name_ar, name_en, legal_name, cr_number, vat_number, address, city, region, country, phone, email, status, plan, default_locale, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'نخبة التطوير',
  'Elite Development',
  'Elite Development for Establishment Trading',
  'CR-PLACEHOLDER',  -- TODO: replace with real CR number
  'VAT-PLACEHOLDER', -- TODO: replace with real VAT number (15 digits)
  'Al Nahda District',
  'Buraydah',
  'Qassim',
  'SA',
  '+966000000000',
  'operations@elite-dev.com',
  'active',
  'single_tenant',
  'ar',
  'Asia/Riyadh'
)
ON CONFLICT (id) DO NOTHING;

-- ═══ 9 system roles ═══
INSERT INTO roles (tenant_id, name, name_ar, name_en, description, is_system_role)
VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'general_manager', 'المدير العام', 'General Manager', 'Full access to all modules', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'admin', 'مدير النظام', 'Administrator', 'System administration and user management', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'accountant', 'محاسب', 'Accountant', 'Financial and payroll management', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'supervisor', 'مشرف', 'Supervisor', 'Daily operations supervision', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'hr_officer', 'مسؤول موارد بشرية', 'HR Officer', 'Human resources management', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'operations_officer', 'مسؤول عمليات', 'Operations Officer', 'Operations coordination', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'payroll_officer', 'مسؤول رواتب', 'Payroll Officer', 'Payroll processing', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'platform_coordinator', 'منسق منصات', 'Platform Coordinator', 'Platform account management', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'readonly_auditor', 'مدقق', 'Read-Only Auditor', 'Read-only access to all modules for auditing', true)
ON CONFLICT DO NOTHING;

-- ═══ Permission catalog (19 modules × actions) ═══
INSERT INTO permissions (module, action, description)
VALUES
  -- drivers
  ('drivers', 'read', 'View driver records'),
  ('drivers', 'create', 'Create new driver'),
  ('drivers', 'update', 'Update driver details'),
  ('drivers', 'delete', 'Soft-delete driver'),
  ('drivers', 'export', 'Export driver data'),
  ('drivers', 'print', 'Print driver documents'),
  -- vehicles
  ('vehicles', 'read', 'View vehicle records'),
  ('vehicles', 'create', 'Create new vehicle'),
  ('vehicles', 'update', 'Update vehicle details'),
  ('vehicles', 'delete', 'Soft-delete vehicle'),
  ('vehicles', 'export', 'Export vehicle data'),
  ('vehicles', 'print', 'Print vehicle documents'),
  -- attendance
  ('attendance', 'read', 'View attendance records'),
  ('attendance', 'create', 'Create attendance entries'),
  ('attendance', 'update', 'Update attendance entries'),
  ('attendance', 'delete', 'Delete attendance entries'),
  ('attendance', 'approve', 'Approve leave requests'),
  ('attendance', 'export', 'Export attendance reports'),
  -- payroll
  ('payroll', 'read', 'View payroll records'),
  ('payroll', 'create', 'Create payroll runs'),
  ('payroll', 'update', 'Update payroll runs'),
  ('payroll', 'approve', 'Approve payroll'),
  ('payroll', 'export', 'Export payroll data'),
  ('payroll', 'print', 'Print payslips'),
  -- violations
  ('violations', 'read', 'View violation records'),
  ('violations', 'create', 'Create violation entries'),
  ('violations', 'update', 'Update violation entries'),
  ('violations', 'delete', 'Delete violation entries'),
  ('violations', 'approve', 'Approve/waive violations'),
  ('violations', 'export', 'Export violation reports'),
  -- expenses
  ('expenses', 'read', 'View expense records'),
  ('expenses', 'create', 'Create expense entries'),
  ('expenses', 'update', 'Update expense entries'),
  ('expenses', 'delete', 'Delete expense entries'),
  ('expenses', 'approve', 'Approve expenses'),
  ('expenses', 'export', 'Export expense reports'),
  -- maintenance
  ('maintenance', 'read', 'View maintenance records'),
  ('maintenance', 'create', 'Create maintenance requests'),
  ('maintenance', 'update', 'Update maintenance records'),
  ('maintenance', 'delete', 'Delete maintenance records'),
  ('maintenance', 'export', 'Export maintenance reports'),
  -- invoices
  ('invoices', 'read', 'View invoice records'),
  ('invoices', 'create', 'Create invoices'),
  ('invoices', 'update', 'Update invoices'),
  ('invoices', 'approve', 'Approve invoices'),
  ('invoices', 'export', 'Export invoice data'),
  ('invoices', 'print', 'Print invoices'),
  -- accounting
  ('accounting', 'read', 'View accounting records'),
  ('accounting', 'create', 'Create journal entries'),
  ('accounting', 'update', 'Update journal entries'),
  ('accounting', 'approve', 'Approve postings'),
  ('accounting', 'export', 'Export financial reports'),
  ('accounting', 'print', 'Print financial statements'),
  -- platforms
  ('platforms', 'read', 'View platform records'),
  ('platforms', 'create', 'Create platform accounts'),
  ('platforms', 'update', 'Update platform settings'),
  ('platforms', 'delete', 'Delete platform accounts'),
  ('platforms', 'export', 'Export platform data'),
  -- hr
  ('hr', 'read', 'View HR records'),
  ('hr', 'create', 'Create HR records'),
  ('hr', 'update', 'Update HR records'),
  ('hr', 'delete', 'Delete HR records'),
  ('hr', 'approve', 'Approve HR requests'),
  ('hr', 'export', 'Export HR reports'),
  ('hr', 'print', 'Print HR documents'),
  -- reports
  ('reports', 'read', 'View reports'),
  ('reports', 'export', 'Export reports'),
  ('reports', 'print', 'Print reports'),
  -- templates
  ('templates', 'read', 'View templates'),
  ('templates', 'create', 'Create templates'),
  ('templates', 'update', 'Update templates'),
  ('templates', 'print', 'Print generated documents'),
  -- assignments
  ('assignments', 'read', 'View assignments'),
  ('assignments', 'create', 'Create assignments'),
  ('assignments', 'update', 'Update assignments'),
  ('assignments', 'delete', 'Delete assignments'),
  -- users
  ('users', 'read', 'View user records'),
  ('users', 'create', 'Invite users'),
  ('users', 'update', 'Update user details'),
  ('users', 'delete', 'Deactivate users'),
  ('users', 'manage', 'Full user management'),
  -- roles
  ('roles', 'read', 'View roles'),
  ('roles', 'create', 'Create custom roles'),
  ('roles', 'update', 'Update roles'),
  ('roles', 'delete', 'Delete custom roles'),
  ('roles', 'manage', 'Full role management'),
  -- audit_log
  ('audit_log', 'read', 'View audit log'),
  ('audit_log', 'export', 'Export audit log'),
  -- security
  ('security', 'read', 'View security settings'),
  ('security', 'manage', 'Manage security settings'),
  -- settings
  ('settings', 'read', 'View settings'),
  ('settings', 'manage', 'Manage all settings')
ON CONFLICT DO NOTHING;

-- ═══ Role-permission matrix ═══
-- general_manager: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'general_manager'
ON CONFLICT DO NOTHING;

-- admin: all except settings.manage and security.manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'admin'
  AND NOT (p.module = 'settings' AND p.action = 'manage')
  AND NOT (p.module = 'security' AND p.action = 'manage')
ON CONFLICT DO NOTHING;

-- accountant: payroll, invoices, expenses, accounting, reports (read+create+update+export+approve)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'accountant'
  AND p.module IN ('payroll', 'invoices', 'expenses', 'accounting', 'reports')
  AND p.action IN ('read', 'create', 'update', 'export', 'approve', 'print')
ON CONFLICT DO NOTHING;

-- accountant also gets read on drivers, vehicles, attendance, platforms
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'accountant'
  AND p.module IN ('drivers', 'vehicles', 'attendance', 'platforms')
  AND p.action = 'read'
ON CONFLICT DO NOTHING;

-- supervisor: drivers, vehicles, attendance, violations, assignments, maintenance (read+create+update)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'supervisor'
  AND p.module IN ('drivers', 'vehicles', 'attendance', 'violations', 'assignments', 'maintenance')
  AND p.action IN ('read', 'create', 'update', 'export')
ON CONFLICT DO NOTHING;

-- supervisor also gets attendance.approve and reports.read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'supervisor'
  AND ((p.module = 'attendance' AND p.action = 'approve') OR (p.module = 'reports' AND p.action = 'read'))
ON CONFLICT DO NOTHING;

-- hr_officer: hr, drivers(read), attendance(read+approve), templates(read+print)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'hr_officer'
  AND (
    (p.module = 'hr' AND p.action IN ('read', 'create', 'update', 'approve', 'export', 'print'))
    OR (p.module = 'drivers' AND p.action = 'read')
    OR (p.module = 'attendance' AND p.action IN ('read', 'approve'))
    OR (p.module = 'templates' AND p.action IN ('read', 'print'))
  )
ON CONFLICT DO NOTHING;

-- operations_officer: drivers, vehicles, platforms, assignments, maintenance (read+create+update)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'operations_officer'
  AND p.module IN ('drivers', 'vehicles', 'platforms', 'assignments', 'maintenance')
  AND p.action IN ('read', 'create', 'update')
ON CONFLICT DO NOTHING;

-- payroll_officer: payroll(read+create+update+export+print), attendance(read), drivers(read)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'payroll_officer'
  AND (
    (p.module = 'payroll' AND p.action IN ('read', 'create', 'update', 'export', 'print'))
    OR (p.module = 'attendance' AND p.action = 'read')
    OR (p.module = 'drivers' AND p.action = 'read')
  )
ON CONFLICT DO NOTHING;

-- platform_coordinator: platforms(read+create+update), drivers(read), reports(read)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'platform_coordinator'
  AND (
    (p.module = 'platforms' AND p.action IN ('read', 'create', 'update', 'export'))
    OR (p.module = 'drivers' AND p.action = 'read')
    OR (p.module = 'reports' AND p.action = 'read')
  )
ON CONFLICT DO NOTHING;

-- readonly_auditor: read on everything except users, security, settings
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'readonly_auditor'
  AND p.action = 'read'
  AND p.module NOT IN ('users', 'security', 'settings')
ON CONFLICT DO NOTHING;

-- readonly_auditor also gets audit_log.read and audit_log.export
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND r.name = 'readonly_auditor'
  AND p.module = 'audit_log' AND p.action IN ('read', 'export')
ON CONFLICT DO NOTHING;

-- ═══ Default system_settings (24 settings) ═══
INSERT INTO system_settings (tenant_id, key, value, category, description_ar, description_en, is_public)
VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'security.max_failed_login_attempts', '5', 'security', 'الحد الأقصى لمحاولات الدخول الفاشلة', 'Max failed login attempts', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'security.lockout_duration_minutes', '15', 'security', 'مدة قفل الحساب (دقائق)', 'Account lockout duration (minutes)', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'security.session_access_token_hours', '1', 'security', 'صلاحية رمز الوصول (ساعات)', 'Access token TTL (hours)', false),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'security.session_refresh_token_days', '30', 'security', 'صلاحية رمز التحديث (أيام)', 'Refresh token TTL (days)', false),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'security.password_min_length', '12', 'security', 'الحد الأدنى لطول كلمة المرور', 'Minimum password length', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'security.password_expiry_days', '90', 'security', 'انتهاء صلاحية كلمة المرور (أيام)', 'Password expiry (days)', false),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'security.password_reuse_count', '5', 'security', 'منع إعادة استخدام آخر N كلمات مرور', 'Password reuse prevention count', false),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'security.require_2fa', 'false', 'security', 'فرض التحقق الثنائي', 'Require 2FA', false),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'attendance.supervisor_edit_window_days', '3', 'attendance', 'نافذة تعديل المشرف (أيام)', 'Supervisor edit window (days)', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'attendance.default_working_days_per_month', '26', 'attendance', 'أيام العمل الافتراضية شهرياً', 'Default working days per month', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'attendance.late_threshold_minutes', '30', 'attendance', 'حد التأخر (دقائق)', 'Late threshold (minutes)', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'attendance.grace_period_minutes', '15', 'attendance', 'فترة السماح (دقائق)', 'Grace period (minutes)', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'attendance.half_day_threshold_minutes', '120', 'attendance', 'حد نصف اليوم (دقائق)', 'Half-day threshold (minutes)', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'payroll.default_working_days', '26', 'payroll', 'أيام العمل الافتراضية للراتب', 'Default payroll working days', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'payroll.min_net_floor', '0', 'payroll', 'الحد الأدنى لصافي الراتب', 'Minimum net payroll floor', false),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'payroll.saudi_minimum_wage', '4000', 'payroll', 'الحد الأدنى لأجور السعوديين', 'Saudi minimum wage', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'payroll.waiver_threshold_admin', '500', 'payroll', 'حد الإعفاء للمسؤول', 'Admin waiver threshold (SAR)', false),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'violations.admin_waiver_limit_sar', '500', 'violations', 'حد إعفاء المخالفات للمسؤول', 'Admin violation waiver limit (SAR)', false),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'violations.dispute_window_days', '7', 'violations', 'نافذة الاعتراض (أيام)', 'Dispute window (days)', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'orders.supervisor_edit_window_days', '3', 'orders', 'نافذة تعديل الطلبات (أيام)', 'Orders supervisor edit window (days)', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'system.default_language', 'ar', 'system', 'اللغة الافتراضية', 'Default language', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'system.timezone', 'Asia/Riyadh', 'system', 'المنطقة الزمنية', 'Timezone', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'system.date_format', 'dd/MM/yyyy', 'system', 'صيغة التاريخ', 'Date format', true),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'system.hijri_dates', 'true', 'system', 'تفعيل التواريخ الهجرية', 'Enable Hijri dates', true)
ON CONFLICT DO NOTHING;
