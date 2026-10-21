-- Define complete standard accounting initialization for future workspaces and
-- explicit authorized initialization. This migration does not backfill any tenant.
CREATE OR REPLACE FUNCTION public.ensure_default_chart_of_accounts(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant id is required';
  END IF;

  INSERT INTO public.chart_of_accounts
    (tenant_id, account_code, name_ar, name_en, account_type, normal_balance, is_contra)
  VALUES
    (p_tenant_id, '1000', 'النقد بالصندوق', 'Cash on Hand', 'asset', 'debit', false),
    (p_tenant_id, '1100', 'الحساب البنكي', 'Bank Account', 'asset', 'debit', false),
    (p_tenant_id, '1200', 'ذمم مدينة — عملاء', 'Accounts Receivable — Customers', 'asset', 'debit', false),
    (p_tenant_id, '1300', 'ذمم مدينة — منصات التوصيل', 'Accounts Receivable — Platforms', 'asset', 'debit', false),
    (p_tenant_id, '1400', 'ذمم مدينة — السائقون (COD)', 'Receivable — Drivers (COD)', 'asset', 'debit', false),
    (p_tenant_id, '1500', 'مصروفات مدفوعة مقدماً', 'Prepaid Expenses', 'asset', 'debit', false),
    (p_tenant_id, '1600', 'الأصول الثابتة', 'Fixed Assets', 'asset', 'debit', false),
    (p_tenant_id, '1610', 'مجمع الإهلاك', 'Accumulated Depreciation', 'asset', 'credit', true),
    (p_tenant_id, '2000', 'ذمم دائنة — موردون', 'Accounts Payable — Suppliers', 'liability', 'credit', false),
    (p_tenant_id, '2100', 'رواتب مستحقة', 'Wages Payable', 'liability', 'credit', false),
    (p_tenant_id, '2200', 'مستحقات التأمينات (GOSI)', 'GOSI Payable', 'liability', 'credit', false),
    (p_tenant_id, '2300', 'سلف مستلمة', 'Advances Received', 'liability', 'credit', false),
    (p_tenant_id, '2500', 'ضريبة القيمة المضافة المستحقة (مخرجات)', 'VAT Output Payable', 'liability', 'credit', false),
    (p_tenant_id, '2600', 'ضريبة القيمة المضافة المدينة (مدخلات)', 'VAT Input Receivable', 'asset', 'debit', false),
    (p_tenant_id, '3000', 'رأس المال', 'Capital', 'equity', 'credit', false),
    (p_tenant_id, '3100', 'الأرباح المحتجزة', 'Retained Earnings', 'equity', 'credit', false),
    (p_tenant_id, '4000', 'إيرادات رسوم التوصيل', 'Revenue — Delivery Fees', 'income', 'credit', false),
    (p_tenant_id, '4100', 'إيرادات عمولات المنصات', 'Revenue — Platform Commissions', 'income', 'credit', false),
    (p_tenant_id, '4200', 'إيرادات رسوم التحصيل عند الاستلام', 'Revenue — COD Handling Fees', 'income', 'credit', false),
    (p_tenant_id, '5000', 'مصروفات الوقود', 'Fuel Expenses', 'expense', 'debit', false),
    (p_tenant_id, '5100', 'الصيانة والإصلاحات', 'Maintenance & Repairs', 'expense', 'debit', false),
    (p_tenant_id, '5200', 'الرواتب والأجور', 'Salaries & Wages', 'expense', 'debit', false),
    (p_tenant_id, '5300', 'اشتراكات التأمينات (GOSI)', 'GOSI Contributions', 'expense', 'debit', false),
    (p_tenant_id, '5400', 'الإيجار', 'Rent', 'expense', 'debit', false),
    (p_tenant_id, '5500', 'التأمين', 'Insurance', 'expense', 'debit', false),
    (p_tenant_id, '5600', 'الرسوم البنكية', 'Bank Charges', 'expense', 'debit', false),
    (p_tenant_id, '5700', 'مصروف الإهلاك', 'Depreciation Expense', 'expense', 'debit', false),
    (p_tenant_id, '5800', 'مصروفات متنوعة', 'Miscellaneous Expenses', 'expense', 'debit', false)
  ON CONFLICT (tenant_id, account_code) WHERE deleted_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Ensure the current open accounting period exists for the tenant.
  INSERT INTO public.accounting_periods (tenant_id, period_year, period_month, status)
  SELECT p_tenant_id,
         EXTRACT(YEAR FROM CURRENT_DATE)::smallint,
         EXTRACT(MONTH FROM CURRENT_DATE)::smallint,
         'open'
  ON CONFLICT (tenant_id,period_year,period_month) DO NOTHING;


  -- Standard templates from 040. Existing tenant choices are never overwritten.
  INSERT INTO public.expense_category_mappings(tenant_id,expense_type,coa_account_code,vat_recoverability)
  VALUES
    (p_tenant_id,'fuel','5000','recoverable'),
    (p_tenant_id,'maintenance','5100','recoverable'),
    (p_tenant_id,'operational','5800','recoverable'),
    (p_tenant_id,'platform_commission','5800','recoverable'),
    (p_tenant_id,'advance','1500','non_recoverable'),
    (p_tenant_id,'other','5800','pending_review')
  ON CONFLICT (tenant_id,expense_type) DO NOTHING;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_company_atomic(p_auth_user_id uuid, p_company jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant_id uuid; v_user_id uuid; v_role_id uuid; v_email text; v_slug text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_auth_user_id FOR UPDATE;
  IF v_email IS NULL THEN RAISE EXCEPTION 'COMPANY_AUTH_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE auth_user_id = p_auth_user_id) THEN
    RAISE EXCEPTION 'COMPANY_ALREADY_PROVISIONED';
  END IF;
  IF length(btrim(COALESCE(p_company->>'name',''))) < 2
     OR length(btrim(COALESCE(p_company->>'domain',''))) < 3 THEN
    RAISE EXCEPTION 'COMPANY_DETAILS_INVALID';
  END IF;
  INSERT INTO public.tenants(name_en,name_ar,slug,domain,logo_url,brand_colors,trial_ends_at,created_by)
  VALUES (p_company->>'name',p_company->>'name',NULLIF(p_company->>'slug',''),lower(btrim(p_company->>'domain')),
    NULLIF(p_company->>'logo_url',''),COALESCE(p_company->'brand_colors','{}'::jsonb),now()+interval '14 days',p_auth_user_id)
  RETURNING id,slug INTO v_tenant_id,v_slug;
  INSERT INTO public.users(auth_user_id,tenant_id,email,role,status,must_change_password)
  VALUES(p_auth_user_id,v_tenant_id,v_email,'general_manager','active',false) RETURNING id INTO v_user_id;
  INSERT INTO public.tenant_memberships(tenant_id,user_id,is_primary) VALUES(v_tenant_id,v_user_id,true);
  INSERT INTO public.roles (tenant_id, name, name_ar, name_en, description, is_system_role)
VALUES
  (v_tenant_id, 'general_manager', 'المدير العام', 'General Manager', 'Full access to all modules', true),
  (v_tenant_id, 'admin', 'مدير النظام', 'Administrator', 'System administration and user management', true),
  (v_tenant_id, 'accountant', 'محاسب', 'Accountant', 'Financial and payroll management', true),
  (v_tenant_id, 'supervisor', 'مشرف', 'Supervisor', 'Daily operations supervision', true),
  (v_tenant_id, 'hr_officer', 'مسؤول موارد بشرية', 'HR Officer', 'Human resources management', true),
  (v_tenant_id, 'operations_officer', 'مسؤول عمليات', 'Operations Officer', 'Operations coordination', true),
  (v_tenant_id, 'payroll_officer', 'مسؤول رواتب', 'Payroll Officer', 'Payroll processing', true),
  (v_tenant_id, 'platform_coordinator', 'منسق منصات', 'Platform Coordinator', 'Platform account management', true),
  (v_tenant_id, 'readonly_auditor', 'مدقق', 'Read-Only Auditor', 'Read-only access to all modules for auditing', true)
ON CONFLICT DO NOTHING;

-- ═══ Role-permission matrix ═══
-- general_manager: ALL permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'general_manager'
ON CONFLICT DO NOTHING;

-- admin: all except settings.manage and security.manage
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'admin'
  AND NOT (p.module = 'settings' AND p.action = 'manage')
  AND NOT (p.module = 'security' AND p.action = 'manage')
ON CONFLICT DO NOTHING;

-- accountant: payroll, invoices, expenses, accounting, reports (read+create+update+export+approve)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'accountant'
  AND p.module IN ('payroll', 'invoices', 'expenses', 'accounting', 'reports')
  AND p.action IN ('read', 'create', 'update', 'export', 'approve', 'print')
ON CONFLICT DO NOTHING;

-- accountant also gets read on drivers, vehicles, attendance, platforms
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'accountant'
  AND p.module IN ('drivers', 'vehicles', 'attendance', 'platforms')
  AND p.action = 'read'
ON CONFLICT DO NOTHING;

-- supervisor: drivers, vehicles, attendance, violations, assignments, maintenance (read+create+update)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'supervisor'
  AND p.module IN ('drivers', 'vehicles', 'attendance', 'violations', 'assignments', 'maintenance')
  AND p.action IN ('read', 'create', 'update', 'export')
ON CONFLICT DO NOTHING;

-- supervisor also gets attendance.approve and reports.read
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'supervisor'
  AND ((p.module = 'attendance' AND p.action = 'approve') OR (p.module = 'reports' AND p.action = 'read'))
ON CONFLICT DO NOTHING;

-- hr_officer: hr, drivers(read), attendance(read+approve), templates(read+print)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'hr_officer'
  AND (
    (p.module = 'hr' AND p.action IN ('read', 'create', 'update', 'approve', 'export', 'print'))
    OR (p.module = 'drivers' AND p.action = 'read')
    OR (p.module = 'attendance' AND p.action IN ('read', 'approve'))
    OR (p.module = 'templates' AND p.action IN ('read', 'print'))
  )
ON CONFLICT DO NOTHING;

-- operations_officer: drivers, vehicles, platforms, assignments, maintenance (read+create+update)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'operations_officer'
  AND p.module IN ('drivers', 'vehicles', 'platforms', 'assignments', 'maintenance')
  AND p.action IN ('read', 'create', 'update')
ON CONFLICT DO NOTHING;

-- payroll_officer: payroll(read+create+update+export+print), attendance(read), drivers(read)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'payroll_officer'
  AND (
    (p.module = 'payroll' AND p.action IN ('read', 'create', 'update', 'export', 'print'))
    OR (p.module = 'attendance' AND p.action = 'read')
    OR (p.module = 'drivers' AND p.action = 'read')
  )
ON CONFLICT DO NOTHING;

-- platform_coordinator: platforms(read+create+update), drivers(read), reports(read)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'platform_coordinator'
  AND (
    (p.module = 'platforms' AND p.action IN ('read', 'create', 'update', 'export'))
    OR (p.module = 'drivers' AND p.action = 'read')
    OR (p.module = 'reports' AND p.action = 'read')
  )
ON CONFLICT DO NOTHING;

-- readonly_auditor: read on everything except users, security, settings
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'readonly_auditor'
  AND p.action = 'read'
  AND p.module NOT IN ('users', 'security', 'settings')
ON CONFLICT DO NOTHING;

-- readonly_auditor also gets audit_log.read and audit_log.export
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.tenant_id = v_tenant_id
  AND r.name = 'readonly_auditor'
  AND p.module = 'audit_log' AND p.action IN ('read', 'export')
ON CONFLICT DO NOTHING;

INSERT INTO public.system_settings (tenant_id, key, value, category, description_ar, description_en, is_public)
VALUES
  (v_tenant_id, 'security.max_failed_login_attempts', '5', 'security', 'الحد الأقصى لمحاولات الدخول الفاشلة', 'Max failed login attempts', true),
  (v_tenant_id, 'security.lockout_duration_minutes', '15', 'security', 'مدة قفل الحساب (دقائق)', 'Account lockout duration (minutes)', true),
  (v_tenant_id, 'security.session_access_token_hours', '1', 'security', 'صلاحية رمز الوصول (ساعات)', 'Access token TTL (hours)', false),
  (v_tenant_id, 'security.session_refresh_token_days', '30', 'security', 'صلاحية رمز التحديث (أيام)', 'Refresh token TTL (days)', false),
  (v_tenant_id, 'security.password_min_length', '12', 'security', 'الحد الأدنى لطول كلمة المرور', 'Minimum password length', true),
  (v_tenant_id, 'security.password_expiry_days', '90', 'security', 'انتهاء صلاحية كلمة المرور (أيام)', 'Password expiry (days)', false),
  (v_tenant_id, 'security.password_reuse_count', '5', 'security', 'منع إعادة استخدام آخر N كلمات مرور', 'Password reuse prevention count', false),
  (v_tenant_id, 'security.require_2fa', 'false', 'security', 'فرض التحقق الثنائي', 'Require 2FA', false),
  (v_tenant_id, 'attendance.supervisor_edit_window_days', '3', 'attendance', 'نافذة تعديل المشرف (أيام)', 'Supervisor edit window (days)', true),
  (v_tenant_id, 'attendance.default_working_days_per_month', '26', 'attendance', 'أيام العمل الافتراضية شهرياً', 'Default working days per month', true),
  (v_tenant_id, 'attendance.late_threshold_minutes', '30', 'attendance', 'حد التأخر (دقائق)', 'Late threshold (minutes)', true),
  (v_tenant_id, 'attendance.grace_period_minutes', '15', 'attendance', 'فترة السماح (دقائق)', 'Grace period (minutes)', true),
  (v_tenant_id, 'attendance.half_day_threshold_minutes', '120', 'attendance', 'حد نصف اليوم (دقائق)', 'Half-day threshold (minutes)', true),
  (v_tenant_id, 'payroll.default_working_days', '26', 'payroll', 'أيام العمل الافتراضية للراتب', 'Default payroll working days', true),
  (v_tenant_id, 'payroll.min_net_floor', '0', 'payroll', 'الحد الأدنى لصافي الراتب', 'Minimum net payroll floor', false),
  (v_tenant_id, 'payroll.saudi_minimum_wage', '4000', 'payroll', 'الحد الأدنى لأجور السعوديين', 'Saudi minimum wage', true),
  (v_tenant_id, 'payroll.waiver_threshold_admin', '500', 'payroll', 'حد الإعفاء للمسؤول', 'Admin waiver threshold (SAR)', false),
  (v_tenant_id, 'violations.admin_waiver_limit_sar', '500', 'violations', 'حد إعفاء المخالفات للمسؤول', 'Admin violation waiver limit (SAR)', false),
  (v_tenant_id, 'violations.dispute_window_days', '7', 'violations', 'نافذة الاعتراض (أيام)', 'Dispute window (days)', true),
  (v_tenant_id, 'orders.supervisor_edit_window_days', '3', 'orders', 'نافذة تعديل الطلبات (أيام)', 'Orders supervisor edit window (days)', true),
  (v_tenant_id, 'system.default_language', 'ar', 'system', 'اللغة الافتراضية', 'Default language', true),
  (v_tenant_id, 'system.timezone', 'Asia/Riyadh', 'system', 'المنطقة الزمنية', 'Timezone', true),
  (v_tenant_id, 'system.date_format', 'dd/MM/yyyy', 'system', 'صيغة التاريخ', 'Date format', true),
  (v_tenant_id, 'system.hijri_dates', 'true', 'system', 'تفعيل التواريخ الهجرية', 'Enable Hijri dates', true)
ON CONFLICT DO NOTHING;

  -- New workspaces receive the same empty standard ledger/template as the
  -- explicit accounting initializer. No existing tenant is backfilled.
  PERFORM public.ensure_default_chart_of_accounts(v_tenant_id);

  SELECT id INTO v_role_id FROM public.roles WHERE tenant_id=v_tenant_id AND name='general_manager' AND deleted_at IS NULL;
  INSERT INTO public.user_role_assignments(tenant_id,user_id,role_id,assigned_by)
  VALUES(v_tenant_id,v_user_id,v_role_id,p_auth_user_id);
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action)
  VALUES(v_tenant_id,p_auth_user_id,'platform','tenants',v_tenant_id,'company_created');
  RETURN jsonb_build_object('id',v_tenant_id,'slug',v_slug);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_chart_of_accounts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_chart_of_accounts(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.provision_company_atomic(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.provision_company_atomic(uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
