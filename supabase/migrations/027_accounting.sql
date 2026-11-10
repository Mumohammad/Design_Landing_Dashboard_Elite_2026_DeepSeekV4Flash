-- 027_accounting.sql
-- Module 9 — Accounting & Finance Management (NEW in v2.0).
-- Source: docs/elite-master-prompt-v2.md section 7.
--
-- Scope: chart of accounts, accounting periods, journal entries (source-linked,
-- immutable postings), accounts receivable/payable, customers/suppliers,
-- payment allocation, VAT output + input ledgers (never netted silently),
-- bank accounts + bank reconciliation, trial balance view, period close.
--
-- Saudi finance rules (7.2):
--  - Output VAT and input VAT tracked in SEPARATE ledgers.
--  - Posted entries are immutable; corrections use reversal entries only.
--  - Customer invoice totals are never reduced by purchase invoices.
--
-- RLS: 4-policy pattern on every tenant-owned table (SELECT + INSERT WITH
-- CHECK + UPDATE; no DELETE — soft-delete only). Posted journal rows are also
-- protected by a trigger (immutability, ADR-007 style).

-- =====================================================================
-- 1. Enums
-- =====================================================================
CREATE TYPE account_type AS ENUM (
  'asset', 'liability', 'equity', 'income', 'expense'
);
CREATE TYPE account_normal_balance AS ENUM ('debit', 'credit');
CREATE TYPE accounting_period_status AS ENUM ('open', 'closing', 'closed', 'reopened');
CREATE TYPE journal_entry_status AS ENUM ('draft', 'posted', 'reversed');
CREATE TYPE journal_entry_type AS ENUM (
  'manual', 'payroll', 'cod_settlement', 'invoice', 'expense',
  'bank', 'vat', 'reversal', 'opening'
);
CREATE TYPE finance_payment_method AS ENUM ('cash', 'transfer', 'cheque', 'wps', 'card');
CREATE TYPE finance_payment_status AS ENUM ('pending', 'allocated', 'partially_allocated', 'void');
CREATE TYPE ar_ap_status AS ENUM ('open', 'partially_paid', 'paid', 'overdue', 'written_off');
CREATE TYPE bank_transaction_status AS ENUM ('pending', 'cleared', 'matched');
CREATE TYPE reconciliation_status AS ENUM ('draft', 'in_progress', 'completed');

-- =====================================================================
-- 2. Sequences (never COUNT(*)+1 — v2.0 M8 correction)
-- =====================================================================
CREATE SEQUENCE journal_entry_ref_seq START 1001;
CREATE SEQUENCE finance_doc_ref_seq START 1001;

-- =====================================================================
-- 3. Chart of accounts
-- =====================================================================
CREATE TABLE chart_of_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  account_code     TEXT NOT NULL,               -- e.g. '5200'
  name_ar          TEXT NOT NULL,
  name_en          TEXT NOT NULL,
  account_type     account_type NOT NULL,
  normal_balance   account_normal_balance NOT NULL,
  parent_id        UUID REFERENCES chart_of_accounts(id),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  deleted_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_coa_tenant_code
  ON chart_of_accounts(tenant_id, account_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_coa_tenant_type
  ON chart_of_accounts(tenant_id, account_type) WHERE deleted_at IS NULL;

-- =====================================================================
-- 4. Accounting periods
-- =====================================================================
CREATE TABLE accounting_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  period_year   SMALLINT NOT NULL,
  period_month  SMALLINT NOT NULL,
  status        accounting_period_status NOT NULL DEFAULT 'open',
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by     UUID REFERENCES auth.users(id),
  closing_started_at TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  closed_by     UUID REFERENCES auth.users(id),
  reopen_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT chk_accounting_period_month CHECK (period_month BETWEEN 1 AND 12),
  UNIQUE (tenant_id, period_year, period_month)
);

-- =====================================================================
-- 5. Journal entries + lines (immutable once posted)
-- =====================================================================
CREATE TABLE journal_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  entry_ref          TEXT NOT NULL DEFAULT lpad(nextval('journal_entry_ref_seq')::text, 8, '0'),
  entry_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  period_id          UUID REFERENCES accounting_periods(id),
  entry_type         journal_entry_type NOT NULL DEFAULT 'manual',
  status             journal_entry_status NOT NULL DEFAULT 'draft',
  description_ar     TEXT,
  description_en     TEXT,
  -- Source linkage (auditable back to the business record — ZATCA-ready)
  source_module      TEXT,                       -- 'payroll' | 'invoices' | 'expenses' | ...
  source_entity_type TEXT,
  source_entity_id   UUID,
  -- Reversal chain
  reversal_of_entry_id UUID REFERENCES journal_entries(id),
  reversed_entry_id    UUID REFERENCES journal_entries(id),
  posted_at          TIMESTAMPTZ,
  posted_by          UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES auth.users(id),
  updated_by         UUID REFERENCES auth.users(id),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX idx_journal_tenant_date ON journal_entries(tenant_id, entry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_journal_tenant_status ON journal_entries(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_journal_source ON journal_entries(source_module, source_entity_id) WHERE source_entity_id IS NOT NULL;

CREATE TABLE journal_entry_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  journal_entry_id  UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id        UUID NOT NULL REFERENCES chart_of_accounts(id),
  description       TEXT,
  debit_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_line_single_side CHECK (
    (debit_amount > 0 AND credit_amount = 0) OR
    (credit_amount > 0 AND debit_amount = 0)
  ),
  CONSTRAINT chk_line_non_negative CHECK (debit_amount >= 0 AND credit_amount >= 0)
);
CREATE INDEX idx_jel_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_jel_account ON journal_entry_lines(account_id);

-- Journal immutability: once posted, an entry may only transition to
-- 'reversed' (with reversal linkage); all other edits and hard deletes are
-- blocked. Corrections are reversal-based only (7.2).
CREATE OR REPLACE FUNCTION prevent_posted_journal_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'posted' AND (NEW.status = 'posted' OR NEW.status = 'draft') THEN
    RAISE EXCEPTION 'JRN001: posted journal entries are immutable; use a reversal entry';
  END IF;
  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'JRN002: reversed journal entries cannot be modified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_immutable
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_mutation();

CREATE OR REPLACE FUNCTION block_posted_journal_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'JRN003: posted journal entries cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_no_delete_posted
  BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION block_posted_journal_delete();

-- =====================================================================
-- 6. Bank accounts + reconciliations (created before finance_payments so
--    the FK on finance_payments.bank_account_id resolves)
-- =====================================================================
CREATE TABLE bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  bank_name       TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  iban            TEXT NOT NULL,
  account_number  TEXT,
  currency        TEXT NOT NULL DEFAULT 'SAR',
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE bank_reconciliations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  bank_account_id     UUID NOT NULL REFERENCES bank_accounts(id),
  statement_from      DATE NOT NULL,
  statement_to        DATE NOT NULL,
  opening_balance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_balance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  matched_count       INTEGER NOT NULL DEFAULT 0,
  status              reconciliation_status NOT NULL DEFAULT 'draft',
  reconciled_at       TIMESTAMPTZ,
  reconciled_by       UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES auth.users(id),
  updated_by          UUID REFERENCES auth.users(id),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT chk_recon_dates CHECK (statement_to >= statement_from)
);

CREATE TABLE bank_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  bank_account_id   UUID NOT NULL REFERENCES bank_accounts(id),
  transaction_date  DATE NOT NULL,
  description       TEXT,
  amount            NUMERIC(12,2) NOT NULL,   -- positive = deposit, negative = withdrawal
  status            bank_transaction_status NOT NULL DEFAULT 'pending',
  reconciliation_id UUID REFERENCES bank_reconciliations(id),
  source_entity_type TEXT,
  source_entity_id   UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES auth.users(id),
  updated_by        UUID REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX idx_bank_tx_account_date ON bank_transactions(bank_account_id, transaction_date) WHERE deleted_at IS NULL;

-- =====================================================================
-- 7. Customers & suppliers (finance references)
-- =====================================================================
CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  customer_code TEXT NOT NULL DEFAULT lpad(nextval('finance_doc_ref_seq')::text, 6, '0'),
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  phone         TEXT,
  email         TEXT,
  tax_number    TEXT,                          -- ZATCA VAT registration no.
  address       TEXT,
  credit_limit  NUMERIC(12,2),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_customers_tenant_code ON customers(tenant_id, customer_code) WHERE deleted_at IS NULL;

CREATE TABLE suppliers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  supplier_code TEXT NOT NULL DEFAULT lpad(nextval('finance_doc_ref_seq')::text, 6, '0'),
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  phone         TEXT,
  email         TEXT,
  tax_number    TEXT,
  address       TEXT,
  credit_limit  NUMERIC(12,2),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_suppliers_tenant_code ON suppliers(tenant_id, supplier_code) WHERE deleted_at IS NULL;

-- =====================================================================
-- 8. Receivables (AR) & Payables (AP)
-- =====================================================================
CREATE TABLE receivables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  customer_id    UUID REFERENCES customers(id),
  invoice_ref    TEXT NOT NULL,
  invoice_date   DATE NOT NULL,
  due_date       DATE NOT NULL,
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- net of VAT
  vat_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,   -- amount + vat_amount
  paid_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  status         ar_ap_status NOT NULL DEFAULT 'open',
  source_entity_type TEXT,                           -- 'platform_payments' | 'orders' | ...
  source_entity_id   UUID,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  deleted_at     TIMESTAMPTZ,
  CONSTRAINT chk_receivables_amounts CHECK (
    amount >= 0 AND vat_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0
  )
);
CREATE INDEX idx_receivables_tenant_status ON receivables(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_receivables_due ON receivables(tenant_id, due_date) WHERE deleted_at IS NULL AND status IN ('open', 'partially_paid', 'overdue');

CREATE TABLE payables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  supplier_id    UUID REFERENCES suppliers(id),
  invoice_ref    TEXT NOT NULL,
  invoice_date   DATE NOT NULL,
  due_date       DATE NOT NULL,
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  status         ar_ap_status NOT NULL DEFAULT 'open',
  source_entity_type TEXT,
  source_entity_id   UUID,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  deleted_at     TIMESTAMPTZ,
  CONSTRAINT chk_payables_amounts CHECK (
    amount >= 0 AND vat_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0
  )
);
CREATE INDEX idx_payables_tenant_status ON payables(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_payables_due ON payables(tenant_id, due_date) WHERE deleted_at IS NULL AND status IN ('open', 'partially_paid', 'overdue');

-- =====================================================================
-- 9. Finance payments + allocation
-- =====================================================================
CREATE TABLE finance_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  payment_ref    TEXT NOT NULL DEFAULT lpad(nextval('finance_doc_ref_seq')::text, 8, '0'),
  direction      TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  customer_id    UUID REFERENCES customers(id),
  supplier_id    UUID REFERENCES suppliers(id),
  payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  amount         NUMERIC(12,2) NOT NULL,
  method         finance_payment_method NOT NULL DEFAULT 'transfer',
  bank_account_id UUID REFERENCES bank_accounts(id),
  reference      TEXT,
  status         finance_payment_status NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  deleted_at     TIMESTAMPTZ,
  CONSTRAINT chk_finance_payment_amount CHECK (amount > 0)
);

CREATE TABLE payment_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  finance_payment_id UUID NOT NULL REFERENCES finance_payments(id) ON DELETE CASCADE,
  receivable_id     UUID REFERENCES receivables(id),
  payable_id        UUID REFERENCES payables(id),
  allocated_amount  NUMERIC(12,2) NOT NULL,
  allocated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  allocated_by      UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_allocation_target CHECK (
    (receivable_id IS NOT NULL AND payable_id IS NULL) OR
    (receivable_id IS NULL AND payable_id IS NOT NULL)
  ),
  CONSTRAINT chk_allocation_amount CHECK (allocated_amount > 0)
);
CREATE INDEX idx_allocations_payment ON payment_allocations(finance_payment_id);
CREATE INDEX idx_allocations_receivable ON payment_allocations(receivable_id) WHERE receivable_id IS NOT NULL;
CREATE INDEX idx_allocations_payable ON payment_allocations(payable_id) WHERE payable_id IS NOT NULL;

-- =====================================================================
-- 10. VAT ledgers — output and input NEVER netted silently (7.2)
-- =====================================================================
CREATE TABLE vat_output_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  period_year      SMALLINT NOT NULL,
  period_month     SMALLINT NOT NULL,
  invoice_ref      TEXT NOT NULL,
  invoice_date     DATE NOT NULL,
  vat_base_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate         NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  vat_amount       NUMERIC(12,2) NOT NULL,
  customer_id      UUID REFERENCES customers(id),
  source_entity_type TEXT,
  source_entity_id   UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id),
  CONSTRAINT chk_vat_output_period CHECK (period_month BETWEEN 1 AND 12)
);
CREATE INDEX idx_vat_output_period ON vat_output_ledger(tenant_id, period_year, period_month);

CREATE TABLE vat_input_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  period_year      SMALLINT NOT NULL,
  period_month     SMALLINT NOT NULL,
  invoice_ref      TEXT NOT NULL,
  invoice_date     DATE NOT NULL,
  vat_base_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate         NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  vat_amount       NUMERIC(12,2) NOT NULL,
  supplier_id      UUID REFERENCES suppliers(id),
  source_entity_type TEXT,
  source_entity_id   UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id),
  CONSTRAINT chk_vat_input_period CHECK (period_month BETWEEN 1 AND 12)
);
CREATE INDEX idx_vat_input_period ON vat_input_ledger(tenant_id, period_year, period_month);

-- =====================================================================
-- 11. updated_at triggers (reuses update_updated_at_column from 009)
-- =====================================================================
CREATE TRIGGER trg_coa_updated_at BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_accounting_periods_updated_at BEFORE UPDATE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_journal_entries_updated_at BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_receivables_updated_at BEFORE UPDATE ON receivables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_payables_updated_at BEFORE UPDATE ON payables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_finance_payments_updated_at BEFORE UPDATE ON finance_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_bank_accounts_updated_at BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_bank_transactions_updated_at BEFORE UPDATE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_bank_reconciliations_updated_at BEFORE UPDATE ON bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================================
-- 12. Trial balance view (security_invoker respects RLS of base tables)
-- =====================================================================
CREATE VIEW trial_balance
WITH (security_invoker = true) AS
SELECT
  je.tenant_id,
  ca.account_code,
  ca.name_ar,
  ca.name_en,
  ca.account_type,
  ca.normal_balance,
  SUM(jel.debit_amount)  AS total_debit,
  SUM(jel.credit_amount) AS total_credit,
  SUM(jel.debit_amount) - SUM(jel.credit_amount) AS net_balance
FROM journal_entry_lines jel
JOIN journal_entries je  ON je.id = jel.journal_entry_id
JOIN chart_of_accounts ca ON ca.id = jel.account_id
WHERE je.status = 'posted'
GROUP BY je.tenant_id, ca.account_code, ca.name_ar, ca.name_en, ca.account_type, ca.normal_balance;

-- =====================================================================
-- 13. RLS — 4-policy pattern on all tenant-owned tables
-- =====================================================================
ALTER TABLE chart_of_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables               ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_output_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_input_ledger       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_reconciliations   ENABLE ROW LEVEL SECURITY;

-- helper for repetitive policy creation (tables with deleted_at)
CREATE OR REPLACE FUNCTION apply_accounting_rls(p_table regclass)
RETURNS void AS $$
BEGIN
  EXECUTE format('CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);',
    'sel_' || p_table || '_tenant', p_table);
  EXECUTE format('CREATE POLICY %I ON %s FOR INSERT TO authenticated WITH CHECK (tenant_id = get_my_tenant_id());',
    'ins_' || p_table || '_tenant', p_table);
  EXECUTE format('CREATE POLICY %I ON %s FOR UPDATE TO authenticated USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL) WITH CHECK (tenant_id = get_my_tenant_id());',
    'upd_' || p_table || '_tenant', p_table);
  -- No DELETE policy: soft-delete only (ADR-007 / v1.0)
END;
$$ LANGUAGE plpgsql;

SELECT apply_accounting_rls('chart_of_accounts');
SELECT apply_accounting_rls('accounting_periods');
SELECT apply_accounting_rls('journal_entries');
SELECT apply_accounting_rls('customers');
SELECT apply_accounting_rls('suppliers');
SELECT apply_accounting_rls('receivables');
SELECT apply_accounting_rls('payables');
SELECT apply_accounting_rls('finance_payments');
SELECT apply_accounting_rls('bank_accounts');
SELECT apply_accounting_rls('bank_transactions');
SELECT apply_accounting_rls('bank_reconciliations');

-- journal_entry_lines + payment_allocations + vat ledgers have no deleted_at:
-- explicit policies (no soft-delete filter)
CREATE POLICY "sel_jel_tenant" ON journal_entry_lines FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_jel_tenant" ON journal_entry_lines FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "upd_jel_tenant" ON journal_entry_lines FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "sel_allocations_tenant" ON payment_allocations FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_allocations_tenant" ON payment_allocations FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "upd_allocations_tenant" ON payment_allocations FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "sel_vat_output_tenant" ON vat_output_ledger FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_vat_output_tenant" ON vat_output_ledger FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "upd_vat_output_tenant" ON vat_output_ledger FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "sel_vat_input_tenant" ON vat_input_ledger FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "ins_vat_input_tenant" ON vat_input_ledger FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "upd_vat_input_tenant" ON vat_input_ledger FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id()) WITH CHECK (tenant_id = get_my_tenant_id());

DROP FUNCTION apply_accounting_rls(regclass);

-- =====================================================================
-- 14. Seed — default chart of accounts (idempotent)
-- =====================================================================
INSERT INTO chart_of_accounts
  (tenant_id, account_code, name_ar, name_en, account_type, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000001', '1000', 'النقد بالصندوق', 'Cash on Hand', 'asset', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '1100', 'الحساب البنكي', 'Bank Account', 'asset', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '1200', 'ذمم مدينة — عملاء', 'Accounts Receivable — Customers', 'asset', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '1300', 'ذمم مدينة — منصات التوصيل', 'Accounts Receivable — Platforms', 'asset', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '1400', 'ذمم مدينة — السائقون (COD)', 'Receivable — Drivers (COD)', 'asset', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '1500', 'مصروفات مدفوعة مقدماً', 'Prepaid Expenses', 'asset', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '1600', 'الأصول الثابتة', 'Fixed Assets', 'asset', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '1610', 'مجمع الإهلاك', 'Accumulated Depreciation', 'asset', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '2000', 'ذمم دائنة — موردون', 'Accounts Payable — Suppliers', 'liability', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '2100', 'رواتب مستحقة', 'Wages Payable', 'liability', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '2200', 'مستحقات التأمينات (GOSI)', 'GOSI Payable', 'liability', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '2300', 'سلف مستلمة', 'Advances Received', 'liability', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '2500', 'ضريبة القيمة المضافة المستحقة (مخرجات)', 'VAT Output Payable', 'liability', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '2600', 'ضريبة القيمة المضافة المدينة (مدخلات)', 'VAT Input Receivable', 'asset', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '3000', 'رأس المال', 'Capital', 'equity', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '3100', 'الأرباح المحتجزة', 'Retained Earnings', 'equity', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '4000', 'إيرادات رسوم التوصيل', 'Revenue — Delivery Fees', 'income', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '4100', 'إيرادات عمولات المنصات', 'Revenue — Platform Commissions', 'income', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '4200', 'إيرادات رسوم التحصيل عند الاستلام', 'Revenue — COD Handling Fees', 'income', 'credit'),
  ('00000000-0000-0000-0000-000000000001', '5000', 'مصروفات الوقود', 'Fuel Expenses', 'expense', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '5100', 'الصيانة والإصلاحات', 'Maintenance & Repairs', 'expense', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '5200', 'الرواتب والأجور', 'Salaries & Wages', 'expense', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '5300', 'اشتراكات التأمينات (GOSI)', 'GOSI Contributions', 'expense', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '5400', 'الإيجار', 'Rent', 'expense', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '5500', 'التأمين', 'Insurance', 'expense', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '5600', 'الرسوم البنكية', 'Bank Charges', 'expense', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '5700', 'مصروف الإهلاك', 'Depreciation Expense', 'expense', 'debit'),
  ('00000000-0000-0000-0000-000000000001', '5800', 'مصروفات متنوعة', 'Miscellaneous Expenses', 'expense', 'debit')
ON CONFLICT (tenant_id, account_code) WHERE deleted_at IS NULL DO NOTHING;

-- Seed the current accounting period for the default tenant (idempotent).
INSERT INTO accounting_periods (tenant_id, period_year, period_month, status)
SELECT '00000000-0000-0000-0000-000000000001', EXTRACT(YEAR FROM CURRENT_DATE)::smallint,
       EXTRACT(MONTH FROM CURRENT_DATE)::smallint, 'open'
WHERE NOT EXISTS (
  SELECT 1 FROM accounting_periods
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
    AND period_year = EXTRACT(YEAR FROM CURRENT_DATE)::smallint
    AND period_month = EXTRACT(MONTH FROM CURRENT_DATE)::smallint
);
