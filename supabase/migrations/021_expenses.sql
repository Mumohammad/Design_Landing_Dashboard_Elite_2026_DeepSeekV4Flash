-- 021_expenses.sql
-- Module 6 (Expenses Management) — expenses and advances tables.

-- expenses table
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  expense_code    TEXT,
  expense_type    TEXT NOT NULL CHECK (expense_type IN ('fuel', 'advance', 'operational', 'platform_commission', 'maintenance', 'other')),
  category        TEXT,
  amount          NUMERIC(10,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'SAR',
  expense_date    DATE NOT NULL,
  description     TEXT,
  driver_id       UUID REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id      UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  platform_id     UUID REFERENCES delivery_platforms(id) ON DELETE SET NULL,
  vendor          TEXT,
  receipt_url     TEXT,
  is_approved     BOOLEAN NOT NULL DEFAULT false,
  approved_by     UUID REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  is_deducted     BOOLEAN NOT NULL DEFAULT false,
  payroll_period_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT chk_expense_amount CHECK (amount >= 0)
);
CREATE INDEX idx_expenses_active ON expenses(tenant_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_driver ON expenses(tenant_id, driver_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_vehicle ON expenses(tenant_id, vehicle_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_pending_approval ON expenses(tenant_id, is_approved) WHERE deleted_at IS NULL AND is_approved = false;

-- payroll_advances table
CREATE TABLE payroll_advances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  amount          NUMERIC(10,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'SAR',
  advance_date    DATE NOT NULL,
  repayment_month TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'repaid', 'cancelled')),
  approved_by     UUID REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  repaid_at       TIMESTAMPTZ,
  payroll_period_id UUID,
  reason          TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT chk_advance_amount CHECK (amount > 0)
);
CREATE INDEX idx_advances_pending ON payroll_advances(tenant_id, driver_id, repayment_month, status) WHERE deleted_at IS NULL AND status = 'approved';

-- Triggers
CREATE TRIGGER trg_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_payroll_advances_updated_at BEFORE UPDATE ON payroll_advances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_advances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_sel" ON expenses FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "expenses_ins" ON expenses FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "expenses_upd" ON expenses FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "advances_sel" ON payroll_advances FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "advances_ins" ON payroll_advances FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "advances_upd" ON payroll_advances FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());
