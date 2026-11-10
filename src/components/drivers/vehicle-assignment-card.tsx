"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { CalendarClock, Car, ClipboardCheck, ExternalLink, FileText, Fuel, KeyRound, Loader2, Palette, ShieldCheck, Undo2, Upload, Wrench } from "lucide-react"
import { fetchFleetRows } from "@/lib/vehicles/query-pages"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { assignVehicleToDriver, unassignVehicleFromDriver } from "@/lib/vehicles/assignments"
import { getVehicleDocumentUrl } from "@/lib/vehicles/actions"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DocumentUploadDialog } from "@/components/drivers/document-upload-dialog"
import { emitDriverChanged, subscribeDriverChanged } from "@/lib/drivers/driver-events"

type VehicleFull = {
  id: string; vehicle_code: string | null; plate_number: string | null; plate_type: string | null; make: string | null; model: string | null; year: number | null; color: string | null
  vin: string | null; chassis_number: string | null; fuel_type: string | null; transmission: string | null; odometer_current: number | null; odometer_unit: string | null; odometer_last_service: number | null
  ownership_type: string | null; rental_company: string | null; rental_contract_end: string | null; insurance_provider: string | null; insurance_policy_number: string | null
  insurance_expiry: string | null; registration_expiry: string | null; inspection_expiry: string | null; operating_card_expiry: string | null; status: string | null; condition_status: string | null; sequence_number: string | null
}
type CurrentAssignment = { version: number; id: string; vehicle_id: string; assigned_at: string | null; assignment_reason: string | null; handover_odometer: number | null; handover_condition: string | null; notes: string | null; vehicles: VehicleFull | null }
type VehicleOption = { id: string; vehicle_code: string | null; plate_number: string | null; make: string | null; model: string | null; year: number | null; odometer_current: number | null }
type VehicleDoc = { id: string; doc_type: string; doc_number: string | null; expiry_date: string | null }

const VEHICLE_COLS = "id, vehicle_code, plate_number, plate_type, make, model, year, color, vin, chassis_number, fuel_type, transmission, odometer_current, odometer_unit, odometer_last_service, ownership_type, rental_company, rental_contract_end, insurance_provider, insurance_policy_number, insurance_expiry, registration_expiry, inspection_expiry, operating_card_expiry, status, condition_status, sequence_number"
const human = (v: string | null | undefined) => (v ? v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—")
const riyadhToday = () => new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()) + "T00:00:00Z").getTime()
const daysTo = (d: string | null) => (d ? Math.round((new Date(d.slice(0, 10) + "T00:00:00Z").getTime() - riyadhToday()) / 86400000) : null)
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"))

function SaudiPlate({ plate }: { plate: string | null }) {
  const raw = (plate ?? "").trim()
  const digits = raw.replace(/[^0-9٠-٩]/g, "")
  const letters = raw.replace(/[0-9٠-٩\s-]/g, "")
  return (
    <div dir="ltr" className="inline-flex h-14 overflow-hidden rounded-lg border-2 border-slate-800 bg-white text-slate-900 shadow-sm dark:border-slate-300" aria-label={`Plate ${raw}`}>
      <div className="flex flex-col items-center justify-center px-3 font-mono text-xl font-bold tracking-widest">{digits || raw || "—"}</div>
      {letters && <div className="flex items-center justify-center border-s-2 border-slate-800 px-3 font-mono text-xl font-bold tracking-widest dark:border-slate-300">{letters}</div>}
      <div className="flex w-8 flex-col items-center justify-center bg-elite-blue-600 text-[8px] font-bold leading-tight text-white"><span>KSA</span><span>السعودية</span></div>
    </div>
  )
}

function ExpiryPill({ label, date, icon: Icon, isAr }: { label: string; date: string | null; icon: LucideIcon; isAr: boolean }) {
  const d = daysTo(date)
  const tone = d == null ? "border-border/60 bg-muted/40 text-muted-foreground" : d < 0 ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400" : d <= 30 ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2", tone)}>
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium opacity-80">{label}</p>
        <p className="truncate text-xs font-semibold tabular-nums">{date ? date.slice(0, 10) : (isAr ? "غير مسجل" : "Not recorded")}{d != null && <span className="ms-1 font-normal opacity-80">({d < 0 ? (isAr ? `منتهي ${-d} يوم` : `expired ${-d}d`) : isAr ? `${d} يوم` : `${d}d`})</span>}</p>
      </div>
    </div>
  )
}

function Spec({ icon: Icon, label, value, ltr }: { icon: LucideIcon; label: string; value: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0"><p className="text-[10.5px] text-muted-foreground">{label}</p><p className="truncate text-xs font-semibold" dir={ltr ? "ltr" : undefined}>{value}</p></div>
    </div>
  )
}

/** Assigned vehicle panel on the driver profile: full vehicle file, expiries, documents, handover & return. */
export function VehicleAssignmentCard({ driverId, isAr, driverVersion, onOpenTab }: { driverId: string; isAr: boolean; driverVersion?: number; onOpenTab?: (tab: string) => void }) {
  const [assignment, setAssignment] = useState<CurrentAssignment | null>(null)
  const [docs, setDocs] = useState<VehicleDoc[]>([])
  const [forms, setForms] = useState<{ count: number; last: string | null }>({ count: 0, last: null })
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState<string | null>(null)
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [vehicleId, setVehicleId] = useState("")
  const [reason, setReason] = useState("")
  const [odometer, setOdometer] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [loadedAt, setLoadedAt] = useState(0)

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    const db = createClient()
    const { data, error } = await db.from("vehicle_assignments")
      .select(`id, version, vehicle_id, assigned_at, assignment_reason, handover_odometer, handover_condition, notes, vehicles(${VEHICLE_COLS})`)
      .eq("driver_id", driverId).eq("is_current", true).is("deleted_at", null)
      .order("assigned_at", { ascending: false }).limit(1).maybeSingle()
    setLoadError(!!error)
    setLoadedAt(Date.now())
    const a = (data as CurrentAssignment | null) ?? null
    setAssignment(a)
    if (a?.vehicle_id) {
      const [d, f] = await Promise.all([
        db.from("vehicle_documents").select("id, doc_type, doc_number, expiry_date").eq("vehicle_id", a.vehicle_id).eq("is_active", true).is("deleted_at", null).order("created_at", { ascending: false }).limit(12),
        db.from("vehicle_handover_forms").select("form_date", { count: "exact" }).eq("assignment_id", a.id).is("deleted_at", null).order("form_date", { ascending: false }).limit(1),
      ])
      setDocs((d.data ?? []) as VehicleDoc[])
      setForms({ count: f.count ?? 0, last: (f.data?.[0] as { form_date?: string } | undefined)?.form_date ?? null })
    } else { setDocs([]); setForms({ count: 0, last: null }) }
    setIsLoading(false)
  }, [driverId])

  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id) }, [load])
  useEffect(() => subscribeDriverChanged((d) => { if (d.driverId === driverId && d.action === "assignment") void load(true) }), [driverId, load])

  const openAssign = async () => {
    setVehicleId(""); setReason(""); setOdometer(""); setNotes(""); setAssignOpen(true)
    const { data, error } = await fetchFleetRows<VehicleOption>(() => createClient().from("vehicles")
      .select("id, vehicle_code, plate_number, make, model, year, odometer_current").eq("status", "available").is("deleted_at", null)
      .order("vehicle_code", { ascending: true }).order("id"))
    if (error) return toast.error(isAr ? "تعذر تحميل المركبات المتاحة." : "Could not load available vehicles.")
    setVehicles((data as VehicleOption[]) ?? [])
  }

  const odoValue = () => { const n = odometer.trim() ? Number(odometer) : null; return n != null && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null }

  const assign = async () => {
    if (saving || !vehicleId) return
    setSaving(true)
    const res = await assignVehicleToDriver({ vehicleId, driverId, assignment_reason: reason.trim() || null, handover_odometer: odoValue(), notes: notes.trim() || null })
    setSaving(false)
    if (!res.success) return void toast.error(res.error ?? (isAr ? "فشل تعيين المركبة" : "Failed to assign vehicle"))
    toast.success(isAr ? "تم تسليم المركبة للسائق" : "Vehicle handed over to the driver")
    setAssignOpen(false); await load(); emitDriverChanged({ driverId, action: "assignment" })
  }

  const doReturn = async () => {
    if (saving || !assignment) return
    setSaving(true)
    const res = await unassignVehicleFromDriver({ expectedVersion: assignment.version, vehicleId: assignment.vehicle_id, driverId, return_odometer: odoValue(), notes: notes.trim() || null })
    setSaving(false)
    if (!res.success) return void toast.error(res.error ?? (isAr ? "فشل استلام المركبة" : "Failed to return vehicle"))
    toast.success(isAr ? "تم استلام المركبة من السائق" : "Vehicle returned")
    setReturnOpen(false); await load(); emitDriverChanged({ driverId, action: "assignment" })
  }

  const viewDoc = async (id: string) => {
    const r = await getVehicleDocumentUrl(id)
    if (!r.success || !r.url) return void toast.error(r.error ?? (isAr ? "تعذر فتح المستند" : "Could not open document"))
    window.open(r.url, "_blank", "noopener,noreferrer")
  }

  if (loadError) return <div role="alert" className="rounded-2xl border p-4 lg:col-span-2"><p className="text-sm">{isAr ? "تعذر تحميل المركبة. أعد المحاولة." : "Could not load the vehicle. Try again."}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>{isAr ? "أعد المحاولة" : "Try again"}</Button></div>
  if (isLoading) return <Skeleton className="h-72 rounded-2xl lg:col-span-2" />

  const v = assignment?.vehicles
  const since = assignment?.assigned_at ? Math.max(0, Math.round((loadedAt - new Date(assignment.assigned_at).getTime()) / 86400000)) : null
  const driven = v?.odometer_current != null && assignment?.handover_odometer != null ? Math.max(0, v.odometer_current - assignment.handover_odometer) : null
  const unit = v?.odometer_unit || "km"

  return (
    <section data-testid="driver-vehicle-panel" className="relative overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm lg:col-span-2">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-r from-amber-500/15 via-elite-blue-500/10 to-transparent" />
      <div className="relative p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold"><Car className="size-4 text-elite-blue-500" />{isAr ? "المركبة المسلّمة للسائق" : "Assigned vehicle"}</h3>
          <div className="flex flex-wrap gap-2">
            {onOpenTab && <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => onOpenTab("assignments")}><CalendarClock className="size-3.5" />{isAr ? "سجل التعيينات" : "Assignment history"}</Button>}
            {assignment && v ? (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setOdometer(v.odometer_current != null ? String(v.odometer_current) : ""); setNotes(""); setReturnOpen(true) }}><Undo2 className="size-3.5" />{isAr ? "استلام المركبة" : "Return vehicle"}</Button>
            ) : (
              <Button size="sm" className="h-8 gap-1.5" onClick={() => void openAssign()}><KeyRound className="size-3.5" />{isAr ? "تسليم مركبة" : "Assign vehicle"}</Button>
            )}
          </div>
        </div>

        {assignment && v ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-5">
              <SaudiPlate plate={v.plate_number} />
              <div className="min-w-0">
                <p className="text-lg font-bold leading-tight">{[v.make, v.model].filter(Boolean).join(" ") || "—"} {v.year && <span className="text-muted-foreground">{v.year}</span>}</p>
                <p className="text-xs text-muted-foreground">
                  {v.vehicle_code && <span className="me-2 font-mono">{v.vehicle_code}</span>}
                  {human(v.status)} · {human(v.condition_status)}
                  {since != null && <> · {isAr ? `مع السائق منذ ${since} يوم` : `with driver for ${since} days`}</>}
                </p>
                <Link href={`/vehicles/${v.id}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-400">
                  {isAr ? "فتح ملف المركبة" : "Open vehicle file"}<ExternalLink className="size-3" />
                </Link>
              </div>
              <div className="ms-auto grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2"><p className="text-[10.5px] text-muted-foreground">{isAr ? "العداد الحالي" : "Odometer"}</p><p className="text-sm font-bold tabular-nums" dir="ltr">{num(v.odometer_current)} {unit}</p></div>
                <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2"><p className="text-[10.5px] text-muted-foreground">{isAr ? "عند التسليم" : "At handover"}</p><p className="text-sm font-bold tabular-nums" dir="ltr">{num(assignment.handover_odometer)} {unit}</p></div>
                <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2"><p className="text-[10.5px] text-muted-foreground">{isAr ? "المقطوع" : "Driven"}</p><p className="text-sm font-bold tabular-nums" dir="ltr">{num(driven)} {unit}</p></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border/50 bg-background/60 p-3 sm:grid-cols-3 lg:grid-cols-6">
              <Spec icon={Palette} label={isAr ? "اللون" : "Colour"} value={v.color || "—"} />
              <Spec icon={Fuel} label={isAr ? "الوقود / القير" : "Fuel / gearbox"} value={`${human(v.fuel_type)} · ${human(v.transmission)}`} />
              <Spec icon={FileText} label="VIN" value={v.vin || v.chassis_number || "—"} ltr />
              <Spec icon={FileText} label={isAr ? "الرقم التسلسلي" : "Sequence no."} value={v.sequence_number || "—"} ltr />
              <Spec icon={KeyRound} label={isAr ? "الملكية" : "Ownership"} value={v.ownership_type === "rented" || v.rental_company ? `${human(v.ownership_type)}${v.rental_company ? ` · ${v.rental_company}` : ""}` : human(v.ownership_type)} />
              <Spec icon={Wrench} label={isAr ? "آخر صيانة (عداد)" : "Last service (km)"} value={num(v.odometer_last_service)} ltr />
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <ExpiryPill icon={ShieldCheck} isAr={isAr} label={`${isAr ? "التأمين" : "Insurance"}${v.insurance_provider ? ` · ${v.insurance_provider}` : ""}`} date={v.insurance_expiry} />
              <ExpiryPill icon={FileText} isAr={isAr} label={isAr ? "الاستمارة" : "Registration (Istimara)"} date={v.registration_expiry} />
              <ExpiryPill icon={ClipboardCheck} isAr={isAr} label={isAr ? "الفحص الدوري" : "Periodic inspection (MVPI)"} date={v.inspection_expiry} />
              <ExpiryPill icon={CalendarClock} isAr={isAr} label={v.rental_contract_end ? (isAr ? "نهاية عقد الإيجار" : "Rental contract end") : (isAr ? "بطاقة التشغيل" : "Operating card")} date={v.rental_contract_end ?? v.operating_card_expiry} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border/50 p-3">
                <p className="mb-2 flex items-center justify-between text-xs font-semibold">{isAr ? "مستندات المركبة" : "Vehicle documents"}<span className="font-normal text-muted-foreground">{docs.length}</span></p>
                {docs.length === 0 ? <p className="text-xs text-muted-foreground">{isAr ? "لا توجد مستندات مرفوعة لهذه المركبة." : "No documents uploaded for this vehicle yet."}</p> : (
                  <ul className="space-y-1.5">{docs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{human(d.doc_type)}{d.doc_number && <span className="ms-1 font-mono text-muted-foreground" dir="ltr">{d.doc_number}</span>}</span>
                      <span className="flex shrink-0 items-center gap-2">{d.expiry_date && <span className="tabular-nums text-muted-foreground">{d.expiry_date}</span>}<button type="button" className="font-medium text-elite-blue-600 hover:underline" onClick={() => void viewDoc(d.id)}>{isAr ? "عرض" : "View"}</button></span>
                    </li>))}
                  </ul>)}
              </div>
              <div className="rounded-xl border border-border/50 p-3">
                <p className="mb-1 text-xs font-semibold">{isAr ? "تقارير التسليم والاستلام" : "Handover & return reports"}</p>
                <p className="text-xs text-muted-foreground">{isAr ? `نماذج الفحص: ${forms.count}` : `Inspection forms: ${forms.count}`}{forms.last && ` · ${isAr ? "آخر نموذج" : "last"} ${forms.last}`}{assignment.handover_condition && ` · ${human(assignment.handover_condition)}`}</p>
                {assignment.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{assignment.notes}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!!driverVersion && <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setReportOpen("vehicle_handover_report")}><Upload className="size-3" />{isAr ? "رفع تقرير التسليم" : "Upload handover report"}</Button>}
                  {!!driverVersion && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setReportOpen("accident_report")}><Upload className="size-3" />{isAr ? "تقرير حادث" : "Accident report"}</Button>}
                  {onOpenTab && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpenTab("handover")}>{isAr ? "نماذج الفحص" : "Inspection forms"}</Button>}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-elite-blue-500/10 text-elite-blue-600"><Car className="size-6" /></span>
            <div><p className="text-sm font-semibold">{isAr ? "لا توجد مركبة مسلّمة لهذا السائق" : "No vehicle assigned to this driver"}</p>
              <p className="text-xs text-muted-foreground">{isAr ? "سلّم مركبة متاحة مع قراءة العداد، ثم ارفع تقرير التسليم." : "Hand over an available vehicle with its odometer reading, then upload the handover report."}</p></div>
            <Button size="sm" className="gap-1.5" onClick={() => void openAssign()}><KeyRound className="size-3.5" />{isAr ? "تسليم مركبة" : "Assign vehicle"}</Button>
          </div>
        )}
      </div>

      <Dialog open={assignOpen} onOpenChange={(o) => { if (!saving) setAssignOpen(o) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "تسليم مركبة للسائق" : "Assign a vehicle"}</DialogTitle>
            <DialogDescription>{isAr ? "اختر مركبة متاحة وسجّل قراءة العداد عند التسليم." : "Pick an available vehicle and record the odometer at handover."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assign-vehicle">{isAr ? "المركبة" : "Vehicle"}</Label>
              <SearchableSelect id="assign-vehicle" value={vehicleId} allowClear={false}
                onChange={(id) => { setVehicleId(id); const o = vehicles.find((x) => x.id === id); if (o?.odometer_current != null) setOdometer(String(o.odometer_current)) }}
                options={vehicles.map((o) => ({ value: o.id, label: `${[o.make, o.model, o.year].filter(Boolean).join(" ")}${o.plate_number ? ` · ${o.plate_number}` : ""}`, keywords: [o.vehicle_code ?? "", o.plate_number ?? ""], hint: o.vehicle_code ?? undefined }))}
                placeholder={vehicles.length ? (isAr ? "اختر مركبة" : "Select vehicle") : (isAr ? "لا توجد مركبات متاحة" : "No available vehicles")}
                searchPlaceholder={isAr ? "ابحث باللوحة أو الطراز…" : "Search plate, code or model…"} emptyText={isAr ? "لا نتائج" : "No results"} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="assign-odometer">{isAr ? "العداد عند التسليم" : "Handover odometer"}</Label><Input id="assign-odometer" inputMode="numeric" dir="ltr" value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ""))} /></div>
              <div className="space-y-2"><Label htmlFor="assign-reason">{isAr ? "السبب (اختياري)" : "Reason (optional)"}</Label><Input id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isAr ? "تعيين تشغيلي" : "Operational"} /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="assign-notes">{isAr ? "ملاحظات الحالة" : "Condition notes"}</Label><Textarea id="assign-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={saving}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => void assign()} disabled={saving || !vehicleId}>{saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{isAr ? "تسليم" : "Assign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={(o) => { if (!saving) setReturnOpen(o) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "استلام المركبة من السائق" : "Return vehicle"}</DialogTitle>
            <DialogDescription>{isAr ? "سجّل قراءة العداد عند الاستلام وأي ملاحظات. ارفع تقرير الاستلام بعدها." : "Record the return odometer and any notes. Upload the return report afterwards."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="return-odometer">{isAr ? "العداد عند الاستلام" : "Return odometer"}</Label><Input id="return-odometer" inputMode="numeric" dir="ltr" value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ""))} /></div>
            <div className="space-y-2"><Label htmlFor="return-notes">{isAr ? "ملاحظات" : "Notes"}</Label><Textarea id="return-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(false)} disabled={saving}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => void doReturn()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}{isAr ? "تأكيد الاستلام" : "Confirm return"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {driverVersion ? (
        <DocumentUploadDialog open={!!reportOpen} onOpenChange={(o) => { if (!o) setReportOpen(null) }} driverId={driverId} expectedDriverVersion={driverVersion} defaultDocType={reportOpen} isAr={isAr} onUploaded={() => setReportOpen(null)} />
      ) : null}
    </section>
  )
}
