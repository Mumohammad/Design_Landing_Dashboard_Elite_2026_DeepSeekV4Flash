// Pure helpers for the Payroll surface wiring (Prompt F).
//
// No Supabase / React imports — unit-testable per the drivers/users/approvals
// module precedent (vitest, node environment).
//
// Covers:
//   * payroll status transition guards (users-module idiom: terminal states,
//     mandatory reason on rejection-like transitions)
//   * the CSV serializer for the payroll list export
//   * period label formatting shared by list/detail/CSV

/** payroll_status enum values (migration 022). */
export type PayrollStatus =
  | "draft"
  | "calculated"
  | "in_review"
  | "approved"
  | "paid"
  | "locked"
  | "cancelled"

/**
 * Allowed payroll status transitions (users-module guard idiom).
 *
 *   draft → calculated      (calculation ran)
 *   calculated → in_review  (submitted for review)
 *   in_review → approved    (the approval decision)
 *   in_review → calculated  (review bounced it back for recalculation)
 *   approved → paid         (disbursement recorded — execution itself is
 *                            explicitly out of scope for this PR)
 *   approved/locked → cancelled (with mandatory reason)
 *   draft/calculated → cancelled (mistake before review)
 *
 * Terminal states (no origin): paid, locked, cancelled.
 * cancelled is also terminal — a cancelled period is re-created by running
 * the calculation again, never resurrected.
 */
export const ALLOWED_PAYROLL_TRANSITIONS: Record<PayrollStatus, readonly PayrollStatus[]> = {
  draft: ["calculated", "cancelled"],
  calculated: ["in_review", "cancelled"],
  in_review: ["approved", "calculated", "cancelled"],
  approved: ["paid", "cancelled"],
  paid: [],
  locked: [],
  cancelled: [],
}

export function isPayrollTransitionAllowed(from: PayrollStatus, to: PayrollStatus): boolean {
  return ALLOWED_PAYROLL_TRANSITIONS[from].includes(to)
}

/**
 * Target statuses that require a mandatory reason (the "rejection" family —
 * anything that discards prior work or takes money off the table). Keyed by
 * TARGET, not by the from→to pair: every path into `cancelled` demands a
 * reason, from every legal origin.
 * Pure — unit-tested; the server action enforces the same rule.
 */
export const REASON_REQUIRED_TARGETS: ReadonlySet<PayrollStatus> = new Set([
  "cancelled",
])

/** True when a transition from `from` to `to` demands a reason. */
export function transitionRequiresReason(from: PayrollStatus, to: PayrollStatus): boolean {
  void from // every origin into a reason-required target demands the reason
  return REASON_REQUIRED_TARGETS.has(to)
}

export type PayrollCsvRow = {
  period_year: number
  period_month: number
  status: string
  driver_code: string | null
  driver_name: string | null
  orders_achieved: number | null
  orders_prorated_target: number | null
  orders_variance: number | null
  base_amount: number | null
  orders_bonus: number | null
  total_deductions: number | null
  cod_deduction: number | null
  net_payroll: number | null
  below_minimum_wage: boolean | null
  minimum_floor_applied: boolean | null
  manual_override: boolean | null
}

export type CsvCell = string | number | boolean | null | undefined

/** RFC-4180-safe CSV line builder with a UTF-8 BOM (Excel + Arabic safe). */
export function payrollToCsv(header: string[], rows: CsvCell[][]): string {
  const escape = (v: CsvCell) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "\uFEFF" + [header, ...rows].map((r) => r.map(escape).join(",")).join("\n")
}

/** Serialized CSV body for the payroll list export (same columns as the table). */
export function payrollRowsToCsv(rows: PayrollCsvRow[]): string {
  const header = [
    "Period",
    "Driver Code",
    "Driver",
    "Status",
    "Orders Achieved",
    "Orders Target (prorated)",
    "Orders Variance",
    "Base (SAR)",
    "Bonus (SAR)",
    "Deductions (SAR)",
    "COD Deduction (SAR)",
    "Net (SAR)",
    "Below Min Wage",
    "Floor Applied",
    "Manual Override",
  ]
  const body = rows.map((r) => [
    `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
    r.driver_code,
    r.driver_name,
    r.status,
    r.orders_achieved,
    r.orders_prorated_target,
    r.orders_variance,
    r.base_amount,
    r.orders_bonus,
    r.total_deductions,
    r.cod_deduction,
    r.net_payroll,
    r.below_minimum_wage ? "yes" : "no",
    r.minimum_floor_applied ? "yes" : "no",
    r.manual_override ? "yes" : "no",
  ])
  return payrollToCsv(header, body)
}

/** "2026-9" → "2026-09" period key used by deduction month columns. */
export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

export type MonthlyOrdersRollup = {
  total_delivered: number
  total_failed: number
  total_returned: number
  total_revenue: number
  platforms: number
}

/** Aggregate per-platform monthly_driver_orders rows into one rollup. */
export function rollupMonthlyOrders(
  rows: { total_delivered: number | null; total_failed: number | null; total_returned: number | null; total_revenue: number | null }[]
): MonthlyOrdersRollup {
  return {
    total_delivered: rows.reduce((s, r) => s + (r.total_delivered ?? 0), 0),
    total_failed: rows.reduce((s, r) => s + (r.total_failed ?? 0), 0),
    total_returned: rows.reduce((s, r) => s + (r.total_returned ?? 0), 0),
    total_revenue: rows.reduce((s, r) => s + Number(r.total_revenue ?? 0), 0),
    platforms: rows.length,
  }
}

export type CodRollup = {
  sessions: number
  collected: number
  submitted: number
  variance: number
  pending: number
}

/** Aggregate COD sessions: collected/submitted totals, variance, pending count. */
export function rollupCodSessions(
  rows: { cod_collected: number | null; cod_submitted: number | null; cod_variance: number | null; status: string }[]
): CodRollup {
  return {
    sessions: rows.length,
    collected: rows.reduce((s, r) => s + Number(r.cod_collected ?? 0), 0),
    submitted: rows.reduce((s, r) => s + Number(r.cod_submitted ?? 0), 0),
    variance: rows.reduce((s, r) => s + Number(r.cod_variance ?? 0), 0),
    pending: rows.filter((r) => r.status === "pending").length,
  }
}
