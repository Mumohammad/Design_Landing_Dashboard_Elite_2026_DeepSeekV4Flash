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

export function OdometerDialog({
  vehicleId,
  vehicleLabel,
  onClose,
}: {
  vehicleId: string | null
  vehicleLabel: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const m = t.maintenanceModule
  const vm = t.vehicles
  const isAr = t.common.status === "الحالة"
  const [logs, setLogs] = useState<OdometerLog[]>([])
  const [loading, setLoading] = useState(false)
  const [reading, setReading] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    if (!vehicleId) return
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("vehicle_odometer_logs")
      .select("id,reading,recorded_at,source,notes")
      .eq("vehicle_id", vehicleId)
      .is("deleted_at", null)
      .order("recorded_at", { ascending: false })
      .limit(50)
    setLogs((data as OdometerLog[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (vehicleId) {
      load()
      setReading("")
      setErr(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId])

  async function submit() {
    if (!vehicleId) return
    const value = Number(reading)
    if (!reading || Number.isNaN(value) || value < 0) {
      setErr(m.errReadingRequired)
      return
    }
    setBusy(true)
    const res = await addOdometerReading({ vehicle_id: vehicleId, reading: value })
    setBusy(false)
    if (res.success) {
      setReading("")
      setErr(null)
      await load()
    } else {
      setErr(res.error ?? "Error")
    }
  }

  const series = odometerSparkline(logs.map((l) => ({ reading: l.reading, recorded_at: l.recorded_at })))

  return (
    <Dialog open={vehicleId != null} onOpenChange={(o) => !o && onClose()}>
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
              <Input aria-label={m.addOdometerReading} dir="ltr" type="number" min="0" value={reading} onChange={(e) => setReading(e.target.value)} placeholder="0" />
            </div>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
