-- 015_driver_compliance.sql
-- Module 1 (Drivers) — v2.0 M1 corrections: COD sessions, salary history, payroll rules,
-- and the compute_driver_completeness() DB function.
-- Source: docs/elite-master-prompt-v2.md section 6 M1

-- ═══ cod_status enum (v2.0 M1) ═══
CREATE TYPE cod_status AS ENUM ('pending', 'reconciled', 'disputed', 'written_off');

-- ═══ driver_cod_sessions table (v2.0 M1 — COD reconciliation) ═══
-- Tracks cash on delivery collections per session. Addresses the core business
-- problem: drivers withholding collected cash. Unresolved shortfalls become
-- payroll deductions.
CREATE TABLE driver_cod_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID REFERENCES auth.users(id),
  updated_by            UUID REFERENCES auth.users(id),
  deleted_at            TIMESTAMPTZ,

  driver_id             UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  platform_id           UUID NOT NULL,
  session_date          DATE NOT NULL,
  session_ref           TEXT,

  -- What was collected
  orders_with_cod       INTEGER NOT NULL DEFAULT 0,
  cod_collected         NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- What was submitted to company
  cod_submitted         NUMERIC(10,2) NOT NULL DEFAULT 0,
  submission_date       DATE,
  submission_method     TEXT,  -- 'cash_handover' | 'bank_transfer' | 'stc_pay'
  submission_ref        TEXT,

  -- Variance (positive = driver owes money) — GENERATED column
  cod_variance          NUMERIC(10,2) GENERATED ALWAYS AS
                        (cod_collected - cod_submitted) STORED,

  -- Source data for cross-reference
  platform_reported_cod NUMERIC(10,2),
  platform_session_data JSONB,

  status                cod_status NOT NULL DEFAULT 'pending',
  reconciled_by         UUID REFERENCES auth.users(id),
  reconciled_at         TIMESTAMPTZ,
  dispute_notes         TEXT,
  resolution_notes      TEXT,

  -- Payroll linkage: unresolved COD shortfalls can become deductions
  deduction_created     BOOLEAN NOT NULL DEFAULT false,
  deduction_id          UUID,

  notes                 TEXT,

  UNIQUE(tenant_id, driver_id, platform_id, session_date, session_ref)
);

CREATE INDEX idx_cod_sessions_outstanding
  ON driver_cod_sessions(tenant_id, driver_id, status)
  WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX idx_cod_sessions_driver_date
  ON driver_cod_sessions(tenant_id, driver_id, session_date DESC)
  WHERE deleted_at IS NULL;

-- ═══ driver_salary_history table (v2.0 M1) ═══
-- Track every change to a driver's base salary configuration. Without this,
-- there is no audit trail for why March payslip differs from February payslip.
CREATE TABLE driver_salary_history (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES auth.users(id),

  driver_id               UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  effective_date          DATE NOT NULL,

  -- Snapshot of salary at this effective date
  basic_salary            NUMERIC(10,2),
  housing_allowance       NUMERIC(10,2),
  transport_allowance     NUMERIC(10,2),
  other_allowances        JSONB,
  category                driver_category,
  payroll_rule_id         UUID,

  -- Why it changed
  change_type             TEXT NOT NULL,  -- 'initial' | 'increase' | 'decrease' | 'correction' | 'category_change'
  change_reason           TEXT NOT NULL,
  approved_by             UUID REFERENCES auth.users(id),
  approved_at             TIMESTAMPTZ,

  -- Previous values (for diff display)
  previous_basic_salary   NUMERIC(10,2),
  previous_category       driver_category,

  CONSTRAINT chk_salary_change_type CHECK (
    change_type IN ('initial', 'increase', 'decrease', 'correction', 'category_change')
  )
);

CREATE INDEX idx_salary_history_driver
  ON driver_salary_history(tenant_id, driver_id, effective_date DESC);

-- ═══ driver_payroll_rules table (shared with M4 Payroll) ═══
CREATE TABLE driver_payroll_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  driver_id               UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  category                driver_category NOT NULL,
  version                 INTEGER NOT NULL DEFAULT 1,
  effective_date          DATE NOT NULL,
  is_active               BOOLEAN NOT NULL DEFAULT true,

  -- Type 1 fields
  base_salary             NUMERIC(10,2),
  target_orders           INTEGER,
  working_days_target     INTEGER,
  bonus_rate              NUMERIC(6,2),
  deduction_rate          NUMERIC(6,2),

  -- Type 2 fields
  package_amount          NUMERIC(10,2),
  threshold_orders        INTEGER,
  car_rent_deduction      NUMERIC(10,2),

  -- Freelancer flexible fields
  base_pay_type           TEXT,
  extra_order_rate        NUMERIC(6,2),
  under_target_rate       NUMERIC(6,2),
  petrol_by_company       BOOLEAN,
  accommodation_by_company BOOLEAN,
  vehicle_by_company      BOOLEAN,
  bonus_cap               NUMERIC(10,2),
  deduction_cap           NUMERIC(10,2),
  minimum_net_floor       NUMERIC(10,2),

  -- Application flags
  apply_violations        BOOLEAN NOT NULL DEFAULT true,
  apply_penalties         BOOLEAN NOT NULL DEFAULT true,
  apply_vehicle_deductions BOOLEAN NOT NULL DEFAULT true,
  apply_maintenance       BOOLEAN NOT NULL DEFAULT true,
  allow_manual_override   BOOLEAN NOT NULL DEFAULT false,
  custom_notes            TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES auth.users(id),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by              UUID REFERENCES auth.users(id),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX idx_driver_payroll_rules_active
  ON driver_payroll_rules(tenant_id, driver_id, is_active)
  WHERE deleted_at IS NULL AND is_active = true;

-- ═══ updated_at triggers ═══
CREATE TRIGGER trg_driver_cod_sessions_updated_at BEFORE UPDATE ON driver_cod_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_driver_payroll_rules_updated_at BEFORE UPDATE ON driver_payroll_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══ RLS ═══
ALTER TABLE driver_cod_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_salary_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_payroll_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cod_sessions_select_own_tenant" ON driver_cod_sessions
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "cod_sessions_insert_own_tenant" ON driver_cod_sessions
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "cod_sessions_update_own_tenant" ON driver_cod_sessions
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "salary_history_select_own_tenant" ON driver_salary_history
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "salary_history_insert_own_tenant" ON driver_salary_history
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "payroll_rules_select_own_tenant" ON driver_payroll_rules
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "payroll_rules_insert_own_tenant" ON driver_payroll_rules
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "payroll_rules_update_own_tenant" ON driver_payroll_rules
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ═══ compute_driver_completeness() function (v2.0 M1) ═══
-- Compute and store completeness score in DB rather than application code.
-- Called from API layer after any driver update.
CREATE OR REPLACE FUNCTION compute_driver_completeness(p_driver_id UUID)
RETURNS SMALLINT AS $$
DECLARE
  score SMALLINT := 0;
  d drivers%ROWTYPE;
  doc_count INTEGER;
BEGIN
  SELECT * INTO d FROM drivers WHERE id = p_driver_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- IDENTITY (20 points)
  IF d.photo_url IS NOT NULL THEN score := score + 5; END IF;
  IF d.full_name_en IS NOT NULL AND d.full_name_en != '' THEN score := score + 3; END IF;
  IF d.date_of_birth IS NOT NULL THEN score := score + 4; END IF;
  IF d.nationality IS NOT NULL THEN score := score + 4; END IF;
  IF d.gender IS NOT NULL THEN score := score + 2; END IF;
  IF d.date_of_birth IS NOT NULL AND d.date_of_birth < CURRENT_DATE - INTERVAL '18 years'
    THEN score := score + 2; END IF;

  -- LEGAL DOCUMENTS (25 points)
  IF d.iqama_number IS NOT NULL THEN score := score + 6; END IF;
  IF d.iqama_expiry_date IS NOT NULL AND d.iqama_expiry_date > CURRENT_DATE THEN score := score + 4; END IF;
  IF d.license_number IS NOT NULL THEN score := score + 6; END IF;
  IF d.license_expiry_date IS NOT NULL AND d.license_expiry_date > CURRENT_DATE THEN score := score + 4; END IF;
  IF d.passport_number IS NOT NULL THEN score := score + 5; END IF;

  -- CONTACT (10 points)
  IF d.primary_mobile IS NOT NULL THEN score := score + 4; END IF;
  IF d.secondary_mobile IS NOT NULL THEN score := score + 2; END IF;
  IF d.personal_email IS NOT NULL OR d.work_email IS NOT NULL THEN score := score + 2; END IF;
  IF d.current_city IS NOT NULL THEN score := score + 2; END IF;

  -- EMPLOYMENT (20 points)
  IF d.hire_date IS NOT NULL THEN score := score + 4; END IF;
  IF d.contract_type IS NOT NULL THEN score := score + 4; END IF;
  IF d.contract_start IS NOT NULL THEN score := score + 4; END IF;
  IF d.supervisor_id IS NOT NULL THEN score := score + 4; END IF;
  IF d.job_title IS NOT NULL THEN score := score + 4; END IF;

  -- COMPENSATION (10 points)
  IF d.basic_salary IS NOT NULL AND d.basic_salary > 0 THEN score := score + 5; END IF;
  IF d.iban IS NOT NULL AND length(d.iban) = 24 THEN score := score + 5; END IF;

  -- OPERATIONS (10 points)
  IF d.primary_platform_id IS NOT NULL THEN score := score + 5; END IF;
  IF d.current_vehicle_id IS NOT NULL THEN score := score + 3; END IF;
  IF d.city_zone IS NOT NULL THEN score := score + 2; END IF;

  -- EMERGENCY CONTACT (5 points)
  SELECT COUNT(*) INTO doc_count FROM driver_emergency_contacts
  WHERE driver_id = p_driver_id AND tenant_id = d.tenant_id AND deleted_at IS NULL;
  IF doc_count > 0 THEN score := score + 5; END IF;

  -- Cap at 100
  score := LEAST(score, 100);

  -- Update the driver record
  UPDATE drivers SET profile_completeness_score = score WHERE id = p_driver_id;

  RETURN score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
