-- =====================================================================
-- 041 — Financial Phase 8: VAT Engine
--
--   1. `vat_periods` — per (tenant, year, month) period with an open →
--      closing → closed → reopened lifecycle; one open period per month.
--   2. `vat_adjustments` — credit/debit note effects + corrections.
--      Rows are finalized on creation; once finalized the financial fields
--      are immutable (VAT003). One adjustment per source (unique index).
--   3. `vat_input_ledger` gains `vat_recoverability`
--      (recoverable | non_recoverable | pending_review) — the Phase 8
--      classification that gates what counts toward the net position.
--
-- The ledger rows themselves (vat_output_ledger / vat_input_ledger from
-- 027) are written by the Phase 9 event dispatcher; this migration only
-- adds the period + adjustment infrastructure and the classification.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. vat_periods
-- ---------------------------------------------------------------------
CREATE TABLE vat_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  period_year   SMALLINT NOT NULL,
  period_month  SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'closing', 'closed', 'reopened')),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  closed_by     UUID REFERENCES auth.users(id),
  reopen_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT uq_vat_period UNIQUE (tenant_id, period_year, period_month)
);
CREATE INDEX idx_vat_periods_tenant
  ON vat_periods (tenant_id, period_year DESC, period_month DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_vat_periods_updated_at BEFORE UPDATE ON vat_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE vat_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vatp_sel_tenant" ON vat_periods FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "vatp_ins_tenant" ON vat_periods FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "vatp_upd_tenant" ON vat_periods FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL)
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 2. vat_adjustments (credit/debit notes + corrections) — immutable once
--    finalized
-- ---------------------------------------------------------------------
CREATE TABLE vat_adjustments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  period_year       SMALLINT NOT NULL,
  period_month      SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  adjustment_type   TEXT NOT NULL
                    CHECK (adjustment_type IN ('credit_note', 'debit_note', 'correction', 'other')),
  direction         TEXT NOT NULL CHECK (direction IN ('output', 'input')),
  base_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- signed: negative = reduction
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'finalized'
                    CHECK (status IN ('draft', 'finalized', 'voided')),
  source_entity_type TEXT,
  source_entity_id   UUID,
  finalized_at      TIMESTAMPTZ,
  finalized_by      UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX idx_vat_adjustments_period
  ON vat_adjustments (tenant_id, period_year, period_month)
  WHERE deleted_at IS NULL;
-- Idempotency: exactly one adjustment per source document.
CREATE UNIQUE INDEX uq_vat_adjustment_source
  ON vat_adjustments (tenant_id, source_entity_type, source_entity_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_vat_adjustments_updated_at BEFORE UPDATE ON vat_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Immutability once finalized (VAT003). Soft-delete stays allowed.
CREATE OR REPLACE FUNCTION protect_finalized_vat_adjustment()
RETURNS TRIGGER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'finalized' AND (
      NEW.period_year      <> OLD.period_year
   OR NEW.period_month     <> OLD.period_month
   OR NEW.adjustment_type  <> OLD.adjustment_type
   OR NEW.direction        <> OLD.direction
   OR NEW.base_amount      <> OLD.base_amount
   OR NEW.vat_amount       <> OLD.vat_amount
   OR NEW.status           <> OLD.status
  ) THEN
    RAISE EXCEPTION 'VAT003: finalized VAT adjustments are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vat_adjustments_protect BEFORE UPDATE ON vat_adjustments
  FOR EACH ROW EXECUTE FUNCTION protect_finalized_vat_adjustment();

ALTER TABLE vat_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vata_sel_tenant" ON vat_adjustments FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "vata_ins_tenant" ON vat_adjustments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "vata_upd_tenant" ON vat_adjustments FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL)
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 3. Input VAT recoverability classification
-- ---------------------------------------------------------------------
ALTER TABLE vat_input_ledger
  ADD COLUMN vat_recoverability TEXT NOT NULL DEFAULT 'recoverable'
    CHECK (vat_recoverability IN ('recoverable', 'non_recoverable', 'pending_review'));

-- ---------------------------------------------------------------------
-- 4. Demo seed — current open VAT period for the demo tenant
-- ---------------------------------------------------------------------
INSERT INTO vat_periods (tenant_id, period_year, period_month, status)
SELECT '00000000-0000-0000-0000-000000000001',
       EXTRACT(YEAR FROM CURRENT_DATE)::smallint,
       EXTRACT(MONTH FROM CURRENT_DATE)::smallint,
       'open'
WHERE NOT EXISTS (
  SELECT 1 FROM vat_periods
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
    AND period_year = EXTRACT(YEAR FROM CURRENT_DATE)::smallint
    AND period_month = EXTRACT(MONTH FROM CURRENT_DATE)::smallint
);
