"use client"

// Daily-entry CSV paste-import dialog (Prompt O Part 2): client-side
// validation preview, then the server action reports per-row failures
// (duplicate natural key / unknown driver) partial-failure style.

import { useMemo, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
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
import { importDailyEntries } from "@/lib/platforms-module/actions"
import { parseDailyRowsCsv } from "@/lib/platforms-module/module-utils"
import { Loader2 } from "lucide-react"

interface ImportFailure {
  rowNumber: number
  error: string
}

export function ImportDialog({
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
  const [csv, setCsv] = useState("")
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState<ImportFailure[]>([])
  const [inserted, setInserted] = useState<number | null>(null)
  // Session-initialized state — the parent remounts with a fresh key per open.

  const parsed = useMemo(() => (platformId ? parseDailyRowsCsv(csv, platformId) : { rows: [], okCount: 0, errorCount: 0 }), [csv, platformId])

  async function run() {
    if (!platformId) return
    const okRows = parsed.rows.filter((r) => r.ok)
    if (okRows.length === 0) {
      onDone(t.common.error)
      return
    }
    setBusy(true)
    const res = await importDailyEntries(
      okRows.map((r) => ({
        rowNumber: r.rowNumber,
        driver_code: r.driver_code,
        driver_id: r.driver_code, // resolved server-side from driver_code
        entry_date: r.entry_date,
        shift_label: r.shift_label || null,
        orders_delivered: r.orders_delivered ?? 0,
        orders_failed: r.orders_failed ?? 0,
        orders_returned: r.orders_returned ?? 0,
        gross_revenue: r.gross_revenue ?? 0,
        notes: r.notes || null,
      })),
      platformId,
      "import"
    )
    setBusy(false)
    if (res.success) {
      setInserted(res.inserted ?? 0)
      setFailures(res.failures ?? [])
    } else {
      onDone(res.error ?? "Error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pm.importEntries}</DialogTitle>
          <DialogDescription>{platformName} — {pm.importEntriesDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{pm.importCsv}</Label>
            <Textarea
              dir="ltr"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={7}
              placeholder={pm.importPlaceholder}
              className="font-mono text-xs"
            />
          </div>
          {csv.trim() !== "" && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>{pm.importRowsParsed}: <strong dir="ltr">{parsed.rows.length}</strong></span>
              <span className="text-emerald-600">{pm.importRowsOk}: <strong dir="ltr">{parsed.okCount}</strong></span>
              <span className={parsed.errorCount > 0 ? "text-red-500 font-medium" : ""}>{pm.importRowsFailed}: <strong dir="ltr">{parsed.errorCount}</strong></span>
            </div>
          )}
          {parsed.rows.some((r) => !r.ok) && (
            <div className="max-h-32 overflow-y-auto rounded-xl border border-red-500/30 bg-red-500/5 p-2 text-xs">
              {parsed.rows.filter((r) => !r.ok).slice(0, 20).map((r) => (
                <p key={r.rowNumber} dir="ltr" className="text-red-500">
                  row {r.rowNumber}: {r.error}
                </p>
              ))}
            </div>
          )}
          {inserted !== null && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              <p className={failures.length > 0 ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}>
                {failures.length > 0
                  ? pm.importPartial.replace("{ok}", String(inserted)).replace("{failed}", String(failures.length))
                  : pm.importSuccess.replace("{ok}", String(inserted))}
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
            {pm.importRun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
