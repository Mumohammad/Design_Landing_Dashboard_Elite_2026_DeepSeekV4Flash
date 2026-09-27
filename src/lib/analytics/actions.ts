"use server"

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard analytics — server-side aggregation layer.
// Reads REAL data from Supabase (RLS-bound server client, tenant-scoped by the
// user's own policies). The dashboard never invents numbers: every KPI is
// computed here from module tables, and the payroll numbers come from the
// payroll module's calculated driver_payroll_periods rows.
//
// Graceful degradation: if a table is missing (migrations pending) the module
// is flagged `available: false` and the UI shows an empty/offline state rather
// than fabricated values.
// ─────────────────────────────────────────────────────────────────────────────

import { endOfDay, format, startOfDay, subDays } from "date-fns"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/auth/authorization"
import { rollupCodSessions } from "@/lib/payroll/payroll-utils"
import { aggregateApprovalsDepth, mergePayrollTrend } from "./dashboard-utils"
import type {
  ActivityEvent,
  ActionItem,
  ComplianceBucket,
  ComplianceSummary,
  DashboardFilters,
  DashboardSnapshot,
  DriverTargetRow,
  Insight,
  MetricValue,
  PlatformMetric,
  TrendPoint,
} from "./types"
import { rateLimitDashboard, RateLimitError } from "@/lib/auth/rate-limit"

const PERIOD_DAYS: Record<DashboardFilters["period"], number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12m": 365,
}

const OPEN_VIOLATION_STATUS = [
  "open",
  "under_review",
  "acknowledged",
  "disputed",
  "escalated",
]
const APPROVED_PAYROLL_STATUS = ["approved", "paid", "locked"]
const OPEN_MAINTENANCE_STATUS = ["open", "in_progress"]

function metric(value: number, previous: number, available = true): MetricValue {
  const delta = value - previous
  const pct =
    previous === 0 ? (value > 0 ? 100 : 0) : Math.round((delta / previous) * 1000) / 10
  return { value, previous, delta, pct, available }
}

/** Days until a date-only string; null when missing/unparseable. */
function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

function expiryBucket(days: number | null): "valid" | "expiring" | "expired" | null {
  if (days === null) return null
  if (days < 0) return "expired"
  if (days <= 30) return "expiring"
  return "valid"
}

/** Trend bucket key: daily for short presets, monthly otherwise. */
function bucketKey(dateStr: string, period: DashboardFilters["period"]): string {
  const day = period === "7d" || period === "30d"
  return day ? dateStr.slice(0, 10) : dateStr.slice(0, 7)
}

interface OrderRow {
  driver_id: string | null
  platform_id: string | null
  entry_date: string
  orders_delivered: number | null
  orders_cancelled: number | null
  orders_failed: number | null
  orders_returned: number | null
  gross_revenue: number | null
}

/**
 * Browser-supplied filters are parsed, never trusted (zod parity with the
 * module actions); .catch() degrades to the safe default instead of throwing.
 */
const dashboardFiltersSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "12m"]).catch("30d"),
  platform: z.string().trim().max(64).catch("all"),
  category: z.string().trim().max(64).catch("all"),
})

export async function getDashboardSnapshot(
  rawFilters: DashboardFilters,
): Promise<DashboardSnapshot> {
  const filters = dashboardFiltersSchema.parse(rawFilters ?? {})
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const rl = await rateLimitDashboard(user.id)
    if (!rl.success) {
      throw new RateLimitError(rl.resetAt, 30)
    }
  }
  const now = new Date()
  const days = PERIOD_DAYS[filters.period]
  const start = startOfDay(subDays(now, days - 1))
  const end = endOfDay(now)
  const prevStart = startOfDay(subDays(start, days))
  const startIso = format(start, "yyyy-MM-dd")
  const prevStartIso = format(prevStart, "yyyy-MM-dd")
  const endIso = format(end, "yyyy-MM-dd")

  const availability: Record<string, boolean> = {
    drivers: false,
    vehicles: false,
    orders: false,
    payroll: false,
    violations: false,
    maintenance: false,
    applications: false,
    approvals: false,
    cod: false,
    audit: false,
  }

  // ── Platforms (needed for filter + breakdown labels) ──────────────────────
  let platformsById = new Map<string, { code: string; name: string }>()
  const { data: platformRows } = await supabase
    .from("delivery_platforms")
    .select("id, code, name_ar, name_en, is_active")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
  if (platformRows) {
    platformsById = new Map(
      platformRows.map((p) => [
        p.id,
        {
          code: p.code ?? p.id,
          name: p.name_ar || p.name_en || p.code || "Platform",
        },
      ]),
    )
  }
  const platformIdByCode = new Map<string, string>()
  platformRows?.forEach((p) => {
    if (p.code) platformIdByCode.set(p.code, p.id)
  })

  // ── Drivers ────────────────────────────────────────────────────────────────
  let drivers: {
    id: string
    status: string | null
    category: string | null
    full_name_ar: string | null
    full_name_en: string | null
    hire_date: string | null
    created_at: string | null
    iqama_expiry_date: string | null
    license_expiry_date: string | null
  }[] = []
  try {
    const q = supabase
      .from("drivers")
      .select(
        "id, status, category, full_name_ar, full_name_en, hire_date, created_at, iqama_expiry_date, license_expiry_date",
      )
      .is("deleted_at", null)
    if (filters.category !== "all") q.eq("category", filters.category)
    const { data, error } = await q
    if (!error && data) {
      drivers = data as typeof drivers
      availability.drivers = true
    }
  } catch {
    /* table missing */
  }

  const totalDrivers = drivers.length
  const activeDrivers = drivers.filter((d) => d.status === "active").length

  const driverNames = new Map<string, string>()
  drivers.forEach((d) =>
    driverNames.set(d.id, d.full_name_ar || d.full_name_en || d.id.slice(0, 8)),
  )

  // ── Vehicles (incl. compliance expiries) ──────────────────────────────────
  let vehicles: {
    id: string
    status: string | null
    insurance_expiry: string | null
    registration_expiry: string | null
  }[] = []
  try {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id, status, insurance_expiry, registration_expiry")
      .is("deleted_at", null)
    if (!error && data) {
      vehicles = data as typeof vehicles
      availability.vehicles = true
    }
  } catch {
    /* table missing */
  }

  const totalVehicles = vehicles.length
  const inMaintenance = vehicles.filter((v) => v.status === "in_maintenance").length
  // Fleet availability split (#53 assignment wiring: available ↔ assigned).
  const availableVehicles = vehicles.filter((v) => v.status === "available").length
  const assignedVehicles = vehicles.filter((v) => v.status === "assigned").length

  const compliance: ComplianceSummary = {
    iqama: bucketCounts(drivers.map((d) => d.iqama_expiry_date)),
    license: bucketCounts(drivers.map((d) => d.license_expiry_date)),
    insurance: bucketCounts(vehicles.map((v) => v.insurance_expiry)),
    registration: bucketCounts(vehicles.map((v) => v.registration_expiry)),
  }
  const expiringDocs =
    compliance.iqama.expiring +
    compliance.license.expiring +
    compliance.insurance.expiring +
    compliance.registration.expiring
  const expiredDocs =
    compliance.iqama.expired +
    compliance.license.expired +
    compliance.insurance.expired +
    compliance.registration.expired

  // ── Orders (daily_order_entries) + platform breakdown + trends ────────────
  let orderRows: OrderRow[] = []
  try {
    const q = supabase
      .from("daily_order_entries")
      .select(
        "driver_id, platform_id, entry_date, orders_delivered, orders_cancelled, orders_failed, orders_returned, gross_revenue",
      )
      .gte("entry_date", prevStartIso)
      .lte("entry_date", endIso)
    if (filters.platform !== "all") {
      const pid = platformIdByCode.get(filters.platform)
      if (pid) q.eq("platform_id", pid)
      else q.eq("platform_id", "00000000-0000-0000-0000-000000000000") // no-op: no data
    }
    const { data, error } = await q
    if (!error && data) {
      orderRows = data as OrderRow[]
      availability.orders = true
    }
  } catch {
    /* table missing */
  }

  const orderAgg = aggregateOrders(orderRows, startIso)
  const platformAgg = new Map<string, { orders: number; revenue: number; drivers: Set<string>; completed: number; failed: number; cancelled: number; returned: number }>()
  const ordersTrendMap = new Map<string, TrendPoint>()
  const revenueTrendMap = new Map<string, TrendPoint>()
  for (const row of orderRows) {
    const delivered = row.orders_delivered ?? 0
    const cancelled = row.orders_cancelled ?? 0
    const failed = row.orders_failed ?? 0
    const returned = row.orders_returned ?? 0
    const revenue = Number(row.gross_revenue ?? 0)
    const current = (row.entry_date ?? "").slice(0, 10) >= startIso
    if (current) {
      const key = bucketKey(row.entry_date, filters.period)
      let p = ordersTrendMap.get(key)
      if (!p) {
        p = { date: key }
        ordersTrendMap.set(key, p)
      }
      p.orders = (p.orders ?? 0) + delivered
      p.completed = (p.completed ?? 0) + delivered
      p.cancelled = (p.cancelled ?? 0) + cancelled
      p.failed = (p.failed ?? 0) + failed
      p.revenue = (p.revenue ?? 0) + revenue

      const pk = bucketKey(row.entry_date, filters.period)
      let rp = revenueTrendMap.get(pk)
      if (!rp) {
        rp = { date: pk, revenue: 0 }
        revenueTrendMap.set(pk, rp)
      }
      rp.revenue = (rp.revenue ?? 0) + revenue
    }
    if (current && row.platform_id) {
      let agg = platformAgg.get(row.platform_id)
      if (!agg) {
        agg = { orders: 0, revenue: 0, drivers: new Set(), completed: 0, failed: 0, cancelled: 0, returned: 0 }
        platformAgg.set(row.platform_id, agg)
      }
      agg.orders += delivered
      agg.revenue += revenue
      agg.completed += delivered
      agg.failed += failed
      agg.cancelled += cancelled
      agg.returned += returned
      if (row.driver_id) agg.drivers.add(row.driver_id)
    }
  }

  const platforms: PlatformMetric[] = [...platformAgg.entries()]
    .map(([id, a]) => {
      const meta = platformsById.get(id)
      const totalAttempted = a.completed + a.failed + a.cancelled + a.returned
      return {
        code: meta?.code ?? id,
        name: meta?.name ?? "Platform",
        orders: a.orders,
        revenue: Math.round(a.revenue),
        drivers: a.drivers.size,
        completionRate: totalAttempted > 0 ? Math.round((a.completed / totalAttempted) * 1000) / 10 : 0,
      }
    })
    .sort((x, y) => y.orders - x.orders)

  // ── Payroll (module-owned calculated results) ─────────────────────────────
  let payrollRows: {
    driver_id: string
    period_year: number
    period_month: number
    orders_achieved: number | null
    target_orders_monthly: number | null
    orders_prorated_target: number | null
    orders_bonus: number | null
    total_earnings: number | null
    total_deductions: number | null
    net_payroll: number | null
  }[] = []
  let latestPeriod: { year: number; month: number } | null = null
  try {
    const { data, error } = await supabase
      .from("driver_payroll_periods")
      .select(
        "driver_id, period_year, period_month, orders_achieved, target_orders_monthly, orders_prorated_target, orders_bonus, total_earnings, total_deductions, net_payroll",
      )
      .in("status", APPROVED_PAYROLL_STATUS)
      .is("deleted_at", null)
    if (!error && data) {
      payrollRows = data as typeof payrollRows
      availability.payroll = true
      for (const r of payrollRows) {
        if (
          !latestPeriod ||
          r.period_year > latestPeriod.year ||
          (r.period_year === latestPeriod.year && r.period_month > latestPeriod.month)
        ) {
          latestPeriod = { year: r.period_year, month: r.period_month }
        }
      }
    }
  } catch {
    /* table missing */
  }

  const prevPeriod =
    latestPeriod && latestPeriod.month === 1
      ? { year: latestPeriod.year - 1, month: 12 }
      : latestPeriod
        ? { year: latestPeriod.year, month: latestPeriod.month - 1 }
        : null

  const latestRows = payrollRows.filter(
    (r) =>
      latestPeriod &&
      r.period_year === latestPeriod.year &&
      r.period_month === latestPeriod.month,
  )
  const prevRows = payrollRows.filter(
    (r) =>
      prevPeriod &&
      r.period_year === prevPeriod.year &&
      r.period_month === prevPeriod.month,
  )

  const payrollNet = sum(latestRows.map((r) => Number(r.net_payroll ?? 0)))
  const payrollNetPrev = sum(prevRows.map((r) => Number(r.net_payroll ?? 0)))
  const payrollGross = sum(latestRows.map((r) => Number(r.total_earnings ?? 0)))
  const payrollBonus = sum(latestRows.map((r) => Number(r.orders_bonus ?? 0)))
  const payrollDeductions = sum(latestRows.map((r) => Number(r.total_deductions ?? 0)))

  // Payroll period series (approved periods, monthly) merged by period key —
  // payroll months without orders data appear; orders months without payroll
  // keep payroll undefined. Neither side is zero-filled.
  const payrollTrend = mergePayrollTrend(
    [],
    payrollRows.map((r) => ({
      period_year: r.period_year,
      period_month: r.period_month,
      net_payroll: r.net_payroll,
    })),
  )
  const aboveTarget = latestRows.filter(
    (r) => (r.orders_achieved ?? 0) - (r.orders_prorated_target ?? r.target_orders_monthly ?? 0) > 0,
  ).length
  const belowTarget = latestRows.filter(
    (r) => (r.orders_achieved ?? 0) - (r.orders_prorated_target ?? r.target_orders_monthly ?? 0) < 0,
  ).length
  const negativeBalance = latestRows.filter((r) => Number(r.net_payroll ?? 0) < 0).length

  const driverTargets: DriverTargetRow[] = latestRows
    .map((r): DriverTargetRow => {
      const target = r.orders_prorated_target ?? r.target_orders_monthly ?? 0
      const actual = r.orders_achieved ?? 0
      const achievement = target > 0 ? Math.round((actual / target) * 1000) / 10 : 0
      const status: DriverTargetRow["status"] =
        achievement >= 100 ? "exceeded" : achievement >= 90 ? "on_track" : "below"
      return {
        driverId: r.driver_id,
        name: driverNames.get(r.driver_id) ?? "Driver",
        target,
        actual,
        achievement,
        netPayroll: Math.round(Number(r.net_payroll ?? 0)),
        status,
      }
    })
    .sort((a, b) => b.achievement - a.achievement)
    .slice(0, 8)

  const targetBuckets = [
    { bucket: "<70%", count: 0 },
    { bucket: "70–89%", count: 0 },
    { bucket: "90–99%", count: 0 },
    { bucket: "100%", count: 0 },
    { bucket: ">100%", count: 0 },
  ]
  latestRows.forEach((r) => {
    const target = r.orders_prorated_target ?? r.target_orders_monthly ?? 0
    const actual = r.orders_achieved ?? 0
    const ach = target > 0 ? (actual / target) * 100 : 0
    if (ach < 70) targetBuckets[0].count++
    else if (ach < 90) targetBuckets[1].count++
    else if (ach < 100) targetBuckets[2].count++
    else if (ach === 100) targetBuckets[3].count++
    else targetBuckets[4].count++
  })

  // ── Violations ────────────────────────────────────────────────────────────
  let violations: { id: string; status: string | null; deduction_amount: number | null; incident_date: string | null }[] = []
  try {
    const { data, error } = await supabase
      .from("violations")
      .select("id, status, deduction_amount, incident_date")
      .gte("incident_date", prevStartIso)
      .lte("incident_date", endIso)
      .is("deleted_at", null)
    if (!error && data) {
      violations = data as typeof violations
      availability.violations = true
    }
  } catch {
    /* table missing */
  }

  const violationsCurrent = violations.filter((v) => (v.incident_date ?? "").slice(0, 10) >= startIso)
  const openViolations = violationsCurrent.filter((v) =>
    OPEN_VIOLATION_STATUS.includes(v.status ?? ""),
  ).length

  const violationsTrendMap = new Map<string, TrendPoint>()
  violationsCurrent.forEach((v) => {
    const key = bucketKey(v.incident_date ?? "", filters.period)
    let p = violationsTrendMap.get(key)
    if (!p) {
      p = { date: key, violations: 0, penalties: 0 }
      violationsTrendMap.set(key, p)
    }
    p.violations = (p.violations ?? 0) + 1
    p.penalties = (p.penalties ?? 0) + Number(v.deduction_amount ?? 0)
  })

  // ── Maintenance ───────────────────────────────────────────────────────────
  let maintenance: { id: string; status: string | null; cost: number | null; reported_at: string | null }[] = []
  try {
    const { data, error } = await supabase
      .from("vehicle_maintenance_events")
      .select("id, status, cost, reported_at")
      .gte("reported_at", `${prevStartIso}T00:00:00`)
      .lte("reported_at", `${endIso}T23:59:59`)
      .is("deleted_at", null)
    if (!error && data) {
      maintenance = data as typeof maintenance
      availability.maintenance = true
    }
  } catch {
    /* table missing */
  }

  const startMs = start.getTime()
  const maintenanceCurrent = maintenance.filter((m) => new Date(m.reported_at ?? 0).getTime() >= startMs)
  const maintenancePrev = maintenance.filter((m) => new Date(m.reported_at ?? 0).getTime() < startMs)
  const maintenanceCost = sum(maintenanceCurrent.map((m) => Number(m.cost ?? 0)))
  const maintenanceCostPrev = sum(maintenancePrev.map((m) => Number(m.cost ?? 0)))
  const openMaintenance = maintenance.filter((m) =>
    OPEN_MAINTENANCE_STATUS.includes(m.status ?? ""),
  ).length

  // ── Driver applications ───────────────────────────────────────────────────
  let pendingApplications = 0
  try {
    const { count, error } = await supabase
      .from("driver_applications")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "under_review"])
    if (!error) {
      pendingApplications = count ?? 0
      availability.applications = true
    }
  } catch {
    /* table missing */
  }

  // ── COD reconciliation (driver_cod_sessions, 015) ───────────────────────
  // Rollup shape reused from the payroll module (#53) — pending sessions and
  // their variance are the reconciliation backlog the finance lead acts on.
  type CodRow = {
    cod_collected: number | null
    cod_submitted: number | null
    cod_variance: number | null
    status: string
  }
  let cod: DashboardSnapshot["cod"] = {
    pendingSessions: 0,
    pendingVariance: 0,
    collected: 0,
    submitted: 0,
    available: false,
  }
  try {
    const { data, error } = await supabase
      .from("driver_cod_sessions")
      .select("cod_collected, cod_submitted, cod_variance, status")
      .is("deleted_at", null)
    if (!error && data) {
      const rollup = rollupCodSessions(data as CodRow[])
      cod = {
        pendingSessions: rollup.pending,
        pendingVariance: Math.round(rollup.variance * 100) / 100,
        collected: Math.round(rollup.collected),
        submitted: Math.round(rollup.submitted),
        available: true,
      }
      availability.cod = true
    }
  } catch {
    /* table missing */
  }

  // ── Cross-module ops: approvals depth (#52 RPC) + audit volume (#51) ──────
  // Both read through the admin client, scoped by the SERVER-side tenant id
  // (never the browser). Depth/counts only — no PII-bearing column of the
  // queue or the audit payload projects into the snapshot (PDPL minimal
  // projection; the aggregates are counts).
  let auditEvents = 0
  let approvals: DashboardSnapshot["approvals"] = {
    total: 0,
    expenses: 0,
    leaves: 0,
    applications: 0,
    stale: 0,
    available: false,
  }
  const currentUser = await getCurrentUser()
  if (currentUser) {
    const admin = createAdminClient()
    try {
      const { data, error } = await admin.rpc("fetch_pending_approvals", {
        p_tenant_id: currentUser.tenantId,
        p_type: null,
        p_from: null,
        p_to: null,
        p_limit: 200,
      })
      if (!error && data) {
        approvals = {
          ...aggregateApprovalsDepth(
            (data as { item_type: string; requested_at: string }[]).map((r) => ({
              item_type: r.item_type,
              requested_at: r.requested_at,
            })),
          ),
          available: true,
        }
        availability.approvals = true
      }
    } catch {
      /* RPC missing */
    }
    try {
      const { count, error } = await admin
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", currentUser.tenantId)
        .gte("created_at", start.toISOString())
      if (!error) {
        auditEvents = count ?? 0
        availability.audit = true
      }
    } catch {
      /* table missing */
    }
  }

  // ── Recent activity (across modules) ──────────────────────────────────────
  const activity: ActivityEvent[] = []
  try {
    const { data } = await supabase
      .from("driver_applications")
      .select("id, application_number, created_at")
      .order("created_at", { ascending: false })
      .limit(3)
    data?.forEach((a) =>
      activity.push({
        id: `app-${a.id}`,
        type: "application",
        ref: a.application_number ?? "—",
        time: a.created_at ?? "",
      }),
    )
  } catch {
    /* table missing */
  }
  try {
    const { data } = await supabase
      .from("violations")
      .select("id, violation_ref, reported_at, driver_id")
      .is("deleted_at", null)
      .order("reported_at", { ascending: false })
      .limit(2)
    data?.forEach((v) =>
      activity.push({
        id: `vio-${v.id}`,
        type: "violation",
        ref: v.violation_ref ?? "—",
        time: v.reported_at ?? "",
      }),
    )
  } catch {
    /* table missing */
  }
  try {
    const { data } = await supabase
      .from("vehicle_maintenance_events")
      .select("id, reported_at")
      .is("deleted_at", null)
      .order("reported_at", { ascending: false })
      .limit(2)
    data?.forEach((m) =>
      activity.push({
        id: `mnt-${m.id}`,
        type: "maintenance",
        ref: "",
        time: m.reported_at ?? "",
      }),
    )
  } catch {
    /* table missing */
  }
  try {
    const { data } = await supabase
      .from("drivers")
      .select("id, full_name_ar, full_name_en, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(2)
    data?.forEach((d) =>
      activity.push({
        id: `drv-${d.id}`,
        type: "driver",
        ref: d.full_name_ar || d.full_name_en || "—",
        time: d.created_at ?? "",
      }),
    )
  } catch {
    /* table missing */
  }
  activity.sort((a, b) => (a.time < b.time ? 1 : -1))

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalOrders = orderAgg.current.orders
  const totalOrdersPrev = orderAgg.previous.orders
  const completionRate =
    orderAgg.current.attempted > 0
      ? Math.round((orderAgg.current.completed / orderAgg.current.attempted) * 1000) / 10
      : 0
  const completionRatePrev =
    orderAgg.previous.attempted > 0
      ? Math.round((orderAgg.previous.completed / orderAgg.previous.attempted) * 1000) / 10
      : 0
  const revenue = Math.round(orderAgg.current.revenue)
  const revenuePrev = Math.round(orderAgg.previous.revenue)

  // Non-time-series metrics keep previous = value (no fabricated history): the
  // UI then shows no delta chip for them.
  const kpis: DashboardSnapshot["kpis"] = {
    totalDrivers: metric(totalDrivers, totalDrivers, availability.drivers),
    activeDrivers: metric(activeDrivers, activeDrivers, availability.drivers),
    totalVehicles: metric(totalVehicles, totalVehicles, availability.vehicles),
    inMaintenance: metric(inMaintenance, inMaintenance, availability.vehicles),
    totalOrders: metric(totalOrders, totalOrdersPrev, availability.orders),
    completionRate: metric(completionRate, completionRatePrev, availability.orders),
    revenue: metric(revenue, revenuePrev, availability.orders),
    netPayroll: metric(payrollNet, payrollNetPrev, availability.payroll),
    openViolations: metric(openViolations, openViolations, availability.violations),
    pendingApplications: metric(pendingApplications, pendingApplications, availability.applications),
    expiringDocuments: metric(expiringDocs, expiringDocs, availability.drivers || availability.vehicles),
    expiredDocuments: metric(expiredDocs, expiredDocs, availability.drivers || availability.vehicles),
    availableVehicles: metric(availableVehicles, availableVehicles, availability.vehicles),
    assignedVehicles: metric(assignedVehicles, assignedVehicles, availability.vehicles),
    openApprovals: metric(approvals.total, approvals.total, availability.approvals),
    auditEvents: metric(auditEvents, auditEvents, availability.audit),
    codPendingSessions: metric(cod.pendingSessions, cod.pendingSessions, availability.cod),
  }

  const payroll = {
    period: latestPeriod ? `${latestPeriod.year}-${String(latestPeriod.month).padStart(2, "0")}` : "—",
    gross: Math.round(payrollGross),
    bonuses: Math.round(payrollBonus),
    deductions: Math.round(payrollDeductions),
    net: Math.round(payrollNet),
    avgNet: latestRows.length > 0 ? Math.round(payrollNet / latestRows.length) : 0,
    aboveTarget,
    belowTarget,
    negativeBalance,
    available: availability.payroll,
  }

  // ── Actions + insights (derived from real numbers only) ───────────────────
  const actions: ActionItem[] = []
  if (expiredDocs > 0)
    actions.push({ id: "expired-docs", module: "documents", severity: "critical", count: expiredDocs, href: "/drivers" })
  if (expiringDocs > 0)
    actions.push({ id: "expiring-docs", module: "documents", severity: "warning", count: expiringDocs, href: "/drivers" })
  if (openViolations > 0)
    actions.push({ id: "open-violations", module: "violations", severity: "warning", count: openViolations, href: "/violations" })
  if (pendingApplications > 0)
    actions.push({ id: "pending-apps", module: "applications", severity: "info", count: pendingApplications, href: "/applications" })
  if (approvals.available && approvals.total > 0)
    actions.push({
      id: "open-approvals",
      module: "applications",
      severity: approvals.stale > 0 ? "warning" : "info",
      count: approvals.total,
      href: "/approvals",
    })
  if (inMaintenance > 0 || openMaintenance > 0)
    actions.push({ id: "open-maintenance", module: "maintenance", severity: "info", count: inMaintenance + openMaintenance, href: "/maintenance" })
  if (belowTarget > 0)
    actions.push({ id: "below-target", module: "payroll", severity: "warning", count: belowTarget, href: "/payroll" })

  const insights: Insight[] = []
  insights.push({
    id: "orders",
    kind: kpis.totalOrders.pct >= 0 ? "positive" : "negative",
    key: "orders",
    value: Math.abs(kpis.totalOrders.pct),
  })
  const completionDelta = Math.round((completionRate - completionRatePrev) * 10) / 10
  insights.push({
    id: "completion",
    kind: completionDelta >= 0 ? "positive" : "negative",
    key: "completion",
    value: Math.abs(completionDelta),
  })
  insights.push({
    id: "revenue",
    kind: kpis.revenue.pct >= 0 ? "positive" : "negative",
    key: "revenue",
    value: Math.abs(kpis.revenue.pct),
  })
  const maintDelta = maintenanceCostPrev > 0
    ? Math.round(((maintenanceCost - maintenanceCostPrev) / maintenanceCostPrev) * 1000) / 10
    : 0
  if (maintDelta !== 0)
    insights.push({
      id: "maintenance",
      kind: maintDelta > 0 ? "negative" : "positive",
      key: "maintenance",
      value: Math.abs(maintDelta),
    })
  const bestPlatform = [...platforms].sort((a, b) => b.completionRate - a.completionRate)[0]
  if (bestPlatform && bestPlatform.orders > 0)
    insights.push({
      id: "best-platform",
      kind: "positive",
      key: "best_platform",
      value: bestPlatform.completionRate,
      secondary: bestPlatform.name,
    })
  if (belowTarget > 0)
    insights.push({ id: "below-target", kind: "negative", key: "below_target", value: belowTarget })

  const trends: DashboardSnapshot["trends"] = {
    orders: [...ordersTrendMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    revenue: [...revenueTrendMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((p) => ({
      ...p,
      payroll: payrollTrend.find((pp) => pp.date === p.date)?.payroll,
    })),
    violations: [...violationsTrendMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
  }

  return {
    generatedAt: now.toISOString(),
    periodStart: startIso,
    periodEnd: endIso,
    availability,
    kpis,
    payroll,
    approvals,
    cod,
    trends,
    platforms,
    driverTargets,
    targetBuckets,
    compliance,
    actions,
    insights,
    activity: activity.slice(0, 8),
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function bucketCounts(dates: (string | null | undefined)[]): ComplianceBucket {
  const bucket: ComplianceBucket = { valid: 0, expiring: 0, expired: 0 }
  for (const d of dates) {
    const b = expiryBucket(daysUntil(d))
    if (b) bucket[b]++
  }
  return bucket
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0)
}

function aggregateOrders(
  rows: OrderRow[],
  startIso: string,
): {
  current: { orders: number; completed: number; failed: number; cancelled: number; returned: number; attempted: number; revenue: number }
  previous: { orders: number; completed: number; failed: number; cancelled: number; returned: number; attempted: number; revenue: number }
} {
  const zero = { orders: 0, completed: 0, failed: 0, cancelled: 0, returned: 0, attempted: 0, revenue: 0 }
  const current = { ...zero }
  const previous = { ...zero }
  for (const row of rows) {
    const delivered = row.orders_delivered ?? 0
    const cancelled = row.orders_cancelled ?? 0
    const failed = row.orders_failed ?? 0
    const returned = row.orders_returned ?? 0
    const revenue = Number(row.gross_revenue ?? 0)
    const t = (row.entry_date ?? "").slice(0, 10) >= startIso ? current : previous
    t.orders += delivered
    t.completed += delivered
    t.cancelled += cancelled
    t.failed += failed
    t.returned += returned
    t.attempted += delivered + cancelled + failed + returned
    t.revenue += revenue
  }
  return { current, previous }
}
