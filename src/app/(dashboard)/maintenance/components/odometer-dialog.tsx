"use client"

// Odometer history dialog (Prompt O Part 1): per-vehicle readings from
// vehicle_odometer_logs with an inline sparkline + add-reading form.

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useEffect, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { addOdometerReading } from "@/lib/maintenance/actions"
import { odometerSparkline } from "@/lib/maintenance/module-utils"
import { Loader2, Plus } from "lucide-react"

interface OdometerLog {
  id: string
  reading: number
  recorded_at: string
  source: string
  notes: string | null
}

function Sparkline({ values }: { values: number[] }) {
  const ui = useUiText()
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const w = 220
  const h = 40
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * h}`)
    .join(" ")
  return (
    <svg width={w} height={h} className="overflow-visible" role="img" aria-label={ui("odometer trend")}>
      <polyline
        points={points}
        fill="none"
        stroke="#1E5A99"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type OdometerDialogProps = {
  vehicleId: string | null
  vehicleLabel: string
  onClose: () => void
}

export function OdometerDialog(props: OdometerDialogProps) {
  if (!props.vehicleId) return null
  return <OdometerForm key={props.vehicleId} {...props} vehicleId={props.vehicleId} />
}

function OdometerForm({
  vehicleId,
  vehicleLabel,
  onClose,
}: OdometerDialogProps & { vehicleId: string }) {
  const { t } = useTranslation()
  const m = t.maintenanceModule
  const vm = t.vehicles
  const isAr = t.common.status === "الحالة"
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{revision: number; logs: OdometerLog[]; failed: boolean} | null>(null)
  const [reading, setReading] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const { data, error } = await createClient()
          .from("vehicle_odometer_logs")
          .select("id,reading,recorded_at,source,notes")
          .eq("vehicle_id", vehicleId)
          .is("deleted_at", null)
          .order("recorded_at", { ascending: false })
          .limit(50)
          .abortSignal(controller.signal)
        if (controller.signal.aborted) return
        if (error) throw Error("Odometer history unavailable")
        setResult({revision, logs: (data as OdometerLog[]) ?? [], failed: false})
      } catch {
        if (!controller.signal.aborted) setResult({revision, logs: [], failed: true})
      }
    })()
    return () => controller.abort()
  }, [vehicleId, revision])

  const current = result?.revision === revision ? result : null
  const logs = current?.logs ?? []
  const loading = current === null

  async function submit() {
    if (busy) return
    const value = Number(reading)
    if (!reading || Number.isNaN(value) || value < 0) {
      setErr(m.errReadingRequired)
      return
    }
    setBusy(true)
    try {
      const res = await addOdometerReading({ vehicle_id: vehicleId, reading: value })
      if (res.success) {
        setReading("")
        setErr(null)
        setRevision(value => value + 1)
      } else {
        setErr(res.error ?? "Error")
      }
    } catch {
      setErr(isAr ? "تعذر تأكيد قراءة العداد. أعد التحميل قبل المحاولة مجدداً." : "The odometer reading could not be confirmed. Reload before retrying.")
    } finally {
      setBusy(false)
    }
  }

  const series = odometerSparkline(logs.map((l) => ({ reading: l.reading, recorded_at: l.recorded_at })))

  return (
    <Dialog open={vehicleId != null} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.odometerDialog}</DialogTitle>
          <DialogDescription>{vehicleLabel}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {series.length >= 2 && (
            <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{m.odometerHistory}</p>
              <Sparkline values={series} />
            </div>
          )}

          <div className="max-h-56 overflow-y-auto rounded-xl border border-border/40">
            {loading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : current?.failed ? (
              <div role="alert" className="space-y-2 p-4 text-sm text-destructive">
                <p>{isAr ? "تعذر تحميل سجل العداد." : "Could not load odometer history."}</p>
                <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>{isAr ? "أعد المحاولة" : "Try again"}</Button>
              </div>
            ) : logs.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">{vm.noOdometerLogs}</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b border-border/20 last:border-0">
                      <td dir="ltr" className="px-3 py-2 tabular-nums">{l.reading.toLocaleString()} <LocalizedText text="km" /></td>
                      <td dir="ltr" className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(l.recorded_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {l.source === "manual" ? vm.sourceManual : l.source === "gps" ? vm.sourceGps : l.source === "obd" ? vm.sourceObd : vm.sourceImport}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div className="grid gap-1.5">
              <Label>{m.addOdometerReading}</Label>
              <Input aria-label={m.addOdometerReading} dir="ltr" type="number" min="0" value={reading} onChange={(e) => setReading(e.target.value)} placeholder="0" disabled={busy} />
            </div>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t.common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
