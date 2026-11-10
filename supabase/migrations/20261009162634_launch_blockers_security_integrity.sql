-- Launch-blocker security and integrity hardening.
-- Forward-only and idempotent: functions are replaced in place, policies are
-- altered/recreated by their stable names, and all grants are re-asserted.

-- ---------------------------------------------------------------------------
-- 1. Database-level RBAC helper used by RLS and privileged RPCs.
-- ---------------------------------------------------------------------------

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
      AND u.status = 'active'
      AND u.deleted_at IS NULL
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
GRANT EXECUTE ON FUNCTION public.user_has_permission(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_callers_role(p_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r
      ON r.tenant_id = u.tenant_id
     AND r.name = u.role
     AND r.deleted_at IS NULL
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.status = 'active'
      AND u.deleted_at IS NULL
      AND r.id = p_role_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_callers_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_callers_role(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Tenant-bind SECURITY DEFINER reads to the authenticated caller.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fetch_pending_approvals(
  p_tenant_id uuid,
  p_type      text        DEFAULT NULL,
  p_from      timestamptz DEFAULT NULL,
  p_to        timestamptz DEFAULT NULL,
  p_limit     integer     DEFAULT 50
)
RETURNS TABLE (
  item_type    text,
  item_id      uuid,
  subject      text,
  subject_meta jsonb,
  requester    text,
  requested_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH caller AS (
    SELECT public.get_my_tenant_id() AS tenant_id
  )
  SELECT *
  FROM (
    SELECT
      'expense'::text AS item_type,
      e.id AS item_id,
      COALESCE(e.expense_code, 'EXP-' || LEFT(e.id::text, 8)) AS subject,
      jsonb_build_object(
        'amount', e.amount,
        'currency', e.currency,
        'expense_type', e.expense_type,
        'category', e.category,
        'vendor', e.vendor,
        'expense_date', e.expense_date
      ) AS subject_meta,
      COALESCE(e.vendor, '') AS requester,
      e.created_at AS requested_at
    FROM public.expenses e
    CROSS JOIN caller c
    WHERE c.tenant_id IS NOT NULL
      AND p_tenant_id = c.tenant_id
      AND public.user_has_permission('expenses', 'approve')
      AND e.tenant_id = c.tenant_id
      AND e.deleted_at IS NULL
      AND e.is_approved = FALSE
      AND (p_type IS NULL OR p_type = 'expense')
      AND (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to IS NULL OR e.created_at <= p_to)

    UNION ALL

    SELECT
      'leave_request'::text,
      r.id,
      COALESCE(t.name_en, t.name_ar, t.code),
      jsonb_build_object(
        'driver_id', r.driver_id,
        'leave_type', t.code,
        'start_date', r.start_date,
        'end_date', r.end_date,
        'days_requested', r.days_requested,
        'reason', r.reason
      ),
      '',
      r.requested_at
    FROM public.driver_leave_requests r
    JOIN public.leave_types t ON t.id = r.leave_type_id
    CROSS JOIN caller c
    WHERE c.tenant_id IS NOT NULL
      AND p_tenant_id = c.tenant_id
      AND public.user_has_permission('attendance', 'approve')
      AND r.tenant_id = c.tenant_id
      AND r.deleted_at IS NULL
      AND r.status = 'pending'
      AND (p_type IS NULL OR p_type = 'leave_request')
      AND (p_from IS NULL OR r.requested_at >= p_from)
      AND (p_to IS NULL OR r.requested_at <= p_to)

    UNION ALL

    SELECT
      'application'::text,
      a.id,
      a.application_number,
      jsonb_build_object(
        'full_name', a.full_name,
        'mobile_hashed', CASE WHEN a.mobile IS NOT NULL THEN 'present' ELSE NULL END,
        'city', a.city,
        'work_type', a.work_type,
        'driver_category', a.driver_category,
        'status', a.status
      ),
      '',
      a.submitted_at
    FROM public.driver_applications a
    CROSS JOIN caller c
    WHERE c.tenant_id IS NOT NULL
      AND p_tenant_id = c.tenant_id
      AND public.user_has_permission('hr', 'approve')
      AND a.tenant_id = c.tenant_id
      AND a.status IN ('submitted', 'under_review')
      AND (p_type IS NULL OR p_type = 'application')
      AND (p_from IS NULL OR a.submitted_at >= p_from)
      AND (p_to IS NULL OR a.submitted_at <= p_to)
  ) q
  ORDER BY q.requested_at ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
$$;

REVOKE ALL ON FUNCTION public.fetch_pending_approvals(uuid, text, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_pending_approvals(uuid, text, timestamptz, timestamptz, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fetch_audit_trail_page(
  p_tenant_id      uuid,
  p_from           timestamptz DEFAULT NULL,
  p_to             timestamptz DEFAULT NULL,
  p_actor_user_id  uuid        DEFAULT NULL,
  p_action         text        DEFAULT NULL,
  p_module         text        DEFAULT NULL,
  p_entity_type    text        DEFAULT NULL,
  p_entity_id      uuid        DEFAULT NULL,
  p_limit          integer     DEFAULT 50
)
RETURNS TABLE (
  id          uuid,
  created_at  timestamptz,
  module      text,
  action      text,
  entity_type text,
  entity_id   uuid,
  actor_id    uuid,
  ip_address  inet,
  reason      text,
  old_values  jsonb,
  new_values  jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH caller AS (
    SELECT public.get_my_tenant_id() AS tenant_id
    WHERE public.user_has_permission('audit_log', 'read')
  )
  SELECT
    a.id,
    a.created_at,
    a.module,
    a.action,
    a.entity_type,
    a.entity_id,
    a.actor_id,
    a.ip_address,
    CASE
      WHEN a.new_values ? 'reason' THEN NULLIF(a.new_values ->> 'reason', '')
      WHEN a.old_values ? 'reason' THEN NULLIF(a.old_values ->> 'reason', '')
      WHEN a.new_values ? 'archived_reason' THEN NULLIF(a.new_values ->> 'archived_reason', '')
      ELSE NULL
    END,
    a.old_values,
    a.new_values
  FROM public.audit_log a
  CROSS JOIN caller c
  WHERE c.tenant_id IS NOT NULL
    AND p_tenant_id = c.tenant_id
    AND a.tenant_id = c.tenant_id
    AND (p_from IS NULL OR a.created_at >= p_from)
    AND (p_to IS NULL OR a.created_at <= p_to)
    AND (
      p_actor_user_id IS NULL
      OR a.actor_id = (
        SELECT u.auth_user_id
        FROM public.users u
        WHERE u.id = p_actor_user_id
          AND u.tenant_id = c.tenant_id
        LIMIT 1
      )
    )
    AND (p_action IS NULL OR a.action = p_action)
    AND (p_module IS NULL OR a.module = p_module)
    AND (p_entity_type IS NULL OR a.entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR a.entity_id = p_entity_id)
  ORDER BY a.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
$$;

REVOKE ALL ON FUNCTION public.fetch_audit_trail_page(
  uuid, timestamptz, timestamptz, uuid, text, text, text, uuid, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_audit_trail_page(
  uuid, timestamptz, timestamptz, uuid, text, text, text, uuid, integer
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_driver_status(
  p_driver_id  uuid,
  p_status     public.driver_status,
  p_reason     text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_caller_tenant uuid := public.get_my_tenant_id();
  v_driver_tenant uuid;
  v_current public.driver_status;
  v_service_role boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF NOT v_service_role THEN
    IF v_auth_user_id IS NULL OR v_caller_tenant IS NULL THEN
      RAISE EXCEPTION 'AUTH001: authentication required' USING ERRCODE = '42501';
    END IF;

    IF NOT public.user_has_permission('drivers', 'update') THEN
      RAISE EXCEPTION 'AUTH007: drivers:update permission required' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT d.tenant_id, d.status
    INTO v_driver_tenant, v_current
  FROM public.drivers d
  WHERE d.id = p_driver_id
    AND d.deleted_at IS NULL
  FOR UPDATE;

  IF v_driver_tenant IS NULL THEN
    RAISE EXCEPTION 'DRV001: driver not found';
  END IF;

  IF NOT v_service_role AND v_driver_tenant <> v_caller_tenant THEN
    RAISE EXCEPTION 'AUTH006: cross-tenant driver access denied' USING ERRCODE = '42501';
  END IF;

  IF v_current = p_status THEN
    RETURN;
  END IF;

  UPDATE public.drivers
  SET status = p_status,
      updated_by = CASE WHEN v_service_role THEN p_changed_by ELSE v_auth_user_id END,
      updated_at = now()
  WHERE id = p_driver_id;

  -- The reason remains part of the stable public signature for existing callers.
  PERFORM p_reason;
END;
$$;

REVOKE ALL ON FUNCTION public.set_driver_status(uuid, public.driver_status, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_driver_status(uuid, public.driver_status, text, uuid)
  TO authenticated, service_role;

-- The previous helper used bool_and over whichever consent rows happened to
-- exist, so one accepted consent incorrectly satisfied the documented
-- two-consent gate. Require both latest consent types explicitly.
CREATE OR REPLACE FUNCTION public.has_pdpl_consent(p_driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (c.consent_type)
      c.consent_type,
      c.accepted
    FROM public.driver_consents c
    WHERE c.driver_id = p_driver_id
      AND c.consent_type IN ('photo', 'sensitive_docs')
    ORDER BY c.consent_type, c.created_at DESC
  )
  SELECT count(*) = 2 AND bool_and(accepted)
  FROM latest
$$;

REVOKE ALL ON FUNCTION public.has_pdpl_consent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_pdpl_consent(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Tighten priority-table RLS with the same permission vocabulary used by
--    server actions. Existing tenant and soft-delete predicates are retained.
-- ---------------------------------------------------------------------------

ALTER POLICY "drivers_select_own_tenant" ON public.drivers
  USING (tenant_id = public.get_my_tenant_id() AND deleted_at IS NULL
         AND public.user_has_permission('drivers', 'read'));
ALTER POLICY "drivers_insert_own_tenant" ON public.drivers
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('drivers', 'create'));
ALTER POLICY "drivers_update_own_tenant" ON public.drivers
  USING (tenant_id = public.get_my_tenant_id()
         AND public.user_has_permission('drivers', 'update'))
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('drivers', 'update'));

ALTER POLICY "vehicles_select_own_tenant" ON public.vehicles
  USING (tenant_id = public.get_my_tenant_id() AND deleted_at IS NULL
         AND public.user_has_permission('vehicles', 'read'));
ALTER POLICY "vehicles_insert_own_tenant" ON public.vehicles
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('vehicles', 'create'));
ALTER POLICY "vehicles_update_own_tenant" ON public.vehicles
  USING (tenant_id = public.get_my_tenant_id()
         AND public.user_has_permission('vehicles', 'update'))
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('vehicles', 'update'));

ALTER POLICY violations_sel ON public.violations
  USING (tenant_id = public.get_my_tenant_id() AND deleted_at IS NULL
         AND public.user_has_permission('violations', 'read'));
ALTER POLICY violations_ins ON public.violations
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('violations', 'create'));
ALTER POLICY violations_upd ON public.violations
  USING (tenant_id = public.get_my_tenant_id()
         AND public.user_has_permission('violations', 'update'))
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('violations', 'update'));

ALTER POLICY "payroll_periods_sel" ON public.driver_payroll_periods
  USING (tenant_id = public.get_my_tenant_id() AND deleted_at IS NULL
         AND public.user_has_permission('payroll', 'read'));
ALTER POLICY "payroll_periods_ins" ON public.driver_payroll_periods
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('payroll', 'create'));
ALTER POLICY "payroll_periods_upd" ON public.driver_payroll_periods
  USING (tenant_id = public.get_my_tenant_id()
         AND public.user_has_permission('payroll', 'update'))
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('payroll', 'update'));

ALTER POLICY "sel_invoices_tenant" ON public.invoices
  USING (tenant_id = public.get_my_tenant_id() AND deleted_at IS NULL
         AND public.user_has_permission('invoices', 'read'));
ALTER POLICY "ins_invoices_tenant" ON public.invoices
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('invoices', 'create'));
ALTER POLICY "upd_invoices_tenant" ON public.invoices
  USING (tenant_id = public.get_my_tenant_id() AND deleted_at IS NULL
         AND public.user_has_permission('invoices', 'update'))
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('invoices', 'update'));

ALTER POLICY "expenses_sel" ON public.expenses
  USING (tenant_id = public.get_my_tenant_id() AND deleted_at IS NULL
         AND public.user_has_permission('expenses', 'read'));
ALTER POLICY "expenses_ins" ON public.expenses
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('expenses', 'create'));
ALTER POLICY "expenses_upd" ON public.expenses
  USING (tenant_id = public.get_my_tenant_id()
         AND public.user_has_permission('expenses', 'update'))
  WITH CHECK (tenant_id = public.get_my_tenant_id()
              AND public.user_has_permission('expenses', 'update'));

ALTER POLICY "users_select_own_tenant" ON public.users
  USING (
    tenant_id = public.get_my_tenant_id()
    AND deleted_at IS NULL
    AND (
      auth_user_id = (SELECT auth.uid())
      OR public.user_has_permission('users', 'read')
      OR public.user_has_permission('users', 'manage')
    )
  );

ALTER POLICY "roles_select_own_tenant" ON public.roles
  USING (
    tenant_id = public.get_my_tenant_id()
    AND deleted_at IS NULL
    AND (
      public.is_callers_role(id)
      OR public.user_has_permission('roles', 'read')
      OR public.user_has_permission('roles', 'manage')
    )
  );

ALTER POLICY "role_permissions_select" ON public.role_permissions
  USING (
    public.is_callers_role(role_id)
    OR public.user_has_permission('roles', 'read')
    OR public.user_has_permission('roles', 'manage')
  );

ALTER POLICY "audit_log_select_own_tenant" ON public.audit_log
  USING (tenant_id = public.get_my_tenant_id()
         AND public.user_has_permission('audit_log', 'read'));

-- ---------------------------------------------------------------------------
-- 4. Atomic, tenant-bound public driver application provisioning.
-- ---------------------------------------------------------------------------

-- Public intake needs a stable, non-secret tenant identifier. Existing
-- company-registration callers already write `slug`, but the column was never
-- represented in the migration history on this branch.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS slug text;

-- Existing tenant slugs require a separately reviewed operator assignment.

CREATE OR REPLACE FUNCTION public.assign_tenant_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := COALESCE(
      NULLIF(
        lower(trim(both '-' FROM regexp_replace(NEW.name_en, '[^a-zA-Z0-9]+', '-', 'g'))),
        ''
      ),
      'tenant'
    ) || '-' || left(NEW.id::text, 8);
  ELSE
    NEW.slug := lower(btrim(NEW.slug));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_tenant_slug ON public.tenants;
CREATE TRIGGER trg_assign_tenant_slug
  BEFORE INSERT OR UPDATE OF slug, name_en ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.assign_tenant_slug();

REVOKE ALL ON FUNCTION public.assign_tenant_slug() FROM PUBLIC, anon, authenticated;

-- Existing rows can remain NULL; new inserts receive a slug from the trigger.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug_active
  ON public.tenants (lower(slug))
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.provision_driver_application_atomic(
  p_tenant_slug text,
  p_application jsonb,
  p_documents jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_application_id uuid;
  v_application_number text;
  v_document_count integer;
BEGIN
  IF p_tenant_slug IS NULL OR btrim(p_tenant_slug) = '' THEN
    RAISE EXCEPTION 'APP_TENANT_REQUIRED: tenant slug is required' USING ERRCODE = '22023';
  END IF;

  SELECT t.id
    INTO v_tenant_id
  FROM public.tenants t
  WHERE t.slug = lower(btrim(p_tenant_slug))
    AND t.status = 'active'
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'APP_TENANT_NOT_FOUND: unknown or inactive tenant' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_application) <> 'object' OR jsonb_typeof(p_documents) <> 'array' THEN
    RAISE EXCEPTION 'APP_PAYLOAD_INVALID: invalid application payload' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT d.document_type)
    INTO v_document_count
  FROM jsonb_to_recordset(p_documents) AS d(document_type text, storage_path text)
  WHERE d.document_type IN ('profile_photo', 'identity', 'license');

  IF v_document_count <> 3 THEN
    RAISE EXCEPTION 'APP_DOCUMENTS_REQUIRED: profile, identity, and license documents are required'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_documents) AS d(document_type text, storage_path text)
    WHERE d.document_type NOT IN (
      'profile_photo', 'identity', 'license', 'vehicle_reg', 'vehicle_insurance'
    )
      OR d.storage_path !~* '^drafts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
  ) THEN
    RAISE EXCEPTION 'APP_DOCUMENT_PATH_INVALID: invalid document metadata' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.driver_applications (
    tenant_id, locale,
    first_name, middle_name, last_name, full_name, date_of_birth, nationality, gender,
    mobile, alternative_mobile, email, city, district, address,
    identity_type, identity_number, identity_expiry,
    license_number, license_type, license_country, license_expiry,
    work_type, driver_category, platform_codes,
    has_vehicle, vehicle_ownership, vehicle_type, vehicle_make, vehicle_model,
    vehicle_year, vehicle_plate, vehicle_reg_expiry, vehicle_insurance_expiry,
    consent_terms, consent_privacy, consent_at, status, status_token_hash, ip_hash
  ) VALUES (
    v_tenant_id,
    p_application ->> 'locale',
    p_application ->> 'first_name',
    NULLIF(p_application ->> 'middle_name', ''),
    p_application ->> 'last_name',
    p_application ->> 'full_name',
    NULLIF(p_application ->> 'date_of_birth', '')::date,
    NULLIF(p_application ->> 'nationality', ''),
    NULLIF(p_application ->> 'gender', ''),
    p_application ->> 'mobile',
    NULLIF(p_application ->> 'alternative_mobile', ''),
    NULLIF(p_application ->> 'email', ''),
    NULLIF(p_application ->> 'city', ''),
    NULLIF(p_application ->> 'district', ''),
    NULLIF(p_application ->> 'address', ''),
    p_application ->> 'identity_type',
    NULLIF(p_application ->> 'identity_number', ''),
    NULLIF(p_application ->> 'identity_expiry', '')::date,
    NULLIF(p_application ->> 'license_number', ''),
    NULLIF(p_application ->> 'license_type', ''),
    NULLIF(p_application ->> 'license_country', ''),
    NULLIF(p_application ->> 'license_expiry', '')::date,
    p_application ->> 'work_type',
    NULLIF(p_application ->> 'driver_category', ''),
    COALESCE(p_application -> 'platform_codes', '[]'::jsonb),
    COALESCE((p_application ->> 'has_vehicle')::boolean, false),
    NULLIF(p_application ->> 'vehicle_ownership', ''),
    NULLIF(p_application ->> 'vehicle_type', ''),
    NULLIF(p_application ->> 'vehicle_make', ''),
    NULLIF(p_application ->> 'vehicle_model', ''),
    NULLIF(p_application ->> 'vehicle_year', '')::smallint,
    NULLIF(p_application ->> 'vehicle_plate', ''),
    NULLIF(p_application ->> 'vehicle_reg_expiry', '')::date,
    NULLIF(p_application ->> 'vehicle_insurance_expiry', '')::date,
    COALESCE((p_application ->> 'consent_terms')::boolean, false),
    COALESCE((p_application ->> 'consent_privacy')::boolean, false),
    COALESCE(NULLIF(p_application ->> 'consent_at', '')::timestamptz, now()),
    'submitted',
    p_application ->> 'status_token_hash',
    NULLIF(p_application ->> 'ip_hash', '')
  )
  RETURNING id, application_number INTO v_application_id, v_application_number;

  INSERT INTO public.driver_application_documents (
    application_id, tenant_id, document_type, file_name, storage_path,
    mime_type, file_size, expiry_date
  )
  SELECT
    v_application_id,
    v_tenant_id,
    d.document_type,
    d.file_name,
    d.storage_path,
    d.mime_type,
    d.file_size,
    d.expiry_date
  FROM jsonb_to_recordset(p_documents) AS d(
    document_type text,
    file_name text,
    storage_path text,
    mime_type text,
    file_size bigint,
    expiry_date date
  );

  RETURN jsonb_build_object(
    'application_id', v_application_id,
    'application_number', v_application_number,
    'tenant_id', v_tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_driver_application_atomic(text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_driver_application_atomic(text, jsonb, jsonb)
  TO service_role;

-- Remove the direct anonymous metadata path: the service-role RPC is now the
-- only application + document-metadata write boundary.
DROP POLICY IF EXISTS "driver_apps_anon_insert" ON public.driver_applications;
DROP POLICY IF EXISTS "driver_app_docs_anon_insert" ON public.driver_application_documents;
REVOKE INSERT ON public.driver_applications FROM anon;
REVOKE INSERT ON public.driver_application_documents FROM anon;

-- Keep the numbering trigger, but remove its oldest-active-tenant fallback.
CREATE OR REPLACE FUNCTION public.assign_application_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'APP_TENANT_REQUIRED: tenant_id must be resolved before insert'
      USING ERRCODE = '23502';
  END IF;
  IF NEW.application_number IS NULL OR NEW.application_number = '' THEN
    NEW.application_number := 'DRV-' || to_char(NEW.submitted_at, 'YYYY') || '-' ||
                              lpad(nextval('public.driver_application_number_seq')::text, 6, '0');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.get_default_tenant_id() FROM PUBLIC, anon, authenticated;

-- Match the client-generated path exactly: drafts/<draft UUID>/<file UUID>.<ext>.
DROP POLICY IF EXISTS "driver_apps_upload_anon" ON storage.objects;
DROP POLICY IF EXISTS "anon_insert_driver_drafts" ON storage.objects;
DROP POLICY IF EXISTS "anon_insert_drafts" ON storage.objects;
CREATE POLICY "anon_insert_driver_drafts" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'driver-applications'
    AND name ~* '^drafts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
    AND (storage.foldername(name))[1] = 'drafts'
    AND array_length(storage.foldername(name), 1) = 2
    AND lower(COALESCE(metadata ->> 'mimetype', '')) IN (
      'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Post-condition guards: fail the migration if a security boundary drifted.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_policy record;
BEGIN
  IF to_regprocedure('public.user_has_permission(text,text)') IS NULL
     OR to_regprocedure('public.provision_driver_application_atomic(text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'launch-blocker helper/RPC missing after migration';
  END IF;

  IF has_function_privilege('anon', 'public.provision_driver_application_atomic(text,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.provision_driver_application_atomic(text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'atomic application RPC must remain service-role only';
  END IF;

  IF pg_get_functiondef(
       'public.fetch_pending_approvals(uuid,text,timestamptz,timestamptz,integer)'::regprocedure
     ) NOT LIKE '%get_my_tenant_id%'
     OR pg_get_functiondef(
       'public.fetch_pending_approvals(uuid,text,timestamptz,timestamptz,integer)'::regprocedure
     ) NOT LIKE '%user_has_permission%'
     OR pg_get_functiondef(
       'public.fetch_audit_trail_page(uuid,timestamptz,timestamptz,uuid,text,text,text,uuid,integer)'::regprocedure
     ) NOT LIKE '%get_my_tenant_id%'
     OR pg_get_functiondef(
       'public.fetch_audit_trail_page(uuid,timestamptz,timestamptz,uuid,text,text,text,uuid,integer)'::regprocedure
     ) NOT LIKE '%user_has_permission%'
     OR pg_get_functiondef(
       'public.set_driver_status(uuid,public.driver_status,text,uuid)'::regprocedure
     ) NOT LIKE '%get_my_tenant_id%'
     OR pg_get_functiondef(
       'public.set_driver_status(uuid,public.driver_status,text,uuid)'::regprocedure
     ) NOT LIKE '%user_has_permission%' THEN
    RAISE EXCEPTION 'tenant/RBAC guard missing from a launch-blocker RPC';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'storage'
      AND p.tablename = 'objects'
      AND p.policyname = 'anon_insert_driver_drafts'
      AND p.cmd = 'INSERT'
      AND p.with_check LIKE '%drafts/%'
      AND p.with_check LIKE '%application/pdf%'
  ) THEN
    RAISE EXCEPTION 'anonymous driver draft Storage policy post-condition failed';
  END IF;

  FOR v_policy IN
    SELECT expected.table_name, expected.policy_name, p.policyname, p.qual, p.with_check
    FROM (VALUES
      ('drivers', 'drivers_select_own_tenant'),
      ('drivers', 'drivers_insert_own_tenant'),
      ('drivers', 'drivers_update_own_tenant'),
      ('vehicles', 'vehicles_select_own_tenant'),
      ('vehicles', 'vehicles_insert_own_tenant'),
      ('vehicles', 'vehicles_update_own_tenant'),
      ('violations', 'violations_sel'),
      ('violations', 'violations_ins'),
      ('violations', 'violations_upd'),
      ('driver_payroll_periods', 'payroll_periods_sel'),
      ('driver_payroll_periods', 'payroll_periods_ins'),
      ('driver_payroll_periods', 'payroll_periods_upd'),
      ('invoices', 'sel_invoices_tenant'),
      ('invoices', 'ins_invoices_tenant'),
      ('invoices', 'upd_invoices_tenant'),
      ('expenses', 'expenses_sel'),
      ('expenses', 'expenses_ins'),
      ('expenses', 'expenses_upd'),
      ('users', 'users_select_own_tenant'),
      ('roles', 'roles_select_own_tenant'),
      ('role_permissions', 'role_permissions_select'),
      ('audit_log', 'audit_log_select_own_tenant')
    ) AS expected(table_name, policy_name)
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public'
     AND p.tablename = expected.table_name
     AND p.policyname = expected.policy_name
  LOOP
    IF v_policy.policyname IS NULL
       OR COALESCE(v_policy.qual, '') || COALESCE(v_policy.with_check, '') NOT LIKE '%user_has_permission%' THEN
      RAISE EXCEPTION 'RBAC policy guard missing: %.%', v_policy.table_name, v_policy.policy_name;
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
