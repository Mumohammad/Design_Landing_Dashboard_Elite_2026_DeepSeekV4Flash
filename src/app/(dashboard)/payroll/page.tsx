"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { CreditCard, FileCheck, AlertTriangle, DollarSign, Calculator, Download, Ban, Loader2 } from "lucide-react"
import {
  calculatePayrollForPeriod,
  cancelPayrollPeriodAction,
  generateWpsFile,
} from "@/lib/payroll/actions"

interface PayrollRow {
  id: string
  period_year: number
  period_month: number
  status: string
  net_payroll: number
  base_amount: number
  orders_bonus: number
  total_deductions: number
  orders_achieved: number
  orders_prorated_target: number
  orders_variance: number
  below_minimum_wage: boolean
  minimum_floor_applied: boolean
  manual_override: boolean
  driver: { full_name_ar: string; driver_code: string } | null
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
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  async function load() {
    setIsLoading(true)
    const supabase = createClient()
    const { data: result, error } = await supabase
      .from("driver_payroll_periods")
      .select(`
        id,period_year,period_month,status,net_payroll,base_amount,orders_bonus,
        total_deductions,orders_achieved,orders_prorated_target,orders_variance,
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
    setIsLoading(false)
  }

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("driver_payroll_periods")
        .select(`
          id,period_year,period_month,status,net_payroll,base_amount,orders_bonus,
          total_deductions,orders_achieved,orders_prorated_target,orders_variance,
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
      setIsLoading(false)
    })()
  }, [selectedYear])

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

  async function handleCancel(row: PayrollRow) {
    const reason = window.prompt(ar ? "سبب الإلغاء (مطلوب):" : "Cancellation reason (required):")
    if (!reason) return
    setCancellingId(row.id)
    setFeedback(null)
    const res = await cancelPayrollPeriodAction(row.id, reason)
    setCancellingId(null)
    if (res.success) {
      setFeedback({ type: "ok", text: ar ? "تم إلغاء الفترة وإرجاع الخصومات." : "Period cancelled, deductions rolled back." })
      await load()
    } else {
      setFeedback({ type: "err", text: res.error ?? "Error" })
    }
  }

  const filtered = search
    ? data.filter(r => r.driver?.full_name_ar?.includes(search) || r.driver?.driver_code?.includes(search))
    : data

  const totalNet = data.reduce((s, r) => s + (r.net_payroll ?? 0), 0)
  const approvedCount = data.filter(r => r.status === "approved" || r.status === "paid").length

  const kpiCards: KpiCardData[] = [
    { label: t.nav.payroll, value: data.length, icon: CreditCard, color: "#1E5A99" },
    { label: t.common.approved, value: approvedCount, icon: FileCheck, color: "#10B981" },
    { label: t.common.pending, value: data.filter(r => r.status === "draft" || r.status === "calculated").length, icon: AlertTriangle, color: "#F59E0B" },
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
        const canCancel = !["paid", "cancelled"].includes(r.status)
        if (!canCancel) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <button
            onClick={() => handleCancel(r)}
            disabled={cancellingId === r.id}
            className="inline-flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            {cancellingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
            {ar ? "إلغاء" : "Cancel"}
          </button>
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
