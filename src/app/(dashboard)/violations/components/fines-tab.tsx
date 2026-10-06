"use client"

// External-fines tab (Prompt O Part 3): paste-import government fine rows
// (idempotent by the (tenant, external_ref, source) unique key), the
// unmatched queue with match-to-driver, duplicate/ignored marking, and
// conversion of matched fines into violations.

import { useMemo, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
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
  createViolationFromFine,
  importExternalFines,
  markExternalFine,
  matchExternalFine,
} from "@/lib/violations-module/actions"
import { parseFinesCsv } from "@/lib/violations-module/module-utils"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import type { DriverOption } from "./violation-dialogs"
import { Download, Loader2, Plus, UserCheck } from "lucide-react"

export interface FineRow {
  id: string
  source: string
  external_ref: string
  external_source: string | null
  vehicle_plate: string | null
  violation_date: string | null
  violation_location: string | null
  violation_type_code: string | null
  fine_amount: number | null
  payment_deadline: string | null
  status: string
  match_notes: string | null
  matched_driver_id: string | null
}

const FINE_SOURCES = ["manual", "najm", "moi", "absher"] as const

export function FinesTab({
  rows,
  drivers,
  isLoading,
  onRefresh,
}: {
  rows: FineRow[]
  drivers: DriverOption[]
  isLoading: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const isAr = t.common.status === "الحالة"

  const [importOpen, setImportOpen] = useState(false)
  const [importSession, setImportSession] = useState(0)
  const [matchFor, setMatchFor] = useState<FineRow | null>(null)
  const [matchSession, setMatchSession] = useState(0)
  const [markFor, setMarkFor] = useState<{ fine: FineRow; status: "duplicate" | "ignored" } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const statusMeta: Record<string, { ar: string; en: string; className: string }> = {
    unmatched: { ar: "غير مطابقة", en: "Unmatched", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
    matched: { ar: "مطابقة", en: "Matched", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
    violation_created: { ar: "تحولت لمخالفة", en: "Violation created", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
    duplicate: { ar: "مكررة", en: "Duplicate", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
    ignored: { ar: "متجاهلة", en: "Ignored", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  }

  function done(err: string | null, driverId?: string | null) {
    if (err) toast.error(err)
    else {
      toast.success(t.common.saved)
      if (driverId) emitDriverChanged({ driverId, action: "violation" })
      onRefresh()
    }
    setMatchFor(null)
    setMarkFor(null)
  }

  async function convert(f: FineRow) {
    setBusyId(f.id)
    const res = await createViolationFromFine(f.id)
    setBusyId(null)
    if (res.success) {
      toast.success(t.common.saved)
      if (f.matched_driver_id) emitDriverChanged({ driverId: f.matched_driver_id, action: "violation" })
      onRefresh()
    } else {
      toast.error(res.error ?? "Error")
    }
  }

  // Unmatched queue first (its own index), then the rest by external ref.
  const ordered = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const rank = (s: string) => (s === "unmatched" ? 0 : s === "matched" ? 1 : 2)
        return rank(a.status) - rank(b.status) || a.external_ref.localeCompare(b.external_ref)
      }),
    [rows]
  )

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => { setImportSession((s) => s + 1); setImportOpen(true) }}>
          <Download className="mr-1 h-4 w-4 rotate-180" />
          {vm.finesImport}
        </Button>
      </div>
      <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/20">
              <tr>
                {[vm.colExternalRef, vm.colExternalSource, vm.colPlate, vm.colIncidentDate, vm.colFineAmount, vm.colDeadline, vm.colFineStatus, t.common.actions].map((h) => (
                  <th key={h} className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">{t.common.loading}</td></tr>
              ) : ordered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">{vm.noFines}</td></tr>
              ) : (
                ordered.map((f) => {
                  const meta = statusMeta[f.status] ?? statusMeta.unmatched
                  return (
                    <tr key={f.id}>
                      <td className="px-4 py-2.5 text-sm"><span dir="ltr" className="font-mono text-xs">{f.external_ref}</span></td>
                      <td className="px-4 py-2.5 text-sm">{f.external_source ?? f.source}</td>
                      <td className="px-4 py-2.5 text-sm"><span dir="ltr">{f.vehicle_plate ?? "—"}</span></td>
                      <td className="px-4 py-2.5 text-sm" dir="ltr">{f.violation_date ?? "—"}</td>
                      <td className="px-4 py-2.5 text-sm tabular-nums" dir="ltr">{f.fine_amount != null ? Number(f.fine_amount).toFixed(2) : "—"}</td>
                      <td className="px-4 py-2.5 text-sm" dir="ltr">{f.payment_deadline ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}>
                          {isAr ? meta.ar : meta.en}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          {f.status === "unmatched" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => { setMatchSession((s) => s + 1); setMatchFor(f) }}>
                                <UserCheck className="mr-1 h-3.5 w-3.5" />
                                {vm.matchDriver}
                              </Button>
                              <Button size="sm" variant="ghost" title={vm.markDuplicate} onClick={() => setMarkFor({ fine: f, status: "duplicate" })}>{vm.markDuplicate}</Button>
                              <Button size="sm" variant="ghost" title={vm.markIgnored} onClick={() => setMarkFor({ fine: f, status: "ignored" })}>{vm.markIgnored}</Button>
                            </>
                          )}
                          {f.status === "matched" && (
                            <Button size="sm" variant="outline" onClick={() => void convert(f)} disabled={busyId === f.id}>
                              {busyId === f.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                              {vm.createViolationFromFine}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {importOpen && (
        <FinesImportDialog key={importSession} open onClose={() => setImportOpen(false)} onDone={done} onRefresh={onRefresh} />
      )}
      {matchFor != null && (
        <MatchDialog key={`${matchFor.id}-${matchSession}`} open fine={matchFor} drivers={drivers} onClose={() => setMatchFor(null)} onDone={done} />
      )}
      {markFor != null && (
        <MarkDialog key={`${markFor.fine.id}-${markFor.status}`} open fine={markFor.fine} status={markFor.status} onClose={() => setMarkFor(null)} onDone={done} />
      )}
    </div>
  )
}

// ── Paste-import dialog (client preview, server partial-failure) ────────

function FinesImportDialog({
  open,
  onClose,
  onDone,
  onRefresh,
}: {
  open: boolean
  onClose: () => void
  onDone: (err: string | null, driverId?: string | null) => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const [csv, setCsv] = useState("")
  const [source, setSource] = useState<(typeof FINE_SOURCES)[number]>("manual")
  const [busy, setBusy] = useState(false)
  const [inserted, setInserted] = useState<number | null>(null)
  const [failures, setFailures] = useState<{ rowNumber: number; error: string }[]>([])

  const parsed = useMemo(() => parseFinesCsv(csv), [csv])

  async function run() {
    const okRows = parsed.rows.filter((r) => r.ok)
    if (okRows.length === 0) return
    setBusy(true)
    const res = await importExternalFines(
      okRows.map((r) => ({
        rowNumber: r.rowNumber,
        external_ref: r.external_ref,
        external_source: r.external_source || null,
        vehicle_plate: r.vehicle_plate || null,
        violation_date: r.violation_date || null,
        violation_location: r.violation_location || null,
        violation_type_code: r.violation_type_code || null,
        fine_amount: r.fine_amount,
        payment_deadline: r.payment_deadline || null,
        match_notes: r.match_notes || null,
      })),
      source
    )
    setBusy(false)
    if (res.success) {
      setInserted(res.inserted ?? 0)
      setFailures(res.failures ?? [])
      if ((res.inserted ?? 0) > 0) onRefresh()
    } else {
      onDone(res.error ?? "Error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{vm.finesImport}</DialogTitle>
          <DialogDescription>{vm.finesImportDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{vm.colExternalSource}</Label>
            <Select value={source} onValueChange={(v) => setSource(v as (typeof FINE_SOURCES)[number])}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FINE_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{vm.finesCsv}</Label>
            <Textarea
              dir="ltr"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={7}
              placeholder={vm.finesPlaceholder}
              className="font-mono text-xs"
            />
          </div>
          {csv.trim() !== "" && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>{vm.finesRowsParsed}: <strong dir="ltr">{parsed.rows.length}</strong></span>
              <span className="text-emerald-600">{vm.finesRowsOk}: <strong dir="ltr">{parsed.okCount}</strong></span>
              <span className={parsed.errorCount > 0 ? "text-red-500 font-medium" : ""}>{vm.finesRowsFailed}: <strong dir="ltr">{parsed.errorCount}</strong></span>
            </div>
          )}
          {parsed.rows.some((r) => !r.ok) && (
            <div className="max-h-32 overflow-y-auto rounded-xl border border-red-500/30 bg-red-500/5 p-2 text-xs">
              {parsed.rows.filter((r) => !r.ok).slice(0, 20).map((r) => (
                <p key={r.rowNumber} dir="ltr" className="text-red-500">row {r.rowNumber}: {r.error}</p>
              ))}
            </div>
          )}
          {inserted !== null && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              <p className={failures.length > 0 ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}>
                {failures.length > 0
                  ? vm.finesPartial.replace("{ok}", String(inserted)).replace("{failed}", String(failures.length))
                  : vm.finesSuccess.replace("{ok}", String(inserted))}
              </p>
              {failures.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto text-xs">
                  {failures.slice(0, 20).map((f, i) => (
                    <p key={i} dir="ltr" className="text-red-500">row {f.rowNumber}: {f.error}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.close}</Button>
          <Button onClick={run} disabled={busy || parsed.okCount === 0}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {vm.finesRun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Match-to-driver + mark dialogs ──────────────────────────────────────

function MatchDialog({
  open,
  fine,
  drivers,
  onClose,
  onDone,
}: {
  open: boolean
  fine: FineRow
  drivers: DriverOption[]
  onClose: () => void
  onDone: (err: string | null, driverId?: string | null) => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const [driverId, setDriverId] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")

  const filtered = query
    ? drivers.filter((d) =>
        `${d.full_name_ar ?? ""} ${d.driver_code ?? ""}`.toLowerCase().includes(query.toLowerCase())
      )
    : drivers

  async function submit() {
    if (!driverId) return onDone(vm.errDriverRequired, null)
    setBusy(true)
    const res = await matchExternalFine({ id: fine.id, driver_id: driverId, match_notes: notes || null })
    setBusy(false)
    onDone(res.success ? null : (res.error ?? "Error"), driverId)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{vm.matchDriver} — <span dir="ltr" className="font-mono text-xs">{fine.external_ref}</span></DialogTitle>
          <DialogDescription>{vm.matchDriverDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input placeholder={t.common.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="max-h-56 overflow-y-auto rounded-xl border border-border/50">
            {filtered.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDriverId(d.id)}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/30 ${driverId === d.id ? "bg-muted/50 font-medium" : ""}`}
              >
                <span>{d.full_name_ar ?? d.id}</span>
                <span dir="ltr" className="text-xs text-muted-foreground">{d.driver_code ?? ""}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t.common.noData}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label>{vm.markReason}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy || !driverId}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {vm.matchDriver}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MarkDialog({
  open,
  fine,
  status,
  onClose,
  onDone,
}: {
  open: boolean
  fine: FineRow
  status: "duplicate" | "ignored"
  onClose: () => void
  onDone: (err: string | null, driverId?: string | null) => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (reason.trim().length < 3) return onDone(vm.markReasonRequired, null)
    setBusy(true)
    const res = await markExternalFine({ id: fine.id, status, match_notes: reason })
    setBusy(false)
    onDone(res.success ? null : (res.error ?? "Error"))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{status === "duplicate" ? vm.markDuplicate : vm.markIgnored}</DialogTitle>
          <DialogDescription><span dir="ltr" className="font-mono text-xs">{fine.external_ref}</span></DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>{vm.markReason}</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
