"use client"

import { useCallback, useMemo, useState } from "react"
import { CheckCircle2, CircleAlert, CircleDashed, Clock, ExternalLink, Landmark, Loader2, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { recordGovernmentCheck } from "@/app/actions/drivers/government-checks"
import { addDays, GOV_CHECK_TYPES, GOV_CHECKS, summarizeGovChecks, type GovCheckState, type GovCheckType } from "@/lib/drivers/government-checks"
import { useDriverPanelRead } from "@/hooks/use-driver-panel-read"
import { readLatestGovernmentChecks } from "@/lib/drivers/profile-operational-reads"

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })
const field = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
const STATE: Record<GovCheckState, { en: string; ar: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok: { en: "Verified", ar: "تم التحقق", cls: "text-emerald-600 bg-emerald-500/10", Icon: CheckCircle2 },
  issue: { en: "Issue found", ar: "توجد ملاحظة", cls: "text-red-600 bg-red-500/10", Icon: CircleAlert },
  pending: { en: "Pending", ar: "قيد المتابعة", cls: "text-amber-700 bg-amber-500/10", Icon: Clock },
  due: { en: "Re-check due", ar: "مستحق إعادة الفحص", cls: "text-amber-700 bg-amber-500/10", Icon: Clock },
  never: { en: "Not checked", ar: "لم يُفحص", cls: "text-muted-foreground bg-muted", Icon: CircleDashed },
}

export function DriverGovernmentChecks({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  return <GovernmentChecks key={driverId} driverId={driverId} isAr={isAr} />
}

function GovernmentChecks({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const L = (en: string, ar: string) => (isAr ? ar : en)
  const [open, setOpen] = useState<GovCheckType | null>(null)
  const [form, setForm] = useState({ result: "ok" as "ok" | "issue" | "pending", reference: "", notes: "", checkedOn: today(), nextDueOn: "" })
  const [busy, setBusy] = useState(false)

  const fetchRows = useCallback((signal: AbortSignal) => readLatestGovernmentChecks(createClient(), driverId, signal), [driverId])
  const { data: rows, error, reload } = useDriverPanelRead(fetchRows)
  const summary = useMemo(() => summarizeGovChecks(rows ?? [], today()), [rows])

  function start(t: GovCheckType) {
    const d = today()
    setForm({ result: "ok", reference: "", notes: "", checkedOn: d, nextDueOn: addDays(d, GOV_CHECKS[t].cadenceDays) })
    setOpen(t)
  }
  async function save() {
    if (!open || busy) return
    setBusy(true)
    try {
      const r = await recordGovernmentCheck({ driverId, checkType: open, result: form.result, reference: form.reference || undefined, notes: form.notes || undefined, checkedOn: form.checkedOn, nextDueOn: form.nextDueOn || undefined })
      if (!r.ok) { toast.error(isAr ? r.errorAr : r.error); return }
      toast.success(L("Check recorded", "تم تسجيل الفحص"))
      setOpen(null)
      reload()
    } catch { toast.error(L("Could not confirm the check. Reload before retrying.", "تعذر تأكيد حفظ الفحص. أعد التحميل قبل المحاولة مجدداً.")) }
    finally { setBusy(false) }
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold">{L("Government checks", "الفحوصات الحكومية")}</h3>
          <p className="text-xs text-muted-foreground">{L("Verify on the official portal, then record the result here. Direct API integration needs official contracts (Elm, GOSI, HRSD).", "تحقق عبر البوابة الرسمية ثم سجّل النتيجة هنا. الربط المباشر يتطلب عقوداً رسمية (علم، التأمينات، الموارد البشرية).")}</p>
        </div>
      </div>
      {error ? <div className="space-y-3 rounded-md border p-4" role="alert">
        <p className="text-sm text-muted-foreground">{L("Could not load the latest government checks. Retry to review their status.", "تعذر تحميل أحدث الفحوصات الحكومية. أعد المحاولة لمراجعة حالتها.")}</p>
        <Button variant="outline" size="sm" onClick={reload}>{L("Retry", "أعد المحاولة")}</Button>
      </div> : rows === null ? <div className="h-24 animate-pulse rounded-lg bg-muted" /> : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {GOV_CHECK_TYPES.map((t) => {
            const c = GOV_CHECKS[t], s = summary[t], st = STATE[s.state]
            return (
              <div key={t} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{isAr ? c.ar : c.en}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? c.whatAr : c.what}</p>
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}><st.Icon className="h-3 w-3" />{isAr ? st.ar : st.en}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.last ? `${L("Last", "آخر فحص")} ${s.last.checked_on}${s.last.reference ? ` · ${s.last.reference}` : ""} · ${L("next", "التالي")} ${s.dueOn}` : L("No record yet", "لا يوجد سجل")}
                </p>
                {s.last?.notes && <p className="line-clamp-2 text-xs">{s.last.notes}</p>}
                <div className="mt-auto flex gap-2">
                  <Button size="sm" variant="outline" asChild><a href={c.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />{L("Open portal", "فتح البوابة")}</a></Button>
                  <Button size="sm" variant="outline" onClick={() => start(t)}><Plus className="h-3.5 w-3.5" />{L("Record", "تسجيل")}</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && !busy && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open ? `${L("Record check", "تسجيل فحص")} · ${isAr ? GOV_CHECKS[open].ar : GOV_CHECKS[open].en}` : ""}</DialogTitle>
            <DialogDescription>{open ? (isAr ? GOV_CHECKS[open].whatAr : GOV_CHECKS[open].what) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(["ok", "issue", "pending"] as const).map((r) => (
                <button key={r} type="button" disabled={busy} aria-pressed={form.result === r} onClick={() => setForm((f) => ({ ...f, result: r }))}
                  className={cn("rounded-lg border px-2 py-2 text-xs font-medium", form.result === r ? STATE[r].cls + " border-current" : "hover:bg-muted")}>
                  {isAr ? STATE[r].ar : STATE[r].en}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">{L("Checked on", "تاريخ الفحص")}<input type="date" className={field} max={today()} value={form.checkedOn} onChange={(e) => setForm((f) => ({ ...f, checkedOn: e.target.value }))} /></label>
              <label className="space-y-1 text-xs text-muted-foreground">{L("Next check", "الفحص القادم")}<input type="date" className={field} value={form.nextDueOn} onChange={(e) => setForm((f) => ({ ...f, nextDueOn: e.target.value }))} /></label>
            </div>
            <input className={field} placeholder={L("Reference / transaction no. (optional)", "رقم المرجع / العملية (اختياري)")} maxLength={100} value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
            <textarea className={cn(field, "h-20 py-2")} placeholder={L("Notes", "ملاحظات")} maxLength={1000} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(null)}>{L("Cancel", "إلغاء")}</Button>
            <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{L("Save", "حفظ")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
