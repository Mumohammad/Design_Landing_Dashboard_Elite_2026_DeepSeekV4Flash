/**
 * Load test profiling endpoint — exercises critical query paths with timing.
 *
 * GET /api/load-test?scenario=dashboard|payroll|accounting|all
 *
 * Security model (FAIL CLOSED):
 *   - Production: LOAD_TEST_SECRET must be configured — otherwise this route
 *     answers 503. Requests must send `Authorization: Bearer <secret>` and the
 *     comparison is timing-safe.
 *   - Non-production (local/staging): open for profiling.
 *
 * Responses never include raw database error messages (metadata leak).
 * Reads only — no mutations.
 */

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { moduleLogger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const log = moduleLogger("api/load-test")

/**
 * Timing-safe string comparison to prevent timing attacks.
 * (Same helper as src/app/api/webhooks/cron/route.ts — extract to a shared
 * util in a follow-up.)
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// ── Latency budgets (ms) — queries exceeding these are flagged ───────────────
const BUDGETS = {
  dashboard_drivers: 200,
  dashboard_vehicles: 150,
  dashboard_orders: 300,
  dashboard_payroll: 250,
  dashboard_violations: 150,
  dashboard_maintenance: 150,
  dashboard_applications: 100,
  dashboard_platforms: 100,
  payroll_drivers: 150,
  payroll_periods: 200,
  payroll_wps: 300,
  accounting_coa: 200,
  accounting_journal: 250,
  accounting_invoices: 250,
  accounting_parties: 200,
  accounting_vat: 200,
} as const

interface QueryTiming {
  name: string
  durationMs: number
  rows: number
  budget: number
  withinBudget: boolean
  error?: string
}

interface ScenarioResult {
  scenario: string
  timestamp: string
  queries: QueryTiming[]
  summary: {
    totalMs: number
    queryCount: number
    avgMs: number
    p50Ms: number
    p95Ms: number
    allWithinBudget: boolean
  }
}

async function timeQuery(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: () => PromiseLike<any>,
): Promise<QueryTiming> {
  const start = performance.now()
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await fn()
    const durationMs = Math.round(performance.now() - start)

    if (result.error) {
      const errObj = result.error as { message?: string; code?: string }
      // Table not found is expected during first setup
      if (errObj?.code === "42P01" || errObj?.message?.includes("does not exist")) {
        return {
          name,
          durationMs,
          rows: 0,
          budget: BUDGETS[name as keyof typeof BUDGETS] ?? 500,
          withinBudget: true,
          error: "table_missing",
        }
      }
      // Never leak raw database errors to the client — log server-side only.
      log.warn({ query: name, dbError: errObj?.message, code: errObj?.code }, "Load test query failed")
      return {
        name,
        durationMs,
        rows: 0,
        budget: BUDGETS[name as keyof typeof BUDGETS] ?? 500,
        withinBudget: false,
        error: "query_failed",
      }
    }

    const rows = result.count ?? result.data?.length ?? 0
    const budget = BUDGETS[name as keyof typeof BUDGETS] ?? 500
    return { name, durationMs, rows, budget, withinBudget: durationMs <= budget }
  } catch (e) {
    const durationMs = Math.round(performance.now() - start)
    log.error({ query: name, err: e }, "Load test query threw")
    return {
      name,
      durationMs,
      rows: 0,
      budget: BUDGETS[name as keyof typeof BUDGETS] ?? 500,
      withinBudget: false,
      error: "exception",
    }
  }
}

function computeSummary(queries: QueryTiming[]): ScenarioResult["summary"] {
  const durations = queries.map((q) => q.durationMs).sort((a, b) => a - b)
  const totalMs = durations.reduce((s, d) => s + d, 0)
  const avgMs = durations.length > 0 ? Math.round(totalMs / durations.length) : 0
  const p50Ms = durations[Math.floor(durations.length * 0.5)] ?? 0
  const p95Ms = durations[Math.floor(durations.length * 0.95)] ?? 0
  const allWithinBudget = queries.every((q) => q.withinBudget)

  return { totalMs, queryCount: queries.length, avgMs, p50Ms, p95Ms, allWithinBudget }
}

// ── Scenario: Dashboard ──────────────────────────────────────────────────────
async function scenarioDashboard(): Promise<QueryTiming[]> {
  const admin = createAdminClient()
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
  const startIso = thirtyDaysAgo.toISOString().slice(0, 10)
  const endIso = now.toISOString().slice(0, 10)

  const queries = await Promise.all([
    timeQuery("dashboard_platforms", () =>
      admin.from("delivery_platforms").select("id, code, name_ar, name_en, is_active").is("deleted_at", null).order("sort_order"),
    ),
    timeQuery("dashboard_drivers", () =>
      admin.from("drivers").select("id, status, category, full_name_ar, full_name_en, hire_date, created_at, iqama_expiry_date, license_expiry_date").is("deleted_at", null),
    ),
    timeQuery("dashboard_vehicles", () =>
      admin.from("vehicles").select("id, status, insurance_expiry, registration_expiry").is("deleted_at", null),
    ),
    timeQuery("dashboard_orders", () =>
      admin.from("daily_order_entries").select("driver_id, platform_id, entry_date, orders_delivered, orders_cancelled, orders_failed, orders_returned, gross_revenue").gte("entry_date", startIso).lte("entry_date", endIso),
    ),
    timeQuery("dashboard_payroll", () =>
      admin.from("driver_payroll_periods").select("driver_id, period_year, period_month, orders_achieved, target_orders_monthly, orders_prorated_target, orders_bonus, total_earnings, total_deductions, net_payroll").is("deleted_at", null),
    ),
    timeQuery("dashboard_violations", () =>
      admin.from("violations").select("id, status, deduction_amount, incident_date").gte("incident_date", startIso).lte("incident_date", endIso).is("deleted_at", null),
    ),
    timeQuery("dashboard_maintenance", () =>
      admin.from("vehicle_maintenance_events").select("id, status, cost, reported_at").is("deleted_at", null),
    ),
    timeQuery("dashboard_applications", () =>
      admin.from("driver_applications").select("id", { count: "exact", head: true }).in("status", ["submitted", "under_review"]),
    ),
  ])

  return queries
}

// ── Scenario: Payroll ────────────────────────────────────────────────────────
async function scenarioPayroll(): Promise<QueryTiming[]> {
  const admin = createAdminClient()

  const queries = await Promise.all([
    timeQuery("payroll_drivers", () =>
      admin.from("drivers").select("id, full_name_ar, full_name_en, status, iqama_number, iban, housing_allowance").is("deleted_at", null).in("status", ["active", "on_leave"]),
    ),
    timeQuery("payroll_periods", () =>
      admin.from("driver_payroll_periods").select("id, driver_id, period_year, period_month, status, base_amount, orders_bonus, total_earnings, total_deductions, net_payroll, working_days_actual").is("deleted_at", null).order("period_year", { ascending: false }).order("period_month", { ascending: false }).limit(100),
    ),
    timeQuery("payroll_wps", () =>
      admin.from("driver_payroll_periods").select("period_year, period_month, status, net_payroll, base_amount, total_deductions, working_days_actual, paid_at, driver:drivers(iqama_number, full_name_ar, iban, housing_allowance)").in("status", ["approved", "paid"]).is("deleted_at", null),
    ),
  ])

  return queries
}

// ── Scenario: Accounting ─────────────────────────────────────────────────────
async function scenarioAccounting(): Promise<QueryTiming[]> {
  const admin = createAdminClient()

  const queries = await Promise.all([
    timeQuery("accounting_coa", () =>
      admin.from("chart_of_accounts").select("id, code, name_ar, name_en, account_type, parent_id, is_active, is_system").is("deleted_at", null).order("code"),
    ),
    timeQuery("accounting_journal", () =>
      admin.from("journal_entries").select("id, entry_number, entry_date, reference, description, status, total_debit, total_credit, period_id").is("deleted_at", null).order("entry_date", { ascending: false }).limit(100),
    ),
    timeQuery("accounting_invoices", () =>
      admin.from("invoices").select("id, invoice_number, invoice_date, due_date, status, total_amount, currency, party_type, party_id").is("deleted_at", null).order("invoice_date", { ascending: false }).limit(100),
    ),
    timeQuery("accounting_parties", async () => {
      const [c, s] = await Promise.all([
        admin.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
        admin.from("suppliers").select("id", { count: "exact", head: true }).is("deleted_at", null),
      ])
      return { count: (c.count ?? 0) + (s.count ?? 0), data: [] as unknown[], error: c.error ?? s.error }
    }),
    timeQuery("accounting_vat", async () => {
      const { data, error, count } = await admin.from("vat_returns").select("id, period_year, period_month, status, total_sales, total_purchases, vat_output, vat_input, net_vat").is("deleted_at", null).order("period_year", { ascending: false }).order("period_month", { ascending: false }).limit(24)
      return { count: count ?? data?.length ?? 0, data: data ?? [], error }
    }),
  ])

  return queries
}

// ── Handler ──────────────────────────────────────────────────────────────────
export async function GET(req: Request): Promise<NextResponse> {
  // FAIL CLOSED in production: no secret configured → 503, never skip the gate.
  const secret = process.env.LOAD_TEST_SECRET
  if (process.env.NODE_ENV === "production") {
    if (!secret) {
      log.error("LOAD_TEST_SECRET is not configured — refusing to serve in production")
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
    }
    const auth = req.headers.get("authorization")
    if (!auth || !safeCompare(auth, `Bearer ${secret}`)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const url = new URL(req.url)
  const scenario = url.searchParams.get("scenario") ?? "all"

  log.info({ scenario }, "Load test profiling started")

  const results: ScenarioResult[] = []
  const startAll = performance.now()

  try {
    if (scenario === "all" || scenario === "dashboard") {
      const queries = await scenarioDashboard()
      results.push({
        scenario: "dashboard",
        timestamp: new Date().toISOString(),
        queries,
        summary: computeSummary(queries),
      })
    }

    if (scenario === "all" || scenario === "payroll") {
      const queries = await scenarioPayroll()
      results.push({
        scenario: "payroll",
        timestamp: new Date().toISOString(),
        queries,
        summary: computeSummary(queries),
      })
    }

    if (scenario === "all" || scenario === "accounting") {
      const queries = await scenarioAccounting()
      results.push({
        scenario: "accounting",
        timestamp: new Date().toISOString(),
        queries,
        summary: computeSummary(queries),
      })
    }

    const totalMs = Math.round(performance.now() - startAll)

    log.info({ totalMs, scenarios: results.length }, "Load test profiling complete")

    return NextResponse.json({
      totalMs,
      scenarios: results,
      budget: BUDGETS,
    })
  } catch (e) {
    log.error({ err: e }, "Load test profiling failed")
    return NextResponse.json({ error: "Load test failed" }, { status: 500 })
  }
}
