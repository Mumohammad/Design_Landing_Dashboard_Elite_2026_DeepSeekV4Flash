"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Car, Gavel, Link2, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import { createViolationFromFine } from "@/app/actions/violations/fines"

type Row = { id: string; external_ref: string; vehicle_plate: string | null; violation_date: string | null; fine_amount: number | null; violation_type_code: string | null; status: string; violation_id: string | null }

/** Traffic fines auto-attributed to this driver (vehicle held on the fine date). */
export function DriverTrafficFines({ driverId, isAr, onConverted }: { driverId: string; isAr: boolean; onConverted?: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fetchRows = useCallback(async (): Promise<Row[]> => {
    const { data, error } = await createClient().from("external_fine_imports")
      .select("id,external_ref,vehicle_plate,violation_date,fine_amount,violation_type_code,status,violation_id")
      .eq("matched_driver_id", driverId).in("status", ["matched", "violation_created"])
      .order("violation_date", { ascending: false, nullsFirst: false }).limit(50)
    return error ? [] : ((data ?? []) as Row[])
  }, [driverId])
  const load = useCallback(async () => setRows(await fetchRows()), [fetchRows])
  useEffect(() => {
    let cancelled = false
    void fetchRows().then((r) => { if (!cancelled) setRows(r) })
    return () => { cancelled = true }
  }, [fetchRows])

  if (!rows || rows.length === 0) return null
  const pending = rows.filter((r) => r.status === "matched")
  const pendingAmount = pending.reduce((s, r) => s + Number(r.fine_amount ?? 0), 0)

  return (
    <section className="rounded-2xl border bg-gradient-to-br from-rose-500/5 to-transparent p-4" aria-label={isAr ? "المخالفات المرورية" : "Traffic fines"} data-testid="driver-traffic-fines">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Gavel className="size-4 text-rose-600" />{isAr ? "المخالفات المرورية المطابقة" : "Matched traffic fines"}</h3>
        <div className="flex items-center gap-3 text-xs">
          {pending.length > 0 && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 font-medium text-rose-700 dark:text-rose-300">{isAr ? `${pending.length} بانتظار التحويل · ${pendingAmount.toLocaleString("ar-SA")} ر.س` : `${pending.length} awaiting action · SAR ${pendingAmount.toLocaleString("en-SA")}`}</span>}
          <Link href="/violations/fines" className="text-primary hover:underline">{isAr ? "كل المخالفات المرورية" : "All traffic fines"}</Link>
        </div>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div className="flex items-center gap-3">
              <Car className="size-4 text-muted-foreground" />
              <div>
                <p className="font-medium tabular-nums" dir="ltr">{r.external_ref}{r.vehicle_plate ? ` · ${r.vehicle_plate}` : ""}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{r.violation_date ?? "—"}{r.violation_type_code ? ` · ${r.violation_type_code}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">{Number(r.fine_amount ?? 0).toLocaleString(isAr ? "ar-SA" : "en-SA")} {isAr ? "ر.س" : "SAR"}</span>
              {r.status === "matched" ? (
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={async () => {
                  setBusy(r.id)
                  const res = await createViolationFromFine(r.id)
                  setBusy(null)
                  if (!res.ok) { toast.error(isAr ? res.errorAr : res.error); return }
                  toast.success(isAr ? "تم إنشاء المخالفة" : "Violation created")
                  emitDriverChanged({ driverId, action: "violation" })
                  void load(); onConverted?.()
                }}>{busy === r.id ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Link2 className="me-1.5 size-3.5" />}{isAr ? "تحويل لمخالفة" : "Create violation"}</Button>
              ) : <span className={cn("rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300")}>{isAr ? "مُحوّلة" : "Converted"}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
