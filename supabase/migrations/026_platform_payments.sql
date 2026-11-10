-- 026_platform_payments.sql
-- Module 10: Platform payment reconciliation.
-- PostgreSQL-compatible version.
-- Partial UNIQUE constraints are implemented as standalone partial indexes.

-- ═══ Enum ═══
CREATE TYPE payment_status AS ENUM ('pending', 'partial', 'paid', 'overdue', 'disputed');

-- ═══ Platform payments ═══
CREATE TABLE platform_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  platform_id       UUID NOT NULL REFERENCES delivery_platforms(id),
  period_year       SMALLINT NOT NULL,
  period_month      SMALLINT NOT NULL,
  expected_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  outstanding_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status    payment_status NOT NULL DEFAULT 'pending',
  payment_date      DATE,
  payment_ref       TEXT,
  invoice_url       TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT chk_platform_payment_month CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT chk_platform_payment_year CHECK (period_year BETWEEN 2000 AND 2200),
  CONSTRAINT chk_platform_payment_expected CHECK (expected_amount >= 0),
  CONSTRAINT chk_platform_payment_received CHECK (received_amount >= 0),
  CONSTRAINT chk_platform_payment_outstanding CHECK (outstanding_amount >= 0)
);

CREATE UNIQUE INDEX idx_platform_payments_unique_period
  ON platform_payments (tenant_id, platform_id, period_year, period_month)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_platform_payments_overdue
  ON platform_payments (tenant_id, payment_status)
  WHERE deleted_at IS NULL AND payment_status = 'overdue';

CREATE INDEX idx_platform_payments_period
  ON platform_payments (tenant_id, period_year, period_month)
  WHERE deleted_at IS NULL;

-- ═══ Updated-at trigger ═══
CREATE TRIGGER trg_platform_payments_updated_at
  BEFORE UPDATE ON platform_payments FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══ Row-level security ═══
ALTER TABLE platform_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_payments_sel ON platform_payments
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);

CREATE POLICY platform_payments_ins ON platform_payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY platform_payments_upd ON platform_payments
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());