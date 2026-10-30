"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { useTranslation } from "@/hooks/use-translation"
import type { SheetSpec } from "@/lib/payroll-engine/exports"

export function useLang() {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  return { ar, tx: (en: string, arabic: string) => (ar ? arabic : en) }
}

export const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
export const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
export const primaryButtonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
export const dangerButtonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/50 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}{children}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</label>
}

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const sar = (n: number | null | undefined) => nf.format(n ?? 0)
export const int = (n: number | null | undefined) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n ?? 0)

const STATUS: Record<string, { en: string; ar: string; cls: string }> = {
  draft: { en: "Draft", ar: "مسودة", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  approved: { en: "Approved", ar: "معتمدة", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  cancelled: { en: "Cancelled", ar: "ملغاة", cls: "border-destructive/40 bg-destructive/5 text-destructive" },
  active: { en: "Active", ar: "نشط", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  inactive: { en: "Inactive", ar: "غير نشط", cls: "border-border bg-muted text-muted-foreground" },
  paid: { en: "Paid", ar: "مدفوع", cls: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  completed: { en: "Completed", ar: "مكتمل", cls: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  pending: { en: "Pending", ar: "قيد الانتظار", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  rejected: { en: "Rejected", ar: "مرفوض", cls: "border-destructive/40 bg-destructive/5 text-destructive" },
  ok: { en: "OK", ar: "سليم", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  minor: { en: "Minor", ar: "طفيف", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  major: { en: "Major", ar: "كبير", cls: "border-destructive/40 bg-destructive/5 text-destructive" },
  review: { en: "Review", ar: "مراجعة", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  flagged: { en: "Flagged", ar: "مُعلَّم", cls: "border-destructive/40 bg-destructive/5 text-destructive" },
  info: { en: "Info", ar: "معلومة", cls: "border-border bg-muted text-muted-foreground" },
  warning: { en: "Warning", ar: "تحذير", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  error: { en: "Error", ar: "خطأ", cls: "border-destructive/40 bg-destructive/5 text-destructive" },
  open: { en: "Open", ar: "مفتوح", cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  resolved: { en: "Resolved", ar: "تمت المعالجة", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  ignored: { en: "Ignored", ar: "متجاهَل", cls: "border-border bg-muted text-muted-foreground" },
}

export function StatusBadge({ status }: { status: string }) {
  const { ar } = useLang()
  const m = STATUS[status] ?? { en: status, ar: status, cls: "border-border bg-muted text-muted-foreground" }
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${m.cls}`}>{ar ? m.ar : m.en}</span>
}

export function PlatformPayrollNav() {
  const { tx } = useLang()
  const path = usePathname()
  const tabs = [
    { href: "/payroll/platform", label: tx("Payroll runs", "مسيرات الرواتب"), exact: true },
    { href: "/payroll/platform/rules", label: tx("Rules", "القواعد") },
    { href: "/payroll/platform/adjustments", label: tx("Bonuses, deductions & fines", "المكافآت والخصومات والمخالفات") },
    { href: "/payroll/platform/income-expenses", label: tx("Income vs expenses", "الإيرادات مقابل المصروفات") },
  ]
  return (
    <nav aria-label={tx("Platform payroll", "رواتب المنصات")} className="flex flex-wrap gap-2 border-b border-border pb-3">
      <Link href="/payroll" className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">← {tx("Payroll", "الرواتب")}</Link>
      {tabs.map(t => {
        const active = t.exact ? path === t.href || path.startsWith("/payroll/platform/runs") : path.startsWith(t.href)
        return <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{t.label}</Link>
      })}
    </nav>
  )
}

export function PageShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <PlatformPayrollNav />
      {children}
    </div>
  )
}

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""
  return <div className="rounded-xl border border-border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div></div>
}

export function Notice({ kind, children }: { kind: "ok" | "err" | "info"; children: ReactNode }) {
  const cls = kind === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
    : kind === "err" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-border bg-muted/50"
  return <div role={kind === "err" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>
}

/** Write SheetSpecs to an .xlsx download (xlsx is loaded on demand). */
export async function downloadSheets(sheets: SheetSpec[], fileName: string) {
  const XLSX = await import("xlsx")
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    if (s.cols) ws["!cols"] = s.cols.map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, fileName)
}

export function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
