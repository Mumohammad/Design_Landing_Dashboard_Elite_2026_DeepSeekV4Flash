"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { CreditCard, FileCheck, AlertTriangle, DollarSign, Calculator, Download, Ban, Loader2, ArrowRightCircle, PackageCheck } from "lucide-react"
import { toast } from "sonner"
import {
  calculatePayrollForPeriod,
  generateWpsFile,
} from "@/lib/payroll/actions"
import { transitionPayrollStatus } from "@/lib/payroll/status-actions"
import {
  ALLOWED_PAYROLL_TRANSITIONS,
  payrollRowsToCsv,
  periodKey,
  type PayrollStatus,
} from "@/lib/payroll/payroll-utils"

interface PayrollRow {
  id: string
  driver_id: string
  period_year: number
  period_month: number
  status: string
  net_payroll: number
  base_amount: number
  orders_bonus: number
  total_deductions: number
  cod_deduction: number
  orders_achieved: number
  orders_prorated_target: number
  orders_variance: number
  below_minimum_wage: boolean
  minimum_floor_applied: boolean
  manual_override: boolean
  driver: { full_name_ar: string; driver_code: string } | null
}

// Per-driver live reads wiring payroll to the orders + COD surfaces (Prompt F).
interface OrdersRollupRow {
  driver_id: string
  total_delivered: number | null
  total_failed: number | null
  total_returned: number | null
  total_revenue: number | null
}
interface CodRollupRow {
  driver_id: string
  cod_collected: number | null
  cod_submitted: number | null
  cod_variance: number | null
  status: string
}

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  draft: { ar: "مسودة", en: "Draft", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  calculated: { ar: "محسوبة", en: "Calculated", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  in_review: { ar: "مراجعة", en: "In Review", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  approved: { ar: "معتمدة", en: "Approved", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  paid: { ar: "مدفوعة", en: "Paid", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  locked: { ar: "مقفلة", en: "Locked", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  cancelled: { ar: "ملغاة", en: "Cancelled", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toFixed(2) + " SAR"
}

const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export default function PayrollPage() {
  const { t } = useTranslation()
  const ar = t.common.status === "الحالة"
  const [data, setData] = useState<PayrollRow[]>([])
  const [ordersByDriver, setOrdersByDriver] = useState<Map<string, { delivered: number; revenue: number }>>(new Map())
  const [codByDriver, setCodByDriver] = useState<Map<string, { sessions: number; variance: number; pending: number }>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [transitioningId, setTransitioningId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  async function load() {
    setIsLoading(true)
    const supabase = createClient()
    const { data: result, error } = await supabase
      .from("driver_payroll_periods")
      .select(`
        id,driver_id,period_year,period_month,status,net_payroll,base_amount,orders_bonus,
        total_deductions,cod_deduction,orders_achieved,orders_prorated_target,orders_variance,
        below_minimum_wage,minimum_floor_applied,manual_override,
        driver:drivers(full_name_ar,driver_code)
      `)
      .eq("period_year", selectedYear)
      .is("deleted_at", null)
      .order("period_month", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200)
    if (error) { console.error(error); setData([]) }
    else { setData((result as unknown as PayrollRow[]) ?? []) }

    // ── Live orders rollup (monthly_driver_orders) for the loaded rows ──
    // One query for the whole page: per-platform rows keyed by (driver,
    // period) then aggregated client-side (pure rollup in payroll-utils).
    const rowSet = (result as unknown as PayrollRow[]) ?? []
    if (rowSet.length > 0) {
      // Rollup per (driver_id, period) — map by `${driver_id}:${year}:${month}`.
      const { data: orderRows } = await supabase
        .from("monthly_driver_orders")
        .select("driver_id, period_year, period_month, total_delivered, total_failed, total_returned, total_revenue")
        .eq("period_year", selectedYear)
        .in("period_month", [...new Set(rowSet.map((r) => r.period_month))])
        .is("deleted_at", null)
        .limit(2000)
      const ordersMap = new Map<string, { delivered: number; revenue: number }>()
      for (const r of (orderRows as unknown as (OrdersRollupRow & { period_year: number; period_month: number })[]) ?? []) {
        const key = `${r.driver_id}:${r.period_year}:${r.period_month}`
        const agg = ordersMap.get(key) ?? { delivered: 0, revenue: 0 }
        agg.delivered += r.total_delivered ?? 0
        agg.revenue += Number(r.total_revenue ?? 0)
        ordersMap.set(key, agg)
      }
      setOrdersByDriver(ordersMap)

      // ── COD sessions rollup per driver for the loaded rows' periods ──
      // session_date spans the whole month, so filter by range per distinct
      // period in the rowset (the pure rollup lives in payroll-utils).
      const monthStarts = [...new Set(rowSet.map((r) => periodKey(r.period_year, r.period_month)))]
      const { data: codRows } = await supabase
        .from("driver_cod_sessions")
        .select("driver_id, cod_collected, cod_submitted, cod_variance, status, session_date")
        .in("session_date", monthStarts.map((k) => `${k}-01`))
        .is("deleted_at", null)
        .limit(2000)
      // session_date is a DATE not a month key; group by driver + month prefix.
      const codMap = new Map<string, { sessions: number; variance: number; pending: number }>()
      for (const r of (codRows as unknown as (CodRollupRow & { session_date: string })[]) ?? []) {
        const monthKey = `${r.session_date.slice(0, 7)}`
        const key = `${r.driver_id}:${monthKey}`
        const agg = codMap.get(key) ?? { sessions: 0, variance: 0, pending: 0 }
        agg.sessions += 1
        agg.variance += Number(r.cod_variance ?? 0)
        if (r.status === "pending") agg.pending += 1
        codMap.set(key, agg)
      }
      setCodByDriver(codMap)
    } else {
      setOrdersByDriver(new Map())
      setCodByDriver(new Map())
    }
    setIsLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on year change
  }, [selectedYear])

  /** Guarded status transition through the shared server action. */
  async function handleTransition(row: PayrollRow, to: PayrollStatus) {
    // Mandatory reason on the rejection family (cancelled) — same bar as the
    // users module (min 5 chars).
    let reason: string | null = null
    if (to === "cancelled") {
      reason = window.prompt(ar ? "سبب الإلغاء (مطلوب):" : "Cancellation reason (required):")
      if (!reason || reason.trim().length < 5) return
    }
    setTransitioningId(row.id)
    const res = await transitionPayrollStatus({
      periodId: row.id,
      to,
      reason,
      surface: "payroll",
    })
    setTransitioningId(null)
    if (res.success) {
      toast.success(ar ? `تم تحديث الحالة إلى ${STATUS_META[to]?.ar ?? to}` : `Status changed to ${to}`)
      await load()
    } else {
      toast.error(res.error ?? "Error")
    }
  }

  /** CSV export matching the users/audit-trail/approvals pattern. */
  function exportCsv() {
    const csv = payrollRowsToCsv(
      filtered.map((r) => ({
        period_year: r.period_year,
        period_month: r.period_month,
        status: r.status,
        driver_code: r.driver?.driver_code ?? null,
        driver_name: r.driver?.full_name_ar ?? null,
        orders_achieved: r.orders_achieved,
        orders_prorated_target: r.orders_prorated_target,
        orders_variance: r.orders_variance,
        base_amount: r.base_amount,
        orders_bonus: r.orders_bonus,
        total_deductions: r.total_deductions,
        cod_deduction: r.cod_deduction,
        net_payroll: r.net_payroll,
        below_minimum_wage: r.below_minimum_wage,
        minimum_floor_applied: r.minimum_floor_applied,
        manual_override: r.manual_override,
      }))
    )
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `payroll-${periodKey(selectedYear, selectedMonth)}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCalculate() {
    setIsCalculating(true)
    setFeedback(null)
    const res = await calculatePayrollForPeriod(selectedYear, selectedMonth)
    setIsCalculating(false)
    if (res.success) {
      setFeedback({
        type: "ok",
        text: ar
          ? `تم احتساب رواتب ${res.calculated} سائق${res.error ? ` (${res.error})` : ""}.`
          : `${res.calculated} driver(s) calculated${res.error ? ` (${res.error})` : ""}.`,
      })
      await load()
    } else {
      setFeedback({ type: "err", text: res.error ?? "Error" })
    }
  }

  async function handleDownloadWps() {
    setIsDownloading(true)
    setFeedback(null)
    const res = await generateWpsFile(selectedYear, selectedMonth)
    setIsDownloading(false)
    if (res.success && res.content && res.filename) {
      const blob = new Blob([res.content], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = res.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setFeedback({ type: "ok", text: ar ? "تم إنشاء ملف WPS بنجاح." : "WPS SIF file generated." })
    } else {
      setFeedback({ type: "err", text: res.error ?? "Error" })
    }
  }

  // Cancel now routes through the guarded transition action (handleTransition
  // with to=cancelled) — cancelPayrollPeriodAction (M4 rollback chain) remains
  // available for the disbursement-execution backlog.

  const filtered = search
    ? data.filter(r => r.driver?.full_name_ar?.includes(search) || r.driver?.driver_code?.includes(search))
    : data

  const totalNet = data.reduce((s, r) => s + (r.net_payroll ?? 0), 0)
  const approvedCount = data.filter(r => r.status === "approved" || r.status === "paid").length
  // Live orders/COD KPI (Prompt F): aggregated across the loaded rows' drivers.
  const totalDelivered = [...ordersByDriver.values()].reduce((s, v) => s + v.delivered, 0)

  const kpiCards: KpiCardData[] = [
    { label: t.nav.payroll, value: data.length, icon: CreditCard, color: "#1E5A99" },
    { label: t.common.approved, value: approvedCount, icon: FileCheck, color: "#10B981" },
    { label: ar ? "طلبات مُسلَّمة (مباشر)" : "Delivered orders (live)", value: totalDelivered.toLocaleString("en-US"), icon: PackageCheck, color: "#F59E0B" },
    { label: "Net Total (SAR)", value: totalNet.toFixed(0), icon: DollarSign, color: "#8B5CF6" },
  ]

  const columns: TableColumn<PayrollRow>[] = [
    {
      key: "period",
      header: ar ? "الفترة" : "Period",
      render: (r) => {
        const monthName = ar ? MONTH_NAMES_AR[(r.period_month ?? 1) - 1] : MONTH_NAMES_EN[(r.period_month ?? 1) - 1]
        return <span dir="ltr" className="tabular-nums">{monthName} {r.period_year}</span>
      },
    },
    { key: "driver", header: t.nav.drivers, render: (r) => <span className="font-medium">{r.driver?.full_name_ar ?? "—"}</span> },
    {
      key: "status",
      header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.draft
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{ar ? s.ar : s.en}</span>
      },
    },
    {
      key: "orders",
      header: ar ? "الطلبات" : "Orders",
      render: (r) => (
        <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
          {r.orders_achieved ?? 0} / {r.orders_prorated_target ?? 0}
          {(r.orders_variance ?? 0) > 0 && <span className="text-emerald-600 ml-1">(+{r.orders_variance})</span>}
          {(r.orders_variance ?? 0) < 0 && <span className="text-red-600 ml-1">({r.orders_variance})</span>}
        </span>
      ),
    },
    { key: "base_amount", header: "Base", render: (r) => <span dir="ltr" className="tabular-nums">{fmtMoney(r.base_amount)}</span> },
    { key: "orders_bonus", header: "Bonus", render: (r) => <span dir="ltr" className="tabular-nums text-emerald-600">{r.orders_bonus > 0 ? "+" + fmtMoney(r.orders_bonus) : "—"}</span> },
    {
      key: "cod",
      header: "COD",
      render: (r) => {
        // Live COD rollup for this driver+period from driver_cod_sessions;
        // falls back to the persisted cod_deduction when no session rows exist.
        const live = codByDriver.get(`${r.driver_id}:${periodKey(r.period_year, r.period_month)}`)
        const owed = live && live.variance > 0 ? live.variance : r.cod_deduction > 0 ? r.cod_deduction : null
        return (
          <span
            dir="ltr"
            title={live ? `${live.sessions} session(s), ${live.pending} pending` : undefined}
            className={`tabular-nums text-xs ${owed ? "text-red-600 font-medium" : "text-muted-foreground"}`}
          >
            {owed ? "-" + fmtMoney(owed) : "—"}
          </span>
        )
      },
    },
    { key: "total_deductions", header: "Deductions", render: (r) => <span dir="ltr" className="tabular-nums text-red-600">{r.total_deductions > 0 ? "-" + fmtMoney(r.total_deductions) : "—"}</span> },
    {
      key: "net_payroll",
      header: ar ? "صافي الراتب" : "Net Payroll",
      render: (r) => (
        <div className="flex items-center gap-2">
          <span dir="ltr" className="tabular-nums font-bold">{fmtMoney(r.net_payroll)}</span>
          {r.below_minimum_wage && (
            <span className="inline-flex items-center rounded-full bg-red-500/15 text-red-600 border border-red-500/20 px-1.5 py-0.5 text-[10px] font-medium" title="Below Saudi minimum wage">
              <AlertTriangle className="h-3 w-3 ml-0.5" />
              MW
            </span>
          )}
          {r.minimum_floor_applied && (
            <span className="inline-flex items-center rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium" title="Minimum floor applied">
              Floor
            </span>
          )}
          {r.manual_override && (
            <span className="inline-flex items-center rounded-full bg-purple-500/15 text-purple-600 border border-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium" title="Manual override applied">
              Override
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: ar ? "إجراء" : "Action",
      render: (r) => {
        // Guarded transitions (users-module idiom): next allowed targets per
        // ALLOWED_PAYROLL_TRANSITIONS; terminal rows show an em-dash.
        const targets = ALLOWED_PAYROLL_TRANSITIONS[r.status as PayrollStatus] ?? []
        const isBusy = transitioningId === r.id
        return (
          <div className="flex items-center gap-1.5">
            {targets.filter((tt) => tt !== "cancelled").slice(0, 1).map((tt) => (
              <button
                key={tt}
                onClick={() => handleTransition(r, tt)}
                disabled={isBusy}
                title={ar ? `نقل إلى: ${STATUS_META[tt]?.ar ?? tt}` : `Move to: ${tt}`}
                className="inline-flex items-center gap-1 rounded-lg border border-elite-blue-500/25 bg-elite-blue-500/10 px-2 py-1 text-xs font-medium text-elite-blue-600 transition-colors hover:bg-elite-blue-500/20 disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightCircle className="h-3 w-3" />}
                {tt === "in_review" ? (ar ? "مراجعة" : "Review")
                  : tt === "approved" ? (ar ? "اعتماد" : "Approve")
                  : tt === "paid" ? (ar ? "تسجيل الدفع" : "Mark paid")
                  : tt === "calculated" ? (ar ? "إعادة الاحتساب" : "Recalculate")
                  : tt}
              </button>
            ))}
            {targets.includes("cancelled") && (
              <button
                onClick={() => handleTransition(r, "cancelled")}
                disabled={isBusy}
                className="inline-flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                {ar ? "إلغاء" : "Cancel"}
              </button>
            )}
            {targets.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        )
      },
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.payroll}
        subtitle={ar ? "إدارة فترات الرواتب والمدفوعات" : "Manage payroll periods and payments"}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {(ar ? MONTH_NAMES_AR : MONTH_NAMES_EN).map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <button
              onClick={handleCalculate}
              disabled={isCalculating}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:from-elite-blue-700 hover:to-elite-blue-800 disabled:opacity-50"
            >
              {isCalculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              {ar ? "احتساب الفترة" : "Calculate period"}
            </button>
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
            <button
              onClick={handleDownloadWps}
              disabled={isDownloading}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              WPS SIF
            </button>
            {feedback && (
              <span className={`text-xs font-medium ${feedback.type === "ok" ? "text-emerald-600" : "text-red-500"}`}>
                {feedback.text}
              </span>
            )}
          </div>
        }
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
