"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, CheckCircle2, ClipboardCheck, Fuel, Gauge, ImagePlus, Loader2, PenLine, Pencil, Plus, Printer, ShieldAlert } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HANDOVER_CONDITIONS, HANDOVER_ITEMS, HandoverEditor, type HandoverRow } from "@/components/vehicles/fleet-history-panels"
import { SignaturePad } from "@/components/drivers/signature-pad"
import { attachHandoverEvidence } from "@/app/actions/drivers/handover-evidence"
import { buildHandoverReportHtml } from "@/lib/drivers/handover-report"
import { printDocument } from "@/lib/print-document"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import type { Driver } from "@/types/drivers"
import { useDriverPanelRead } from "@/hooks/use-driver-panel-read"
import { readDriverHandovers, readHandoverEvidenceUrls, type DriverHandoverForm as Form } from "@/lib/drivers/profile-operational-reads"

const BUCKET = "handover-evidence"
const MAX_PHOTO = 10 * 1024 * 1024

function issues(f: Form): number {
  return HANDOVER_CONDITIONS.filter(([k]) => f[k] && f[k] !== "ok").length + HANDOVER_ITEMS.filter(([k]) => f[k] === false).length
}

export function DriverHandoverTab({ driver, isAr }: { driver: Driver; isAr: boolean }) {
  return <HandoverTab key={driver.id} driver={driver} isAr={isAr} />
}

function HandoverTab({ driver, isAr }: { driver: Driver; isAr: boolean }) {
  const [editor, setEditor] = useState<{ row?: HandoverRow } | null>(null)
  const [signFor, setSignFor] = useState<Form | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchAll = useCallback((signal: AbortSignal) => readDriverHandovers(createClient(), driver.id, signal), [driver.id])
  const { data, error: loadError, reload } = useDriverPanelRead(fetchAll)
  const forms = data?.list ?? null
  const assignments = data?.assignments ?? []
  const thumbs = data?.urls ?? {}
  const scope = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    scope.current = controller
    return () => controller.abort()
  }, [])

  const uploadPhotos = async (form: Form, files: FileList) => {
    const currentScope = scope.current
    if (busy || !currentScope || currentScope.signal.aborted) return
    const list = Array.from(files).slice(0, 24 - (form.photos?.length ?? 0))
    if (!list.length) return void toast.error(isAr ? "تم بلوغ الحد الأقصى للصور" : "Photo limit reached")
    setBusy(form.id)
    try {
      const db = createClient()
      const paths: string[] = []
      for (const file of list) {
        if (!file.type.startsWith("image/") || file.size > MAX_PHOTO) { toast.error(isAr ? `تم تخطي ${file.name}: صورة حتى 10MB فقط` : `Skipped ${file.name}: images up to 10MB only`); continue }
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg"
        const path = `${form.tenant_id}/${form.id}/${crypto.randomUUID()}.${ext}`
        const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
        if (currentScope.signal.aborted) return
        if (error) { toast.error(isAr ? "فشل رفع صورة" : `Upload failed: ${error.message}`); continue }
        paths.push(path)
      }
      if (!paths.length) return
      const res = await attachHandoverEvidence({ formId: form.id, photos: paths })
      if (currentScope.signal.aborted) return
      if (!res.ok) return void toast.error(isAr ? res.errorAr : res.error)
      toast.success(isAr ? `تمت إضافة ${paths.length} صورة` : `${paths.length} photo(s) added`)
      reload()
    } catch { if (!currentScope.signal.aborted) toast.error(isAr ? "تعذر تأكيد إضافة الصور. أعد تحميل المحاضر قبل المحاولة مجدداً." : "Could not confirm the photos. Reload the reports before retrying.") }
    finally { if (!currentScope.signal.aborted) setBusy(null) }
  }

  const print = async (form: Form) => {
    const currentScope = scope.current
    if (!currentScope || currentScope.signal.aborted) return
    const win = window.open("", "_blank", "width=900,height=1100")
    if (!win) return void toast.error(isAr ? "اسمح بالنوافذ المنبثقة ثم أعد المحاولة." : "Allow popups and try again.")
    try {
      const db = createClient()
      const all = [...(form.photos ?? []), form.driver_signature_url, form.supervisor_signature_url].filter((p): p is string => !!p)
      const map = await readHandoverEvidenceUrls(db, all, currentScope.signal)
      const { data: tenant, error } = await db.from("tenants").select("name_ar, name_en").eq("id", form.tenant_id).abortSignal(currentScope.signal).maybeSingle()
      if (currentScope.signal.aborted) { win.close(); return }
      if (error || !tenant || !(tenant.name_en || tenant.name_ar)) throw new Error("Company details are unavailable")
      const v = form.vehicle_assignments?.vehicles ?? null
      await printDocument(win, buildHandoverReportHtml({
        company: (tenant.name_en || tenant.name_ar) as string,
        form,
        driver: { name: [driver.full_name_ar, driver.full_name_en].filter(Boolean).join(" · "), code: driver.driver_code ?? null, iqama: driver.iqama_number ?? null },
        vehicle: { plate: v?.plate_number ?? null, make: v?.make ?? null, model: v?.model ?? null, year: v?.year ?? null },
        conditions: HANDOVER_CONDITIONS, items: HANDOVER_ITEMS,
        photoUrls: (form.photos ?? []).map((p) => map[p]).filter((u): u is string => !!u),
        driverSignatureUrl: form.driver_signature_url ? map[form.driver_signature_url] ?? null : null,
        supervisorSignatureUrl: form.supervisor_signature_url ? map[form.supervisor_signature_url] ?? null : null,
      }))
    } catch { win.close(); if (!currentScope.signal.aborted) toast.error(isAr ? "تعذر تحميل المحضر ومرفقاته كاملة للطباعة. أعد المحاولة." : "Could not load the complete report and evidence for printing. Try again.") }
  }

  if (loadError) return <section className="space-y-3 rounded-lg border bg-card p-4" role="alert">
    <h3 className="text-sm font-semibold">{isAr ? "محاضر التسليم والاستلام" : "Handover & return reports"}</h3>
    <p className="text-sm text-muted-foreground">{isAr ? "تعذر تحميل المحاضر والتكليفات ومرفقاتها كاملة. أعد المحاولة." : "Could not load complete reports, assignments, and evidence. Try again."}</p>
    <Button variant="outline" size="sm" onClick={reload}>{isAr ? "أعد المحاولة" : "Retry"}</Button>
  </section>
  if (!forms) return <div className="space-y-3"><Skeleton className="h-32 w-full rounded-lg" /><Skeleton className="h-32 w-full rounded-lg" /></div>

  return (
    <div className="space-y-4" data-testid="driver-handover-tab">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-4 text-muted-foreground" />{isAr ? "محاضر التسليم والاستلام الرقمية" : "Digital handover & return reports"}</h3>
          <p className="text-xs text-muted-foreground">{isAr ? "فحص كامل للمركبة، صور، توقيع السائق والمشرف، وتقرير PDF جاهز للطباعة." : "Full vehicle inspection, photos, driver & supervisor signatures and a print-ready PDF report."}</p>
        </div>
        <Button disabled={!assignments.length} onClick={() => setEditor({})}><Plus className="me-1.5 size-4" />{isAr ? "محضر جديد" : "New inspection"}</Button>
      </div>

      {forms.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {assignments.length ? (isAr ? "لا توجد محاضر بعد. ابدأ بفحص التسليم." : "No reports yet. Start with the handover inspection.") : (isAr ? "عيّن مركبة للسائق أولاً." : "Assign a vehicle to this driver first.")}
        </div>
      ) : forms.map((f) => {
        const v = f.vehicle_assignments?.vehicles
        const n = issues(f)
        const signedBoth = !!f.driver_acknowledged_at && !!f.supervisor_acknowledged_at
        const editable = !f.finalized_at && !f.driver_acknowledged_at && !f.supervisor_acknowledged_at
        return (
          <article key={f.id} className="overflow-hidden rounded-lg border bg-card" data-testid="handover-report-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", f.form_type === "return" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300")}>{f.form_type === "return" ? (isAr ? "استلام" : "Return") : (isAr ? "تسليم" : "Handover")}</span>
                <span className="font-semibold tabular-nums">{f.form_date}</span>
                {v && <span className="text-sm text-muted-foreground">{[v.make, v.model, v.year].filter(Boolean).join(" ")}</span>}
                {v?.plate_number && <span className="rounded border-2 border-foreground/70 bg-white px-1.5 font-mono text-xs font-bold text-black" dir="ltr">{v.plate_number}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("rounded-full px-2 py-0.5 font-medium", f.driver_acknowledged_at ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{f.driver_acknowledged_at ? "✓ " : ""}{isAr ? "توقيع السائق" : "Driver signature"}</span>
                <span className={cn("rounded-full px-2 py-0.5 font-medium", f.supervisor_acknowledged_at ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{f.supervisor_acknowledged_at ? "✓ " : ""}{isAr ? "توقيع المشرف" : "Supervisor signature"}</span>
                <span className={cn("rounded-full px-2 py-0.5 font-medium", f.finalized_at ? "bg-slate-800 text-white" : "bg-amber-500/15 text-amber-700")}>{f.finalized_at ? (isAr ? "معتمد" : "Finalized") : (isAr ? "مسودة" : "Draft")}</span>
              </div>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat icon={Gauge} label={isAr ? "العداد" : "Odometer"} value={`${Number(f.odometer_reading).toLocaleString("en-US")} km`} />
                  <Stat icon={Fuel} label={isAr ? "الوقود" : "Fuel"} value={f.fuel_level ?? "—"} />
                  <Stat icon={n ? ShieldAlert : CheckCircle2} label={isAr ? "ملاحظات الفحص" : "Inspection issues"} value={n ? String(n) : (isAr ? "لا يوجد" : "None")} tone={n ? "text-amber-600" : "text-emerald-600"} />
                  <Stat icon={Camera} label={isAr ? "الصور" : "Photos"} value={String(f.photos?.length ?? 0)} />
                </div>
                {f.defects_noted && <p className="rounded-lg bg-muted/50 p-2 text-sm">{f.defects_noted}</p>}
                {(f.photos?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(f.photos ?? []).slice(0, 6).map((p) => thumbs[p] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a key={p} href={thumbs[p]} target="_blank" rel="noreferrer"><img src={thumbs[p]} alt="" className="size-16 rounded-lg border object-cover transition hover:scale-105" /></a>
                    ) : <div key={p} className="size-16 rounded-lg bg-muted" />)}
                    {(f.photos?.length ?? 0) > 6 && <div className="grid size-16 place-items-center rounded-lg border text-xs text-muted-foreground">+{(f.photos?.length ?? 0) - 6}</div>}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap content-start gap-2 lg:w-48 lg:flex-col">
                <Button size="sm" variant="outline" onClick={() => void print(f)}><Printer className="me-1.5 size-4" />{isAr ? "طباعة / PDF" : "Print / PDF"}</Button>
                {!signedBoth && <Button size="sm" variant="outline" onClick={() => setSignFor(f)}><PenLine className="me-1.5 size-4" />{isAr ? "توقيع" : "Sign"}</Button>}
                {!signedBoth && (
                  <label className={cn("inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted", busy === f.id && "pointer-events-none opacity-60")}>
                    {busy === f.id ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}{isAr ? "إضافة صور" : "Add photos"}
                    <input type="file" accept="image/*" multiple capture="environment" className="sr-only" onChange={(e) => { if (e.target.files?.length) void uploadPhotos(f, e.target.files); e.target.value = "" }} />
                  </label>
                )}
                {editable && <Button size="sm" variant="ghost" onClick={() => setEditor({ row: f })}><Pencil className="me-1.5 size-4" />{isAr ? "تعديل الفحص" : "Edit inspection"}</Button>}
              </div>
            </div>
          </article>
        )
      })}

      {editor && <HandoverEditor row={editor.row} assignments={assignments} ar={isAr} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void reload(); emitDriverChanged({ driverId: driver.id, action: "assignment" }) }} />}
      {signFor && <SignDialog form={signFor} isAr={isAr} driverName={driver.full_name_ar ?? ""} onClose={() => setSignFor(null)} onSigned={() => { setSignFor(null); void reload() }} />}
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; tone?: string }) {
  return <div className="rounded-md border p-2.5"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</p><p className={cn("mt-0.5 font-semibold tabular-nums", tone)}>{value}</p></div>
}

function SignDialog({ form, isAr, driverName, onClose, onSigned }: { form: Form; isAr: boolean; driverName: string; onClose: () => void; onSigned: () => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [signer, setSigner] = useState<"driver" | "supervisor">(form.driver_acknowledged_at ? "supervisor" : "driver")
  const [ink, setInk] = useState(false)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const c = canvas.current
    if (!c || !ink || !agree) return
    setBusy(true)
    try {
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"))
      if (!blob) throw new Error("Signature capture failed")
      const path = `${form.tenant_id}/${form.id}/signature-${signer}-${crypto.randomUUID()}.png`
      const { error } = await createClient().storage.from(BUCKET).upload(path, blob, { contentType: "image/png", upsert: false })
      if (error) throw new Error(error.message)
      const res = await attachHandoverEvidence({ formId: form.id, signer, signaturePath: path })
      if (!res.ok) return void toast.error(isAr ? res.errorAr : res.error)
      toast.success(isAr ? "تم حفظ التوقيع" : "Signature saved")
      onSigned()
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isAr ? "توقيع المحضر" : "Sign the report"}</DialogTitle>
          <DialogDescription>{isAr ? "بعد التوقيع يُعتمد المحضر ولا يمكن تعديل الفحص." : "Signing finalizes the inspection; it can no longer be edited."}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["driver", "supervisor"] as const).map((s) => {
            const done = s === "driver" ? !!form.driver_acknowledged_at : !!form.supervisor_acknowledged_at
            return <button key={s} type="button" disabled={done} onClick={() => setSigner(s)} aria-pressed={signer === s}
              className={cn("rounded-xl border p-3 text-start text-sm transition disabled:opacity-50", signer === s && !done ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "hover:bg-muted")}>
              <span className="block font-semibold">{s === "driver" ? (isAr ? "السائق" : "Driver") : (isAr ? "المشرف" : "Supervisor")}</span>
              <span className="text-xs text-muted-foreground">{done ? (isAr ? "تم التوقيع" : "Signed") : s === "driver" ? driverName : (isAr ? "المستخدم الحالي" : "Current user")}</span>
            </button>
          })}
        </div>
        <SignaturePad canvasRef={canvas} onChange={setInk} label={isAr ? "وقّع هنا" : "Sign here"} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          {signer === "driver" ? (isAr ? "أقر بأنني استلمت/سلمت المركبة بالحالة الموضحة في المحضر." : "I confirm the vehicle condition recorded in this report.") : (isAr ? "أعتمد الفحص كمشرف." : "I approve this inspection as supervisor.")}
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button disabled={busy || !ink || !agree} onClick={() => void submit()}>{busy && <Loader2 className="me-2 size-4 animate-spin" />}{isAr ? "حفظ التوقيع" : "Save signature"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
