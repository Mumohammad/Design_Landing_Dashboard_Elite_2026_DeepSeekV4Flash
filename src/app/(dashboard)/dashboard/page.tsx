"use client"

import * as React from "react"
import {
  Banknote,
  CalendarClock,
  CarFront,
  CheckCircle2,
  FileClock,
  Gauge,
  PackageCheck,
  ShieldAlert,
  TriangleAlert,
  UsersRound,
  WalletCards,
  Wrench,
} from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { getDashboardSnapshot } from "@/lib/analytics/actions"
import type { DashboardFilters, DashboardSnapshot } from "@/lib/analytics/types"
import { QuickActions } from "./components/quick-actions"
import { FilterBar } from "./components/filter-bar"
import { KpiCard } from "./components/kpi-card"
import { OrdersTrend } from "./components/orders-trend"
import { RevenueTrend } from "./components/revenue-trend"
import { PlatformPerformance } from "./components/platform-performance"
import { DriverTargets } from "./components/driver-targets"
import { ComplianceRadar } from "./components/compliance-radar"
import { ViolationsTrend } from "./components/violations-trend"
import { PayrollSummary } from "./components/payroll-summary"
import { ActionCenter } from "./components/action-center"
import { Insights } from "./components/insights"
import { RecentActivity } from "./components/recent-activity"
import { DriverTable } from "./components/driver-table"
import { ChartSkeleton, KpiSkeleton } from "./components/states"

const DEFAULT_FILTERS: DashboardFilters = { period: "30d", platform: "all", category: "all" }

export default function DashboardPage() {
  const { t, locale } = useTranslation()

  const [filters, setFilters] = React.useState<DashboardFilters>(DEFAULT_FILTERS)
  const [snapshot, setSnapshot] = React.useState<DashboardSnapshot | null>(null)
  const [initialLoading, setInitialLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [loadError, setLoadError] = React.useState(false)
  const requestId = React.useRef(0)

  const load = React.useCallback(async (f: DashboardFilters, isRefresh = false) => {
    const id = ++requestId.current
    if (isRefresh) setRefreshing(true)
    else setInitialLoading(true)
    try {
      const snap = await getDashboardSnapshot(f)
      if (requestId.current === id) {
        setSnapshot(snap)
        setLoadError(false)
      }
    } catch {
      if (requestId.current === id) setLoadError(true)
    } finally {
      if (requestId.current === id) {
        setInitialLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  React.useEffect(() => {
    void load(filters)
  }, [filters, load])

  const today = React.useMemo(
    () =>
      new Date().toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [locale],
  )

  const k = snapshot?.kpis
  const ordersSpark = React.useMemo(
    () => (snapshot?.trends.orders ?? []).map((p) => p.completed ?? 0),
    [snapshot],
  )
  const revenueSpark = React.useMemo(
    () => (snapshot?.trends.revenue ?? []).map((p) => p.revenue ?? 0),
    [snapshot],
  )
  const completionSpark = React.useMemo(
    () =>
      (snapshot?.trends.orders ?? []).map((p) => {
        const done = p.completed ?? 0
        const tot = done + (p.cancelled ?? 0) + (p.failed ?? 0)
        return tot > 0 ? Math.round((done / tot) * 1000) / 10 : 0
      }),
    [snapshot],
  )

  const platformOptions = React.useMemo(
    () => (snapshot?.platforms ?? []).map((p) => ({ code: p.code, name: p.name })),
    [snapshot],
  )

  return (
    <div className="space-y-6 px-4 lg:px-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{t.app.dashboardTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.welcomeMessage} · {today}</p>
        </div>
        <QuickActions />
      </div>

      {/* Global filters */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        onRefresh={() => void load(filters, true)}
        refreshing={refreshing}
        platforms={platformOptions}
        generatedAt={snapshot?.generatedAt ?? null}
      />

      {loadError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">{t.dashboard.unableToLoad}</p>
          <button
            onClick={() => void load(filters)}
            className="mt-2 text-xs font-semibold text-elite-blue-600 underline-offset-2 hover:underline dark:text-elite-blue-300"
          >
            {t.common.retry}
          </button>
        </div>
      ) : initialLoading || !snapshot || !k ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
        </>
      ) : (
        <>
          {/* ── Executive KPI row ── */}
          <section aria-label="Executive KPIs">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KpiCard label={t.dashboard.totalDrivers} metric={k.totalDrivers} icon={UsersRound} color="#1E5A99" href="/drivers" />
              <KpiCard label={t.dashboard.activeDrivers} metric={k.activeDrivers} icon={CheckCircle2} color="#10B981" href="/drivers" />
              <KpiCard label={t.dashboard.totalVehicles} metric={k.totalVehicles} icon={CarFront} color="#2F7BC4" href="/vehicles" />
              <KpiCard label={t.dashboard.inMaintenance} metric={k.inMaintenance} icon={Wrench} color="#F59E0B" href="/maintenance" />
              <KpiCard label={t.dashboard.totalOrders} metric={k.totalOrders} icon={PackageCheck} color="#1E5A99" href="/platforms" spark={ordersSpark} />
              <KpiCard label={t.dashboard.completionRate} metric={k.completionRate} icon={Gauge} color="#10B981" href="/platforms" spark={completionSpark} deltaUnit="pp" />
              <KpiCard label={t.dashboard.revenue} metric={k.revenue} icon={Banknote} color="#2F7BC4" href="/reports" spark={revenueSpark} currency />
              <KpiCard label={t.dashboard.netPayroll} metric={k.netPayroll} icon={WalletCards} color="#E87D3E" href="/payroll" currency />
            </div>
          </section>

          {/* ── Operational KPI row ── */}
          <section aria-label="Operations KPIs">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KpiCard label={t.dashboard.openViolations} metric={k.openViolations} icon={TriangleAlert} color="#EF4444" href="/violations" />
              <KpiCard label={t.dashboard.pendingApplications} metric={k.pendingApplications} icon={FileClock} color="#8B5CF6" href="/applications" />
              <KpiCard label={t.dashboard.expiringDocuments} metric={k.expiringDocuments} icon={CalendarClock} color="#F59E0B" href="/drivers" />
              <KpiCard label={t.dashboard.expiredDocuments} metric={k.expiredDocuments} icon={ShieldAlert} color="#EF4444" href="/drivers" />
            </div>
          </section>

          {/* ── Primary analytics ── */}
          <section aria-label="Trends" className="grid gap-4 xl:grid-cols-2">
            <OrdersTrend data={snapshot.trends.orders} available={snapshot.availability.orders} onRetry={() => void load(filters, true)} />
            <RevenueTrend data={snapshot.trends.revenue} available={snapshot.availability.orders} onRetry={() => void load(filters, true)} />
          </section>

          {/* ── Secondary analytics ── */}
          <section aria-label="Performance" className="grid gap-4 xl:grid-cols-2">
            <PlatformPerformance data={snapshot.platforms} available={snapshot.availability.orders} onRetry={() => void load(filters, true)} />
            <DriverTargets data={snapshot.driverTargets} buckets={snapshot.targetBuckets} available={snapshot.availability.payroll} onRetry={() => void load(filters, true)} />
          </section>

          {/* ── Financial ── */}
          <PayrollSummary payroll={snapshot.payroll} />

          {/* ── Compliance + violations ── */}
          <section aria-label="Compliance" className="grid gap-4 xl:grid-cols-2">
            <ComplianceRadar compliance={snapshot.compliance} available={snapshot.availability.drivers || snapshot.availability.vehicles} onRetry={() => void load(filters, true)} />
            <ViolationsTrend data={snapshot.trends.violations} available={snapshot.availability.violations} onRetry={() => void load(filters, true)} />
          </section>

          {/* ── Action center + insights + activity ── */}
          <section aria-label="Actions and insights" className="grid gap-4 xl:grid-cols-3">
            <ActionCenter actions={snapshot.actions} />
            <Insights insights={snapshot.insights} />
            <RecentActivity activity={snapshot.activity} />
          </section>

          {/* ── Drill-down table ── */}
          <DriverTable data={snapshot.driverTargets} available={snapshot.availability.payroll} onRetry={() => void load(filters, true)} />
        </>
      )}
    </div>
  )
}
