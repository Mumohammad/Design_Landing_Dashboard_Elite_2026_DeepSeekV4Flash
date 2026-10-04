"use client"

// Maintenance event create/edit/complete/cancel dialogs (Prompt O Part 1).
// Composes the vehicle picker (tenant vehicles), the latest odometer reading
// from vehicle_odometer_logs, and the maintenance server actions.

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
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

type DialogKind = "create" | "edit" | "complete" | "cancel" | null

const TYPES = ["preventive", "emergency", "periodic", "repair"] as const

function vehicleLabel(v: VehicleOption, isAr: boolean): string {
  const name = isAr ? `${v.make ?? ""} ${v.model ?? ""}`.trim() : `${v.make ?? ""} ${v.model ?? ""}`.trim()
  return `${v.plate_number ?? "—"} · ${name || (isAr ? "مركبة" : "Vehicle")}`
}

export function EventDialogs({
  kind,
  event,
  vehicles,
  drivers,
  defaultOdometer,
  onClose,
  onDone,
}: {
  kind: DialogKind
  event: MaintenanceEventRow | null
  vehicles: VehicleOption[]
  drivers: DriverOption[]
  defaultOdometer: number | null
  onClose: () => void
  onDone: (msg: string | null) => void
}) {
  const { t } = useTranslation()
  const m = t.maintenanceModule
  const vm = t.vehicles
  const isAr = t.common.status === "الحالة"

  // create/edit form state
  const [vehicleId, setVehicleId] = useState("")
  const [driverId, setDriverId] = useState("")
  const [type, setType] = useState<(typeof TYPES)[number]>("preventive")
  const [fault, setFault] = useState("")
  const [provider, setProvider] = useState("")
  const [cost, setCost] = useState("")
  const [parts, setParts] = useState("")
  const [odometer, setOdometer] = useState("")
  const [nextKm, setNextKm] = useState("")
  const [nextDate, setNextDate] = useState("")
  const [notes, setNotes] = useState("")
  const [cancelReason, setCancelReason] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (kind === "create") {
      setVehicleId("")
      setDriverId("")
      setType("preventive")
      setFault("")
      setProvider("")
      setCost("")
      setParts("")
      setOdometer("")
      setNextKm("")
      setNextDate("")
      setNotes("")
      setCancelReason("")
    } else if (kind === "edit" && event) {
      setVehicleId(event.vehicle_id)
      setType(event.maintenance_type as (typeof TYPES)[number])
      setFault(event.fault_description ?? "")
      setProvider(event.provider ?? "")
      setCost(event.cost != null ? String(event.cost) : "")
      setParts(event.parts_replaced ?? "")
      setNextKm(event.next_service_km != null ? String(event.next_service_km) : "")
      setNextDate(event.next_service_date ?? "")
      setNotes(event.notes ?? "")
      setCancelReason("")
    } else if (kind === "complete" && event) {
      setCost(event.cost != null ? String(event.cost) : "")
      setOdometer(event.odometer_at_service != null ? String(event.odometer_at_service) : defaultOdometer != null ? String(defaultOdometer) : "")
      setParts(event.parts_replaced ?? "")
      setNotes(event.notes ?? "")
    } else if (kind === "cancel" && event) {
      setCancelReason("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, event?.id])

  const selectedVehicle = useMemo(() => vehicles.find((v) => v.id === vehicleId) ?? null, [vehicles, vehicleId])

  async function submitCreate() {
    if (!vehicleId) return onDone(m.errVehicleRequired)
    if (fault.trim().length < 3) return onDone(m.errDescriptionRequired)
    setBusy(true)
    const res = await createMaintenanceEvent({
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
    })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  async function submitEdit() {
    if (!event) return
    if (fault.trim().length < 3) return onDone(m.errDescriptionRequired)
    setBusy(true)
    const res = await updateMaintenanceEvent({
      id: event.id,
      maintenance_type: type,
      fault_description: fault,
      provider: provider || null,
      cost: cost ? Number(cost) : null,
      parts_replaced: parts || null,
      next_service_km: nextKm ? Number(nextKm) : null,
      next_service_date: nextDate || null,
      notes: notes || null,
    })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  async function submitComplete() {
    if (!event) return
    if (cost === "" || Number.isNaN(Number(cost))) return onDone(m.errCostRequired)
    setBusy(true)
    const res = await completeMaintenanceEvent({
      id: event.id,
      cost: Number(cost),
      date_out: new Date().toISOString(),
      odometer_at_service: odometer ? Number(odometer) : null,
      parts_replaced: parts || null,
      notes: notes || null,
    })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  async function submitCancel() {
    if (!event) return
    if (cancelReason.trim().length < 3) return onDone(m.cancelReasonRequired)
    setBusy(true)
    const res = await cancelMaintenanceEvent({ id: event.id, reason: cancelReason })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  const title =
    kind === "create" ? m.addEvent
    : kind === "edit" ? m.editEvent
    : kind === "complete" ? m.completeEvent
    : kind === "cancel" ? m.cancelEvent
    : ""
  const desc =
    kind === "create" ? m.addEventDesc
    : kind === "edit" ? m.editEventDesc
    : kind === "complete" ? m.completeEventDesc
    : kind === "cancel" ? m.cancelEventDesc
    : ""

  return (
    <Dialog open={kind != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>

        {(kind === "create" || kind === "edit") && (
          <div className="grid gap-3">
            {kind === "create" && (
              <div className="grid gap-1.5">
                <Label>{m.fieldVehicle}</Label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
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
                    {m.latestOdometer}: <span dir="ltr">{selectedVehicle.odometer_current.toLocaleString()}</span> km · {m.autoLoggedNote}
                  </p>
                )}
              </div>
            )}
            {kind === "create" && (
              <div className="grid gap-1.5">
                <Label>{m.fieldReportedByDriver}</Label>
                <select
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
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
              <select
                value={type}
                onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
                className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
              >
                <option value="preventive">{vm.typePreventive}</option>
                <option value="emergency">{vm.typeEmergency}</option>
                <option value="periodic">{vm.typePeriodic}</option>
                <option value="repair">{vm.typeRepair}</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldFaultDescription}</Label>
              <Textarea value={fault} onChange={(e) => setFault(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{m.fieldCost}</Label>
                <Input dir="ltr" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>{m.fieldProvider}</Label>
                <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{m.fieldNextServiceKm}</Label>
                <Input dir="ltr" type="number" min="0" value={nextKm} onChange={(e) => setNextKm(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>{m.fieldNextServiceDate}</Label>
                <Input dir="ltr" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldPartsReplaced}</Label>
              <Input value={parts} onChange={(e) => setParts(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldNotes}</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
              <Input dir="ltr" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldOdometerAtService}</Label>
              <Input dir="ltr" type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldPartsReplaced}</Label>
              <Input value={parts} onChange={(e) => setParts(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{m.fieldNotes}</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        {kind === "cancel" && event && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{m.confirmCancel}</p>
            <div className="grid gap-1.5">
              <Label>{m.cancelReason} *</Label>
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={kind === "create" ? submitCreate : kind === "edit" ? submitEdit : kind === "complete" ? submitComplete : submitCancel}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {kind === "cancel" ? t.common.confirm : t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
