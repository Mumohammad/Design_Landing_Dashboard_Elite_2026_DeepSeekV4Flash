"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { recomputeDriverCompliance } from "@/app/actions/drivers/recompute-compliance"
import type { ComplianceLevel, ComplianceResult } from "@/lib/drivers/compliance"
import type { Driver } from "@/types/drivers"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RefreshCw, ShieldAlert } from "lucide-react"

const levelStyles: Record<ComplianceLevel, { en: string; ar: string; cls: string }> = {
  fully_compliant: { en: "Fully compliant", ar: "ممتثل بالكامل", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  compliant_warnings: { en: "Compliant (warnings)", ar: "ممتثل مع تنبيهات", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  pending_review: { en: "Pending review", ar: "قيد المراجعة", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  non_compliant: { en: "Non-compliant", ar: "غير ممتثل", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
  critical_block: { en: "Critical block", ar: "حظر حرج", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
  suspended: { en: "Suspended", ar: "موقوف", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
}

const reqLabels: Record<string, { en: string; ar: string }> = {
  identity: { en: "Identity", ar: "الهوية" },
  driving_license: { en: "Driving licence", ar: "رخصة القيادة" },
  photo: { en: "Photo", ar: "الصورة" },
  health_certificate: { en: "Health certificate", ar: "الشهادة الصحية" },
  home_delivery_permit: { en: "Home delivery permit", ar: "تصريح التوصيل" },
  ajeer_permit: { en: "Ajeer permit", ar: "تصريح أجير" },
  vehicle_link: { en: "Vehicle link", ar: "ربط المركبة" },
  employment_status: { en: "Employment status", ar: "حالة التوظيف" },
  driver_card: { en: "Driver card", ar: "بطاقة السائق" },
}

const reqStatusCls: Record<string, string> = {
  valid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  missing: "bg-red-500/15 text-red-700 dark:text-red-400",
  expired: "bg-red-500/15 text-red-700 dark:text-red-400",
  blocked: "bg-red-500/15 text-red-700 dark:text-red-400",
  suspended: "bg-red-500/15 text-red-700 dark:text-red-400",
  expiring: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  override_active: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  not_required: "bg-muted text-muted-foreground",
}

export function DriverComplianceEngine({ driver, isAr }: { driver: Driver; isAr: boolean }) {
  const [latest, setLatest] = useState<ComplianceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pure query: no setState here so the effect below never triggers the
  // react-hooks set-state-in-effect rule.
  const fetchLatest = useCallback(async (): Promise<ComplianceResult | null> => {
    const supabase = createClient()
    const { data } = await supabase
      .from("driver_compliance_results")
      .select("*")
      .eq("driver_id", driver.id)
      .order("run_at", { ascending: false })
      .limit(1)
    return (data?.[0] as ComplianceResult | undefined) ?? null
  }, [driver.id])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const result = await fetchLatest()
      if (cancelled) return
      setLatest(result)
      setLoading(false)
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [fetchLatest])

  const onRecompute = async () => {
    setRunning(true)
    setError(null)
    const res = await recomputeDriverCompliance({ driverId: driver.id })
    if (!res.ok) {
      setError(res.error)
    } else {
      setLatest(await fetchLatest())
    }
    setRunning(false)
  }

  const meta = latest ? levelStyles[latest.level] : undefined
  const d = latest?.details

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldAlert className="h-4 w-4 text-elite-blue-500" />
          {isAr ? "محرك الامتثال (2026)" : "Compliance engine (2026)"}
        </h3>
        <Button size="sm" variant="outline" onClick={onRecompute} disabled={running}>
          <RefreshCw className={cn("h-3.5 w-3.5", running && "animate-spin")} />
          {running ? (isAr ? "جارٍ الحساب…" : "Computing…") : isAr ? "إعادة الحساب" : "Recompute"}
        </Button>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : !latest ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {isAr ? "لا توجد نتيجة امتثال بعد — اضغط إعادة الحساب." : "No compliance run yet — press Recompute."}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {meta && (
              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", meta.cls)}>
                {isAr ? meta.ar : meta.en}
              </span>
            )}
            <span className="text-sm text-muted-foreground tabular-nums">
              {isAr ? "النتيجة" : "Score"}: {latest.score}/100
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                driver.dispatch_eligible
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {driver.dispatch_eligible ? (isAr ? "مؤهل للإرسال" : "Dispatch eligible") : isAr ? "غير مؤهل للإرسال" : "Not dispatch eligible"}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs text-muted-foreground">
            {([
              [d?.blockers, isAr ? "مانع" : "Blockers"],
              [d?.missing, isAr ? "ناقص" : "Missing"],
              [d?.pending, isAr ? "معلق" : "Pending"],
              [d?.warnings, isAr ? "تنبيه" : "Warnings"],
            ] as const).map(([v, label]) => (
              <div key={label} className="rounded-lg border border-border/40 bg-muted/20 px-2 py-1.5">
                <div className="text-sm font-bold tabular-nums text-foreground">{v ?? "—"}</div>
                {label}
              </div>
            ))}
          </div>

          {d?.requirements && d.requirements.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {d.requirements.map((r) => {
                const lbl = reqLabels[r.key] ?? { en: r.key, ar: r.key }
                return (
                  <li key={r.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground/80">{isAr ? lbl.ar : lbl.en}</span>
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", reqStatusCls[r.status] ?? "bg-muted text-muted-foreground")}>
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            {isAr ? "آخر تشغيل" : "Last run"}: {new Date(latest.run_at).toLocaleString(isAr ? "ar-SA" : "en-GB")}
          </p>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
