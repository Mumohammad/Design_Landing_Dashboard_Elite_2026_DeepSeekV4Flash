"use client"

// Violations module dialogs (Prompt O Part 3): create/edit, the review
// workflow (approve → queue deduction / waive with mandatory reason) and the
// detail dialog with the composed timeline + evidence signed URLs.
// Dialogs are session-keyed by the parent, so initial state derives from
// props — no reset effects (react-hooks/set-state rule).

import { useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  approveViolation,
  createViolation,
  getViolationEvidenceUrl,
  startViolationReview,
  updateViolation,
  waiveViolation,
} from "@/lib/violations-module/actions"
import {
  buildViolationTimeline,
  deductionMonthOptions,
  isViolationTransitionAllowed,
} from "@/lib/violations-module/module-utils"
import { Loader2, ExternalLink } from "lucide-react"

export interface DriverOption {
  id: string
  full_name_ar: string | null
  driver_code: string | null
}

export interface VehicleOption {
  id: string
  plate_number: string | null
}

export interface ViolationTypeOption {
  id: string
  code: string
  name_ar: string
  severity: string
  default_deduction: number | null
}

export interface ViolationRow {
  id: string
  violation_ref: string
  driver_id: string | null
  vehicle_id: string | null
  violation_type_id: string | null
  source: string
  severity: string
  status: string
  incident_date: string
  incident_location: string | null
  incident_description: string | null
  deduction_amount: number | null
  evidence_urls: string[] | null
  reported_at: string | null
  reported_by: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  review_notes: string | null
  waiver_reason: string | null
  waived_at: string | null
  waived_by: string | null
  dispute_deadline: string | null
  driver: { full_name_ar: string | null; driver_code: string | null } | null
  vehicle: { plate_number: string | null } | null
  violation_types: { name_ar: string | null; name_en: string | null; category: string | null } | null
}

const SEVERITIES = ["minor", "moderate", "major", "critical"] as const

// ── Create / edit ───────────────────────────────────────────────────────

export function ViolationDialog({
  open,
  violation,
  drivers,
  vehicles,
  types,
  onClose,
  onDone,
}: {
  open: boolean
  violation: ViolationRow | null
  drivers: DriverOption[]
  vehicles: VehicleOption[]
  types: ViolationTypeOption[]
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const editing = violation != null

  const [driverId, setDriverId] = useState(violation?.driver_id ?? "")
  const [vehicleId, setVehicleId] = useState(violation?.vehicle_id ?? "none")
  const [typeId, setTypeId] = useState(violation?.violation_type_id ?? "none")
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>(
    (violation?.severity as (typeof SEVERITIES)[number]) ?? "minor"
  )
  const [incidentDate, setIncidentDate] = useState(violation?.incident_date ?? new Date().toISOString().slice(0, 10))
  const [location, setLocation] = useState(violation?.incident_location ?? "")
  const [description, setDescription] = useState(violation?.incident_description ?? "")
  const [amount, setAmount] = useState(violation?.deduction_amount != null ? String(violation.deduction_amount) : "")
  const [evidence, setEvidence] = useState((violation?.evidence_urls ?? []).join("\n"))
  const [busy, setBusy] = useState(false)

  // Picking a type composes its severity + default deduction (overridable).
  function onTypeChange(v: string) {
    setTypeId(v)
    const type = types.find((x) => x.id === v)
    if (type) {
      setSeverity(type.severity as (typeof SEVERITIES)[number])
      if (type.default_deduction != null) setAmount(String(type.default_deduction))
    }
  }

  async function submit() {
    if (!driverId) return onDone(vm.errDriverRequired)
    if (!incidentDate) return onDone(vm.errDateRequired)
    if (!description.trim()) return onDone(vm.errDescriptionRequired)
    setBusy(true)
    const payload = {
      driver_id: driverId,
      vehicle_id: vehicleId === "none" ? null : vehicleId,
      violation_type_id: typeId === "none" ? null : typeId,
      severity,
      incident_date: incidentDate,
      incident_location: location || null,
      incident_description: description,
      deduction_amount: amount ? Number(amount) : 0,
      evidence_paths: evidence.split("\n").map((s) => s.trim()).filter(Boolean),
    }
    const res = editing ? await updateViolation({ id: violation.id, ...payload }) : await createViolation(payload)
    setBusy(false)
    onDone(res.success ? null : (res.error ?? "Error"))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? vm.editViolation : vm.addViolation}</DialogTitle>
          <DialogDescription>{vm.addViolationDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{vm.fieldDriver}</Label>
            <Select value={driverId} onValueChange={setDriverId} disabled={editing}>
              <SelectTrigger><SelectValue placeholder={vm.fieldDriver} /></SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.full_name_ar ?? d.driver_code ?? d.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{vm.fieldVehicle}</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.plate_number ?? v.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{vm.fieldViolationType}</Label>
              <Select value={typeId} onValueChange={onTypeChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {types.map((ty) => (
                    <SelectItem key={ty.id} value={ty.id}>{ty.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{vm.fieldSeverity}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as (typeof SEVERITIES)[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{vm.fieldIncidentDate}</Label>
              <Input dir="ltr" type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{vm.fieldDeduction}</Label>
              <Input dir="ltr" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{vm.fieldLocation}</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} />
          </div>
          <div className="grid gap-1.5">
            <Label>{vm.fieldDescription}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
          </div>
          <div className="grid gap-1.5">
            <Label>{vm.fieldEvidencePaths}</Label>
            <Textarea dir="ltr" value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">{vm.fieldEvidenceHint}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Review workflow: approve (queue deduction) / waive ────────────────

export function ApproveDialog({
  open,
  violation,
  onClose,
  onDone,
}: {
  open: boolean
  violation: ViolationRow
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const months = deductionMonthOptions(new Date(), 3)
  const [notes, setNotes] = useState("")
  const [month, setMonth] = useState(months[0])
  const [amount, setAmount] = useState(violation.deduction_amount != null ? String(violation.deduction_amount) : "0")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!month) return onDone(vm.errMonthRequired)
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) return onDone(vm.errAmountInvalid ?? vm.errDescriptionRequired)
    setBusy(true)
    const res = await approveViolation({
      id: violation.id,
      review_notes: notes || null,
      deduction_month: month,
      deduction_amount: amt,
    })
    setBusy(false)
    onDone(res.success ? null : (res.error ?? "Error"))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{vm.approve} — {violation.violation_ref}</DialogTitle>
          <DialogDescription>{vm.approveDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{vm.deductionMonth}</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger dir="ltr"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{vm.deductionAmount}</Label>
              <Input dir="ltr" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{vm.reviewNotes}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {vm.approve}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WaiveDialog({
  open,
  violation,
  onClose,
  onDone,
}: {
  open: boolean
  violation: ViolationRow
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (reason.trim().length < 5) return onDone(vm.waiverReasonRequired)
    setBusy(true)
    const res = await waiveViolation({ id: violation.id, waiver_reason: reason })
    setBusy(false)
    onDone(res.success ? null : (res.error ?? "Error"))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{vm.waive} — {violation.violation_ref}</DialogTitle>
          <DialogDescription>{vm.waiveDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>{vm.waiverReason}</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {vm.waive}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Detail: full violation + timeline + evidence signed URLs ─────────

const TL_KEY_TO_LABEL: Record<string, (vm: { tlReported: string; tlReviewed: string; tlQueued: string; tlApplied: string; tlWaived: string; tlRolledBack: string }) => string> = {
  reported: (vm) => vm.tlReported,
  reviewed: (vm) => vm.tlReviewed,
  queued: (vm) => vm.tlQueued,
  applied: (vm) => vm.tlApplied,
  waived: (vm) => vm.tlWaived,
  rolled_back: (vm) => vm.tlRolledBack,
}

export function ViolationDetailDialog({
  open,
  violation,
  ledgerCount,
  onClose,
  onAction,
}: {
  open: boolean
  violation: ViolationRow
  /** Live ledger rows for this violation (from the page load) — feeds the timeline. */
  ledgerCount: number
  onClose: () => void
  onAction: (action: "approve" | "waive") => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [signingPath, setSigningPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function openEvidence(path: string) {
    if (signed[path]) {
      window.open(signed[path], "_blank", "noopener")
      return
    }
    setSigningPath(path)
    const res = await getViolationEvidenceUrl(path)
    setSigningPath(null)
    if (res.url) {
      setSigned((s) => ({ ...s, [path]: res.url! }))
      window.open(res.url, "_blank", "noopener")
    }
  }

  async function startReview() {
    setBusy(true)
    const res = await startViolationReview(violation.id)
    setBusy(false)
    if (!res.success) window.alert(res.error ?? "Error")
  }

  const timeline = buildViolationTimeline(violation)
  const canReview = isViolationTransitionAllowed(violation.status, "resolved")

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vm.detailTitle} — <span dir="ltr" className="font-mono text-sm">{violation.violation_ref}</span></DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <p><span className="text-muted-foreground">{vm.colDriver}: </span><span className="font-medium">{violation.driver?.full_name_ar ?? "—"}</span></p>
            <p><span className="text-muted-foreground">{vm.colType}: </span>{violation.violation_types?.name_ar ?? "—"}</p>
            <p><span className="text-muted-foreground">{vm.colSeverity}: </span>{violation.severity}</p>
            <p><span className="text-muted-foreground">{t.common.status}: </span><span dir="ltr">{violation.status}</span></p>
            <p><span className="text-muted-foreground">{vm.colIncidentDate}: </span><span dir="ltr">{violation.incident_date}</span></p>
            <p><span className="text-muted-foreground">{vm.colDeduction}: </span><span dir="ltr" className="tabular-nums">{Number(violation.deduction_amount ?? 0).toFixed(2)}</span></p>
            {violation.incident_location && (
              <p className="col-span-2"><span className="text-muted-foreground">{vm.fieldLocation}: </span>{violation.incident_location}</p>
            )}
            {violation.waiver_reason && (
              <p className="col-span-2"><span className="text-muted-foreground">{vm.waiverReason}: </span>{violation.waiver_reason}</p>
            )}
            {violation.review_notes && (
              <p className="col-span-2"><span className="text-muted-foreground">{vm.reviewNotes}: </span>{violation.review_notes}</p>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{vm.timeline}</p>
            <ol className="space-y-1 border-s border-border/60 ps-4">
              {timeline.map((ev, i) => (
                <li key={i} className="text-xs">
                  <span className="font-medium">{TL_KEY_TO_LABEL[ev.key]?.(vm) ?? ev.key}</span>
                  {" · "}
                  <span dir="ltr" className="text-muted-foreground">{ev.at.slice(0, 16).replace("T", " ")}</span>
                  {ev.note ? <span className="text-muted-foreground"> — {ev.note}</span> : null}
                </li>
              ))}
              {ledgerCount > 0 && timeline.length === 0 && (
                <li className="text-xs text-muted-foreground" dir="ltr">{ledgerCount}</li>
              )}
            </ol>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{vm.evidence}</p>
            {(violation.evidence_urls ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">{vm.noEvidence}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(violation.evidence_urls ?? []).map((p) => (
                  <Button key={p} size="sm" variant="outline" onClick={() => void openEvidence(p)} disabled={signingPath === p}>
                    {signingPath === p ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="mr-1 h-3.5 w-3.5" />}
                    {vm.openEvidence}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.close}</Button>
          {violation.status === "open" && (
            <Button variant="secondary" onClick={startReview} disabled={busy}>{vm.startReview}</Button>
          )}
          {canReview && (
            <Button onClick={() => onAction("approve")}>{vm.approve}</Button>
          )}
          {canReview && (
            <Button variant="destructive" onClick={() => onAction("waive")}>{vm.waive}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
