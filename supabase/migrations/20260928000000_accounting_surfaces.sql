-- ============================================================================
-- Accounting Module surfaces (Prompt I)
-- (20260928000000_accounting_surfaces.sql)
--
-- Scope: index support for the accounting read surfaces shipped in this
-- prompt. NO NEW TABLES, NO NEW RPCs — every surface composes over the
-- pre-existing accounting stack (027 journal/finance_payments, 038 invoices,
-- 021 expenses, 048–050 payments engine, 051 vat_reconciliation view):
--
--   Reads the surfaces introduce (per surface):
--     * /payments (NEW list index) — finance_payments ordered by
--       (tenant_id, payment_date DESC), filtered deleted_at IS NULL; KPI
--       cards additionally split by direction and status (unallocated =
--       pending/partially_allocated). finance_payments had NO tenant-leading
--       index at all before this migration (only payment_allocations-side
--       indexes existed) — both indexes below are the first to serve it.
--     * /dashboard accounting KPIs — invoices (sales, issue_date window,
--       deleted_at IS NULL) and expenses (expense_date window) via
--       src/lib/accounting/kpis.ts; served by the existing
--       idx_invoices_tenant_date / idx_invoices_tenant_status (038) and
--       idx_expenses_active (021) — no new index needed there, re-asserted
--       in the pgTAP 066 suite instead.
--     * /accounting journal tab — entry-lines drill-down reads
--       journal_entry_lines by journal_entry_id (idx_jel_entry, 027) with
--       embedded chart_of_accounts (idx_coa_tenant_code); no new index.
--
--   1. finance_payments list index — the page's primary read leads with
--      tenant and orders by payment_date DESC within the soft-delete
--      predicate. This is the list + CSV export scan path.
--   2. finance_payments status index — status-chip filtering and the
--      unallocated KPI (status IN ('pending','partially_allocated')) plus
--      the void action's status lookup lead with (tenant_id, status).
--
-- Conventions (Track 1): idempotent (IF NOT EXISTS), no data seeds, no
-- table grants changed, forward-only migration (rollback notes only).
--
-- Rollback (forward-only repo, notes only):
--   DROP INDEX IF EXISTS public.idx_finance_payments_tenant_date;
--   DROP INDEX IF EXISTS public.idx_finance_payments_tenant_status;
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. finance_payments list index (idempotent)
--    /payments list + CSV export: tenant-scoped, newest first, soft-delete
--    filtered — matches the page's single ORDER BY shape exactly.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_finance_payments_tenant_date
  ON finance_payments(tenant_id, payment_date DESC)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_finance_payments_tenant_date IS
  'Accounting surfaces: /payments list index (tenant, payment_date DESC) — first tenant-leading index on finance_payments';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. finance_payments status index (idempotent)
--    Status chips, the unallocated KPI (pending/partially_allocated), and
--    the void action's status guard read (tenant_id, status).
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_finance_payments_tenant_status
  ON finance_payments(tenant_id, status)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_finance_payments_tenant_status IS
  'Accounting surfaces: /payments status filter + unallocated KPI + void guard (tenant, status)';
