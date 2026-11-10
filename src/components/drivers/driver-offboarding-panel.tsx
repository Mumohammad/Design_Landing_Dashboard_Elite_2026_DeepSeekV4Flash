"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, CircleAlert, CircleDashed, Loader2, LogOut, Printer, RefreshCw, ShieldCheck, XCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { saveDriverOffboarding, type OffboardingRecord } from "@/app/actions/drivers/offboarding"
import { setDriverStatus } from "@/lib/drivers/actions"
import {
  buildClearanceCertificateHtml, clearanceProgress, EXIT_TYPE_LABELS, MANUAL_ITEM_LABELS, OFFBOARDING_EXIT_TYPES, OFFBOARDING_MANUAL_KEYS,
  type OffboardingExitType, type SystemCheck,
} from "@/lib/drivers/clearance-certificate"
import { printDocument } from "@/lib/print-document"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import type { Driver } from "@/types/drivers"

const OPEN_VIOLATIONS = ["open", "acknowledged", "under_review", "disputed", "escalated"]
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })
const field = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"

async function loadChecks(driverId: string): Promise<SystemCheck[]> {
  const db = createClient()
  const [veh, cards, plats, viol, fines, assets] = await Promise.all([
    db.from("vehicle_assignments").select("id, vehicles(plate_number)").eq("driver_id", driverId).eq("is_current", true).is("deleted_at", null),
    db.from("driver_cards").select("id").eq("driver_id", driverId).in("status", ["active", "suspended"]).is("deleted_at", null),
    db.from("driver_platform_accounts").select("platform_code").eq("driver_id", driverId).eq("status", "active").is("deleted_at", null),
    db.from("violations").select("deduction_amount").eq("driver_id", driverId).in("status", OPEN_VIOLATIONS).is("deleted_at", null),
    db.from("external_fine_imports").select("fine_amount").eq("matched_driver_id", driverId).eq("status", "matched"),
    db.from("driver_assets").select("asset_type").eq("driver_id", driverId).is("returned_at", null).is("deleted_at", null),
  ])
  const n = (r: { data: unknown[] | null }) => r.data?.length ?? 0
  const sum = (rows: Record<string, unknown>[] | null, k: string) => (rows ?? []).reduce((s, r) => s + Number(r[k] ?? 0), 0)
  const plates = (veh.data ?? []).map((v) => (v as { vehicles?: { plate_number?: string | null } | null }).vehicles?.plate_number).filter(Boolean).join(", ")
  const vSum = sum(viol.data as Record<string, unknown>[] | null, "deduction_amount")
  const fSum = sum(fines.data as Record<string, unknown>[] | null, "fine_amount")
  return [
    { key: "vehicle", label: "Assigned vehicle returned", labelAr: "استلام المركبة المسندة", ok: n(veh) === 0, blocking: true,
      detail: n(veh) ? `Still assigned: ${plates || n(veh)}` : "No vehicle assigned", detailAr: n(veh) ? `ما زالت مسندة: ${plates || n(veh)}` : "لا توجد مركبة مسندة" },
    { key: "platforms", label: "Platform rider accounts deactivated", labelAr: "إيقاف حسابات المنصات", ok: n(plats) === 0, blocking: true,
      detail: n(plats) ? `Active: ${(plats.data ?? []).map((p) => p.platform_code).join(", ")}` : "No active accounts", detailAr: n(plats) ? `نشطة: ${(plats.data ?? []).map((p) => p.platform_code).join("، ")}` : "لا توجد حسابات نشطة" },
    { key: "cards", label: "Company ID cards revoked", labelAr: "إلغاء بطاقات الهوية", ok: n(cards) === 0, blocking: false,
      detail: n(cards) ? `${n(cards)} card(s) still valid` : "No valid cards", detailAr: n(cards) ? `${n(cards)} بطاقة سارية` : "لا توجد بطاقات سارية" },
    { key: "assets", label: "Custody assets returned", labelAr: "إرجاع العهد", ok: n(assets) === 0, blocking: false,
      detail: n(assets) ? `Pending: ${(assets.data ?? []).map((a) => a.asset_type).join(", ")}` : "All returned", detailAr: n(assets) ? `معلّقة: ${(assets.data ?? []).map((a) => a.asset_type).join("، ")}` : "تم إرجاع الكل" },
    { key: "violations", label: "Open violations settled", labelAr: "تسوية المخالفات المفتوحة", ok: n(viol) === 0, blocking: false,
      detail: n(viol) ? `${n(viol)} open · ${vSum.toLocaleString("en-US")} SAR` : "None open", detailAr: n(viol) ? `${n(viol)} مفتوحة · ${vSum.toLocaleString("en-US")} ر.س` : "لا توجد" },
    { key: "fines", label: "Traffic fines reviewed", labelAr: "مراجعة المخالفات المرورية", ok: n(fines) === 0, blocking: false,
      detail: n(fines) ? `${n(fines)} matched · ${fSum.toLocaleString("en-US")} SAR` : "None pending", detailAr: n(fines) ? `${n(fines)} مطابقة · ${fSum.toLocaleString("en-US")} ر.س` : "لا توجد" },
  ]
}

export function DriverOffboardingPanel({ driver, isAr }: { driver: Driver; isAr: boolean }) {
  const [record, setRecord] = useState<OffboardingRecord | null | undefined>(undefined)
  const [history, setHistory] = useState<OffboardingRecord[]>([])
  const [checks, setChecks] = useState<SystemCheck[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [form, setForm] = useState({ exitType: "resignation" as OffboardingExitType, reason: "", lastWorkingDay: today() })
  const [settle, setSettle] = useState({ amount: "", notes: "" })
  const [markTerminated, setMarkTerminated] = useState(true)
  const L = (en: string, ar: string) => (isAr ? ar : en)

  const fetchData = useCallback(async () => {
    const db = createClient()
    const [{ data }, c] = await Promise.all([
      db.from("driver_offboarding").select("*").eq("driver_id", driver.id).order("created_at", { ascending: false }).limit(10),
      loadChecks(driver.id),
    ])
    return { rows: (data ?? []) as OffboardingRecord[], checks: c }
  }, [driver.id])
  const apply = useCallback(({ rows, checks: c }: { rows: OffboardingRecord[]; checks: SystemCheck[] }) => {
    const open = rows.find((r) => r.status === "in_progress") ?? null
    setRecord(open ?? rows.find((r) => r.status === "completed") ?? null)
    setHistory(rows)
    setChecks(c)
    if (open) setSettle({ amount: open.settlement_amount === null ? "" : String(open.settlement_amount), notes: open.settlement_notes ?? "" })
  }, [])
  const refresh = useCallback(() => fetchData().then(apply), [fetchData, apply])
  useEffect(() => {
    let cancelled = false
    void fetchData().then((d) => { if (!cancelled) apply(d) })
    return () => { cancelled = true }
  }, [fetchData, apply])

  const manual = useMemo(() => OFFBOARDING_MANUAL_KEYS.map((key) => {
    const v = record?.checklist?.[key]
    return { key, done: !!v?.done, at: v?.at ?? null, note: v?.note ?? null }
  }), [record])
  const progress = clearanceProgress(manual, checks)

  async function run(tag: string, input: Record<string, unknown>) {
    setBusy(tag)
    const res = await saveDriverOffboarding({ driverId: driver.id, ...input })
    setBusy(null)
    if (!res.ok) { toast.error(isAr ? res.errorAr : res.error); return null }
    setRecord(res.record)
    return res.record
  }

  async function complete() {
    const rec = await run("complete", { action: "complete" })
    if (!rec) return
    if (markTerminated && driver.status !== "terminated" && driver.profile_version) {
      const exit = EXIT_TYPE_LABELS[rec.exit_type as OffboardingExitType] ?? EXIT_TYPE_LABELS.other
      const s = await setDriverStatus({ driverId: driver.id, expectedVersion: driver.profile_version, status: "terminated", reason: `${exit[0]}${rec.reason ? `: ${rec.reason}` : ""}`.slice(0, 500), terminationDate: rec.last_working_day ?? today() })
      if (!s.success) toast.error(L("Clearance completed, but the driver status could not be changed. Update it from the profile header.", "اكتملت المخالصة لكن تعذر تغيير حالة السائق. حدّثها من رأس الملف."))
    }
    toast.success(L(`Clearance completed · ${rec.clearance_ref}`, `اكتملت المخالصة · ${rec.clearance_ref}`))
    setCompleteOpen(false)
    emitDriverChanged("status")
    void refresh()
  }

  async function print(rec: OffboardingRecord) {
    const win = window.open("", "_blank")
    if (!win) { toast.error(L("Allow pop-ups to print.", "اسمح بالنوافذ المنبثقة للطباعة.")); return }
    try {
      const { data: tenant } = await createClient().from("tenants").select("name_ar, name_en").eq("id", driver.tenant_id).maybeSingle()
      await printDocument(win, buildClearanceCertificateHtml({
        company: (tenant?.name_en || tenant?.name_ar || "EliteDev") as string, ref: rec.clearance_ref,
        driver: { name: [driver.full_name_ar, driver.full_name_en].filter(Boolean).join(" · "), code: driver.driver_code, iqama: driver.iqama_number, nationality: driver.nationality, joinDate: driver.hire_date },
        exitType: rec.exit_type, reason: rec.reason, lastWorkingDay: rec.last_working_day, completedAt: rec.completed_at,
        settlementAmount: rec.settlement_amount === null ? null : Number(rec.settlement_amount), settlementNotes: rec.settlement_notes,
        systemChecks: checks,
        manual: OFFBOARDING_MANUAL_KEYS.map((key) => ({ key, done: !!rec.checklist?.[key]?.done, at: rec.checklist?.[key]?.at ?? null, note: rec.checklist?.[key]?.note ?? null })),
      }))
    } catch (e) { toast.error(e instanceof Error ? e.message : L("Could not print.", "تعذرت الطباعة.")) }
  }

  if (record === undefined) return <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>

  const inProgress = record?.status === "in_progress"
  const exitLabel = record ? (EXIT_TYPE_LABELS[record.exit_type as OffboardingExitType] ?? EXIT_TYPE_LABELS.other) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", record?.status === "completed" ? "bg-emerald-500/10 text-emerald-600" : inProgress ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground")}>
            {record?.status === "completed" ? <ShieldCheck className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="font-semibold">{L("Exit & clearance", "إنهاء الخدمة والمخالصة")}</h3>
            <p className="text-sm text-muted-foreground">
              {!record ? L("No exit process. Start one when the driver resigns, is terminated or leaves.", "لا يوجد إجراء إنهاء خدمة. ابدأ إجراءً عند استقالة السائق أو إنهاء خدمته.")
                : record.status === "completed" ? L(`Cleared on ${record.completed_at?.slice(0, 10)} · ${record.clearance_ref}`, `تمت المخالصة في ${record.completed_at?.slice(0, 10)} · ${record.clearance_ref}`)
                : L(`${exitLabel?.[0]} · last working day ${record.last_working_day ?? "—"}`, `${exitLabel?.[1]} · آخر يوم عمل ${record.last_working_day ?? "—"}`)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" />{L("Refresh", "تحديث")}</Button>
          {record && <Button variant="outline" size="sm" onClick={() => void print(record)}><Printer className="h-3.5 w-3.5" />{record.status === "completed" ? L("Clearance certificate", "شهادة المخالصة") : L("Print draft", "طباعة مسودة")}</Button>}
          {!inProgress && <Button size="sm" onClick={() => setStartOpen(true)}><LogOut className="h-3.5 w-3.5" />{L("Start exit process", "بدء إنهاء الخدمة")}</Button>}
        </div>
      </div>

      {inProgress && (
        <>
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">{L("Clearance progress", "تقدم المخالصة")}</span>
              <span className="tabular-nums text-muted-foreground">{progress.done}/{progress.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full transition-all", progress.ready ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border bg-card p-4">
              <h4 className="mb-3 text-sm font-semibold">{L("System checks (automatic)", "فحوصات النظام (تلقائية)")}</h4>
              <ul className="space-y-2">
                {checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 rounded-lg border p-2.5">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : c.blocking ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{isAr ? c.labelAr : c.label}{c.blocking && !c.ok && <span className="ms-2 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600">{L("Required", "إلزامي")}</span>}</div>
                      <div className="text-xs text-muted-foreground">{isAr ? c.detailAr : c.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border bg-card p-4">
              <h4 className="mb-3 text-sm font-semibold">{L("Clearance checklist", "بنود المخالصة")}</h4>
              <ul className="space-y-2">
                {manual.map((m) => {
                  const l = MANUAL_ITEM_LABELS[m.key]
                  return (
                    <li key={m.key}>
                      <button type="button" disabled={!!busy} onClick={() => void run(`check:${m.key}`, { action: "check", key: m.key, done: !m.done })}
                        className={cn("flex w-full items-start gap-2 rounded-lg border p-2.5 text-start transition-colors hover:bg-muted/60 disabled:opacity-60", m.done && "border-emerald-500/40 bg-emerald-500/5")}>
                        {busy === `check:${m.key}` ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : m.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{isAr ? l[1] : l[0]}</span>
                          <span className="block text-xs text-muted-foreground">{m.done && m.at ? `${L("Done", "تم")} · ${m.at.slice(0, 10)}` : isAr ? l[3] : l[2]}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>

          <section className="rounded-xl border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold">{L("Final settlement", "المخالصة المالية")}</h4>
            <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
              <label className="space-y-1 text-xs text-muted-foreground">{L("Net amount (SAR)", "صافي المبلغ (ر.س)")}
                <input type="number" step="0.01" dir="ltr" className={field} value={settle.amount} onChange={(e) => setSettle((s) => ({ ...s, amount: e.target.value }))} />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">{L("Notes (EOSB, last salary, deductions)", "ملاحظات (نهاية الخدمة، آخر راتب، الخصومات)")}
                <input className={field} maxLength={1000} value={settle.notes} onChange={(e) => setSettle((s) => ({ ...s, notes: e.target.value }))} />
              </label>
              <Button variant="outline" disabled={!!busy} onClick={() => void run("settle", { action: "update", settlementAmount: settle.amount === "" ? null : Number(settle.amount), settlementNotes: settle.notes }).then((r) => r && toast.success(L("Saved", "تم الحفظ")))}>
                {busy === "settle" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{L("Save", "حفظ")}
              </Button>
            </div>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={!!busy} onClick={() => void run("cancel", { action: "cancel" }).then((r) => { if (r) { toast.success(L("Exit process cancelled", "تم إلغاء إجراء إنهاء الخدمة")); void refresh() } })}>{L("Cancel process", "إلغاء الإجراء")}</Button>
            <Button disabled={!!busy || !progress.ready} onClick={() => setCompleteOpen(true)}><ShieldCheck className="h-4 w-4" />{L("Complete clearance", "إتمام المخالصة")}</Button>
          </div>
        </>
      )}

      {history.length > 1 && (
        <section className="rounded-xl border bg-card p-4">
          <h4 className="mb-2 text-sm font-semibold">{L("History", "السجل")}</h4>
          <ul className="divide-y text-sm">
            {history.map((h) => {
              const x = EXIT_TYPE_LABELS[h.exit_type as OffboardingExitType] ?? EXIT_TYPE_LABELS.other
              return <li key={h.id} className="flex items-center justify-between gap-2 py-2"><span>{isAr ? x[1] : x[0]} · {h.created_at.slice(0, 10)}</span><span className="text-muted-foreground">{h.clearance_ref ?? (h.status === "cancelled" ? L("Cancelled", "ملغى") : L("In progress", "قيد التنفيذ"))}</span></li>
            })}
          </ul>
        </section>
      )}

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{L("Start exit process", "بدء إنهاء الخدمة")}</DialogTitle>
            <DialogDescription>{L("Tracks vehicle return, platform accounts, settlement and government updates until the driver is cleared.", "يتابع استلام المركبة وحسابات المنصات والمخالصة والتحديثات الحكومية حتى إخلاء طرف السائق.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">{L("Exit type", "نوع الخروج")}
              <select className={field} value={form.exitType} onChange={(e) => setForm((f) => ({ ...f, exitType: e.target.value as OffboardingExitType }))}>
                {OFFBOARDING_EXIT_TYPES.map((t) => <option key={t} value={t}>{isAr ? EXIT_TYPE_LABELS[t][1] : EXIT_TYPE_LABELS[t][0]}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm">{L("Last working day", "آخر يوم عمل")}
              <input type="date" className={field} value={form.lastWorkingDay} onChange={(e) => setForm((f) => ({ ...f, lastWorkingDay: e.target.value }))} />
            </label>
            <label className="block space-y-1 text-sm">{L("Reason", "السبب")}
              <textarea className={cn(field, "h-20 py-2")} maxLength={500} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartOpen(false)}>{L("Cancel", "إلغاء")}</Button>
            <Button disabled={!!busy} onClick={() => void run("start", { action: "start", exitType: form.exitType, reason: form.reason, lastWorkingDay: form.lastWorkingDay || undefined }).then((r) => { if (r) { setStartOpen(false); void refresh() } })}>
              {busy === "start" && <Loader2 className="h-4 w-4 animate-spin" />}{L("Start", "بدء")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{L("Complete clearance", "إتمام المخالصة")}</DialogTitle>
            <DialogDescription>{L("A clearance reference is issued and the record is locked.", "يتم إصدار رقم مخالصة وقفل السجل.")}</DialogDescription>
          </DialogHeader>
          {driver.status !== "terminated" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={markTerminated} onChange={(e) => setMarkTerminated(e.target.checked)} />
              {L("Also set driver status to Terminated", "تغيير حالة السائق إلى منتهي الخدمة")}
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>{L("Back", "رجوع")}</Button>
            <Button disabled={!!busy} onClick={() => void complete()}>{busy === "complete" && <Loader2 className="h-4 w-4 animate-spin" />}{L("Complete", "إتمام")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
