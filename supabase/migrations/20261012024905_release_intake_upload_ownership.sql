-- Browser uploads require a server-issued signed upload grant. No live data is modified.
BEGIN;
DROP POLICY IF EXISTS "anon_insert_driver_drafts" ON storage.objects;
DROP POLICY IF EXISTS "driver_apps_upload_anon" ON storage.objects;
DROP POLICY IF EXISTS "anon_insert_drafts" ON storage.objects;

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

  -- Lock immutable upload objects in a stable order. Concurrent submissions cannot
  -- claim the same object twice, including across different tenants.
  PERFORM o.id FROM storage.objects o
  WHERE o.bucket_id = 'driver-applications'
    AND o.name IN (SELECT d.storage_path FROM jsonb_to_recordset(p_documents) AS d(storage_path text))
  ORDER BY o.name FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_documents) AS d(storage_path text, document_type text)
    LEFT JOIN storage.objects o ON o.bucket_id = 'driver-applications' AND o.name = d.storage_path
    WHERE o.id IS NULL
      OR COALESCE((o.metadata ->> 'size')::bigint, 0) NOT BETWEEN 1 AND 5242880
      OR COALESCE(o.metadata ->> 'mimetype', '') NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      OR (d.document_type = 'profile_photo' AND o.metadata ->> 'mimetype' = 'application/pdf')
      OR EXISTS (SELECT 1 FROM public.driver_application_documents used WHERE used.storage_path = d.storage_path)
  ) OR (SELECT count(*) <> count(DISTINCT d.storage_path) OR count(*) <> count(DISTINCT d.document_type)
        FROM jsonb_to_recordset(p_documents) AS d(storage_path text, document_type text)) THEN
    RAISE EXCEPTION 'APP_DOCUMENT_INVALID: missing, invalid, or already claimed upload' USING ERRCODE = '22023';
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


COMMIT;
