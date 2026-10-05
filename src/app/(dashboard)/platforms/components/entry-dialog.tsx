"use client"

// Manual daily-entry dialog (Prompt O Part 2): a driver picker (tenant
// drivers on this platform), date, shift and order counts → createDailyEntry.
// Session-initialized state — the parent remounts with a fresh key per open,
// so initial state derives straight from props (no reset effect).

import { useEffect, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { createDailyEntry } from "@/lib/platforms-module/actions"
import { Loader2 } from "lucide-react"

interface DriverOption {
  id: string
  full_name_ar: string | null
  full_name_en: string | null
  driver_code: string | null
}

// shift_label storage convention: NULL = full day (matches the natural-key
// COALESCE(shift_label,'full_day') and the /orders module).
const SHIFTS = [
  { value: "full_day", key: "fullDay" },
  { value: "morning", key: "shiftMorning" },
  { value: "evening", key: "shiftEvening" },
] as const

export function EntryDialog({
  open,
  platformId,
  platformName,
  onClose,
  onDone,
}: {
  open: boolean
  platformId: string | null
  platformName: string
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const pm = t.platformsModule
  const om = t.orders
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [driverId, setDriverId] = useState("")
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [shift, setShift] = useState<(typeof SHIFTS)[number]["value"]>("full_day")
  const [delivered, setDelivered] = useState("")
  const [failed, setFailed] = useState("0")
  const [returned, setReturned] = useState("0")
  const [revenue, setRevenue] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [loadingDrivers, setLoadingDrivers] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!platformId) return
      const supabase = createClient()
      const { data } = await supabase
        .from("drivers")
        .select("id,full_name_ar,full_name_en,driver_code")
        .eq("primary_platform_id", platformId)
        .in("status", ["active", "on_leave"])
        .is("deleted_at", null)
        .order("full_name_ar", { ascending: true })
        .limit(500)
      if (!cancelled) {
        const list = (data as DriverOption[]) ?? []
        setDrivers(list)
        setLoadingDrivers(false)
        if (list.length > 0) setDriverId(list[0].id)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [platformId])

  async function submit() {
    if (!platformId || !driverId) return
    const num = (v: string): number | null => {
      if (v.trim() === "") return null
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : NaN
    }
    const d = num(delivered)
    const f = num(failed)
    const r = num(returned)
    const rev = num(revenue)
    if (Number.isNaN(d) || Number.isNaN(f) || Number.isNaN(r) || Number.isNaN(rev)) {
      return onDone(pm.errAmountInvalid)
    }
    if ((d ?? 0) === 0 && (f ?? 0) === 0 && (r ?? 0) === 0 && rev === null) {
      return onDone(pm.errEntryRequired)
    }

    setBusy(true)
    const res = await createDailyEntry({
      platform_id: platformId,
      driver_id: driverId,
      entry_date: entryDate,
      shift_label: shift === "full_day" ? null : shift,
      orders_delivered: d ?? 0,
      orders_failed: f ?? 0,
      orders_returned: r ?? 0,
      gross_revenue: rev ?? 0,
      notes: notes.trim() || null,
    })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pm.addEntry}</DialogTitle>
          <DialogDescription>{platformName} — {pm.addEntryDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{om.fieldDriver} *</Label>
            {loadingDrivers ? (
              <div className="flex h-9 items-center gap-2 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t.common.loading}
              </div>
            ) : (
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={om.fieldDriver} />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name_ar || d.full_name_en || "—"}
                      {d.driver_code ? ` (${d.driver_code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{om.fieldDate} *</Label>
              <Input dir="ltr" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{om.fieldShiftLabel}</Label>
              <Select value={shift} onValueChange={(v) => setShift(v as (typeof SHIFTS)[number]["value"])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIFTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{om[s.key]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{om.fieldDelivered}</Label>
              <Input dir="ltr" type="number" min="0" value={delivered} onChange={(e) => setDelivered(e.target.value)} placeholder="0" />
            </div>
            <div className="grid gap-1.5">
              <Label>{om.fieldFailed}</Label>
              <Input dir="ltr" type="number" min="0" value={failed} onChange={(e) => setFailed(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{om.fieldReturned}</Label>
              <Input dir="ltr" type="number" min="0" value={returned} onChange={(e) => setReturned(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{om.fieldRevenue}</Label>
            <Input dir="ltr" type="number" min="0" step="0.01" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{om.fieldNotes}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy || loadingDrivers || !driverId}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
