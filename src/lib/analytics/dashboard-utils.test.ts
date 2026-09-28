import { describe, expect, it } from "vitest"

import {
  aggregateApprovalsDepth,
  buildMetric,
  buildMonthlyOrdersTrend,
  kpiRowsToCsv,
  lastNPoints,
  mergePayrollTrend,
  periodKeyOf,
  toCsv,
  type MonthlyOrdersRow,
  type PayrollPeriodRow,
} from "./dashboard-utils"

// ── buildMonthlyOrdersTrend ──────────────────────────────────────────────────

describe("buildMonthlyOrdersTrend", () => {
  const rows: MonthlyOrdersRow[] = [
    { period_year: 2026, period_month: 7, total_delivered: 10, total_revenue: 1500.4 },
    { period_year: 2026, period_month: 7, total_delivered: 5, total_revenue: 500.6 },
    { period_year: 2026, period_month: 9, total_delivered: 8, total_revenue: 900 },
  ]

  it("aggregates rows per month and sorts ascending", () => {
    const trend = buildMonthlyOrdersTrend(rows)
    expect(trend).toHaveLength(2)
    expect(trend[0].date).toBe("2026-07")
    expect(trend[0].orders).toBe(15)
    expect(trend[0].revenue).toBeCloseTo(2001, 5)
    expect(trend[1].date).toBe("2026-09")
    expect(trend[1].orders).toBe(8)
  })

  it("does NOT zero-fill missing months (no invented series)", () => {
    // 2026-08 has no rows → absent from the output entirely.
    const trend = buildMonthlyOrdersTrend(rows)
    expect(trend.map((p) => p.date)).toEqual(["2026-07", "2026-09"])
  })

  it("treats null numerics as zero", () => {
    const trend = buildMonthlyOrdersTrend([
      { period_year: 2026, period_month: 1, total_delivered: null, total_revenue: null },
    ])
    expect(trend[0].orders).toBe(0)
    expect(trend[0].revenue).toBe(0)
  })

  it("returns empty for no rows", () => {
    expect(buildMonthlyOrdersTrend([])).toEqual([])
  })
})

// ── mergePayrollTrend ────────────────────────────────────────────────────────

describe("mergePayrollTrend", () => {
  const orders = buildMonthlyOrdersTrend([
    { period_year: 2026, period_month: 7, total_delivered: 10, total_revenue: 1000 },
  ])
  const payroll: PayrollPeriodRow[] = [
    { period_year: 2026, period_month: 7, net_payroll: 3000 },
    { period_year: 2026, period_month: 8, net_payroll: 3200.5 },
  ]

  it("merges payroll into matching months and adds payroll-only months", () => {
    const merged = mergePayrollTrend(orders, payroll)
    expect(merged.map((p) => p.date)).toEqual(["2026-07", "2026-08"])
    expect(merged[0].payroll).toBe(3000)
    expect(merged[0].orders).toBe(10)
    expect(merged[1].payroll).toBeCloseTo(3200.5, 5)
    expect(merged[1].orders).toBeUndefined()
  })

  it("keeps the series sorted after the merge", () => {
    const merged = mergePayrollTrend(orders, [
      { period_year: 2025, period_month: 12, net_payroll: 1 },
    ])
    expect(merged.map((p) => p.date)).toEqual(["2025-12", "2026-07"])
  })
})

// ── windowing / keys ─────────────────────────────────────────────────────────

describe("lastNPoints / periodKeyOf", () => {
  it("returns the trailing window", () => {
    expect(lastNPoints([1, 2, 3, 4, 5], 2)).toEqual([4, 5])
    expect(lastNPoints([1, 2], 5)).toEqual([1, 2])
  })

  it("zero-pads the month in period keys", () => {
    expect(periodKeyOf(2026, 9)).toBe("2026-09")
    expect(periodKeyOf(2026, 12)).toBe("2026-12")
  })
})

// ── aggregateApprovalsDepth ──────────────────────────────────────────────────

describe("aggregateApprovalsDepth", () => {
  const now = Date.parse("2026-09-27T12:00:00Z")
  const day = 24 * 60 * 60 * 1000

  it("counts by type", () => {
    const depth = aggregateApprovalsDepth(
      [
        { item_type: "expense", requested_at: "2026-09-27T10:00:00Z" },
        { item_type: "expense", requested_at: "2026-09-27T09:00:00Z" },
        { item_type: "leave_request", requested_at: "2026-09-27T08:00:00Z" },
        { item_type: "application", requested_at: "2026-09-27T07:00:00Z" },
      ],
      now,
    )
    expect(depth).toEqual({ total: 4, expenses: 2, leaves: 1, applications: 1, stale: 0 })
  })

  it("flags items older than the stale threshold", () => {
    const depth = aggregateApprovalsDepth(
      [
        { item_type: "expense", requested_at: new Date(now - 8 * day).toISOString() },
        { item_type: "leave_request", requested_at: new Date(now - 2 * day).toISOString() },
        { item_type: "expense", requested_at: "not-a-date" },
      ],
      now,
    )
    expect(depth.total).toBe(3)
    expect(depth.stale).toBe(1)
  })

  it("returns zeros for an empty queue", () => {
    expect(aggregateApprovalsDepth([], now)).toEqual({
      total: 0,
      expenses: 0,
      leaves: 0,
      applications: 0,
      stale: 0,
    })
  })
})

// ── buildMetric ─────────────────────────────────────────────────────────────

describe("buildMetric", () => {
  it("computes delta and pct with 1dp rounding", () => {
    const m = buildMetric(155, 141)
    expect(m.delta).toBe(14)
    expect(m.pct).toBeCloseTo(9.9, 5)
    expect(m.available).toBe(true)
  })

  it("reports 100% only when previous is 0 and value is positive", () => {
    expect(buildMetric(50, 0).pct).toBe(100)
    expect(buildMetric(0, 0).pct).toBe(0)
  })

  it("propagates module availability", () => {
    expect(buildMetric(10, 5, false).available).toBe(false)
  })

  it("negatives: delta flips sign, pct is computed against |previous|", () => {
    const m = buildMetric(90, 110)
    expect(m.delta).toBe(-20)
    expect(m.pct).toBeCloseTo(-18.2, 5)
  })
})

// ── CSV ──────────────────────────────────────────────────────────────────────

describe("kpi snapshot CSV", () => {
  it("emits a BOM + header + one row per metric", () => {
    const csv = kpiRowsToCsv([
      {
        metric: "Total Drivers",
        value: 141,
        previous: 141,
        delta: 0,
        available: true,
        source: "drivers",
        link: "/drivers",
      },
      {
        metric: "Open Approvals",
        value: 3,
        previous: null,
        delta: null,
        available: true,
        source: "fetch_pending_approvals RPC",
        link: "/approvals",
      },
    ])
    expect(csv.startsWith("\uFEFF")).toBe(true)
    const lines = csv.slice(1).split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe("Metric,Value,Previous,Delta,Available,Source,Deep Link")
    expect(lines[1]).toContain("141")
    expect(lines[1]).toContain("/drivers")
    expect(lines[2]).toContain("fetch_pending_approvals RPC")
  })

  it("escapes commas and quotes per RFC-4180 (quotes only when needed)", () => {
    const csv = toCsv(["Name"], [['Murder, "Inc."', null]])
    expect(csv).toBe('\uFEFFName\n"Murder, ""Inc.""",')
  })

  it("quotes cells with embedded newlines", () => {
    const csv = toCsv(["V"], [["line1\nline2"]])
    expect(csv).toBe('\uFEFFV\n"line1\nline2"')
  })
})
