"use client"
import { useTranslation } from "@/hooks/use-translation"
import { cn } from "@/lib/utils"
import { STATUS_LABELS, type Bi, type ClaimStatus } from "@/lib/expense-claims/constants"
import { BOX_LABELS, INVOICE_TYPE_LABELS, RESULT_LABELS, type ZatcaCheck } from "@/lib/expense-claims/zatca-check"

export function useBi() {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  return { ar, locale: (ar ? "ar" : "en") as "ar" | "en", L: (b: Bi) => (ar ? b.ar : b.en), t: (en: string, arText: string) => (ar ? arText : en) }
}

const STATUS_CLASS: Record<ClaimStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  submitted: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300",
  needs_info: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  approved: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  rejected: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300",
  exported: "bg-violet-500/10 text-violet-700 border-violet-500/30 dark:text-violet-300",
  reimbursed: "bg-teal-500/10 text-teal-700 border-teal-500/30 dark:text-teal-300",
}

export function StatusBadge({ status }: { status: ClaimStatus }) {
  const { L } = useBi()
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_CLASS[status])}>{L(STATUS_LABELS[status])}</span>
}

export function UnverifiedTag({ className }: { className?: string }) {
  const { t } = useBi()
  return <span className={cn("inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300", className)}>{t("Unverified", "غير متحقق")}</span>
}

export const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  return <div className={cn("rounded-lg border p-3 text-xs leading-relaxed", tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "border-border bg-muted/40 text-muted-foreground")}>{children}</div>
}

export function downloadBase64(base64: string, filename: string, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement("a")
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function ZatcaCheckPanel({ check }: { check: ZatcaCheck }) {
  const { L, t } = useBi()
  const tone = check.result === "ready" ? "border-emerald-500/40 bg-emerald-500/10" : check.result === "attention" ? "border-amber-500/40 bg-amber-500/10" : "border-red-500/40 bg-red-500/10"
  return (
    <div className={cn("space-y-1.5 rounded-lg border p-3 text-xs leading-relaxed", tone)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium">
        <span>{t("ZATCA invoice check", "التحقق حسب متطلبات الهيئة")}: {L(RESULT_LABELS[check.result])}</span>
        <span className="text-muted-foreground">{L(INVOICE_TYPE_LABELS[check.invoiceType])} · {L(BOX_LABELS[check.box])}</span>
      </div>
      {check.issues.length > 0 && (
        <ul className="list-inside space-y-0.5">
          {check.issues.map((i) => <li key={i.code}>{i.severity === "error" ? "✖" : "⚠"} {L(i.text)}</li>)}
        </ul>
      )}
    </div>
  )
}
