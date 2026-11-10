-- 019_violations.sql
-- Module 5: Violations & Penalties
-- PostgreSQL-compatible version.
-- Partial UNIQUE constraints are implemented as standalone partial indexes.
-- The dispute_deadline generated expression uses date + integer, which returns DATE.

-- ═══ Enums ═══
CREATE TYPE violation_status AS ENUM (
  'open', 'under_review', 'acknowledged', 'disputed',
  'resolved', 'deduction_applied', 'waived', 'escalated', 'closed'
);
CREATE TYPE violation_source AS ENUM (
  'manual', 'absher', 'platform_report', 'najm', 'moi', 'internal'
);
CREATE TYPE violation_severity AS ENUM ('minor', 'moderate', 'major', 'critical');
CREATE TYPE deduction_ledger_status AS ENUM (
  'pending', 'applied', 'rolled_back', 'cancelled'
);
CREATE TYPE external_fine_status AS ENUM (
  'unmatched', 'matched', 'violation_created', 'duplicate', 'ignored'
);

-- ═══ Violation reference sequence ═══
CREATE SEQUENCE IF NOT EXISTS violation_ref_seq
  START WITH 1 INCREMENT BY 1 NO CYCLE;

-- ═══ Violation types ═══
CREATE TABLE violation_types (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  code               TEXT NOT NULL,
  name_ar            TEXT NOT NULL,
  name_en            TEXT,
  category           TEXT NOT NULL,
  severity           violation_severity NOT NULL DEFAULT 'minor',
  default_deduction  NUMERIC(10,2) NOT NULL DEFAULT 0,
  warning_threshold  SMALLINT NOT NULL DEFAULT 3,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT chk_violation_type_deduction CHECK (default_deduction >= 0),
  CONSTRAINT chk_violation_type_warning CHECK (warning_threshold > 0)
);

CREATE UNIQUE INDEX idx_violation_types_unique_code
  ON violation_types (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_violation_types_active
  ON violation_types (tenant_id, category, is_active)
  WHERE deleted_at IS NULL;

-- ═══ Violations ═══
CREATE TABLE violations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  violation_ref         TEXT NOT NULL UNIQUE DEFAULT (
    'VIO-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' ||
    LPAD(NEXTVAL('violation_ref_seq')::TEXT, 5, '0')
  ),
  driver_id             UUID REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id            UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  violation_type_id     UUID REFERENCES violation_types(id),
  source                violation_source NOT NULL DEFAULT 'manual',
  severity              violation_severity NOT NULL DEFAULT 'minor',
  incident_date         DATE NOT NULL,
  incident_location     TEXT,
  incident_description  TEXT NOT NULL,
  deduction_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  status                violation_status NOT NULL DEFAULT 'open',
  warning_level         SMALLINT NOT NULL DEFAULT 1,
  evidence_urls         TEXT[],
  reported_by           UUID REFERENCES auth.users(id),
  reported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by           UUID REFERENCES auth.users(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,
  dispute_window_days   SMALLINT NOT NULL DEFAULT 7,
  dispute_deadline      DATE GENERATED ALWAYS AS
    (incident_date + dispute_window_days) STORED,
  disputed_at           TIMESTAMPTZ,
  dispute_reason        TEXT,
  dispute_evidence_urls TEXT[],
  deduction_applied     BOOLEAN NOT NULL DEFAULT false,
  deduction_applied_at  TIMESTAMPTZ,
  deduction_applied_by  UUID REFERENCES auth.users(id),
  payroll_period_id     UUID,
  waiver_reason         TEXT,
  waived_by             UUID REFERENCES auth.users(id),
  waived_at             TIMESTAMPTZ,
  external_fine_id      UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID REFERENCES auth.users(id),
  updated_by            UUID REFERENCES auth.users(id),
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT chk_violation_deduction CHECK (deduction_amount >= 0),
  CONSTRAINT chk_violation_warning_level CHECK (warning_level > 0),
  CONSTRAINT chk_violation_dispute_days CHECK (dispute_window_days >= 0)
);

CREATE INDEX idx_violations_active
  ON violations (tenant_id, driver_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_violations_dispute_deadline
  ON violations (tenant_id, dispute_deadline)
  WHERE status = 'open' AND deleted_at IS NULL;
CREATE INDEX idx_violations_date
  ON violations (tenant_id, incident_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_violations_vehicle
  ON violations (tenant_id, vehicle_id)
  WHERE deleted_at IS NULL AND vehicle_id IS NOT NULL;

-- ═══ Violation deduction ledger ═══
CREATE TABLE violation_deduction_ledger (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  violation_id       UUID NOT NULL REFERENCES violations(id) ON DELETE CASCADE,
  driver_id          UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  deduction_amount   NUMERIC(10,2) NOT NULL,
  deduction_month    TEXT NOT NULL,
  status             deduction_ledger_status NOT NULL DEFAULT 'pending',
  payroll_period_id  UUID,
  applied_at         TIMESTAMPTZ,
  applied_by         UUID REFERENCES auth.users(id),
  rollback_reason    TEXT,
  rolled_back_by     UUID REFERENCES auth.users(id),
  rolled_back_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT chk_ledger_deduction CHECK (deduction_amount >= 0),
  CONSTRAINT chk_ledger_month CHECK (deduction_month <> '')
);

CREATE INDEX idx_violation_ledger_pending
  ON violation_deduction_ledger
    (tenant_id, driver_id, deduction_month, status)
  WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX idx_violation_ledger_applied
  ON violation_deduction_ledger (tenant_id, payroll_period_id)
  WHERE deleted_at IS NULL AND status = 'applied';

-- ═══ External fine imports ═══
CREATE TABLE external_fine_imports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES auth.users(id),
  source              TEXT NOT NULL DEFAULT 'manual',
  source_batch_ref    TEXT,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  external_ref       TEXT NOT NULL,
  external_source     TEXT,
  vehicle_plate       TEXT,
  violation_date      DATE,
  violation_location  TEXT,
  violation_type_code TEXT,
  fine_amount         NUMERIC(10,2),
  payment_deadline    DATE,
  raw_data            JSONB,
  matched_vehicle_id  UUID REFERENCES vehicles(id),
  matched_driver_id   UUID REFERENCES drivers(id),
  violation_id        UUID REFERENCES violations(id),
  status              external_fine_status NOT NULL DEFAULT 'unmatched',
  match_notes         TEXT,
  matched_by          UUID REFERENCES auth.users(id),
  matched_at          TIMESTAMPTZ,
  CONSTRAINT uq_external_fine UNIQUE (tenant_id, external_ref, source),
  CONSTRAINT chk_external_fine_source CHECK (
    source IN ('manual', 'najm', 'moi', 'absher')
  ),
  CONSTRAINT chk_external_fine_amount CHECK (
    fine_amount IS NULL OR fine_amount >= 0
  )
);

CREATE INDEX idx_external_fines_unmatched
  ON external_fine_imports (tenant_id, status, violation_date)
  WHERE status = 'unmatched';

-- ═══ Updated-at triggers ═══
CREATE TRIGGER trg_violation_types_updated_at
  BEFORE UPDATE ON violation_types FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_violations_updated_at
  BEFORE UPDATE ON violations FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_violation_ledger_updated_at
  BEFORE UPDATE ON violation_deduction_ledger FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══ Row-level security ═══
ALTER TABLE violation_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE violation_deduction_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_fine_imports ENABLE ROW LEVEL SECURITY;

-- Violation types
CREATE POLICY violation_types_sel ON violation_types FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY violation_types_ins ON violation_types FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY violation_types_upd ON violation_types FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Violations
CREATE POLICY violations_sel ON violations FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY violations_ins ON violations FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY violations_upd ON violations FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Deduction ledger
CREATE POLICY deduction_ledger_sel ON violation_deduction_ledger
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY deduction_ledger_ins ON violation_deduction_ledger
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY deduction_ledger_upd ON violation_deduction_ledger
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- External fine imports
CREATE POLICY external_fines_sel ON external_fine_imports
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY external_fines_ins ON external_fine_imports
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY external_fines_upd ON external_fine_imports
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());