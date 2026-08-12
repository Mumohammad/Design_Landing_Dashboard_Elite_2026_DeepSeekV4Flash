"use client"

import { useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { TrendPoint } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatBucketLabel, formatNumber } from "./format"

export function OrdersTrend({
  data,
  available,
  onRetry,
}: {
  data: TrendPoint[]
  available: boolean
  onRetry?: () => void
}) {
  const { t, locale } = useTranslation()

  const [series, setSeries] = useState<Record<"completed" | "cancelled" | "failed", boolean>>({
    completed: true,
    cancelled: true,
    failed: true,
  })

  const chartConfig = {
    completed: { label: t.dashboard.completed, color: "#10B981" },
    cancelled: { label: t.dashboard.cancelled, color: "#F59E0B" },
    failed: { label: t.dashboard.failed, color: "#EF4444" },
  } satisfies ChartConfig

  if (!available) return <ChartCard title={t.dashboard.ordersTrend} description={t.dashboard.ordersTrendDesc}><OfflineState onRetry={onRetry} /></ChartCard>
  if (data.length === 0)
    return (
      <ChartCard title={t.dashboard.ordersTrend} description={t.dashboard.ordersTrendDesc}>
        <EmptyState title={t.dashboard.emptyDashboard} description={t.dashboard.ordersTrendDesc} />
      </ChartCard>
    )

  return (
    <ChartCard
      title={t.dashboard.ordersTrend}
      description={t.dashboard.ordersTrendDesc}
      action={
        <div className="flex items-center gap-1">
          {(Object.keys(series) as (keyof typeof series)[]).map((key) => (
            <button
              key={key}
              onClick={() => setSeries((s) => ({ ...s, [key]: !s[key] }))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors",
                series[key]
                  ? "border-transparent text-foreground"
                  : "border-border text-muted-foreground opacity-60",
              )}
              style={series[key] ? { backgroundColor: `${chartConfig[key].color}1a` } : undefined}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: series[key] ? chartConfig[key].color : undefined }}
              />
              {chartConfig[key].label}
            </button>
          ))}
        </div>
      }
    >
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <AreaChart data={data} margin={{ left: -14, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: string) => formatBucketLabel(locale, v)}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v: unknown) =>
                  formatBucketLabel(locale, String(v))
                }
                formatter={(value: unknown, name: unknown) => (
                  <div className="flex w-full items-center justify-between gap-6">
                    <span className="text-muted-foreground">{name as string}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {formatNumber(locale, Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          {series.completed && (
            <Area dataKey="completed" type="monotone" fill="var(--color-completed)" fillOpacity={0.15} stroke="var(--color-completed)" strokeWidth={2} dot={false} />
          )}
          {series.cancelled && (
            <Area dataKey="cancelled" type="monotone" fill="var(--color-cancelled)" fillOpacity={0.1} stroke="var(--color-cancelled)" strokeWidth={2} dot={false} />
          )}
          {series.failed && (
            <Area dataKey="failed" type="monotone" fill="var(--color-failed)" fillOpacity={0.1} stroke="var(--color-failed)" strokeWidth={2} dot={false} />
          )}
        </AreaChart>
      </ChartContainer>
    </ChartCard>
  )
}
