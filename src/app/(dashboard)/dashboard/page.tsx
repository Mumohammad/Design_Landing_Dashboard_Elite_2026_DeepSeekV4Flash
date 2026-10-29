"use client"

import { useUiText } from "@/components/localized-text"
import * as React from "react"
import {
  Banknote,
  CalendarClock,
  CarFront,
  CheckCircle2,
  FileClock,
  FileText,
  Gauge,
  Landmark,
  LayoutDashboard,
  PackageCheck,
  Receipt,
  Scale,
  ShieldAlert,
  TriangleAlert,
  UsersRound,
  WalletCards,
  Wrench,
} from "lucide-react"
import { buildMetric } from "@/lib/analytics/dashboard-utils"
import { useTranslation } from "@/hooks/use-translation"
import { getDashboardSnapshot } from "@/lib/analytics/actions"
import type { DashboardFilters, DashboardSnapshot } from "@/lib/analytics/types"
import { QuickActions } from "./components/quick-actions"
import { DashboardHeader } from "./components/dashboard-header"
import { OpsPanel } from "./components/ops-panel"
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
import { ScrollReveal, StaggerContainer } from "@/components/ui/scroll-reveal"

const DEFAULT_FILTERS: DashboardFilters = { period: "30d", platform: "all", category: "all" }

function SectionHeader({ title, subtitle }: { icon?: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const ui = useUiText()
  const { t, locale } = useTranslation()

  const [request, setRequest] = React.useState({ filters: DEFAULT_FILTERS, isRefresh: false })
  const filters = request.filters
  const [result, setResult] = React.useState<{ filters: DashboardFilters; snapshot: DashboardSnapshot } | null>(null)
  const snapshot = result?.snapshot ?? null
  const [settledRequest, setSettledRequest] = React.useState<typeof request | null>(null)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const requestId = React.useRef(0)
  const initialLoading = settledRequest !== request && (!request.isRefresh || result?.filters !== filters)
  const refreshing = settledRequest !== request && request.isRefresh
  const loadError = settledRequest === request && loadFailed
  // The first load of every dashboard visit is computed fresh (and refreshes
  // the cache): many writes go straight to Supabase, so there is no complete
  // mutation hook to invalidate on. Only filter switches within the 60-second
  // window are served from the server cache.
  const visitedFresh = React.useRef(false)

  const requestLoad = (filters: DashboardFilters, isRefresh = false) => setRequest({ filters, isRefresh })
  const load = React.useCallback(() => {
    const id = ++requestId.current
    // An explicit refresh and the first load of a visit bypass the cache.
    const fresh = request.isRefresh || !visitedFresh.current
    visitedFresh.current = true
    return getDashboardSnapshot(request.filters, { fresh }).then(
      snap => {
        if (requestId.current !== id) return
        setResult({ filters: request.filters, snapshot: snap })
        setLoadFailed(false)
        setSettledRequest(request)
      },
      () => {
        if (requestId.current !== id) return
        setLoadFailed(true)
        setSettledRequest(request)
      },
    )
  }, [request])

  React.useEffect(() => {
    void load()
    return () => { requestId.current += 1 }
  }, [load])

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
    <div className="page-enter space-y-8 px-4 lg:px-6">
      {/* ── Page header ── */}
      <ScrollReveal direction="fade" duration={400}>
        <div className="flex flex-col gap-4">
          <DashboardHeader snapshot={snapshot} onRefresh={() => requestLoad(filters, true)} refreshing={refreshing} />
          <QuickActions />
        </div>
      </ScrollReveal>

      {/* ── Global filters ── */}
      <ScrollReveal direction="up" delay={50} duration={400}>
        <FilterBar
          filters={filters}
          onChange={filters => requestLoad(filters)}
          onRefresh={() => requestLoad(filters, true)}
          refreshing={refreshing}
          platforms={platformOptions}
          generatedAt={snapshot?.generatedAt ?? null}
        />
      </ScrollReveal>

      {loadError ? (
        <ScrollReveal direction="scale" delay={100}>
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl text-elite-blue-600 dark:text-elite-blue-300">
              <TriangleAlert className="h-6 w-6 text-red-500" />
            </div>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">{t.dashboard.unableToLoad}</p>
            <button
              onClick={() => requestLoad(filters)}
              className="mt-3 rounded-xl bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
            >
              {t.common.retry}
            </button>
          </div>
        </ScrollReveal>
      ) : initialLoading || !snapshot || !k ? (
        <div className="space-y-8">
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
        </div>
      ) : (
        <>
          {/* ── Executive KPI row ── */}
          <section aria-label={ui("Executive KPIs")} className="space-y-3">
            <ScrollReveal direction="up" delay={80}>
              <SectionHeader
                icon={LayoutDashboard}
                title={locale === "ar" ? "مؤشرات الأداء الرئيسية" : "Executive Overview"}
                subtitle={locale === "ar" ? "نظرة عامة على أداء المؤسسة" : "At-a-glance performance metrics"}
              />
            </ScrollReveal>
            <StaggerContainer staggerDelay={60} direction="up">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <KpiCard label={t.dashboard.totalDrivers} metric={k.totalDrivers} icon={UsersRound} color="#1E5A99" href="/drivers" />
                <KpiCard label={t.dashboard.activeDrivers} metric={k.activeDrivers} icon={CheckCircle2} color="#10B981" href="/drivers" />
                <KpiCard label={t.dashboard.totalVehicles} metric={k.totalVehicles} icon={CarFront} color="#2F7BC4" href="/vehicles" />
                <KpiCard label={t.dashboard.inMaintenance} metric={k.inMaintenance} icon={Wrench} color="#F59E0B" href="/maintenance" />
              </div>
            </StaggerContainer>
          </section>

          {/* ── Financial KPI row ── */}
          <section aria-label={ui("Financial KPIs")} className="space-y-3">
            <ScrollReveal direction="up" delay={80}>
              <SectionHeader
                icon={WalletCards}
                title={locale === "ar" ? "المؤشرات المالية" : "Financial Performance"}
                subtitle={locale === "ar" ? "الإيرادات والمصروفات" : "Revenue and payroll at a glance"}
              />
            </ScrollReveal>
            <StaggerContainer staggerDelay={60} direction="up">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <KpiCard label={t.dashboard.totalOrders} metric={k.totalOrders} icon={PackageCheck} color="#1E5A99" href="/platforms" spark={ordersSpark} />
                <KpiCard label={t.dashboard.completionRate} metric={k.completionRate} icon={Gauge} color="#10B981" href="/platforms" spark={completionSpark} deltaUnit="pp" />
                <KpiCard label={t.dashboard.revenue} metric={k.revenue} icon={Banknote} color="#2F7BC4" href="/reports" spark={revenueSpark} currency />
                <KpiCard label={t.dashboard.netPayroll} metric={k.netPayroll} icon={WalletCards} color="#E87D3E" href="/payroll" currency />
              </div>
            </StaggerContainer>
          </section>

          {/* ── Accounting KPI row (Prompt I) ── */}
          <section aria-label={ui("Accounting KPIs")} className="space-y-3">
            <ScrollReveal direction="up" delay={80}>
              <SectionHeader
                icon={Landmark}
                title={locale === "ar" ? "المحاسبة" : "Accounting"}
                subtitle={locale === "ar" ? "قيود دفتر الأستاذ المرحلة والرصيد المتبقي للفواتير والإشعارات المدينة" : "Posted general ledger and outstanding invoice/debit-note receivables"}
              />
            </ScrollReveal>
            <StaggerContainer staggerDelay={60} direction="up">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <KpiCard
                  label={t.dashboard.finInvoiceRevenue}
                  metric={buildMetric(snapshot.accounting.revenue, snapshot.accounting.revenuePrevious, snapshot.accounting.available)}
                  icon={FileText}
                  color="#1E5A99"
                  href="/accounting"
                  currency
                  exactCurrency
                />
                <KpiCard
                  label={t.dashboard.finPendingInvoices}
                  metric={buildMetric(snapshot.accounting.pendingInvoicesAmount, 0, snapshot.accounting.available)}
                  icon={FileClock}
                  color="#F59E0B"
                  href="/accounting"
                  currency
                  exactCurrency
                />
                <KpiCard
                  label={t.dashboard.finExpenses}
                  metric={buildMetric(snapshot.accounting.expenses, snapshot.accounting.expensesPrevious, snapshot.accounting.available)}
                  icon={Receipt}
                  color="#EF4444"
                  href="/accounting"
                  currency
                  exactCurrency
                />
                <KpiCard
                  label={t.dashboard.finNetResult}
                  metric={buildMetric(snapshot.accounting.netResult, 0, snapshot.accounting.available)}
                  icon={Scale}
                  color="#10B981"
                  href="/accounting"
                  currency
                  exactCurrency
                />
              </div>
            </StaggerContainer>
          </section>

          {/* ── Operational Alerts ── */}
          <section aria-label={ui("Operations")} className="space-y-3">
            <ScrollReveal direction="up" delay={80}>
              <SectionHeader
                icon={ShieldAlert}
                title={locale === "ar" ? "تنبيهات التشغيل" : "Operational Alerts"}
                subtitle={locale === "ar" ? "الانتهاكات والمستندات" : "Violations and document expiry"}
              />
            </ScrollReveal>
            <StaggerContainer staggerDelay={60} direction="up">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <KpiCard label={t.dashboard.openViolations} metric={k.openViolations} icon={TriangleAlert} color="#EF4444" href="/violations" />
                <KpiCard label={t.dashboard.pendingApplications} metric={k.pendingApplications} icon={FileClock} color="#0F766E" href="/applications" />
                <KpiCard label={t.dashboard.expiringDocuments} metric={k.expiringDocuments} icon={CalendarClock} color="#F59E0B" href="/drivers" />
                <KpiCard label={t.dashboard.expiredDocuments} metric={k.expiredDocuments} icon={ShieldAlert} color="#EF4444" href="/drivers" />
              </div>
            </StaggerContainer>
          </section>

          {/* ── Cross-module operations (fleet / approvals / COD / audit) ── */}
          <section aria-label={ui("Cross-module operations")} className="space-y-3">
            <ScrollReveal direction="up" delay={80}>
              <SectionHeader
                icon={ShieldAlert}
                title={locale === "ar" ? "العمليات عبر الوحدات" : "Cross-Module Operations"}
                subtitle={
                  locale === "ar"
                    ? "الأسطول والموافقات وتحصيل نقدي وسجل التدقيق"
                    : "Fleet, approvals, COD reconciliation, audit activity"
                }
              />
            </ScrollReveal>
            <ScrollReveal direction="up" delay={120}>
              <OpsPanel kpis={snapshot.kpis} approvals={snapshot.approvals} cod={snapshot.cod} />
            </ScrollReveal>
          </section>

          {/* ── Primary analytics ── */}
          <section aria-label={ui("Trends")} className="grid gap-4 xl:grid-cols-2">
            <ScrollReveal direction="up" delay={100}>
              <OrdersTrend data={snapshot.trends.orders} available={snapshot.availability.orders} onRetry={() => requestLoad(filters, true)} />
            </ScrollReveal>
            <ScrollReveal direction="up" delay={160}>
              <RevenueTrend data={snapshot.trends.revenue} available={snapshot.availability.orders} onRetry={() => requestLoad(filters, true)} />
            </ScrollReveal>
          </section>

          {/* ── Secondary analytics ── */}
          <section aria-label={ui("Performance")} className="grid gap-4 xl:grid-cols-2">
            <ScrollReveal direction="left" delay={100}>
              <PlatformPerformance data={snapshot.platforms} available={snapshot.availability.orders} onRetry={() => requestLoad(filters, true)} />
            </ScrollReveal>
            <ScrollReveal direction="right" delay={160}>
              <DriverTargets data={snapshot.driverTargets} buckets={snapshot.targetBuckets} available={snapshot.availability.payroll} onRetry={() => requestLoad(filters, true)} />
            </ScrollReveal>
          </section>

          {/* ── Financial ── */}
          <ScrollReveal direction="up" delay={100}>
            <PayrollSummary payroll={snapshot.payroll} />
          </ScrollReveal>

          {/* ── Compliance + violations ── */}
          <section aria-label={ui("Compliance")} className="grid gap-4 xl:grid-cols-2">
            <ScrollReveal direction="left" delay={100}>
              <ComplianceRadar compliance={snapshot.compliance} available={snapshot.availability.drivers || snapshot.availability.vehicles} onRetry={() => requestLoad(filters, true)} />
            </ScrollReveal>
            <ScrollReveal direction="right" delay={160}>
              <ViolationsTrend data={snapshot.trends.violations} available={snapshot.availability.violations} onRetry={() => requestLoad(filters, true)} />
            </ScrollReveal>
          </section>

          {/* ── Action center + insights + activity ── */}
          <section aria-label={ui("Actions and insights")} className="grid gap-4 xl:grid-cols-3">
            <ScrollReveal direction="up" delay={80}>
              <ActionCenter actions={snapshot.actions} />
            </ScrollReveal>
            <ScrollReveal direction="up" delay={140}>
              <Insights insights={snapshot.insights} />
            </ScrollReveal>
            <ScrollReveal direction="up" delay={200}>
              <RecentActivity activity={snapshot.activity} />
            </ScrollReveal>
          </section>

          {/* ── Drill-down table ── */}
          <ScrollReveal direction="up" delay={100}>
            <DriverTable data={snapshot.driverTargets} available={snapshot.availability.payroll} onRetry={() => requestLoad(filters, true)} />
          </ScrollReveal>
        </>
      )}
    </div>
  )
}
