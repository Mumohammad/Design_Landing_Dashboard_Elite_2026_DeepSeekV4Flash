"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { Driver } from "@/types/drivers"

type PerformanceTabProps = { driver: Driver; isAr: boolean }

type Snapshot = {
  id: string
  snapshot_month: string | null
  trips_completed: number | null
  on_time_delivery_rate: number | null
  customer_rating: number | null
  safety_score: number | null
  fuel_efficiency_score: number | null
  cod_collection_rate: number | null
  overall_score: number | null
  rank_in_fleet: number | null
}

function scoreColor(v: number | null): string {
  if (v === null) return "text-muted-foreground"
  if (v >= 80) return "text-emerald-600 dark:text-emerald-400"
  if (v >= 60) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

export function PerformanceTab({ driver, isAr }: PerformanceTabProps) {
  const [rows, setRows] = useState<Snapshot[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_performance_snapshots")
        .select(
          "id, snapshot_month, trips_completed, on_time_delivery_rate, customer_rating, safety_score, fuel_efficiency_score, cod_collection_rate, overall_score, rank_in_fleet",
        )
        .eq("driver_id", driver.id)
        .order("snapshot_month", { ascending: false })
        .limit(12)
      if (!cancelled) setRows(error ? [] : ((data ?? []) as unknown as Snapshot[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driver.id])

  const latest = rows && rows.length > 0 ? rows[0] : null

  const metrics = useMemo(() => {
    if (!latest) return []
    return [
      {
        label: isAr ? "الرحلات المكتملة" : "Trips completed",
        value: latest.trips_completed !== null ? String(latest.trips_completed) : "—",
        color: "text-foreground",
      },
      {
        label: isAr ? "التسليم في الوقت" : "On-time delivery",
        value:
          latest.on_time_delivery_rate !== null ? `${Number(latest.on_time_delivery_rate)}%` : "—",
        color: scoreColor(latest.on_time_delivery_rate),
      },
      {
        label: isAr ? "تقييم العملاء" : "Customer rating",
        value: latest.customer_rating !== null ? `${Number(latest.customer_rating)}/5` : "—",
        color:
          latest.customer_rating !== null && latest.customer_rating >= 4
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-amber-600 dark:text-amber-400",
      },
      {
        label: isAr ? "السلامة" : "Safety",
        value: latest.safety_score !== null ? `${Number(latest.safety_score)}%` : "—",
        color: scoreColor(latest.safety_score),
      },
      {
        label: isAr ? "كفاءة الوقود" : "Fuel efficiency",
        value:
          latest.fuel_efficiency_score !== null ? `${Number(latest.fuel_efficiency_score)}%` : "—",
        color: scoreColor(latest.fuel_efficiency_score),
      },
      {
        label: isAr ? "تحصيل COD" : "COD collection",
        value: latest.cod_collection_rate !== null ? `${Number(latest.cod_collection_rate)}%` : "—",
        color: scoreColor(latest.cod_collection_rate),
      },
    ]
  }, [latest, isAr])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }

  if (rows.length === 0 || !latest) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
        <p className="text-sm text-muted-foreground">
          {isAr ? "لا توجد لقطات أداء بعد" : "No performance snapshots yet"}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Latest month highlight */}
      <div className="rounded-2xl border border-border/50 bg-card/60 p-5 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs text-muted-foreground">
              {isAr ? "أحدث شهر" : "Latest month"}
            </div>
            <div className="text-sm font-semibold text-foreground" dir="ltr">
              {latest.snapshot_month ?? "—"}
            </div>
          </div>
          <div className="text-center">
            <div
              className={cn(
                "text-3xl font-extrabold tabular-nums",
                scoreColor(latest.overall_score),
              )}
              dir="ltr"
            >
              {latest.overall_score !== null ? Number(latest.overall_score) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {isAr ? "الدرجة الإجمالية" : "Overall score"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-extrabold tabular-nums text-foreground" dir="ltr">
              {latest.rank_in_fleet !== null ? `#${latest.rank_in_fleet}` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {isAr ? "الترتيب في الأسطول" : "Fleet rank"}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl bg-muted/30 p-3 text-center">
              <div className={cn("text-lg font-bold tabular-nums", m.color)} dir="ltr">
                {m.value}
              </div>
              <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
        <table className="w-full min-w-[720px] text-start text-sm">
          <thead>
            <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الشهر" : "Month"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الرحلات" : "Trips"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "في الوقت" : "On-time"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "التقييم" : "Rating"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "السلامة" : "Safety"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الإجمالي" : "Overall"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الترتيب" : "Rank"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground" dir="ltr">
                  {r.snapshot_month ?? "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.trips_completed ?? "—"}
                </td>
                <td className={cn("px-4 py-3 tabular-nums", scoreColor(r.on_time_delivery_rate))} dir="ltr">
                  {r.on_time_delivery_rate !== null ? `${Number(r.on_time_delivery_rate)}%` : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.customer_rating !== null ? Number(r.customer_rating).toFixed(1) : "—"}
                </td>
                <td className={cn("px-4 py-3 tabular-nums", scoreColor(r.safety_score))} dir="ltr">
                  {r.safety_score !== null ? `${Number(r.safety_score)}%` : "—"}
                </td>
                <td className={cn("px-4 py-3 font-semibold tabular-nums", scoreColor(r.overall_score))} dir="ltr">
                  {r.overall_score !== null ? Number(r.overall_score) : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground" dir="ltr">
                  {r.rank_in_fleet !== null ? `#${r.rank_in_fleet}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
