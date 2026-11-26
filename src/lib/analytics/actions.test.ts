import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), approvals: vi.fn(), financial: vi.fn(), rateLimit: vi.fn(),
  fault: "none", calls: [] as { table: string; method: string; args: unknown[] }[],
}))

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "analytics-owner" } } }) },
  from: mocks.from, rpc: mocks.rpc,
}) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }))
vi.mock("@/lib/auth/authorization", () => ({ getCurrentUser: async () => ({ tenantId: "analytics-tenant", id: "analytics-owner", role: "owner" }) }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitDashboard: mocks.rateLimit, RateLimitError: class extends Error {} }))
vi.mock("@/lib/accounting/kpis", () => ({ getFinancialKpis: mocks.financial }))
vi.mock("@/lib/approvals/queries", () => ({ fetchApprovalsPage: mocks.approvals }))
vi.mock("./cache-scope", () => ({ readDashboardAuthorizationScope: async () => null }))
vi.mock("@/lib/cache", () => ({ CACHE_TTL: { dashboard: 60 }, cacheGet: vi.fn(), cacheKey: vi.fn() }))

import { getDashboardSnapshot } from "./actions"

const driverRows = Array.from({ length: 1251 }, (_, i) => ({
  id: `analytics-driver-${i}`, status: "active", category: "staff", full_name_en: `Driver ${i}`,
  full_name_ar: null, hire_date: "2020-01-01", created_at: "2020-01-01T00:00:00Z",
  iqama_expiry_date: null, license_expiry_date: null,
}))

const roundingRuns = [
  { id: "latest-run", month_key: "2026-11", total_drivers: 3, total_net: 290.014, result_count: 3, payable_total: 290.02 },
  { id: "historical-run", month_key: "2026-09", total_drivers: 2, total_net: 200.01, result_count: 2, payable_total: 200.02 },
]
const roundingResults = roundingRuns.flatMap(run => Array.from({ length: run.total_drivers }, (_, i) => ({
  id: `${run.id}-${i}`, run_id: run.id, month_key: run.month_key, rider_id: `rider-${i}`,
  gross_salary: i === 2 ? 100.005 : 110.005, final_net_salary: i === 2 ? 90.004 : 100.005,
})))

function query(table: string) {
  let head = false
  let limit = 1000
  const hasEngine = ["engine-rounding", "large-history"].includes(mocks.fault)
  let rows = table === "drivers" ? driverRows
    : table === "driver_payroll_periods" && mocks.fault === "fractional-payroll"
      ? [{ id: "period-1", driver_id: "analytics-driver-0", period_year: 2026, period_month: 11,
        total_earnings: 0.45, total_deductions: 0.20, orders_bonus: 0.10, net_payroll: 0.25 }]
    : table === "payroll_engine_runs" && hasEngine ? roundingRuns
    : table === "dashboard_payroll_engine_payable" && hasEngine
      ? roundingRuns.map(row => mocks.fault === "large-history" && row.id === "historical-run"
        ? { ...row, total_drivers: 100_000, result_count: 100_000, payable_total: 10_001_000 }
        : row)
    : table === "payroll_engine_results" && hasEngine ? roundingResults
    : table === "daily_order_entries" && hasEngine
      ? roundingRuns.map(run => ({ id: run.id, entry_date: `${run.month_key}-01`, gross_revenue: 300 }))
      : []
  const chain = {
    select: (columns: string, options?: { head?: boolean; count?: string }) => {
      head = options?.head === true
      mocks.calls.push({ table, method: "select", args: [columns, options] })
      return chain
    },
    is: (...args: unknown[]) => record("is", args),
    eq: (...args: unknown[]) => record("eq", args),
    gte: (...args: unknown[]) => record("gte", args),
    lte: (...args: unknown[]) => record("lte", args),
    in: (column: string, values: string[]) => {
      if (table === "payroll_engine_results" && column === "run_id") rows = roundingResults.filter(row => values.includes(row.run_id))
      return record("in", [column, values])
    },
    order: (...args: unknown[]) => record("order", args),
    limit: (size: number) => { limit = size; return record("limit", [size]) },
    range: async (from: number, to: number) => {
      mocks.calls.push({ table, method: "range", args: [from, to] })
      if (table === "payroll_engine_results" && mocks.fault === "large-history" && rows.some(row => row.id === "historical-run-0")) {
        return { data: [], count: 100_003, error: null }
      }
      if (table === "drivers" && from >= 500 && mocks.fault === "late-driver-error") {
        return { data: null, count: rows.length, error: { message: "private database detail" } }
      }
      if (table === "delivery_platforms" && mocks.fault === "platform-catalog-error") {
        return { data: null, count: null, error: { message: "private database detail" } }
      }
      return {
        data: rows.slice(from, to + 1), error: null,
        count: table === "drivers" && from >= 500 && mocks.fault === "driver-count-change" ? rows.length + 1 : rows.length,
      }
    },
    then: <TResult1 = unknown, TResult2 = never>(
      resolve?: ((value: { data: typeof rows | null; error: null; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
      reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve({
      data: head ? null : rows.slice(0, limit), error: null,
      count: head && mocks.fault === "missing-head-count" ? null : rows.length,
    }).then(resolve, reject),
  }
  function record(method: string, args: unknown[]) {
    mocks.calls.push({ table, method, args })
    return chain
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fault = "none"
  mocks.calls = []
  mocks.from.mockImplementation(query)
  mocks.rpc.mockImplementation(query)
  mocks.rateLimit.mockResolvedValue({ success: true })
  mocks.financial.mockResolvedValue({ available: false })
  mocks.approvals.mockResolvedValue({
    rows: [], kpis: { total: 2401, expenses: 2000, leaves: 300, applications: 101, stale: 12 },
    page: 1, pageSize: 1, totalPages: 2401,
  })
})

const filters = { period: "30d", platform: "all", category: "all" } as const

describe("complete dashboard data", () => {
  it("reconciles approved engine payroll with payable rounding in the summary and trend", async () => {
    mocks.fault = "engine-rounding"
    const snapshot = await getDashboardSnapshot({ ...filters, period: "12m" })
    expect(snapshot.payroll).toMatchObject({ period: "2026-11", gross: 320.03, deductions: 30.01, net: 290.02 })
    expect(snapshot.trends.revenue).toMatchObject([
      { date: "2026-09", payroll: 200.02 }, { date: "2026-11", payroll: 290.02 },
    ])
  })

  it("uses the database total for large approved histories and reads current rider detail only", async () => {
    mocks.fault = "large-history"
    const snapshot = await getDashboardSnapshot({ ...filters, period: "12m" })
    expect(snapshot.payroll).toMatchObject({ available: true, net: 290.02 })
    expect(snapshot.trends.revenue).toMatchObject([{ date: "2026-09", payroll: 10_001_000 }, { date: "2026-11", payroll: 290.02 }])
    expect(mocks.calls.filter(call => call.table === "payroll_engine_results" && call.method === "in").map(call => call.args))
      .toEqual([["run_id", ["latest-run"]]])
  })
  it("preserves approved payroll below one riyal in the summary and driver breakdown", async () => {
    mocks.fault = "fractional-payroll"
    const snapshot = await getDashboardSnapshot(filters)
    expect(snapshot.payroll).toMatchObject({
      period: "2026-11", gross: 0.45, deductions: 0.20, bonuses: 0.10, net: 0.25, avgNet: 0.25,
    })
    expect(snapshot.driverTargets[0].netPayroll).toBe(0.25)
  })
  it("includes drivers beyond the API's 1,000-row cap and retains complete approval totals", async () => {
    const snapshot = await getDashboardSnapshot(filters)
    expect(snapshot.kpis.totalDrivers).toMatchObject({ value: 1251, available: true })
    expect(snapshot.kpis.activeDrivers).toMatchObject({ value: 1251, available: true })
    expect(mocks.calls.filter(x => x.table === "drivers" && x.method === "range").map(x => x.args))
      .toEqual([[0, 499], [500, 999], [1000, 1499]])
    expect(snapshot.approvals).toEqual({ total: 2401, expenses: 2000, leaves: 300, applications: 101, stale: 12, available: true })
    expect(snapshot.kpis.openApprovals).toMatchObject({ value: 2401, available: true })
    expect(mocks.approvals).toHaveBeenCalledWith({}, 1, 1)
  })

  it.each(["late-driver-error", "driver-count-change"])("marks %s as unavailable instead of using the first batch", async fault => {
    mocks.fault = fault
    const snapshot = await getDashboardSnapshot(filters)
    expect(snapshot.availability.drivers).toBe(false)
    expect(snapshot.kpis.totalDrivers).toMatchObject({ value: 0, available: false })
    expect(snapshot.kpis.activeDrivers).toMatchObject({ value: 0, available: false })
    expect(snapshot.availability.vehicles).toBe(true)
    expect(snapshot.kpis.expiringDocuments.available).toBe(false)
    expect(snapshot.kpis.expiredDocuments.available).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain("private database detail")
  })

  it("does not turn a missing platform catalog into a successful zero for a selected platform", async () => {
    mocks.fault = "platform-catalog-error"
    const snapshot = await getDashboardSnapshot({ ...filters, platform: "FAST" })
    expect(snapshot.availability.orders).toBe(false)
    expect(snapshot.kpis.totalOrders.available).toBe(false)
    expect(snapshot.insights.some(insight => ["orders", "completion", "revenue", "best_platform"].includes(insight.key))).toBe(false)
  })

  it("does not claim zero applications or audit events when an exact count is missing", async () => {
    mocks.fault = "missing-head-count"
    const snapshot = await getDashboardSnapshot(filters)
    expect(snapshot.availability.applications).toBe(false)
    expect(snapshot.availability.audit).toBe(false)
    expect(snapshot.kpis.auditEvents.available).toBe(false)
  })
})
