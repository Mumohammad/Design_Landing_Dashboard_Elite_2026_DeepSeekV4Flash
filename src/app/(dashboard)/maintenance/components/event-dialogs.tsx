"use client"

// Maintenance event create/edit/complete/cancel dialogs (Prompt O Part 1).
// Composes the vehicle picker (tenant vehicles), the latest odometer reading
// from vehicle_odometer_logs, and the maintenance server actions.

import { LocalizedText } from "@/components/localized-text"
import { useMemo, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { SuffixInput } from "@/components/forms/form-kit"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  createMaintenanceEvent,
  updateMaintenanceEvent,
  completeMaintenanceEvent,
  cancelMaintenanceEvent,
  archiveMaintenanceEvent,
} from "@/lib/maintenance/actions"
import { Loader2 } from "lucide-react"

export interface VehicleOption {
  id: string
  plate_number: string | null
  make: string | null
  model: string | null
  odometer_current: number | null
}

export interface DriverOption {
  id: string
  full_name_ar: string | null
  full_name_en: string | null
}

export interface MaintenanceEventRow {
  version: number
  id: string
  vehicle_id: string
  maintenance_type: string
  status: string
  reported_at: string | null
  fault_description: string | null
  provider: string | null
  cost: number | null
  parts_replaced: string | null
  odometer_at_service: number | null
  date_in: string | null
  date_out: string | null
  next_service_km: number | null
  next_service_date: string | null
  notes: string | null
  vehicle: { plate_number: string | null; make: string | null; model: string | null } | null
  driver: { full_name_ar: string | null; full_name_en: string | null } | null
}

type DialogKind = "create" | "edit" | "complete" | "cancel" | "archive" | null

type MaintenanceType = "preventive" | "emergency" | "periodic" | "repair"

function vehicleLabel(v: VehicleOption, isAr: boolean): string {
  const name = isAr ? `${v.make ?? ""} ${v.model ?? ""}`.trim() : `${v.make ?? ""} ${v.model ?? ""}`.trim()
  return `${v.plate_number ?? "—"} · ${name || (isAr ? "مركبة" : "Vehicle")}`
}

type EventDialogsProps = {
  kind: DialogKind
  event: MaintenanceEventRow | null
  vehicles: VehicleOption[]
  drivers: DriverOption[]
  defaultOdometer: number | null
  onClose: () => void
  onDone: (msg: string | null) => void
}

export function EventDialogs(props: EventDialogsProps) {
  if (props.kind === null) return null
  return <EventDialogForm key={JSON.stringify([props.kind, props.event])} {...props} />
}

function EventDialogForm({
  kind,
  event,
  vehicles,
  drivers,
  defaultOdometer,
  onClose,
  onDone,
}: EventDialogsProps) {
  const { t } = useTranslation()
  const m = t.maintenanceModule
  const vm = t.vehicles
  const isAr = t.common.status === "الحالة"

  // create/edit form state
  const [vehicleId, setVehicleId] = useState(kind === "create" ? "" : event?.vehicle_id ?? "")
  const [driverId, setDriverId] = useState("")
  const [type, setType] = useState<MaintenanceType>(kind === "create" ? "preventive" : (event?.maintenance_type as MaintenanceType) ?? "preventive")
  const [fault, setFault] = useState(kind === "create" ? "" : event?.fault_description ?? "")
  const [provider, setProvider] = useState(kind === "create" ? "" : event?.provider ?? "")
  const [cost, setCost] = useState(kind !== "create" && event?.cost != null ? String(event.cost) : "")
  const [parts, setParts] = useState(kind === "create" ? "" : event?.parts_replaced ?? "")
  const [odometer, setOdometer] = useState(kind === "complete" ? String(event?.odometer_at_service ?? defaultOdometer ?? "") : "")
  const [nextKm, setNextKm] = useState(kind !== "create" && event?.next_service_km != null ? String(event.next_service_km) : "")
  const [nextDate, setNextDate] = useState(kind === "create" ? "" : event?.next_service_date ?? "")
  const [notes, setNotes] = useState(kind === "create" ? "" : event?.notes ?? "")
  const [cancelReason, setCancelReason] = useState("")
  const [busy, setBusy] = useState(false)

  const selectedVehicle = useMemo(() => vehicles.find((v) => v.id === vehicleId) ?? null, [vehicles, vehicleId])

  async function runMutation(operation: () => Promise<{success: boolean; error?: string}>) {
    setBusy(true)
    try {
      const res = await operation()
      onDone(res.success ? null : res.error ?? "Error")
    } catch {
      onDone(isAr ? "تعذر تأكيد تحديث الصيانة. أعد التحميل قبل المحاولة مجدداً." : "The maintenance update could not be confirmed. Reload before retrying.")
    } finally {
      setBusy(false)
    }
  }

  async function submitCreate() {
    if (busy) return
    if (!vehicleId) return onDone(m.errVehicleRequired)
    if (fault.trim().length < 3) return onDone(m.errDescriptionRequired)
    await runMutation(() => createMaintenanceEvent({
      vehicle_id: vehicleId,
      maintenance_type: type,
      reported_by_driver_id: driverId || null,
      fault_description: fault,
      provider: provider || null,
      cost: cost ? Number(cost) : null,
      parts_replaced: parts || null,
      odometer_at_service: odometer ? Number(odometer) : null,
      next_service_km: nextKm ? Number(nextKm) : null,
      next_service_date: nextDate || null,
      notes: notes || null,
    }))
  }

  async function submitEdit() {
    if (busy || !event) return
    if (fault.trim().length < 3) return onDone(m.errDescriptionRequired)
    await runMutation(() => updateMaintenanceEvent({
      id: event.id,
      expected_version: event.version,
      maintenance_type: type,
      fault_description: fault,
      provider: provider || null,
      cost: cost ? Number(cost) : null,
      parts_replaced: parts || null,
      next_service_km: nextKm ? Number(nextKm) : null,
      next_service_date: nextDate || null,
      notes: notes || null,
    }))
  }

  async function submitComplete() {
    if (busy || !event) return
    if (cost === "" || Number.isNaN(Number(cost))) return onDone(m.errCostRequired)
    await runMutation(() => completeMaintenanceEvent({
      id: event.id,
      expected_version: event.version,
      cost: Number(cost),
      date_out: new Date().toISOString(),
      odometer_at_service: odometer ? Number(odometer) : null,
      parts_replaced: parts || null,
      notes: notes || null,
    }))
  }

  async function submitCancel() {
    if (busy || !event) return
    if (cancelReason.trim().length < 3) return onDone(m.cancelReasonRequired)
    await runMutation(() => kind==="archive" ? archiveMaintenanceEvent(event.id,event.version,cancelReason) : cancelMaintenanceEvent({ id: event.id,
      expected_version: event.version, reason: cancelReason }))
  }

  const title =
    kind === "create" ? m.addEvent
    : kind === "edit" ? m.editEvent
    : kind === "complete" ? m.completeEvent
    : kind === "archive" ? (isAr?"أرشفة حدث الصيانة":"Archive maintenance event")
    : kind === "cancel" ? m.cancelEvent
    : ""
  const desc =
    kind === "create" ? m.addEventDesc
    : kind === "edit" ? m.editEventDesc
    : kind === "complete" ? m.completeEventDesc
    : kind === "archive" ? (isAr?"تُحفظ الأحداث السابقة. لا يمكن أرشفة الأعمال المكتملة.":"Previous records are retained. Completed work cannot be archived.")
    : kind === "cancel" ? m.cancelEventDesc
    : ""

  return (
    <Dialog open={kind != null} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className={kind === "create" || kind === "edit" ? "max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-2xl" : "rounded-2xl sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>

        <fieldset disabled={busy} className="contents">
        {(kind === "create" || kind === "edit") && (
          <div className="grid min-w-0 gap-4 rounded-2xl border border-border/60 bg-muted/20 p-4 sm:grid-cols-2">
            {kind === "create" && (
              <div className="grid gap-1.5">
                <Label>{m.fieldVehicle}</Label>
                <select aria-label={m.fieldVehicle}
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs"
                >
                  <option value="">{isAr ? "اختر مركبة" : "Select a vehicle"}</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleLabel(v, isAr)}
                    </option>
                  ))}
                </select>
                {selectedVehicle?.odometer_current != null && (
                  <p className="text-xs text-muted-foreground">
                    {m.latestOdometer}: <span dir="ltr">{selectedVehicle.odometer_current.toLocaleString()}</span> <LocalizedText text="km ·" /> {m.autoLoggedNote}
                  </p>
                )}
              </div>
            )}
            {kind === "create" && (
              <div className="grid gap-1.5">
                <Label>{m.fieldReportedByDriver}</Label>
                <select aria-label={m.fieldReportedByDriver}
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs"
                >
                  <option value="">{isAr ? "— لا شيء —" : "— none —"}</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name_en || d.full_name_ar || d.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>{vm.maintenanceType}</Label>
              <select aria-label={vm.maintenanceType}
                value={type}
                onChange={(e) => setType(e.target.value as MaintenanceType)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs"
              >
                <option value="preventive">{vm.typePreventive}</option>
                <option value="emergency">{vm.typeEmergency}</option>
                <option value="periodic">{vm.typePeriodic}</option>
                <option value="repair">{vm.typeRepair}</option>
              </select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{m.fieldFaultDescription}</Label>
              <Textarea aria-label={m.fieldFaultDescription} value={fault} onChange={(e) => setFault(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <div className="grid gap-1.5">
                <Label>{m.fieldCost}</Label>
                <SuffixInput suffix={isAr ? "ر.س" : "SAR"} aria-label={m.fieldCost} dir="ltr" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>{m.fieldProvider}</Label>
                <Input aria-label={m.fieldProvider} value={provider} onChange={(e) => setProvider(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <div className="grid gap-1.5">
                <Label>{m.fieldNextServiceKm}</Label>
                <SuffixInput suffix={isAr ? "كم" : "km"} aria-label={m.fieldNextServiceKm} dir="ltr" type="number" min="0" value={nextKm} onChange={(e) => setNextKm(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>{m.fieldNextServiceDate}</Label>
                <Input aria-label={m.fieldNextServiceDate} dir="ltr" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldPartsReplaced}</Label>
              <Input aria-label={m.fieldPartsReplaced} value={parts} onChange={(e) => setParts(e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{m.fieldNotes}</Label>
              <Textarea aria-label={m.fieldNotes} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        {kind === "complete" && event && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {event.vehicle ? `${event.vehicle.make ?? ""} ${event.vehicle.model ?? ""} (${event.vehicle.plate_number ?? "—"})` : ""}
            </p>
            <div className="grid gap-1.5">
              <Label>{m.fieldCost}</Label>
              <SuffixInput suffix={isAr ? "ر.س" : "SAR"} aria-label={m.fieldCost} dir="ltr" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldOdometerAtService}</Label>
              <SuffixInput suffix={isAr ? "كم" : "km"} aria-label={m.fieldOdometerAtService} dir="ltr" type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldPartsReplaced}</Label>
              <Input aria-label={m.fieldPartsReplaced} value={parts} onChange={(e) => setParts(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldNotes}</Label>
              <Textarea aria-label={m.fieldNotes} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        {(kind === "cancel" || kind === "archive") && event && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{kind==="archive"?(isAr?"أدخل سبب الأرشفة.":"Enter the archive reason."):m.confirmCancel}</p>
            <div className="grid gap-1.5">
              <Label>{m.cancelReason} *</Label>
              <Textarea aria-label={m.cancelReason} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={kind === "create" ? submitCreate : kind === "edit" ? submitEdit : kind === "complete" ? submitComplete : submitCancel}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {kind === "cancel" || kind === "archive" ? t.common.confirm : t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
