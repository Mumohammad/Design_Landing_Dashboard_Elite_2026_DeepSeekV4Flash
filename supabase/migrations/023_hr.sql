-- 023_hr.sql
-- Module 11 (HR Management) — performance reviews, onboarding checklists, training records.

CREATE TYPE review_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
CREATE TYPE onboarding_step_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped');

-- performance_reviews table
CREATE TABLE performance_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  review_period   TEXT NOT NULL,
  review_date     DATE NOT NULL,
  reviewer_id     UUID REFERENCES auth.users(id),
  attendance_score   NUMERIC(5,2),
  violations_score    NUMERIC(5,2),
  platform_kpi_score  NUMERIC(5,2),
  overall_score       NUMERIC(5,2),
  strengths           TEXT,
  improvements        TEXT,
  goals               TEXT,
  status              review_status NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  deleted_at          TIMESTAMPTZ
);
CREATE INDEX idx_performance_reviews_driver ON performance_reviews(tenant_id, driver_id, review_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_performance_reviews_pending ON performance_reviews(tenant_id, status) WHERE deleted_at IS NULL AND status = 'pending';

-- driver_onboarding_checklists table
CREATE TABLE driver_onboarding_checklists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  step_name       TEXT NOT NULL,
  step_order      SMALLINT NOT NULL DEFAULT 0,
  status          onboarding_step_status NOT NULL DEFAULT 'pending',
  completed_by    UUID REFERENCES auth.users(id),
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_onboarding_driver ON driver_onboarding_checklists(tenant_id, driver_id, step_order) WHERE deleted_at IS NULL;

-- training_records table
CREATE TABLE training_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  course_name     TEXT NOT NULL,
  training_date   DATE NOT NULL,
  expiry_date     DATE,
  provider        TEXT,
  certificate_url TEXT,
  score           NUMERIC(5,2),
  is_passed       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_training_driver ON training_records(tenant_id, driver_id, training_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_training_expiring ON training_records(tenant_id, expiry_date) WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;

CREATE TRIGGER trg_performance_reviews_updated_at BEFORE UPDATE ON performance_reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_onboarding_updated_at BEFORE UPDATE ON driver_onboarding_checklists FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_training_updated_at BEFORE UPDATE ON training_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_onboarding_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perf_reviews_sel" ON performance_reviews FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "perf_reviews_ins" ON performance_reviews FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "perf_reviews_upd" ON performance_reviews FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "onboarding_sel" ON driver_onboarding_checklists FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "onboarding_ins" ON driver_onboarding_checklists FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "onboarding_upd" ON driver_onboarding_checklists FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "training_sel" ON training_records FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "training_ins" ON training_records FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "training_upd" ON training_records FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());
