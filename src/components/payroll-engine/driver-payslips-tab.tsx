"use client"

// Driver profile → Payslips: every platform payroll payslip linked to this
// driver (via Rider ID). Draft payslips refresh automatically when bonuses or
// deductions change, so this view always matches the latest calculation.
import { useEffect, useState } from "react"
import { FileText, TrendingUp, Wallet } from "lucide-react"
import { getDriverPayslips, getPayslipCompany, type DriverPayslip } from "@/lib/payroll-engine/server/read-actions"
import { payslipBreakdown } from "@/lib/payroll-engine/payslip"
import { monthLabel, monthLabelAr } from "@/lib/payroll-engine/month"
import type { PayslipCompany } from "./payslip-print"
import { PayslipViewer } from "./payslip-viewer"

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)

export function DriverPayslipsTab({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [rows, setRows] = useState<DriverPayslip[] | null>(null)
  const [error, setError] = useState("")
  const [company, setCompany] = useState<PayslipCompany | null>(null)
  const [open, setOpen] = useState<DriverPayslip | null>(null)
  useEffect(() => {
    let cancelled = false
    void Promise.all([getDriverPayslips(driverId), getPayslipCompany()]).then(([r, c]) => {
      if (cancelled) return
      if (r.success) setRows(r.data); else { setRows([]); setError(r.error) }
      if (c.success) setCompany(c.data)
    })
    return () => { cancelled = true }
  }, [driverId])

  if (rows === null) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted/60" />)}</div>
  if (error) return <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
  if (rows.length === 0) return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
      {isAr ? "لا توجد قسائم رواتب بعد. اربط رقم المندوب في ملف السائق ثم استورد مسير المنصة." : "No payslips yet. Link the platform Rider ID on this driver, then import the platform payroll."}
    </div>
  )
  const latest = rows[0]
  const ytd = rows.filter(r => r.status === "approved" && r.monthKey.slice(0, 4) === latest.monthKey.slice(0, 4)).reduce((s, r) => s + r.result.finalNetSalary, 0)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<Wallet className="h-4 w-4" />} label={isAr ? "آخر صافي راتب" : "Latest net salary"} value={`SAR ${money(latest.result.finalNetSalary)}`} sub={isAr ? monthLabelAr(latest.monthKey) : monthLabel(latest.monthKey)} />
        <Stat icon={<TrendingUp className="h-4 w-4" />} label={isAr ? `المعتمد في ${latest.monthKey.slice(0, 4)}` : `Approved in ${latest.monthKey.slice(0, 4)}`} value={`SAR ${money(ytd)}`} sub={isAr ? "صافي الرواتب المعتمدة" : "Net of approved payslips"} />
        <Stat icon={<FileText className="h-4 w-4" />} label={isAr ? "القسائم" : "Payslips"} value={String(rows.length)} sub={isAr ? "جميع المسيرات غير الملغاة" : "All non-cancelled runs"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(r => {
          const p = payslipBreakdown(r.result)
          return (
            <div key={r.resultId} data-testid={`driver-payslip-${r.resultId}`} className="group rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><FileText className="h-5 w-5" /></span>
                  <div><div className="font-bold">{isAr ? monthLabelAr(r.monthKey) : monthLabel(r.monthKey)}</div><div className="text-xs text-muted-foreground">{r.platformName} · {r.riderId}</div></div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === "approved" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>{r.status === "approved" ? (isAr ? "معتمد" : "Approved") : (isAr ? "مسودة" : "Draft")}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div><div className="text-muted-foreground">{isAr ? "الإجمالي" : "Gross"}</div><div className="font-semibold tabular-nums">{money(p.gross)}</div></div>
                <div><div className="text-muted-foreground">{isAr ? "الخصومات" : "Deductions"}</div><div className="font-semibold tabular-nums text-red-600">−{money(Math.abs(p.totalDeductions))}</div></div>
                <div><div className="text-muted-foreground">{isAr ? "الصافي" : "Net"}</div><div className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{money(p.net)}</div></div>
              </div>
              <button type="button" className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-sm font-semibold hover:border-emerald-500/50 hover:bg-emerald-500/5" onClick={() => setOpen(r)}>
                <FileText className="h-4 w-4" />{isAr ? "عرض القسيمة" : "View payslip"}
              </button>
            </div>
          )
        })}
      </div>
      {open && <PayslipViewer ar={isAr} rows={[{ result: open.result, bank: open.bank }]} title={`${open.result.driverName} · ${open.riderId}`}
        meta={{ month: isAr ? monthLabelAr(open.monthKey) : monthLabel(open.monthKey), platform: open.platformName, status: open.status, company }} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-emerald-500/10 via-card to-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="text-emerald-600">{icon}</span>{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  )
}
