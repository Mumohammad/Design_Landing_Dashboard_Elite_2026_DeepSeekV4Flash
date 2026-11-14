"use client"

// Driver profile → Payslips: every platform payroll payslip linked to this
// driver (via Rider ID). Draft payslips refresh automatically when bonuses or
// deductions change, so this view always matches the latest calculation.
import { useEffect, useState } from "react"
import { FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getDriverPayslips, getPayslipCompany, type DriverPayslip } from "@/lib/payroll-engine/server/read-actions"
import { payslipBreakdown } from "@/lib/payroll-engine/payslip"
import { monthLabel, monthLabelAr } from "@/lib/payroll-engine/month"
import type { PayslipCompany } from "./payslip-print"
import { PayslipViewer } from "./payslip-viewer"
import { friendlyError } from "@/lib/errors/friendly"

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)

type PreviewRead = { success: true; rows: DriverPayslip[]; company: PayslipCompany }
  | { success: false; error: string; source: "payslips" | "company" | "network" }

/** Payslip rows and their tenant identity form one printable read result. */
export async function readDriverPayslipPreview(driverId: string): Promise<PreviewRead> {
  try {
    const [rows, company] = await Promise.all([getDriverPayslips(driverId), getPayslipCompany()])
    if (!rows.success) return { success: false, error: rows.error, source: "payslips" }
    if (!company.success) return { success: false, error: company.error, source: "company" }
    if (!(company.data.nameAr?.trim() || company.data.nameEn?.trim())) return { success: false, error: "", source: "company" }
    return { success: true, rows: rows.data, company: company.data }
  } catch {
    return { success: false, error: "", source: "network" }
  }
}

export function DriverPayslipsTab({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  return <DriverPayslipsContent key={driverId} driverId={driverId} isAr={isAr} />
}

function DriverPayslipsContent({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [state, setState] = useState<PreviewRead | null>(null)
  const [retry, setRetry] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void readDriverPayslipPreview(driverId).then(result => { if (!cancelled) setState(result) })
    return () => { cancelled = true }
  }, [driverId, retry])

  if (!state) return <div role="status" aria-label={isAr ? "جارٍ تحميل القسائم وبيانات الشركة" : "Loading payslips and company details"} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <div key={i} aria-hidden="true" className="h-40 rounded-lg bg-muted" />)}</div>
  if (!state.success) {
    const fallback = state.source === "company"
      ? (isAr ? "تعذر تحميل بيانات الشركة اللازمة للقسائم. أعد المحاولة قبل الطباعة." : "Could not load the company details required for payslips. Retry before printing.")
      : (isAr ? "تعذر تحميل القسائم وبيانات الشركة. أعد المحاولة." : "Could not load payslips and company details. Try again.")
    const codedError = /^[A-Z][A-Z0-9_]{2,}(?::|$)/.test(state.error) ? state.error : ""
    return <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="text-destructive">{friendlyError(codedError, isAr, fallback)}</p>
      <Button type="button" variant="outline" onClick={() => { setOpen(null); setState(null); setRetry(value => value + 1) }}>{isAr ? "إعادة المحاولة" : "Try again"}</Button>
    </div>
  }
  const { rows, company } = state
  if (rows.length === 0) return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      <FileText aria-hidden="true" className="mx-auto mb-2 h-6 w-6" />
      {isAr ? "لا توجد قسائم رواتب بعد. اربط رقم المندوب في ملف السائق ثم استورد مسير المنصة." : "No payslips yet. Link the platform Rider ID on this driver, then import the platform payroll."}
    </div>
  )
  const latest = rows[0]
  const selected = rows.find(row => row.resultId === open)
  const ytd = rows.filter(r => r.status === "approved" && r.monthKey.slice(0, 4) === latest.monthKey.slice(0, 4)).reduce((s, r) => s + r.result.finalNetSalary, 0)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 [&>:last-child]:col-span-2 sm:grid-cols-3 sm:[&>:last-child]:col-span-1">
        <Stat label={isAr ? "آخر صافي راتب" : "Latest net salary"} value={`SAR ${money(latest.result.finalNetSalary)}`} sub={isAr ? monthLabelAr(latest.monthKey) : monthLabel(latest.monthKey)} />
        <Stat label={isAr ? `المعتمد في ${latest.monthKey.slice(0, 4)}` : `Approved in ${latest.monthKey.slice(0, 4)}`} value={`SAR ${money(ytd)}`} sub={isAr ? "صافي الرواتب المعتمدة" : "Net of approved payslips"} />
        <Stat label={isAr ? "القسائم" : "Payslips"} value={String(rows.length)} sub={isAr ? "جميع المسيرات غير الملغاة" : "All non-cancelled runs"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(r => {
          const p = payslipBreakdown(r.result)
          return (
            <div key={r.resultId} data-testid={`driver-payslip-${r.resultId}`} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div><div className="font-bold">{isAr ? monthLabelAr(r.monthKey) : monthLabel(r.monthKey)}</div><div className="text-xs text-muted-foreground">{r.platformName} · {r.riderId}</div></div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === "approved" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>{r.status === "approved" ? (isAr ? "معتمد" : "Approved") : (isAr ? "مسودة" : "Draft")}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div><div className="text-muted-foreground">{isAr ? "الإجمالي" : "Gross"}</div><div className="font-semibold tabular-nums">{money(p.gross)}</div></div>
                <div><div className="text-muted-foreground">{isAr ? "الخصومات" : "Deductions"}</div><div className="font-semibold tabular-nums text-red-600">−{money(Math.abs(p.totalDeductions))}</div></div>
                <div><div className="text-muted-foreground">{isAr ? "الصافي" : "Net"}</div><div className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{money(p.net)}</div></div>
              </div>
              <Button type="button" variant="outline" className="mt-4 w-full" onClick={() => setOpen(r.resultId)}>
                <FileText aria-hidden="true" className="h-4 w-4" />{isAr ? "عرض القسيمة" : "View payslip"}
              </Button>
            </div>
          )
        })}
      </div>
      {selected && <PayslipViewer ar={isAr} rows={[{ result: selected.result, bank: selected.bank }]} title={`${selected.result.driverName} · ${selected.riderId}`}
        meta={{ month: isAr ? monthLabelAr(selected.monthKey) : monthLabel(selected.monthKey), platform: selected.platformName, status: selected.status, company }} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
