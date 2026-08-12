"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { DriverTargetRow } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatNumber } from "./format"

export function DriverTargets({
  data,
  buckets,
  available,
  onRetry,
}: {
  data: DriverTargetRow[]
  buckets: { bucket: string; count: number }[]
  available: boolean
  onRetry?: () => void
}) {
  const { t, locale } = useTranslation()

  const statusMeta = {
    exceeded: { label: t.dashboard.statusExceeded, bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
    on_track: { label: t.dashboard.statusOnTrack, bar: "bg-elite-blue-500", text: "text-elite-blue-600 dark:text-elite-blue-300", bg: "bg-elite-blue-500/10" },
    below: { label: t.dashboard.statusBelow, bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
  } as const

  if (!available)
    return (
      <ChartCard title={t.dashboard.driverTargets} description={t.dashboard.driverTargetsDesc}>
        <OfflineState onRetry={onRetry} />
      </ChartCard>
    )
  if (data.length === 0)
    return (
      <ChartCard title={t.dashboard.driverTargets} description={t.dashboard.driverTargetsDesc}>
        <EmptyState title={t.dashboard.emptyDashboard} description={t.dashboard.driverTargetsDesc} />
      </ChartCard>
    )

  const totalBuckets = buckets.reduce((s, b) => s + b.count, 0)

  return (
    <ChartCard title={t.dashboard.driverTargets} description={t.dashboard.driverTargetsDesc}>
      <div className="space-y-4">
        {/* Target distribution buckets */}
        {totalBuckets > 0 && (
          <div className="grid grid-cols-5 gap-1.5">
            {buckets.map((b) => (
              <div
                key={b.bucket}
                className="rounded-lg border border-border/70 bg-muted/30 px-1.5 py-2 text-center"
                title={b.bucket}
              >
                <p className="text-sm font-bold tabular-nums text-foreground">{b.count}</p>
                <p className="truncate text-[10px] text-muted-foreground">{b.bucket}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {data.map((d) => {
            const s = statusMeta[d.status]
            const pct = Math.min(d.achievement, 150)
            return (
              <Link
                key={d.driverId}
                href={`/drivers/${d.driverId}`}
                className="group block rounded-lg p-1.5 transition-colors hover:bg-accent/50"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-xs font-bold text-white">
                    {d.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold text-foreground">{d.name}</p>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums", s.text, s.bg)}>
                        {formatNumber(locale, d.achievement)}%
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", s.bar)}
                          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                        />
                        {/* 100% target marker */}
                        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/25" />
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {formatNumber(locale, d.actual)}/{formatNumber(locale, d.target)}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </ChartCard>
  )
}
