"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { recomputeDriverCompliance } from "@/app/actions/drivers/recompute-compliance"
import { createComplianceOverride, revokeComplianceOverride } from "@/app/actions/drivers/compliance-overrides"
import {
  OVERRIDABLE_REQUIREMENTS,
  type ComplianceLevel,
  type ComplianceOverride,
  type ComplianceResult,
} from "@/lib/drivers/compliance"
import type { Driver } from "@/types/drivers"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

const canOverride = (key: string, status: string) =>
  (status === "missing" || status === "expired") &&
  (OVERRIDABLE_REQUIREMENTS as readonly string[]).includes(key)

export function DriverComplianceEngine({ driver, isAr }: { driver: Driver; isAr: boolean }) {
  const [latest, setLatest] = useState<ComplianceResult | null>(null)
  const [overrides, setOverrides] = useState<ComplianceOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overrideFor, setOverrideFor] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [days, setDays] = useState<"7" | "30" | "90">("30")
  const [attachmentUrl, setAttachmentUrl] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // Pure queries: no setState here so effects below stay clear of the
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

  const fetchOverrides = useCallback(async (): Promise<ComplianceOverride[]> => {
    const supabase = createClient()
    const { data } = await supabase
      .from("driver_compliance_overrides")
      .select("id, driver_id, requirement, reason, attachment_url, approved_by, approved_at, expires_at, revoked_at")
      .eq("driver_id", driver.id)
      .is("revoked_at", null)
      .is("deleted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true })
    return (data ?? []) as ComplianceOverride[]
  }, [driver.id])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const [result, active] = await Promise.all([fetchLatest(), fetchOverrides()])
      if (cancelled) return
      setLatest(result)
      setOverrides(active)
      setLoading(false)
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [fetchLatest, fetchOverrides])

  const refreshAll = async () => {
    const [result, active] = await Promise.all([fetchLatest(), fetchOverrides()])
    setLatest(result)
    setOverrides(active)
  }

  const onRecompute = async () => {
    setRunning(true)
    setError(null)
    const res = await recomputeDriverCompliance({ driverId: driver.id })
    if (!res.ok) {
      setError(res.error)
    } else {
      await refreshAll()
    }
    setRunning(false)
  }

  const openOverride = (key: string) => {
    setOverrideFor(key)
    setReason("")
    setDays("30")
    setAttachmentUrl("")
    setFormError(null)
  }

  const submitOverride = async () => {
    if (!overrideFor) return
    setSaving(true)
    setFormError(null)
    const res = await createComplianceOverride({
      driverId: driver.id,
      requirement: overrideFor,
      reason,
      days: Number(days) as 7 | 30 | 90,
      attachmentUrl: attachmentUrl.trim() === "" ? undefined : attachmentUrl.trim(),
    })
    setSaving(false)
    if (!res.ok) {
      setFormError(res.error)
      return
    }
    setOverrideFor(null)
    await refreshAll()
  }

  const onRevoke = async (overrideId: string) => {
    setRevokingId(overrideId)
    setError(null)
    const res = await revokeComplianceOverride({ overrideId })
    if (!res.ok) setError(res.error)
    setRevokingId(null)
    await refreshAll()
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
                    <span className="flex items-center gap-2">
                      {canOverride(r.key, r.status) && (
                        <button
                          type="button"
                          onClick={() => openOverride(r.key)}
                          className="text-[10px] font-semibold text-elite-blue-500 hover:underline"
                        >
                          {isAr ? "تجاوز" : "Override"}
                        </button>
                      )}
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", reqStatusCls[r.status] ?? "bg-muted text-muted-foreground")}>
                        {r.status.replace(/_/g, " ")}
                      </span>
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

      {!loading && overrides.length > 0 && (
        <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
            {isAr ? "تجاوزات نشطة" : "Active overrides"}
          </p>
          <ul className="mt-2 space-y-2">
            {overrides.map((o) => {
              const lbl = reqLabels[o.requirement] ?? { en: o.requirement, ar: o.requirement }
              return (
                <li key={o.id} className="flex items-start justify-between gap-3 text-xs">
                  <div>
                    <span className="font-medium text-foreground">{isAr ? lbl.ar : lbl.en}</span>
                    <span className="text-muted-foreground"> — {o.reason}</span>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {isAr ? "تنتهي" : "expires"} {new Date(o.expires_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={revokingId === o.id}
                    onClick={() => void onRevoke(o.id)}
                    className="shrink-0 text-[10px] font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                  >
                    {revokingId === o.id ? (isAr ? "جارٍ الإلغاء…" : "Revoking…") : isAr ? "إلغاء" : "Revoke"}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Dialog open={overrideFor !== null} onOpenChange={(open) => { if (!open) setOverrideFor(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isAr ? "اعتماد تجاوز امتثال" : "Approve compliance override"}</DialogTitle>
          </DialogHeader>
          {overrideFor && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {isAr
                  ? `المتطلب: ${reqLabels[overrideFor]?.ar ?? overrideFor}`
                  : `Requirement: ${reqLabels[overrideFor]?.en ?? overrideFor}`}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="ovr-reason">{isAr ? "السبب (إلزامي)" : "Reason (required)"}</Label>
                <Textarea
                  id="ovr-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={isAr ? "مثال: التجديد قيد المعالجة لدى الجهة الحكومية" : "e.g. Renewal in progress at the authority"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? "المدة" : "Duration"}</Label>
                <Select value={days} onValueChange={(v) => setDays(v as "7" | "30" | "90")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">{isAr ? "7 أيام" : "7 days"}</SelectItem>
                    <SelectItem value="30">{isAr ? "30 يومًا" : "30 days"}</SelectItem>
                    <SelectItem value="90">{isAr ? "90 يومًا" : "90 days"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ovr-att">{isAr ? "رابط مرفق (اختياري)" : "Attachment URL (optional)"}</Label>
                <Input
                  id="ovr-att"
                  dir="ltr"
                  value={attachmentUrl}
                  onChange={(e) => setAttachmentUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideFor(null)} disabled={saving}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={() => void submitOverride()} disabled={saving || reason.trim().length < 5}>
              {saving ? (isAr ? "جارٍ الحفظ…" : "Saving…") : isAr ? "اعتماد التجاوز" : "Approve override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
