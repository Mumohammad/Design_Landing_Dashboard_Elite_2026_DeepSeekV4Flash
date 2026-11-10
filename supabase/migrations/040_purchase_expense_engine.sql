-- =====================================================================
-- 040 — Financial Phase 7: Purchase / Expense integration
--
--   1. `expenses` grows input-VAT capture fields (vat_rate, vat_amount,
--      vat_recoverability) + a stable auto-generated `expense_code`
--      (EXP-YYYY-000001) and a `coa_account_code` snapshot of the CoA
--      expense account resolved at approval time.
--   2. `expense_category_mappings` maps each expense category to a CoA
--      expense account + VAT recoverability class (seeded for the demo
--      tenant; ExpenseApprovedEvent consumers in Phase 9 use it to post
--      Dr Expense / Dr VAT Input / Cr AP).
--   3. `validate_expense_approval()` trigger — approving an expense
--      requires an approver + timestamp (EXP004).
--
-- Payables already exist (027) with RLS + source_entity_type/id — purchase
-- invoice approval (PINV) and expense approval create rows there.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Expenses: input VAT + CoA mapping snapshot + expense_code
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS expense_code_seq START 1000;

ALTER TABLE expenses
  ALTER COLUMN expense_code SET DEFAULT
    ('EXP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('expense_code_seq')::text, 6, '0'));

ALTER TABLE expenses
  ADD COLUMN vat_rate           NUMERIC(5,2)  NOT NULL DEFAULT 15,
  ADD COLUMN vat_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN vat_recoverability TEXT NOT NULL DEFAULT 'recoverable'
    CHECK (vat_recoverability IN ('recoverable', 'non_recoverable', 'pending_review')),
  ADD COLUMN coa_account_code   TEXT;

ALTER TABLE expenses
  ADD CONSTRAINT chk_expenses_vat CHECK (vat_rate >= 0 AND vat_rate <= 100 AND vat_amount >= 0);

-- Approval guard: is_approved can only flip true when approver + timestamp
-- are recorded (EXP004). BEFORE UPDATE so the server action can write all
-- three fields in one statement.
CREATE OR REPLACE FUNCTION validate_expense_approval()
RETURNS trigger
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_approved AND NOT OLD.is_approved
     AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'EXP004: expense approval requires an approver and timestamp';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expenses_approval ON expenses;
CREATE TRIGGER trg_expenses_approval
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION validate_expense_approval();

-- ---------------------------------------------------------------------
-- 2. Expense category → CoA mapping (Phase 7/8)
-- ---------------------------------------------------------------------
CREATE TABLE expense_category_mappings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  expense_type       TEXT NOT NULL CHECK (expense_type IN ('fuel', 'advance', 'operational', 'platform_commission', 'maintenance', 'other')),
  coa_account_code   TEXT NOT NULL,
  vat_recoverability TEXT NOT NULL DEFAULT 'recoverable'
    CHECK (vat_recoverability IN ('recoverable', 'non_recoverable', 'pending_review')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_expense_category_mapping UNIQUE (tenant_id, expense_type)
);

CREATE INDEX idx_expense_category_mapping_tenant
  ON expense_category_mappings (tenant_id, expense_type);

-- RLS (config table — authenticated reads + writes within the tenant)
ALTER TABLE expense_category_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expcat_sel_tenant" ON expense_category_mappings FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "expcat_ins_tenant" ON expense_category_mappings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "expcat_upd_tenant" ON expense_category_mappings FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

-- ---------------------------------------------------------------------
-- 3. Demo seed (default tenant, synthetic — CoA codes from 027/033)
--    fuel→5000 · maintenance→5100 · advance→1500 (prepaid, non-recoverable)
--    operational→5800 · platform_commission→5800 · other→5800 (review)
-- ---------------------------------------------------------------------
INSERT INTO expense_category_mappings (tenant_id, expense_type, coa_account_code, vat_recoverability)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'fuel',                 '5000', 'recoverable'),
  ('00000000-0000-0000-0000-000000000001', 'maintenance',          '5100', 'recoverable'),
  ('00000000-0000-0000-0000-000000000001', 'operational',          '5800', 'recoverable'),
  ('00000000-0000-0000-0000-000000000001', 'platform_commission',  '5800', 'recoverable'),
  ('00000000-0000-0000-0000-000000000001', 'advance',              '1500', 'non_recoverable'),
  ('00000000-0000-0000-0000-000000000001', 'other',                '5800', 'pending_review')
ON CONFLICT (tenant_id, expense_type) DO NOTHING;
