"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { DriverTargetRow } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatCurrency, formatNumber } from "./format"

const STATUS_META: Record<
  DriverTargetRow["status"],
  { key: "statusExceeded" | "statusOnTrack" | "statusBelow"; chip: string }
> = {
  exceeded: { key: "statusExceeded", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  on_track: { key: "statusOnTrack", chip: "bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300" },
  below: { key: "statusBelow", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
}

export function DriverTable({
  data,
  available,
  onRetry,
}: {
  data: DriverTargetRow[]
  available: boolean
  onRetry?: () => void
}) {
  const { t, locale } = useTranslation()

  if (!available)
    return (
      <ChartCard title={t.dashboard.driverPerformanceTable} description={t.dashboard.driverPerformanceTableDesc}>
        <OfflineState onRetry={onRetry} />
      </ChartCard>
    )
  if (data.length === 0)
    return (
      <ChartCard title={t.dashboard.driverPerformanceTable} description={t.dashboard.driverPerformanceTableDesc}>
        <EmptyState title={t.dashboard.emptyDashboard} description={t.dashboard.driverPerformanceTableDesc} />
      </ChartCard>
    )

  return (
    <ChartCard title={t.dashboard.driverPerformanceTable} description={t.dashboard.driverPerformanceTableDesc}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-130 text-start text-[13px]">
          <thead>
            <tr className="border-b border-border/70 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 text-start font-semibold">{t.dashboard.driver}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.dashboard.orders}</th>
              <th className="px-2 py-2 text-end font-semibold">{t.dashboard.target}</th>
              <th className="px-2 py-2 text-start font-semibold">{t.dashboard.achievement}</th>
              <th className="hidden px-2 py-2 text-end font-semibold sm:table-cell">{t.dashboard.netSalary}</th>
              <th className="px-2 py-2 text-center font-semibold">{t.common.status}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              const s = STATUS_META[d.status]
              const pct = Math.min(Math.max(d.achievement, 0), 100)
              return (
                <tr key={d.driverId} className="border-b border-border/40 transition-colors last:border-0 hover:bg-accent/40">
                  <td className="px-2 py-2.5">
                    <Link href={`/drivers/${d.driverId}`} className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-xs font-bold text-white">
                        {d.name.slice(0, 1)}
                      </span>
                      <span className="max-w-36 truncate font-medium text-foreground hover:text-elite-blue-600 dark:hover:text-elite-blue-300">
                        {d.name}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-2.5 text-end tabular-nums text-foreground">{formatNumber(locale, d.actual)}</td>
                  <td className="px-2 py-2.5 text-end tabular-nums text-muted-foreground">{formatNumber(locale, d.target)}</td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            d.status === "exceeded" ? "bg-emerald-500" : d.status === "on_track" ? "bg-elite-blue-500" : "bg-amber-500",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(locale, d.achievement)}%</span>
                    </div>
                  </td>
                  <td className="hidden px-2 py-2.5 text-end tabular-nums text-foreground sm:table-cell">
                    {formatCurrency(locale, d.netPayroll)}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", s.chip)}>
                      {t.dashboard[s.key]}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </ChartCard>
  )
}
