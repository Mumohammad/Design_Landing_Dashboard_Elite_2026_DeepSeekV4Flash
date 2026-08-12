-- 024_reports.sql
-- Module 12 (Reports) — v2.0 M7: async report generation job queue.

CREATE TYPE report_status AS ENUM ('generating', 'completed', 'failed', 'expired');
CREATE TYPE report_type AS ENUM (
  'driver_performance', 'payroll_summary', 'fleet_cost', 'revenue',
  'violations_report', 'attendance_summary', 'executive_dashboard',
  'hs_reconciliation', 'custom'
);

-- report_generation_log table (v2.0 M7)
CREATE TABLE report_generation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  report_type     report_type NOT NULL,
  report_params   JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_format   TEXT NOT NULL DEFAULT 'pdf' CHECK (output_format IN ('pdf', 'xlsx', 'csv')),
  generated_by    UUID NOT NULL REFERENCES auth.users(id),
  status          report_status NOT NULL DEFAULT 'generating',
  file_url        TEXT,
  file_name       TEXT,
  file_size_bytes BIGINT,
  error_message   TEXT,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_tenant ON report_generation_log(tenant_id, created_at DESC);
CREATE INDEX idx_reports_status ON report_generation_log(tenant_id, status) WHERE status IN ('generating', 'completed');
CREATE INDEX idx_reports_user ON report_generation_log(tenant_id, generated_by, created_at DESC);

CREATE TRIGGER trg_report_log_updated_at BEFORE UPDATE ON report_generation_log FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE report_generation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_sel" ON report_generation_log FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id());
CREATE POLICY "reports_ins" ON report_generation_log FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "reports_upd" ON report_generation_log FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());
