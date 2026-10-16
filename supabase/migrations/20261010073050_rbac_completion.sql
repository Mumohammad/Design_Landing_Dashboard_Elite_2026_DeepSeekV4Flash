-- Repository-wide RBAC completion and account-state hardening.
-- Forward-only. This migration binds tenant helpers and privileged functions to
-- active callers, applies the approved module/action matrix to remaining
-- tenant policies, narrows Data API grants, and scopes Storage by bucket.

-- ---------------------------------------------------------------------------
-- 1. Account state is part of every tenant/permission decision.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.tenant_id
  FROM public.users u
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND u.status = 'active'::public.user_status
    AND u.deleted_at IS NULL
    AND (u.locked_until IS NULL OR u.locked_until <= now())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_has_permission(
  p_module text,
  p_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.status = 'active'::public.user_status
      AND u.deleted_at IS NULL
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND (
        u.role = 'general_manager'::public.user_role
        OR EXISTS (
          SELECT 1
          FROM public.roles r
          JOIN public.role_permissions rp ON rp.role_id = r.id
          JOIN public.permissions p ON p.id = rp.permission_id
          WHERE r.tenant_id = u.tenant_id
            AND r.name = u.role
            AND r.deleted_at IS NULL
            AND p.module = p_module
            AND p.action = p_action
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_permission(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_permission(text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.storage_path_in_current_tenant(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.status = 'active'::public.user_status
      AND u.deleted_at IS NULL
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND p_name ~ (
        '^' || u.tenant_id::text || '/[^/]+(/[^/]+)*$'
      )
      AND p_name !~ '(^|/)\.\.?(/|$)'
      AND strpos(p_name, E'\\') = 0
  );
$$;

REVOKE ALL ON FUNCTION public.storage_path_in_current_tenant(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_path_in_current_tenant(text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Bind the four remaining SECURITY DEFINER helpers to caller + permission.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_pdpl_consent(p_driver_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_service boolean :=
    COALESCE((auth.jwt() ->> 'role') = 'service_role', false)
    OR current_setting('role', true) IN ('none', 'postgres');
  v_result boolean;
BEGIN
  SELECT d.tenant_id
    INTO v_tenant_id
  FROM public.drivers d
  WHERE d.id = p_driver_id
    AND d.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT v_is_service AND (
    v_tenant_id IS DISTINCT FROM public.get_my_tenant_id()
    OR NOT public.user_has_permission('drivers', 'read')
  ) THEN
    RETURN false;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (c.consent_type)
      c.consent_type,
      c.accepted
    FROM public.driver_consents c
    WHERE c.driver_id = p_driver_id
      AND c.tenant_id = v_tenant_id
      AND c.consent_type IN ('photo', 'sensitive_docs')
    ORDER BY c.consent_type, c.created_at DESC
  )
  SELECT count(*) = 2 AND COALESCE(bool_and(accepted), false)
    INTO v_result
  FROM latest;

  RETURN COALESCE(v_result, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_user_pdpl_consent(
  p_user_id uuid,
  p_consent_type text DEFAULT 'terms'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_service boolean :=
    COALESCE((auth.jwt() ->> 'role') = 'service_role', false)
    OR current_setting('role', true) IN ('none', 'postgres');
BEGIN
  SELECT u.tenant_id
    INTO v_tenant_id
  FROM public.users u
  WHERE u.id = p_user_id
    AND u.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT v_is_service AND (
    v_tenant_id IS DISTINCT FROM public.get_my_tenant_id()
    OR NOT public.user_has_permission('users', 'read')
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_consents c
    WHERE c.user_id = p_user_id
      AND c.tenant_id = v_tenant_id
      AND c.consent_type = p_consent_type
      AND c.accepted IS TRUE
      AND c.version = (
        SELECT c2.version
        FROM public.user_consents c2
        WHERE c2.user_id = p_user_id
          AND c2.tenant_id = v_tenant_id
          AND c2.consent_type = p_consent_type
        ORDER BY c2.created_at DESC, c2.version DESC
        LIMIT 1
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_leave_request(
  p_driver_id uuid,
  p_leave_type_code text,
  p_days integer,
  p_year integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_hire_date date;
  v_entitled integer;
  v_used integer;
  v_pending integer;
  v_requested integer;
  v_code text;
  v_days_per_year smallint;
  v_sick_full integer := 30;
  v_sick_half integer := 60;
  v_sick_unpaid integer := 30;
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  v_is_service boolean :=
    COALESCE((auth.jwt() ->> 'role') = 'service_role', false)
    OR current_setting('role', true) IN ('none', 'postgres');
BEGIN
  SELECT d.tenant_id, d.hire_date
    INTO v_tenant_id, v_hire_date
  FROM public.drivers d
  WHERE d.id = p_driver_id
    AND d.deleted_at IS NULL;

  IF v_tenant_id IS NULL OR v_hire_date IS NULL THEN
    RETURN 'DRV001: driver not found';
  END IF;

  IF NOT v_is_service AND (
    v_tenant_id IS DISTINCT FROM public.get_my_tenant_id()
    OR NOT public.user_has_permission('attendance', 'create')
  ) THEN
    RAISE EXCEPTION 'AUTH008: attendance:create permission required'
      USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL OR p_days <= 0 THEN
    RETURN 'Leave length must be at least one day';
  END IF;

  IF p_leave_type_code = 'annual' THEN
    v_entitled := CASE
      WHEN v_year - EXTRACT(YEAR FROM v_hire_date)::integer >= 5 THEN 30
      ELSE 21
    END;

    SELECT COALESCE(SUM(b.used_days), 0), COALESCE(SUM(b.pending_days), 0)
      INTO v_used, v_pending
    FROM public.driver_leave_balances b
    WHERE b.driver_id = p_driver_id
      AND b.tenant_id = v_tenant_id
      AND b.year = v_year
      AND b.deleted_at IS NULL;

    v_requested := COALESCE(v_used, 0) + COALESCE(v_pending, 0) + p_days;
    IF v_requested > v_entitled THEN
      RETURN format(
        'Annual leave exceeds entitlement: %s/%s days used. Driver has %s years of service (entitlement: %s days).',
        v_used + v_pending, v_entitled,
        v_year - EXTRACT(YEAR FROM v_hire_date)::integer,
        v_entitled
      );
    END IF;
  END IF;

  IF p_leave_type_code = 'sick' THEN
    SELECT COALESCE(SUM(r.days_requested), 0)
      INTO v_used
    FROM public.driver_leave_requests r
    JOIN public.leave_types t
      ON t.id = r.leave_type_id
     AND t.tenant_id = v_tenant_id
    WHERE r.driver_id = p_driver_id
      AND r.tenant_id = v_tenant_id
      AND t.code = 'sick'
      AND r.status IN ('pending', 'approved')
      AND EXTRACT(YEAR FROM r.start_date) = v_year
      AND r.deleted_at IS NULL;

    v_requested := v_used + p_days;
    IF v_requested <= v_sick_full THEN
      RETURN NULL;
    ELSIF v_requested <= v_sick_full + v_sick_half THEN
      RAISE NOTICE 'sick tier: half pay (day % of 120-day window)',
        v_requested - v_sick_full;
      RETURN NULL;
    ELSIF v_requested <= v_sick_full + v_sick_half + v_sick_unpaid THEN
      RAISE NOTICE 'sick tier: unpaid (day % of 120-day window)',
        v_requested - v_sick_full - v_sick_half;
      RETURN NULL;
    ELSE
      RETURN format(
        'Sick leave exceeds the 120-day statutory window (%s full + %s half + %s unpaid). Requested through day %s.',
        v_sick_full, v_sick_half, v_sick_unpaid, v_requested
      );
    END IF;
  END IF;

  SELECT t.code, t.days_per_year
    INTO v_code, v_days_per_year
  FROM public.leave_types t
  WHERE t.tenant_id = v_tenant_id
    AND t.code = p_leave_type_code
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF v_code IS NOT NULL AND v_days_per_year > 0 THEN
    SELECT COALESCE(SUM(r.days_requested), 0)
      INTO v_used
    FROM public.driver_leave_requests r
    JOIN public.leave_types t2
      ON t2.id = r.leave_type_id
     AND t2.tenant_id = v_tenant_id
    WHERE r.driver_id = p_driver_id
      AND r.tenant_id = v_tenant_id
      AND t2.code = v_code
      AND r.status IN ('pending', 'approved')
      AND EXTRACT(YEAR FROM r.start_date) = v_year
      AND r.deleted_at IS NULL;

    IF v_used + p_days > v_days_per_year THEN
      RETURN format(
        'Leave exceeds the %s-day yearly cap for type "%s".',
        v_days_per_year, v_code
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_employee_code(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_service boolean :=
    COALESCE((auth.jwt() ->> 'role') = 'service_role', false)
    OR current_setting('role', true) IN ('none', 'postgres');
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'next_employee_code: p_tenant_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_service AND (
    p_tenant_id IS DISTINCT FROM public.get_my_tenant_id()
    OR NOT public.user_has_permission('users', 'create')
  ) THEN
    RAISE EXCEPTION 'AUTH009: users:create permission required'
      USING ERRCODE = '42501';
  END IF;

  RETURN 'EDU-' ||
    lpad(nextval('public.user_employee_code_seq')::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.has_pdpl_consent(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_user_pdpl_consent(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_leave_request(uuid, text, integer, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.next_employee_code(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_pdpl_consent(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_user_pdpl_consent(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_leave_request(uuid, text, integer, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_employee_code(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Service-owned append/derived rows cannot be written directly.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS audit_log_insert_own_actor ON public.audit_log;
DROP POLICY IF EXISTS attendance_summary_ins ON public.driver_attendance_summary;
DROP POLICY IF EXISTS attendance_summary_upd ON public.driver_attendance_summary;
DROP POLICY IF EXISTS driver_compliance_results_tenant_ins
  ON public.driver_compliance_results;
DROP POLICY IF EXISTS driver_compliance_results_tenant_upd
  ON public.driver_compliance_results;
DROP POLICY IF EXISTS leave_balances_ins ON public.driver_leave_balances;
DROP POLICY IF EXISTS leave_balances_upd ON public.driver_leave_balances;
DROP POLICY IF EXISTS payroll_journal_ins ON public.payroll_journal_entries;
DROP POLICY IF EXISTS payroll_journal_upd ON public.payroll_journal_entries;
DROP POLICY IF EXISTS deduction_ledger_ins ON public.violation_deduction_ledger;
DROP POLICY IF EXISTS deduction_ledger_upd ON public.violation_deduction_ledger;
DROP POLICY IF EXISTS driver_card_prints_tenant_upd ON public.driver_card_prints;
DROP POLICY IF EXISTS generated_docs_ins ON public.generated_documents;
DROP POLICY IF EXISTS generated_docs_upd ON public.generated_documents;
DROP POLICY IF EXISTS reports_upd ON public.report_generation_log;
DROP POLICY IF EXISTS tenants_insert_own ON public.tenants;

-- ---------------------------------------------------------------------------
-- 4. Apply the approved resource -> module/action matrix.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v record;
  p record;
  v_using text;
  v_check text;
BEGIN
  FOR v IN
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
        ('expense_category_mappings', 'accounting'),
        ('external_fine_imports', 'violations'),
        ('finance_payments', 'accounting'),
        ('invoice_lines', 'invoices'),
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
        ('violation_types', 'violations')
    ),
    matrix(table_name, command_name, module_name, action_name) AS (
      SELECT table_name, 'SELECT', module_name, 'read' FROM standard
      UNION ALL
      SELECT table_name, 'INSERT', module_name, 'create' FROM standard
      UNION ALL
      SELECT table_name, 'UPDATE', module_name, 'update' FROM standard
      UNION ALL
      VALUES
        ('driver_application_documents', 'SELECT', 'hr', 'read'),
        ('driver_applications', 'SELECT', 'hr', 'read'),
        ('driver_attendance_summary', 'SELECT', 'attendance', 'read'),
        ('driver_card_prints', 'SELECT', 'drivers', 'read'),
        ('driver_card_prints', 'INSERT', 'drivers', 'print'),
        ('driver_compliance_results', 'SELECT', 'drivers', 'read'),
        ('driver_leave_balances', 'SELECT', 'attendance', 'read'),
        ('financial_events', 'SELECT', 'accounting', 'read'),
        ('generated_documents', 'SELECT', 'templates', 'read'),
        ('invites', 'SELECT', 'users', 'read'),
        ('journal_approvals', 'SELECT', 'accounting', 'read'),
        ('journal_entries', 'SELECT', 'accounting', 'read'),
        ('journal_entry_lines', 'SELECT', 'accounting', 'read'),
        ('payroll_journal_entries', 'SELECT', 'payroll', 'read'),
        ('permissions', 'SELECT', 'roles', 'read'),
        ('report_generation_log', 'SELECT', 'reports', 'read'),
        ('report_generation_log', 'INSERT', 'reports', 'export'),
        ('system_settings', 'SELECT', 'settings', 'read'),
        ('system_settings', 'INSERT', 'settings', 'manage'),
        ('system_settings', 'UPDATE', 'settings', 'manage'),
        ('tenant_memberships', 'SELECT', 'users', 'read'),
        ('tenants', 'SELECT', 'settings', 'read'),
        ('tenants', 'UPDATE', 'settings', 'manage'),
        ('user_role_assignments', 'SELECT', 'roles', 'read'),
        ('violation_deduction_ledger', 'SELECT', 'violations', 'read'),
        ('zatca_transmissions', 'SELECT', 'accounting', 'read')
    )
    SELECT DISTINCT * FROM matrix
  LOOP
    FOR p IN
      SELECT *
      FROM pg_policies pp
      WHERE pp.schemaname = 'public'
        AND pp.tablename = v.table_name
        AND pp.cmd = v.command_name
        AND 'authenticated' = ANY(pp.roles)
    LOOP
      IF COALESCE(p.qual, '') || COALESCE(p.with_check, '')
         LIKE '%user_has_permission%' THEN
        CONTINUE;
      END IF;

      IF v.command_name = 'SELECT' OR v.command_name = 'DELETE' THEN
        v_using := COALESCE(p.qual, 'true');
        EXECUTE format(
          'ALTER POLICY %I ON public.%I USING ((%s) AND public.user_has_permission(%L, %L))',
          p.policyname, v.table_name, v_using, v.module_name, v.action_name
        );
      ELSIF v.command_name = 'INSERT' THEN
        v_check := COALESCE(p.with_check, 'true');
        EXECUTE format(
          'ALTER POLICY %I ON public.%I WITH CHECK ((%s) AND public.user_has_permission(%L, %L))',
          p.policyname, v.table_name, v_check, v.module_name, v.action_name
        );
      ELSIF v.command_name = 'UPDATE' THEN
        v_using := COALESCE(p.qual, 'true');
        v_check := COALESCE(p.with_check, p.qual, 'true');
        EXECUTE format(
          'ALTER POLICY %I ON public.%I USING ((%s) AND public.user_has_permission(%L, %L)) WITH CHECK ((%s) AND public.user_has_permission(%L, %L))',
          p.policyname, v.table_name,
          v_using, v.module_name, v.action_name,
          v_check, v.module_name, v.action_name
        );
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- Ownership-sensitive resources keep self access but no longer expose every
-- tenant row to any authenticated user.
ALTER POLICY user_consents_tenant_sel ON public.user_consents
  USING (
    tenant_id = public.get_my_tenant_id()
    AND (
      user_id = (
        SELECT u.id
        FROM public.users u
        WHERE u.auth_user_id = (SELECT auth.uid())
          AND u.status = 'active'::public.user_status
          AND u.deleted_at IS NULL
          AND (u.locked_until IS NULL OR u.locked_until <= now())
      )
      OR public.user_has_permission('users', 'read')
    )
  );

ALTER POLICY user_consents_tenant_ins ON public.user_consents
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND user_id = (
      SELECT u.id
      FROM public.users u
      WHERE u.auth_user_id = (SELECT auth.uid())
        AND u.status = 'active'::public.user_status
        AND u.deleted_at IS NULL
        AND (u.locked_until IS NULL OR u.locked_until <= now())
    )
  );

ALTER POLICY tenant_memberships_select_own_tenant
  ON public.tenant_memberships
  USING (
    tenant_id = public.get_my_tenant_id()
    AND deleted_at IS NULL
    AND (
      user_id = (
        SELECT u.id
        FROM public.users u
        WHERE u.auth_user_id = (SELECT auth.uid())
          AND u.status = 'active'::public.user_status
          AND u.deleted_at IS NULL
          AND (u.locked_until IS NULL OR u.locked_until <= now())
      )
      OR public.user_has_permission('users', 'read')
    )
  );

ALTER POLICY user_role_assignments_select_own_tenant
  ON public.user_role_assignments
  USING (
    tenant_id = public.get_my_tenant_id()
    AND deleted_at IS NULL
    AND (
      user_id = (
        SELECT u.id
        FROM public.users u
        WHERE u.auth_user_id = (SELECT auth.uid())
          AND u.status = 'active'::public.user_status
          AND u.deleted_at IS NULL
          AND (u.locked_until IS NULL OR u.locked_until <= now())
      )
      OR public.user_has_permission('roles', 'read')
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Bucket-specific Storage RBAC and traversal-safe tenant prefixes.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS storage_read_own_tenant ON storage.objects;
DROP POLICY IF EXISTS storage_insert_own_tenant ON storage.objects;
DROP POLICY IF EXISTS storage_read_invoice_docs ON storage.objects;
DROP POLICY IF EXISTS storage_insert_invoice_docs ON storage.objects;
DROP POLICY IF EXISTS storage_update_invoice_docs ON storage.objects;
DROP POLICY IF EXISTS storage_delete_invoice_docs ON storage.objects;

DO $$
DECLARE
  v_policy text;
BEGIN
  FOREACH v_policy IN ARRAY ARRAY[
    'storage_driver_photos_read',
    'storage_driver_photos_insert',
    'storage_driver_photos_update',
    'storage_driver_documents_read',
    'storage_driver_documents_insert',
    'storage_driver_documents_update',
    'storage_vehicle_photos_read',
    'storage_vehicle_photos_insert',
    'storage_vehicle_photos_update',
    'storage_vehicle_documents_read',
    'storage_vehicle_documents_insert',
    'storage_vehicle_documents_update',
    'storage_violation_evidence_read',
    'storage_violation_evidence_insert',
    'storage_violation_evidence_update',
    'storage_generated_reports_read',
    'storage_payroll_payslips_read',
    'storage_invoice_documents_read',
    'storage_invoice_documents_insert',
    'storage_invoice_documents_update',
    'storage_invoice_documents_delete',
    'storage_company_assets_insert',
    'storage_company_assets_update',
    'storage_company_assets_delete'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      v_policy
    );
  END LOOP;
END
$$;

CREATE POLICY storage_driver_photos_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'driver-photos'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('drivers', 'read')
  );
CREATE POLICY storage_driver_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'driver-photos'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('drivers', 'update')
  );
CREATE POLICY storage_driver_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'driver-photos'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('drivers', 'update')
  )
  WITH CHECK (
    bucket_id = 'driver-photos'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('drivers', 'update')
  );

CREATE POLICY storage_driver_documents_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('drivers', 'read')
  );
CREATE POLICY storage_driver_documents_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'driver-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('drivers', 'update')
  );
CREATE POLICY storage_driver_documents_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('drivers', 'update')
  )
  WITH CHECK (
    bucket_id = 'driver-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('drivers', 'update')
  );

CREATE POLICY storage_vehicle_photos_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'vehicle-photos'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('vehicles', 'read')
  );
CREATE POLICY storage_vehicle_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('vehicles', 'update')
  );
CREATE POLICY storage_vehicle_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'vehicle-photos'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('vehicles', 'update')
  )
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('vehicles', 'update')
  );

CREATE POLICY storage_vehicle_documents_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('vehicles', 'read')
  );
CREATE POLICY storage_vehicle_documents_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('vehicles', 'update')
  );
CREATE POLICY storage_vehicle_documents_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('vehicles', 'update')
  )
  WITH CHECK (
    bucket_id = 'vehicle-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('vehicles', 'update')
  );

CREATE POLICY storage_violation_evidence_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'violation-evidence'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('violations', 'read')
  );
CREATE POLICY storage_violation_evidence_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'violation-evidence'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('violations', 'create')
  );
CREATE POLICY storage_violation_evidence_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'violation-evidence'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('violations', 'update')
  )
  WITH CHECK (
    bucket_id = 'violation-evidence'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('violations', 'update')
  );

CREATE POLICY storage_generated_reports_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'generated-reports'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('reports', 'read')
  );

CREATE POLICY storage_payroll_payslips_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payroll-payslips'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('payroll', 'read')
  );

CREATE POLICY storage_invoice_documents_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoice-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('invoices', 'read')
  );
CREATE POLICY storage_invoice_documents_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'invoice-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('invoices', 'create')
  );
CREATE POLICY storage_invoice_documents_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'invoice-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('invoices', 'update')
  )
  WITH CHECK (
    bucket_id = 'invoice-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('invoices', 'update')
  );
CREATE POLICY storage_invoice_documents_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'invoice-documents'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('invoices', 'update')
  );

-- company-assets remains publicly readable; only settings managers can write
-- tenant-prefixed objects.
CREATE POLICY storage_company_assets_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-assets'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('settings', 'manage')
  );
CREATE POLICY storage_company_assets_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('settings', 'manage')
  )
  WITH CHECK (
    bucket_id = 'company-assets'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('settings', 'manage')
  );
CREATE POLICY storage_company_assets_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND public.storage_path_in_current_tenant(name)
    AND public.user_has_permission('settings', 'manage')
  );

-- import-files has no approved human-facing workflow. It is service-role only
-- until a module-specific import permission is approved.

-- ---------------------------------------------------------------------------
-- 6. Explicit least-privilege Data API grants.
-- ---------------------------------------------------------------------------

DO $secrets$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='zatca_csids'
 LOOP EXECUTE format('DROP POLICY %I ON public.zatca_csids',p.policyname); END LOOP;
END;
$secrets$;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT DISTINCT pp.tablename, pp.cmd
    FROM pg_policies pp
    WHERE pp.schemaname = 'public'
      AND 'authenticated' = ANY(pp.roles)
  LOOP
    IF p.cmd = 'ALL' THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated',
        p.tablename
      );
    ELSIF p.cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') THEN
      EXECUTE format(
        'GRANT %s ON public.%I TO authenticated',
        p.cmd, p.tablename
      );
    END IF;
  END LOOP;

  FOR p IN
    SELECT DISTINCT pp.tablename, pp.cmd
    FROM pg_policies pp
    WHERE pp.schemaname = 'public'
      AND 'anon' = ANY(pp.roles)
  LOOP
    IF p.cmd = 'ALL' THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon',
        p.tablename
      );
    ELSIF p.cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') THEN
      EXECUTE format(
        'GRANT %s ON public.%I TO anon',
        p.cmd, p.tablename
      );
    END IF;
  END LOOP;
END
$$;

GRANT SELECT ON public.balance_sheet TO authenticated;
GRANT SELECT ON public.cash_flow TO authenticated;
GRANT SELECT ON public.profit_loss TO authenticated;
GRANT SELECT ON public.trial_balance TO authenticated;
GRANT SELECT ON public.vat_reconciliation TO authenticated;
GRANT SELECT ON public.vehicle_active_documents TO authenticated;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON storage.objects FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON storage.objects FROM authenticated;

-- ---------------------------------------------------------------------------
-- 7. Post-condition guards.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_definition text;
  v_bad record;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_my_tenant_id()'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%status = %active%'
     OR v_definition NOT LIKE '%deleted_at IS NULL%'
     OR v_definition NOT LIKE '%locked_until%' THEN
    RAISE EXCEPTION 'get_my_tenant_id account-state guard missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.storage_path_in_current_tenant(text)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%status = %active%'
     OR v_definition NOT LIKE '%deleted_at IS NULL%'
     OR v_definition NOT LIKE '%locked_until%'
     OR v_definition NOT LIKE '%p_name !~%' THEN
    RAISE EXCEPTION 'Storage account-state/path guard missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND cmd = 'INSERT'
      AND 'authenticated' = ANY(roles)
  ) OR has_table_privilege(
    'authenticated', 'public.audit_log', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'authenticated audit_log INSERT remains exposed';
  END IF;

  FOR v_bad IN
    SELECT pp.tablename, pp.policyname, pp.cmd
    FROM pg_policies pp
    WHERE pp.schemaname = 'public'
      AND 'authenticated' = ANY(pp.roles)
      AND pp.tablename NOT IN (
        'driver_application_platforms',
        'platform_admins',
        'platform_invoices'
      )
      AND COALESCE(pp.qual, '') || COALESCE(pp.with_check, '')
          NOT LIKE '%user_has_permission%'
      AND COALESCE(pp.qual, '') || COALESCE(pp.with_check, '')
          NOT LIKE '%auth.uid()%'
  LOOP
    RAISE EXCEPTION 'broad authenticated policy remains: %.% (%)',
      v_bad.tablename, v_bad.policyname, v_bad.cmd;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('anon', 'authenticated')
      AND g.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'broad non-DML Data API grant remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies pp
    WHERE pp.schemaname = 'storage'
      AND pp.tablename = 'objects'
      AND pp.policyname = 'storage_driver_documents_insert'
      AND pp.with_check LIKE '%storage_path_in_current_tenant%'
      AND pp.with_check LIKE '%user_has_permission%'
  ) THEN
    RAISE EXCEPTION 'bucket-specific Storage RBAC missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.validate_leave_request(uuid,text,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous leave validator execution remains';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
