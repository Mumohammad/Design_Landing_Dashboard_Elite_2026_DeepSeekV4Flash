-- 029_driver_applications.sql
-- Public Driver Registration portal (2026).
--
-- The driver registration page is PUBLIC and ZERO-LOGIN. Applicants submit
-- without an account. Security model:
--   * anon can INSERT into driver_applications + driver_application_documents
--   * anon can SELECT driver_application_platforms (public config only)
--   * anon CANNOT select/update/delete applications or read documents
--   * documents live in a PRIVATE storage bucket (anon upload only, no read)
--   * tenant_id is resolved server-side (never exposed to applicants)
--
-- Tables are future multi-tenant ready (tenant_id on every record).
-- Source: docs/phase-2-schema-plan.md (Driver Registration module).

-- ═══ Helper: resolve the default tenant for anonymous submissions ═══
CREATE OR REPLACE FUNCTION get_default_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM tenants WHERE status = 'active' ORDER BY created_at ASC LIMIT 1;
$$;

-- ═══ Public platform options (driven from config, not hardcoded UI) ═══
CREATE TABLE IF NOT EXISTS driver_application_platforms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  name_ur     TEXT,
  name_bn     TEXT,
  emoji       TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO driver_application_platforms (code, name_en, name_ar, name_ur, name_bn, emoji, sort_order)
VALUES
  ('hungerstation', 'HungerStation', 'هنقرستيشن', 'ہنگر سٹیشن', 'হাঙ্গার স্টেশন', '🍔', 10),
  ('keeta',         'Keeta',         'كيتا',         'کیتا',         'কিতা',         '🍽️', 20),
  ('noon',          'Noon',          'نون',           'نون',          'নুন',          '🟡', 30),
  ('ninja',         'Ninja',         'نينجا',         'نجا',          'নিনজা',        '🥷', 40)
ON CONFLICT (code) DO NOTHING;

-- ═══ Driver applications ═══
CREATE TABLE IF NOT EXISTS driver_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_number    TEXT NOT NULL UNIQUE,
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  locale                TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('ar','en','ur','bn')),

  -- Personal
  first_name            TEXT NOT NULL,
  middle_name           TEXT,
  last_name             TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  date_of_birth         DATE,
  nationality           TEXT,
  gender                TEXT CHECK (gender IN ('male','female')),

  -- Contact
  mobile                TEXT NOT NULL,
  alternative_mobile    TEXT,
  email                 TEXT,
  city                  TEXT,
  district              TEXT,
  address               TEXT,

  -- Identity
  identity_type         TEXT NOT NULL CHECK (identity_type IN ('iqama','national_id','passport')),
  identity_number       TEXT,
  identity_expiry       DATE,

  -- Driving license
  license_number        TEXT,
  license_type          TEXT,
  license_country       TEXT,
  license_expiry        DATE,

  -- Work
  work_type             TEXT NOT NULL CHECK (work_type IN ('full_time','freelancer')),
  driver_category       TEXT CHECK (driver_category IN ('sponsored_type_1','sponsored_type_2','freelancer')),
  platform_codes        JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Vehicle
  has_vehicle           BOOLEAN,
  vehicle_ownership     TEXT,
  vehicle_type          TEXT,
  vehicle_make         TEXT,
  vehicle_model        TEXT,
  vehicle_year          SMALLINT,
  vehicle_plate         TEXT,
  vehicle_reg_expiry    DATE,
  vehicle_insurance_expiry DATE,

  -- Consent
  consent_terms         BOOLEAN NOT NULL DEFAULT false,
  consent_privacy       BOOLEAN NOT NULL DEFAULT false,
  consent_at            TIMESTAMPTZ,

  status                TEXT NOT NULL DEFAULT 'submitted'
                          CHECK (status IN ('submitted','under_review','approved','rejected')),
  ip_hash               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══ Application documents (metadata only; files stay in private storage) ═══
CREATE TABLE IF NOT EXISTS driver_application_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID NOT NULL REFERENCES driver_applications(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  document_type         TEXT NOT NULL,  -- profile_photo | identity | license | vehicle_reg | vehicle_insurance
  file_name             TEXT NOT NULL,
  storage_path          TEXT NOT NULL,
  mime_type             TEXT,
  file_size             BIGINT,
  expiry_date           DATE,
  verification_status   TEXT NOT NULL DEFAULT 'pending'
                          CHECK (verification_status IN ('pending','verified','rejected')),
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID REFERENCES auth.users(id)
);

-- Application number sequence: DRV-{year}-{6-digit}
CREATE SEQUENCE IF NOT EXISTS driver_application_number_seq START 1;

CREATE OR REPLACE FUNCTION assign_application_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.application_number IS NULL OR NEW.application_number = '' THEN
    NEW.application_number := 'DRV-' || to_char(NEW.submitted_at, 'YYYY') || '-' ||
                              lpad(nextval('driver_application_number_seq')::text, 6, '0');
  END IF;
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := get_default_tenant_id();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_applications_number ON driver_applications;
CREATE TRIGGER trg_driver_applications_number
  BEFORE INSERT ON driver_applications
  FOR EACH ROW EXECUTE FUNCTION assign_application_number();

-- ═══ Storage: private bucket with anon-upload-only policy ═══
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-applications',
  'driver-applications',
  false,
  5242880,  -- 5 MB per file
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Anonymous applicants may UPLOAD into the bucket (path-scoped to their draft).
DROP POLICY IF EXISTS "driver_apps_upload_anon" ON storage.objects;
CREATE POLICY "driver_apps_upload_anon"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'driver-applications'
    AND (storage.foldername(name))[1] = 'drafts'
  );

-- No anon SELECT policy → documents are never publicly readable.
-- Authenticated staff (any tenant role) can read within their tenant folder
-- via the service role / admin client. Additional tenant-scoped policies can
-- be layered here when the admin review UI ships.

-- ═══ RLS ═══
ALTER TABLE driver_application_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_application_documents ENABLE ROW LEVEL SECURITY;

-- Platform config: public read-only
DROP POLICY IF EXISTS "driver_app_platforms_public_read" ON driver_application_platforms;
CREATE POLICY "driver_app_platforms_public_read"
  ON driver_application_platforms FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Applications: anonymous INSERT only. No SELECT/UPDATE/DELETE for anon.
DROP POLICY IF EXISTS "driver_apps_anon_insert" ON driver_applications;
CREATE POLICY "driver_apps_anon_insert"
  ON driver_applications FOR INSERT TO anon
  WITH CHECK (status = 'submitted' AND consent_terms = true AND consent_privacy = true);

-- Applications: authenticated staff can view (tenant-scoped) — admin review UI.
DROP POLICY IF EXISTS "driver_apps_staff_select" ON driver_applications;
CREATE POLICY "driver_apps_staff_select"
  ON driver_applications FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());

-- Documents: anonymous INSERT only (metadata mirror of the private upload).
DROP POLICY IF EXISTS "driver_app_docs_anon_insert" ON driver_application_documents;
CREATE POLICY "driver_app_docs_anon_insert"
  ON driver_application_documents FOR INSERT TO anon
  WITH CHECK (tenant_id = get_default_tenant_id());

-- Documents: authenticated staff can view metadata (tenant-scoped).
DROP POLICY IF EXISTS "driver_app_docs_staff_select" ON driver_application_documents;
CREATE POLICY "driver_app_docs_staff_select"
  ON driver_application_documents FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());

-- Indexes for the review flow + uniqueness
CREATE INDEX IF NOT EXISTS idx_driver_apps_created ON driver_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_apps_status ON driver_applications (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_driver_app_docs_app ON driver_application_documents (application_id);
CREATE INDEX IF NOT EXISTS idx_driver_app_docs_tenant ON driver_application_documents (tenant_id);
