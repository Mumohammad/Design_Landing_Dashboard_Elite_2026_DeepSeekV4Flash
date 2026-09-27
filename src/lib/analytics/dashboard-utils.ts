// Pure helpers for the /dashboard analytics restoration (Prompt G).
//
// Client-safe: no Supabase / React imports — unit-testable per the
// payroll-utils / assignment-utils precedent (vitest, node environment).
// "use server" modules cannot be imported by client components, so every
// pure computation the dashboard UI needs lives here.
//
// Covers:
//   * the KPI-snapshot CSV export (payrollToCsv convention: RFC-4180, UTF-8 BOM)
//   * truthful time-series buckets — only from real monthly rollup rows
//     (monthly_driver_orders, driver_payroll_periods). NO zero-fill between
//     months: a missing month has no data, and inventing zeros would draw a
//     fabricated series (the prompt's explicit anti-goal).
//   * approvals depth aggregation over the queue RPC rows (#52)

// ── Trends ───────────────────────────────────────────────────────────────────

export type MonthlyTrendPoint = {
  /** "YYYY-MM" period key. */
  date: string
  orders?: number
  revenue?: number
  payroll?: number
}

export type MonthlyOrdersRow = {
  period_year: number
  period_month: number
  total_delivered: number | null
  total_revenue: number | null
}

export type PayrollPeriodRow = {
  period_year: number
  period_month: number
  net_payroll: number | null
}

/**
 * Build the monthly orders/revenue series from monthly_driver_orders rows.
 * Keys are derived from EXISTING rows only — sparse months stay sparse, so
 * the chart never invents a flat zero line for months that simply have no
 * data. Rows are aggregated across drivers/platforms per (year, month).
 */
export function buildMonthlyOrdersTrend(rows: MonthlyOrdersRow[]): MonthlyTrendPoint[] {
  const byMonth = new Map<string, MonthlyTrendPoint>()
  for (const r of rows) {
    const key = periodKeyOf(r.period_year, r.period_month)
    let p = byMonth.get(key)
    if (!p) {
      p = { date: key, orders: 0, revenue: 0 }
      byMonth.set(key, p)
    }
    p.orders = (p.orders ?? 0) + (r.total_delivered ?? 0)
    p.revenue = (p.revenue ?? 0) + Number(r.total_revenue ?? 0)
  }
  return [...byMonth.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

/**
 * Merge the monthly payroll net series (driver_payroll_periods) into an
 * orders trend by period key. Payroll months without orders rows appear in
 * the result; orders months without payroll keep payroll undefined.
 */
export function mergePayrollTrend(
  trend: MonthlyTrendPoint[],
  payrollRows: PayrollPeriodRow[],
): MonthlyTrendPoint[] {
  const byMonth = new Map(trend.map((p) => [p.date, { ...p }]))
  for (const r of payrollRows) {
    const key = periodKeyOf(r.period_year, r.period_month)
    const p = byMonth.get(key)
    if (p) {
      p.payroll = (p.payroll ?? 0) + Number(r.net_payroll ?? 0)
    } else {
      byMonth.set(key, { date: key, payroll: Number(r.net_payroll ?? 0) })
    }
  }
  return [...byMonth.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** Last N points of a series, ascending — the charts' shared window. */
export function lastNPoints<T>(points: T[], n: number): T[] {
  return points.slice(-n)
}

/** "2026-9" → "2026-09" (payroll-utils periodKey twin, local to analytics). */
export function periodKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

// ── Approvals depth ──────────────────────────────────────────────────────────

export type ApprovalQueueItem = {
  item_type: string
  requested_at: string
}

/** Staleness threshold shared with the approvals inbox (7 days, ms). */
export const APPROVAL_STALE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Aggregate the unified pending-decision queue into counts by type.
 * subject_meta/requester are deliberately not part of the input type — the
 * dashboard consumes queue DEPTH only, never queue contents (PDPL minimal
 * projection: no PII crosses into the aggregate).
 */
export function aggregateApprovalsDepth(
  rows: ApprovalQueueItem[],
  nowMs: number = Date.now(),
): { total: number; expenses: number; leaves: number; applications: number; stale: number } {
  let expenses = 0
  let leaves = 0
  let applications = 0
  let stale = 0
  for (const r of rows) {
    if (r.item_type === "expense") expenses++
    else if (r.item_type === "leave_request") leaves++
    else if (r.item_type === "application") applications++
    const t = Date.parse(r.requested_at)
    if (!Number.isNaN(t) && nowMs - t > APPROVAL_STALE_MS) stale++
  }
  return { total: rows.length, expenses, leaves, applications, stale }
}

// ── CSV snapshot export ──────────────────────────────────────────────────────

export type CsvCell = string | number | boolean | null | undefined

/** RFC-4180-safe CSV line builder with a UTF-8 BOM (payroll-utils twin). */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const escape = (v: CsvCell) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "\uFEFF" + [header, ...rows].map((r) => r.map(escape).join(",")).join("\n")
}

export type KpiCsvRow = {
  metric: string
  value: number | null
  previous: number | null
  delta: number | null
  available: boolean
  source: string
  link: string
}

/** Serialized CSV body for the KPI-snapshot export (mirrors the on-screen cards). */
export function kpiRowsToCsv(rows: KpiCsvRow[]): string {
  const header = [
    "Metric",
    "Value",
    "Previous",
    "Delta",
    "Available",
    "Source",
    "Deep Link",
  ]
  const body = rows.map((r) => [
    r.metric,
    r.value,
    r.previous,
    r.delta,
    r.available ? "yes" : "no",
    r.source,
    r.link,
  ])
  return toCsv(header, body)
}
