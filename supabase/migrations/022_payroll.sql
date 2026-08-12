-- 022_payroll.sql
-- Module 4 (Payroll) — v2.0 M4 corrections:
-- - Canonical prorated payroll formula (Math.ceil target, never flat)
-- - orders_above_target / orders_below_target GENERATED columns
-- - below_minimum_wage advisory flag (SA nationals < 4000 SAR)
-- - cancel_reason / cancelled_by / cancelled_at fields
-- - cod_deduction field
-- - payroll_journal_entries (accounting hook for Module 9)
-- - payroll_journal_seq sequence
-- Source: docs/elite-master-prompt-v2.md section 6 M4

-- ═══ Enums ═══
CREATE TYPE payroll_status AS ENUM ('draft', 'calculated', 'in_review', 'approved', 'paid', 'locked', 'cancelled');

-- ═══ payroll_journal_seq (v2.0 M4) ═══
CREATE SEQUENCE IF NOT EXISTS payroll_journal_seq START 1;

-- ═══ driver_payroll_periods table ═══
-- The canonical payroll record per driver per month. Stores the PRORATED
-- target (v2.0 M4: never compare against flat monthly target).
CREATE TABLE driver_payroll_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  period_year     SMALLINT NOT NULL,
  period_month    SMALLINT NOT NULL,
  payroll_rule_id UUID REFERENCES driver_payroll_rules(id),

  -- Orders (v2.0 M4: stores prorated target, not just raw target)
  orders_achieved           INTEGER NOT NULL DEFAULT 0,
  target_orders_monthly    INTEGER,
  working_days_target      SMALLINT,
  working_days_actual      NUMERIC(4,1),
  orders_prorated_target   INTEGER,
  orders_variance          INTEGER,
  orders_above_target      INTEGER GENERATED ALWAYS AS
                            (GREATEST(COALESCE(orders_achieved,0) - COALESCE(orders_prorated_target,0), 0)) STORED,
  orders_below_target      INTEGER GENERATED ALWAYS AS
                            (GREATEST(COALESCE(orders_prorated_target,0) - COALESCE(orders_achieved,0), 0)) STORED,

  -- Earnings
  base_amount            NUMERIC(10,2) NOT NULL DEFAULT 0,
  orders_bonus           NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_earnings         NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Deductions
  package_deduction      NUMERIC(10,2) NOT NULL DEFAULT 0,
  orders_deduction       NUMERIC(10,2) NOT NULL DEFAULT 0,
  violations_deduction   NUMERIC(10,2) NOT NULL DEFAULT 0,
  penalties_deduction   NUMERIC(10,2) NOT NULL DEFAULT 0,
  vehicle_deduction     NUMERIC(10,2) NOT NULL DEFAULT 0,
  maintenance_deduction NUMERIC(10,2) NOT NULL DEFAULT 0,
  advance_deduction     NUMERIC(10,2) NOT NULL DEFAULT 0,
  absence_deduction     NUMERIC(10,2) NOT NULL DEFAULT 0,
  cod_deduction          NUMERIC(10,2) NOT NULL DEFAULT 0,
  misc_deduction        NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_deductions      NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Net
  net_payroll            NUMERIC(10,2) NOT NULL DEFAULT 0,
  minimum_floor_applied BOOLEAN NOT NULL DEFAULT false,
  is_recovery            BOOLEAN NOT NULL DEFAULT false,
  below_minimum_wage     BOOLEAN NOT NULL DEFAULT false,

  -- Manual override
  manual_override        BOOLEAN NOT NULL DEFAULT false,
  manual_override_reason TEXT,
  manual_override_by     UUID REFERENCES auth.users(id),

  -- Workflow
  status                 payroll_status NOT NULL DEFAULT 'draft',
  calculated_at          TIMESTAMPTZ,
  calculated_by          UUID REFERENCES auth.users(id),
  approved_at            TIMESTAMPTZ,
  approved_by            UUID REFERENCES auth.users(id),
  paid_at                TIMESTAMPTZ,
  paid_by                UUID REFERENCES auth.users(id),
  period_locked          BOOLEAN NOT NULL DEFAULT false,
  locked_at              TIMESTAMPTZ,
  locked_by              UUID REFERENCES auth.users(id),

  -- Cancel (v2.0 M4: calls rollbackPayrollDeductions from Module 3)
  cancel_reason          TEXT,
  cancelled_by           UUID REFERENCES auth.users(id),
  cancelled_at           TIMESTAMPTZ,

  doc_number             TEXT UNIQUE,
  notes                  TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID REFERENCES auth.users(id),
  updated_by             UUID REFERENCES auth.users(id),
  deleted_at             TIMESTAMPTZ,

  UNIQUE(tenant_id, driver_id, period_year, period_month)
);

CREATE INDEX idx_payroll_periods_active
  ON driver_payroll_periods(tenant_id, period_year, period_month, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_payroll_periods_driver
  ON driver_payroll_periods(tenant_id, driver_id, period_year, period_month) WHERE deleted_at IS NULL;
CREATE INDEX idx_payroll_periods_pending
  ON driver_payroll_periods(tenant_id, status) WHERE deleted_at IS NULL AND status IN ('draft', 'calculated', 'in_review');

-- ═══ payroll_journal_entries table (v2.0 M4 — accounting hook for Module 9) ═══
-- Future-ready: generate accounting journal entries per payroll period.
CREATE TABLE payroll_journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),

  payroll_period_id   UUID NOT NULL REFERENCES driver_payroll_periods(id) ON DELETE CASCADE,
  entry_date          DATE NOT NULL,
  entry_ref           TEXT UNIQUE NOT NULL DEFAULT (
    'JRN-' || TO_CHAR(NOW(), 'YYYY-MM') || '-' ||
    LPAD(NEXTVAL('payroll_journal_seq')::TEXT, 4, '0')
  ),
  total_gross         NUMERIC(12,2) NOT NULL,
  total_deductions    NUMERIC(12,2) NOT NULL,
  total_net           NUMERIC(12,2) NOT NULL,
  driver_count        SMALLINT NOT NULL,

  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'exported')),

  exported_at         TIMESTAMPTZ,
  exported_to         TEXT,
  export_format       TEXT,
  export_file_url     TEXT,

  notes               TEXT
);

CREATE INDEX idx_payroll_journal_period
  ON payroll_journal_entries(tenant_id, payroll_period_id);

-- ═══ updated_at triggers ═══
CREATE TRIGGER trg_driver_payroll_periods_updated_at BEFORE UPDATE ON driver_payroll_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══ RLS ═══
ALTER TABLE driver_payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_periods_sel" ON driver_payroll_periods
  FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "payroll_periods_ins" ON driver_payroll_periods
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "payroll_periods_upd" ON driver_payroll_periods
  FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "payroll_journal_sel" ON payroll_journal_entries
  FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id());
CREATE POLICY "payroll_journal_ins" ON payroll_journal_entries
  FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "payroll_journal_upd" ON payroll_journal_entries
  FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());
