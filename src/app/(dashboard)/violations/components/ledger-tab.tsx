"use client"

// Deduction-ledger tab (Prompt O Part 3): pending rows can be applied to the
// driver's draft/calculated payroll period (never posted/locked — enforced
// server-side); applied rows can be rolled back with a mandatory reason
// (refused once the period is locked/paid). Cross-surface refresh rides the
// driver-events bus.

import { useEffect, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
import { applyLedgerDeduction, rollbackLedgerDeduction } from "@/lib/violations-module/actions"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import { Loader2 } from "lucide-react"

export interface LedgerRow {
  id: string
  violation_id: string
  driver_id: string
  deduction_amount: number | null
  deduction_month: string
  status: string
  payroll_period_id: string | null
  applied_at: string | null
  rolled_back_at: string | null
  rollback_reason: string | null
  violation: { violation_ref: string }[] | null
  driver: { full_name_ar: string | null; driver_code: string | null }[] | null
}

export interface PeriodOption {
  id: string
  period_year: number
  period_month: number
  status: string
}

function statusClass(status: string): string {
  if (status === "applied") return "bg-purple-500/15 text-purple-600 border-purple-500/20"
  if (status === "pending") return "bg-amber-500/15 text-amber-600 border-amber-500/20"
  return "bg-gray-500/15 text-gray-600 border-gray-500/20"
}

export function LedgerTab({
  rows,
  isLoading,
  onRefresh,
}: {
  rows: LedgerRow[]
  isLoading: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule

  const [applyFor, setApplyFor] = useState<LedgerRow | null>(null)
  const [rollbackFor, setRollbackFor] = useState<LedgerRow | null>(null)

  function done(err: string | null, driverId?: string | null) {
    if (err) toast.error(err)
    else {
      toast.success(t.common.saved)
      if (driverId) emitDriverChanged({ driverId, action: "violation" })
      onRefresh()
    }
    setApplyFor(null)
    setRollbackFor(null)
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/20">
            <tr>
              {[vm.ledColViolation, vm.ledColDriver, vm.ledColAmount, vm.ledColMonth, vm.ledColStatus, vm.ledColPeriod, t.common.actions].map((h) => (
                <th key={h} className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">{t.common.loading}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">{vm.noLedgerRows}</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 text-sm"><span dir="ltr" className="font-mono text-xs">{r.violation?.[0]?.violation_ref ?? "—"}</span></td>
                  <td className="px-4 py-2.5 text-sm">{r.driver?.[0]?.full_name_ar ?? "—"}</td>
                  <td className="px-4 py-2.5 text-sm tabular-nums" dir="ltr">{Number(r.deduction_amount ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-sm" dir="ltr">{r.deduction_month}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(r.status)}`} dir="ltr">{r.status}</span>
                    {r.rolled_back_at && <span className="ms-1 text-xs text-muted-foreground" dir="ltr">↩</span>}
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    {r.applied_at ? <span dir="ltr" className="text-xs">{r.applied_at.slice(0, 10)}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      {r.status === "pending" && (
                        <Button size="sm" variant="outline" onClick={() => setApplyFor(r)}>{vm.applyToPeriod}</Button>
                      )}
                      {r.status === "applied" && (
                        <Button size="sm" variant="outline" onClick={() => setRollbackFor(r)}>{vm.rollback}</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {applyFor != null && (
        <ApplyDialog key={applyFor.id} open ledger={applyFor} onClose={() => setApplyFor(null)} onDone={done} />
      )}
      {rollbackFor != null && (
        <RollbackDialog key={rollbackFor.id} open ledger={rollbackFor} onClose={() => setRollbackFor(null)} onDone={done} />
      )}
    </div>
  )
}

function ApplyDialog({
  open,
  ledger,
  onClose,
  onDone,
}: {
  open: boolean
  ledger: LedgerRow
  onClose: () => void
  onDone: (err: string | null, driverId?: string | null) => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const [periods, setPeriods] = useState<PeriodOption[] | null>(null)
  const [periodId, setPeriodId] = useState("")
  const [busy, setBusy] = useState(false)

  // The driver's open (draft/calculated) periods only — posted/locked ones are
  // excluded here AND refused server-side (canApplyToPeriod). The awaits come
  // before any setState, so the effect cannot cascade renders.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()
      const { data } = await supabase
        .from("driver_payroll_periods")
        .select("id,period_year,period_month,status,driver_id")
        .eq("driver_id", ledger.driver_id)
        .in("status", ["draft", "calculated"])
        .is("deleted_at", null)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
      if (cancelled) return
      const options = (data as PeriodOption[] | null) ?? []
      setPeriods(options)
      const matching = options.find((p) => `${p.period_year}-${String(p.period_month).padStart(2, "0")}` === ledger.deduction_month)
      if (matching) setPeriodId(matching.id)
    })()
    return () => {
      cancelled = true
    }
  }, [ledger.driver_id, ledger.deduction_month])

  async function submit() {
    if (!periodId) return onDone(vm.errPeriodRequired, null)
    setBusy(true)
    const res = await applyLedgerDeduction({ ledger_id: ledger.id, payroll_period_id: periodId })
    setBusy(false)
    onDone(res.success ? null : (res.error ?? "Error"), ledger.driver_id)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{vm.applyToPeriod}</DialogTitle>
          <DialogDescription>{vm.applyToPeriodDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{vm.fieldPayrollPeriod}</Label>
            {periods === null ? (
              <p className="text-sm text-muted-foreground">{t.common.loading}</p>
            ) : periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">{vm.noOpenPeriods}</p>
            ) : (
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger dir="ltr"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {`${p.period_year}-${String(p.period_month).padStart(2, "0")} · ${p.status}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {periods && periods.length > 0 && <p className="text-xs text-muted-foreground">{vm.applyHint}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy || !periodId}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {vm.applyToPeriod}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RollbackDialog({
  open,
  ledger,
  onClose,
  onDone,
}: {
  open: boolean
  ledger: LedgerRow
  onClose: () => void
  onDone: (err: string | null, driverId?: string | null) => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (reason.trim().length < 5) return onDone(vm.rollbackReasonRequired, null)
    setBusy(true)
    const res = await rollbackLedgerDeduction({ ledger_id: ledger.id, reason })
    setBusy(false)
    onDone(res.success ? null : (res.error ?? "Error"), ledger.driver_id)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{vm.rollback}</DialogTitle>
          <DialogDescription>{vm.rollbackDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>{vm.rollbackReason}</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {vm.rollback}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
