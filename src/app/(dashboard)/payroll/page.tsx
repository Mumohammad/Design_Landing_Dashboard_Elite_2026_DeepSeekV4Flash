"use client"

import Link from "next/link"
import { LocalizedText, useUiText } from "@/components/localized-text"
import { integrationAvailable } from "@/lib/release/integrations"
import { useCallback, useEffect, useRef, useState } from "react"
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
function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toFixed(2) + " SAR"
}

const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  draft: { ar: "مسودة", en: "Draft", className: "border-border bg-muted text-muted-foreground" },
  calculated: { ar: "محتسبة", en: "Calculated", className: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  in_review: { ar: "قيد المراجعة", en: "In review", className: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  approved: { ar: "معتمدة", en: "Approved", className: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  paid: { ar: "مدفوعة", en: "Paid", className: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  locked: { ar: "مقفلة", en: "Locked", className: "border-border bg-muted text-muted-foreground" },
  cancelled: { ar: "ملغاة", en: "Cancelled", className: "border-destructive/40 bg-destructive/5 text-destructive" },
}

export default function PayrollPage() {
  const ui = useUiText()
  const { t } = useTranslation()
  const ar = t.common.status === "الحالة"
  const [data, setData] = useState<PayrollRow[]>([])
  const [codByDriver, setCodByDriver] = useState<Map<string, { sessions: number; variance: number; pending: number }>>(new Map())
  const [request, setRequest] = useState({ year: new Date().getFullYear(), page: 1, search: "" })
  const { year: selectedYear, page, search } = request
  const [totalRecords, setTotalRecords] = useState(0)
  const [yearStats, setYearStats] = useState({net:0,approved:0,delivered:0})
  const [loadError, setLoadError] = useState("")
  const [loadedRequest, setLoadedRequest] = useState<typeof request | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [transitioningId, setTransitioningId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const loadSequence = useRef(0)
  const mounted = useRef(false)
  const isLoading = loadedRequest !== request

  const load = useCallback(() => {
    const sequence = ++loadSequence.current
    const fail = (error: unknown) => {
      if (sequence !== loadSequence.current) return
      setLoadError(error instanceof Error ? error.message : "Unable to load payroll")
      setData([]); setTotalRecords(0); setYearStats({net:0,approved:0,delivered:0}); setCodByDriver(new Map())
      setLoadedRequest(request)
    }
    const supabase = createClient()
    return supabase.rpc("payroll_periods_page", {p_year:request.year,p_page:request.page-1,p_search:request.search.trim()}).then(({ data: result, error }) => {
      if (sequence !== loadSequence.current) return
      if (error || !result) { fail(new Error(error?.message ?? "Unable to load payroll")); return }
      setLoadError("")
      const response=result as {rows:(PayrollRow & {live_delivered:number;live_cod:{sessions:number;variance:number;pending:number}})[];total:number;stats:{net:number;approved:number;delivered:number}}
      setData(response.rows);setTotalRecords(response.total);setYearStats(response.stats)
      setCodByDriver(new Map(response.rows.map(r => [`${r.driver_id}:${periodKey(r.period_year,r.period_month)}`,r.live_cod])))
      setLoadedRequest(request)
    }, fail)
  }, [request])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false; loadSequence.current += 1 }
  }, [load])

  function requestReload() {
    if (mounted.current) setRequest(current => ({ ...current }))
  }

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
    try {
      const res = await transitionPayrollStatus({
        periodId: row.id,
        to,
        reason,
        surface: "payroll",
      })
      if (!mounted.current) return
      if (res.success) {
        toast.success(ar ? `تم تحديث الحالة إلى ${STATUS_META[to]?.ar ?? to}` : `Status changed to ${to}`)
        requestReload()
      } else {
        toast.error(res.error ?? (ar ? "تعذر تحديث الحالة." : "Unable to update status."))
      }
    } catch {
      if (mounted.current) toast.error(ar ? "تعذر تأكيد تحديث الحالة. حدّث الرواتب قبل إعادة المحاولة." : "Could not confirm the status update. Refresh payroll before retrying.")
    } finally {
      if (mounted.current) setTransitioningId(current => current === row.id ? null : current)
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
    try {
      const res = await calculatePayrollForPeriod(selectedYear, selectedMonth)
      if (!mounted.current) return
      if (res.success) {
        setFeedback({
          type: "ok",
          text: ar
            ? `تم احتساب رواتب ${res.calculated} سائق${res.error ? ` (${res.error})` : ""}.`
            : `${res.calculated} driver(s) calculated${res.error ? ` (${res.error})` : ""}.`,
        })
        requestReload()
      } else {
        setFeedback({ type: "err", text: res.error ?? (ar ? "تعذر احتساب الرواتب." : "Unable to calculate payroll.") })
      }
    } catch {
      if (mounted.current) setFeedback({ type: "err", text: ar ? "تعذر تأكيد احتساب الرواتب. حدّث الرواتب قبل إعادة المحاولة." : "Could not confirm the payroll calculation. Refresh payroll before retrying." })
    } finally {
      if (mounted.current) setIsCalculating(false)
    }
  }

  async function handleDownloadWps() {
    setIsDownloading(true)
    setFeedback(null)
    try {
      const res = await generateWpsFile(selectedYear, selectedMonth)
      if (!mounted.current) return
      if (res.success && res.content && res.filename) {
        const blob = new Blob([res.content], { type: "text/plain;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = res.filename
        try {
          document.body.appendChild(a)
          a.click()
        } finally {
          a.remove()
          URL.revokeObjectURL(url)
        }
        setFeedback({ type: "ok", text: ar ? "تم إنشاء ملف WPS بنجاح." : "WPS SIF file generated." })
      } else {
        setFeedback({ type: "err", text: res.error ?? (ar ? "تعذر إنشاء ملف WPS." : "Unable to generate the WPS file.") })
      }
    } catch {
      if (mounted.current) setFeedback({ type: "err", text: ar ? "تعذر تأكيد تنزيل ملف WPS. أعد المحاولة." : "Could not confirm the WPS download. Try again." })
    } finally {
      if (mounted.current) setIsDownloading(false)
    }
  }

  // Cancel now routes through the guarded transition action (handleTransition
  // with to=cancelled) — cancelPayrollPeriodAction (M4 rollback chain) remains
  // available for the disbursement-execution backlog.

  const filtered = data

  const totalNet = yearStats.net
  const approvedCount = yearStats.approved
  // Live orders/COD KPI (Prompt F): aggregated across the loaded rows' drivers.
  const totalDelivered = yearStats.delivered

  const kpiCards: KpiCardData[] = [
    { label: t.nav.payroll, value: totalRecords, icon: CreditCard, color: "#1E5A99" },
    { label: t.common.approved, value: approvedCount, icon: FileCheck, color: "#10B981" },
    { label: ar ? "طلبات مسلّمة (محتسبة، السنة المصفاة)" : "Delivered orders (calculated, filtered year)", value: totalDelivered.toLocaleString("en-US"), icon: PackageCheck, color: "#F59E0B" },
    { label: ar ? "صافي الإجمالي (ر.س)" : "Net Total (SAR)", value: totalNet.toFixed(0), icon: DollarSign, color: "#8B5CF6" },
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
            <span className="inline-flex items-center rounded-full bg-red-500/15 text-red-600 border border-red-500/20 px-1.5 py-0.5 text-[10px] font-medium" title={ar ? "أقل من الحد المرجعي المضبوط للرواتب" : "Below configured payroll advisory"}>
              <AlertTriangle className="h-3 w-3 ml-0.5" /><LocalizedText text="MW" /></span>
          )}
          {r.minimum_floor_applied && (
            <span className="inline-flex items-center rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium" title={ui("Minimum floor applied")}><LocalizedText text="Floor" /></span>
          )}
          {r.manual_override && (
            <span className="inline-flex items-center rounded-full bg-purple-500/15 text-purple-600 border border-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium" title={ui("Manual override applied")}><LocalizedText text="Override" /></span>
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
        onSearchChange={search => setRequest(current => ({ ...current, search, page: 1 }))}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/payroll/preparation" className="inline-flex h-9 items-center rounded-xl border border-border px-3.5 text-sm font-medium hover:bg-muted">{ar ? "تحضير البيانات والسلف" : "Prepare inputs and advances"}</Link>
            <select
              aria-label={ar ? "شهر الراتب" : "Payroll month"}
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {(ar ? MONTH_NAMES_AR : MONTH_NAMES_EN).map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <input
              type="number" min="2000" max="2100" aria-label={ar ? "سنة الراتب" : "Payroll year"}
              value={selectedYear}
              onChange={event => { const year = Number(event.target.value); setRequest(current => ({ ...current, year, page: 1 })) }}
              className="h-9 w-28 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            />
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
              disabled={isLoading || filtered.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {ar ? "CSV — الصفحة الحالية" : "CSV — current page"}
            </button>
            <button
              onClick={handleDownloadWps}
              disabled={isDownloading || !integrationAvailable("wps")}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 text-sm font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {ar ? "WPS — بانتظار اعتماد البنك" : "WPS — awaiting bank validation"}
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
        loadError={isLoading ? "" : loadError}
        onRetry={requestReload}
        pagination={{totalRecords,currentPage:page,totalPages:Math.max(1,Math.ceil(totalRecords/50)),onPageChange:page => setRequest(current => ({ ...current, page }))}}
        isLoading={isLoading}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
