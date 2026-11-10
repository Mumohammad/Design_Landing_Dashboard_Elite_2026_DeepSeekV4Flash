-- =====================================================================
-- 052 — Financial Phase 13 (IMPLEMENTATION-PLAN Phase 12): financial
-- statements — P&L, Balance Sheet, Cash Flow.
--
-- All three are `security_invoker` VIEWS over POSTED journal entries only
-- (drafts/reversals are excluded; reversed entries keep their reversal pair
-- which nets them out — status remains 'posted' on both sides, matching the
-- trial_balance contract). RLS of the base tables therefore applies for
-- authenticated users, so tenant scoping is automatic.
--
--   1. `profit_loss`   — income/expense account balances per (tenant, period)
--   2. `balance_sheet` — asset/liability/equity cumulative balances as of the
--                        END of each period (posted entries up to that month)
--   3. `cash_flow`     — net movement of cash accounts (1000/1100) grouped by
--                        journal entry_type per period
--
-- App layer (src/lib/accounting/statements.ts + statements-manager.tsx)
-- aggregates totals and runs the balance check Assets = Liabilities + Equity.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Profit & Loss — income/expense balances per period
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS profit_loss;
CREATE VIEW profit_loss
WITH (security_invoker = true) AS
SELECT
  je.tenant_id,
  EXTRACT(YEAR FROM je.entry_date)::int  AS period_year,
  EXTRACT(MONTH FROM je.entry_date)::int AS period_month,
  ca.account_code,
  ca.name_ar,
  ca.name_en,
  ca.account_type,
  ca.normal_balance,
  SUM(jel.debit_amount)  AS total_debit,
  SUM(jel.credit_amount) AS total_credit,
  -- P&L presentation sign: revenue positive, expenses negative, so
  -- net_balance = credit − debit (income is credit-normal, expense debit-normal
  -- but is shown as a deduction). Net Profit = SUM(net_balance) works directly.
  SUM(jel.credit_amount) - SUM(jel.debit_amount) AS net_balance
FROM journal_entry_lines jel
JOIN journal_entries je   ON je.id = jel.journal_entry_id
JOIN chart_of_accounts ca ON ca.id = jel.account_id
WHERE je.status = 'posted'
  AND ca.account_type IN ('income', 'expense')
GROUP BY
  je.tenant_id,
  EXTRACT(YEAR FROM je.entry_date),
  EXTRACT(MONTH FROM je.entry_date),
  ca.account_code, ca.name_ar, ca.name_en, ca.account_type, ca.normal_balance;

-- ---------------------------------------------------------------------
-- 2. Balance Sheet — cumulative balances as of each period end
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS balance_sheet;
CREATE VIEW balance_sheet
WITH (security_invoker = true) AS
WITH periods AS (
  SELECT DISTINCT
    je.tenant_id,
    EXTRACT(YEAR FROM je.entry_date)::int  AS period_year,
    EXTRACT(MONTH FROM je.entry_date)::int AS period_month
  FROM journal_entries je
  WHERE je.status = 'posted'
),
balances AS (
  SELECT
    p.tenant_id,
    p.period_year,
    p.period_month,
    ca.account_code,
    ca.name_ar,
    ca.name_en,
    ca.account_type,
    ca.normal_balance,
    SUM(jel.debit_amount)  AS total_debit,
    SUM(jel.credit_amount) AS total_credit
  FROM periods p
  JOIN journal_entries je
    ON je.tenant_id = p.tenant_id
   AND je.status = 'posted'
   AND je.entry_date <= (make_date(p.period_year, p.period_month, 1) + interval '1 month - 1 day')
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN chart_of_accounts ca    ON ca.id = jel.account_id
  WHERE ca.account_type IN ('asset', 'liability', 'equity')
  GROUP BY
    p.tenant_id, p.period_year, p.period_month,
    ca.account_code, ca.name_ar, ca.name_en, ca.account_type, ca.normal_balance
)
SELECT
  tenant_id,
  period_year,
  period_month,
  account_code,
  name_ar,
  name_en,
  account_type,
  normal_balance,
  total_debit,
  total_credit,
  CASE WHEN normal_balance = 'debit'
       THEN total_debit - total_credit
       ELSE total_credit - total_debit END AS balance
FROM balances;

-- ---------------------------------------------------------------------
-- 3. Cash Flow — cash account (1000/1100) movement by entry_type
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS cash_flow;
CREATE VIEW cash_flow
WITH (security_invoker = true) AS
SELECT
  je.tenant_id,
  EXTRACT(YEAR FROM je.entry_date)::int  AS period_year,
  EXTRACT(MONTH FROM je.entry_date)::int AS period_month,
  je.entry_type,
  COUNT(DISTINCT je.id)                  AS entry_count,
  SUM(jel.debit_amount)                  AS cash_in,
  SUM(jel.credit_amount)                 AS cash_out,
  SUM(jel.debit_amount) - SUM(jel.credit_amount) AS net_cash_flow
FROM journal_entry_lines jel
JOIN journal_entries je   ON je.id = jel.journal_entry_id
JOIN chart_of_accounts ca ON ca.id = jel.account_id
WHERE je.status = 'posted'
  AND ca.account_code IN ('1000', '1100')
GROUP BY
  je.tenant_id,
  EXTRACT(YEAR FROM je.entry_date),
  EXTRACT(MONTH FROM je.entry_date),
  je.entry_type;

-- Default privileges (Supabase postgres role) grant SELECT on public views to
-- anon/authenticated/service_role; security_invoker keeps tenant scoping via
-- the base-table RLS. Explicit grants for robustness.
GRANT SELECT ON profit_loss, balance_sheet, cash_flow TO authenticated, service_role;
