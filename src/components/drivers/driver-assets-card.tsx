"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
import { Skeleton } from "@/components/ui/skeleton"
import { PackageOpen } from "lucide-react"

type AssetRow = {
  id: string
  asset_type: string
  serial: string | null
  condition: string | null
  handed_over_at: string | null
  returned_at: string | null
  handover_ref: string | null
  notes: string | null
}

/** Assets issued to the driver (overview card) backed by driver_assets. */
export function DriverAssetsCard({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [rows, setRows] = useState<AssetRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data } = await createClient()
        .from("driver_assets")
        .select(
          "id, asset_type, serial, condition, handed_over_at, returned_at, handover_ref, notes",
        )
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20)
      if (!cancelled) setRows((data as AssetRow[] | null) ?? [])
    }
    void load()
    // Reload when another surface issues/returns assets via the events bus.
    const unsubscribe = subscribeDriverChanged((detail) => {
      if (detail.driverId === driverId && detail.action === "assets") void load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [driverId])

  if (rows === null) {
    return <Skeleton className="h-40 rounded-2xl lg:col-span-2" />
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm lg:col-span-2">
      <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
        <PackageOpen className="h-4 w-4 text-elite-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">
          {isAr ? "الأصول المسلَّمة" : "Assets Issued"}
        </h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isAr ? "لا توجد أصول مسلَّمة للسائق" : "No assets issued to this driver"}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-0.5 rounded-xl border border-border/40 bg-background/40 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{r.asset_type}</span>
                {r.returned_at ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {isAr ? "مُسترَد" : "Returned"}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    {isAr ? "بحوزة السائق" : "Held"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                {r.serial && (
                  <span className="font-mono" dir="ltr">
                    {r.serial}
                  </span>
                )}
                {r.condition && <span>{r.condition}</span>}
                {r.handed_over_at && (
                  <span>
                    {isAr ? "سُلِّم" : "handed"} {r.handed_over_at.slice(0, 10)}
                  </span>
                )}
                {r.handover_ref && <span className="font-mono">{r.handover_ref}</span>}
              </div>
              {r.notes && <p className="text-xs text-muted-foreground/80">{r.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
