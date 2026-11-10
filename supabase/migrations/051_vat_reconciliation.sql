-- =====================================================================
-- 051 — Financial Phase 11 (IMPLEMENTATION-PLAN Phase 10): VAT reconciliation
--
--   1. `vat_reconciliation` VIEW (security_invoker) — per (tenant, year,
--      month) the live net position:
--        net_position = output_vat + adjustments_output
--                     − recoverable_input_vat − adjustments_input
--      Rows are derived from the two ledgers + finalized adjustments, so the
--      view is always in sync with the journal-adjacent state (no snapshot
--      to go stale). security_invoker means the caller's RLS on the base
--      tables applies — tenant scoping is automatic for authenticated users.
--
--   2. `protect_vat_input_reclassify()` trigger — a row's recoverability may
--      ONLY change while the row is `pending_review` (VAT004). Once a human
--      or a dispatcher has classified a row, it is locked. This is the
--      DB-level guard behind the Phase 11 review-items resolution flow.
--
-- The plan's remaining Phase 10 deliverables (review-items UI, CSV export,
-- printable bilingual report) live in the app layer
-- (src/lib/accounting/vat.ts + vat-report-html.ts + the accounting VAT tab).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. vat_reconciliation view
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS vat_reconciliation;
CREATE VIEW vat_reconciliation
WITH (security_invoker = true) AS
WITH months AS (
  SELECT tenant_id, period_year, period_month FROM vat_periods
  WHERE deleted_at IS NULL
  UNION
  SELECT tenant_id, period_year, period_month FROM vat_output_ledger
  UNION
  SELECT tenant_id, period_year, period_month FROM vat_input_ledger
  UNION
  SELECT tenant_id, period_year, period_month FROM vat_adjustments
  WHERE deleted_at IS NULL
),
output AS (
  SELECT tenant_id, period_year, period_month,
         SUM(vat_amount) AS output_vat
  FROM vat_output_ledger
  GROUP BY tenant_id, period_year, period_month
),
input AS (
  SELECT tenant_id, period_year, period_month,
         SUM(vat_amount) FILTER (WHERE vat_recoverability = 'recoverable')   AS recoverable_input_vat,
         SUM(vat_amount) FILTER (WHERE vat_recoverability = 'non_recoverable') AS non_recoverable_vat,
         SUM(vat_amount) FILTER (WHERE vat_recoverability = 'pending_review')  AS pending_review_vat,
         COUNT(*) FILTER (WHERE vat_recoverability = 'pending_review')         AS pending_review_rows
  FROM vat_input_ledger
  GROUP BY tenant_id, period_year, period_month
),
adj AS (
  SELECT tenant_id, period_year, period_month,
         SUM(vat_amount) FILTER (WHERE direction = 'output') AS adjustments_output,
         SUM(vat_amount) FILTER (WHERE direction = 'input')  AS adjustments_input
  FROM vat_adjustments
  WHERE deleted_at IS NULL AND status = 'finalized'
  GROUP BY tenant_id, period_year, period_month
)
SELECT
  m.tenant_id,
  m.period_year,
  m.period_month,
  p.id           AS period_id,
  p.status       AS period_status,
  COALESCE(o.output_vat, 0)              AS output_vat,
  COALESCE(i.recoverable_input_vat, 0)   AS recoverable_input_vat,
  COALESCE(i.non_recoverable_vat, 0)     AS non_recoverable_vat,
  COALESCE(i.pending_review_vat, 0)      AS pending_review_vat,
  COALESCE(a.adjustments_output, 0)      AS adjustments_output,
  COALESCE(a.adjustments_input, 0)       AS adjustments_input,
  COALESCE(i.pending_review_rows, 0)     AS pending_review_rows,
  ROUND(
    COALESCE(o.output_vat, 0) + COALESCE(a.adjustments_output, 0)
    - COALESCE(i.recoverable_input_vat, 0) - COALESCE(a.adjustments_input, 0),
    2
  ) AS net_position
FROM months m
LEFT JOIN vat_periods p
  ON p.tenant_id = m.tenant_id
 AND p.period_year = m.period_year
 AND p.period_month = m.period_month
 AND p.deleted_at IS NULL
LEFT JOIN output o
  ON o.tenant_id = m.tenant_id
 AND o.period_year = m.period_year
 AND o.period_month = m.period_month
LEFT JOIN input i
  ON i.tenant_id = m.tenant_id
 AND i.period_year = m.period_year
 AND i.period_month = m.period_month
LEFT JOIN adj a
  ON a.tenant_id = m.tenant_id
 AND a.period_year = m.period_year
 AND a.period_month = m.period_month;

-- Default privileges (Supabase postgres role) grant SELECT on public views to
-- anon/authenticated/service_role; security_invoker keeps tenant scoping via
-- the base-table RLS. Explicit grant for robustness on non-default setups.
GRANT SELECT ON vat_reconciliation TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Review-item reclassification guard (VAT004)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_vat_input_reclassify()
RETURNS TRIGGER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.vat_recoverability <> NEW.vat_recoverability
     AND OLD.vat_recoverability <> 'pending_review' THEN
    RAISE EXCEPTION 'VAT004: review item is not pending review; reclassification is locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vat_input_reclassify ON vat_input_ledger;
CREATE TRIGGER trg_vat_input_reclassify BEFORE UPDATE ON vat_input_ledger
  FOR EACH ROW EXECUTE FUNCTION protect_vat_input_reclassify();
