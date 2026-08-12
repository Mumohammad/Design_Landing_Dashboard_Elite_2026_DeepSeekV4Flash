-- 014_drivers.sql
-- Module 1 (Drivers) — core tables, documents, emergency contacts.
-- Source: docs/elite-master-prompt-v2.md section 6 M1

-- ═══ Enums (Phase 3 — documented in schema plan section 4.3) ═══
CREATE TYPE driver_category AS ENUM ('sponsored_type1', 'sponsored_type2', 'freelancer');
CREATE TYPE driver_status AS ENUM ('draft', 'active', 'on_leave', 'suspended', 'terminated', 'blacklisted');
CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'contract', 'temporary');
CREATE TYPE contract_type AS ENUM ('unlimited', 'limited', 'task_based');
CREATE TYPE driver_document_type AS ENUM (
  'iqama', 'passport', 'driving_license', 'vehicle_license',
  'medical_certificate', 'police_clearance', 'employment_contract',
  'bank_letter', 'photo', 'other'
);

-- ═══ drivers table ═══
CREATE TABLE drivers (
  -- Universal
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES auth.users(id),
  updated_by              UUID REFERENCES auth.users(id),
  deleted_at              TIMESTAMPTZ,

  -- Identity
  driver_code             TEXT UNIQUE,
  full_name_ar            TEXT NOT NULL,
  full_name_en            TEXT,
  preferred_name          TEXT,
  photo_url               TEXT,
  nationality             TEXT,
  nationality_code        CHAR(2),
  date_of_birth           DATE,
  place_of_birth          TEXT,
  gender                  TEXT,
  marital_status          TEXT,

  -- Legal
  iqama_number            TEXT,
  iqama_issue_date        DATE,
  iqama_expiry_date       DATE,
  profession_on_iqama     TEXT,
  passport_number         TEXT,
  passport_expiry_date    DATE,
  license_number          TEXT,
  license_type            TEXT,
  license_issue_date      DATE,
  license_expiry_date     DATE,

  -- Contact
  primary_mobile          TEXT NOT NULL,
  secondary_mobile        TEXT,
  personal_email          TEXT,
  work_email              TEXT,
  current_city            TEXT,
  current_region          TEXT,
  national_address        TEXT,

  -- Employment
  category                driver_category NOT NULL,
  employment_type         employment_type,
  contract_type           contract_type,
  status                  driver_status NOT NULL DEFAULT 'draft',
  job_title               TEXT,
  department              TEXT,
  cost_center             TEXT,
  hire_date               DATE,
  onboarding_date         DATE,
  probation_start         DATE,
  probation_end           DATE,
  contract_start          DATE,
  contract_end            DATE,
  termination_date        DATE,
  termination_reason      TEXT,
  rehire_eligible         BOOLEAN NOT NULL DEFAULT false,
  supervisor_id           UUID,
  hr_owner_id             UUID,
  ops_owner_id            UUID,

  -- Payroll
  payroll_rule_id         UUID,
  basic_salary            NUMERIC(10,2),
  housing_allowance       NUMERIC(10,2),
  transport_allowance     NUMERIC(10,2),
  other_allowances        JSONB,
  gosi_wage_basis         NUMERIC(10,2),
  payroll_group          TEXT,
  bank_name               TEXT,
  iban                    TEXT,
  payment_method          TEXT,

  -- Operations (FKs added later when vehicles/platforms tables exist)
  primary_platform_id     UUID,
  current_vehicle_id      UUID,
  driver_type             TEXT,
  city_zone               TEXT,
  service_area           TEXT,
  shift_type              TEXT,
  operational_state       TEXT,
  dispatch_eligible       BOOLEAN NOT NULL DEFAULT false,

  -- COD (v2.0 M1)
  cod_outstanding_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  cod_last_reconciled_at  TIMESTAMPTZ,
  cod_risk_flag           BOOLEAN NOT NULL DEFAULT false,
  cod_risk_reason         TEXT,

  -- Compliance
  profile_completeness_score SMALLINT NOT NULL DEFAULT 0,
  compliance_risk_score      SMALLINT NOT NULL DEFAULT 0,
  documents_complete         BOOLEAN NOT NULL DEFAULT false,
  last_compliance_review_at  TIMESTAMPTZ,
  next_compliance_review_at  TIMESTAMPTZ,

  -- Meta
  tags                    TEXT[],
  internal_notes          TEXT,
  priority                TEXT NOT NULL DEFAULT 'normal',
  archived_reason         TEXT,

  CONSTRAINT chk_drivers_completeness CHECK (profile_completeness_score BETWEEN 0 AND 100),
  CONSTRAINT chk_drivers_risk CHECK (compliance_risk_score BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX idx_drivers_tenant_code
  ON drivers(tenant_id, driver_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_drivers_tenant_iqama
  ON drivers(tenant_id, iqama_number) WHERE deleted_at IS NULL AND iqama_number IS NOT NULL;
CREATE INDEX idx_drivers_active
  ON drivers(tenant_id, status, category) WHERE deleted_at IS NULL;
CREATE INDEX idx_drivers_name
  ON drivers(tenant_id, full_name_ar) WHERE deleted_at IS NULL;
CREATE INDEX idx_drivers_supervisor
  ON drivers(tenant_id, supervisor_id) WHERE deleted_at IS NULL;

-- ═══ driver_documents table ═══
CREATE TABLE driver_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  driver_id         UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  doc_type          driver_document_type NOT NULL,
  doc_number        TEXT,
  issue_date        DATE,
  expiry_date       DATE,
  issuing_authority TEXT,
  file_url          TEXT NOT NULL,
  file_size_bytes   BIGINT,
  mime_type         TEXT,
  is_verified       BOOLEAN NOT NULL DEFAULT false,
  verified_by       UUID REFERENCES auth.users(id),
  verified_at       TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_driver_documents_active
  ON driver_documents(tenant_id, driver_id, doc_type, expiry_date)
  WHERE deleted_at IS NULL AND is_active = true;

-- ═══ driver_emergency_contacts table ═══
CREATE TABLE driver_emergency_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  driver_id     UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  contact_name  TEXT NOT NULL,
  relationship  TEXT,
  phone         TEXT NOT NULL,
  email         TEXT,
  address       TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_driver_emergency_contacts_driver
  ON driver_emergency_contacts(tenant_id, driver_id) WHERE deleted_at IS NULL;

-- ═══ updated_at triggers ═══
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_driver_documents_updated_at BEFORE UPDATE ON driver_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_driver_emergency_contacts_updated_at BEFORE UPDATE ON driver_emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══ RLS ═══
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_emergency_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers_select_own_tenant" ON drivers
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "drivers_insert_own_tenant" ON drivers
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "drivers_update_own_tenant" ON drivers
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "driver_documents_select_own_tenant" ON driver_documents
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "driver_documents_insert_own_tenant" ON driver_documents
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "driver_documents_update_own_tenant" ON driver_documents
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "driver_emergency_contacts_select_own_tenant" ON driver_emergency_contacts
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "driver_emergency_contacts_insert_own_tenant" ON driver_emergency_contacts
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "driver_emergency_contacts_update_own_tenant" ON driver_emergency_contacts
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- NOTE: FK from drivers.current_vehicle_id to vehicles(id) added in migration 016_vehicles.sql.
-- NOTE: FK from drivers.primary_platform_id to delivery_platforms(id) added in Phase 4.
