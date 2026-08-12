"use client"

import { useState } from "react"
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { PlatformMetric } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatCurrency, formatNumber } from "./format"

type MetricKey = "orders" | "revenue" | "completionRate"

const COLORS = ["#1E5A99", "#2F7BC4", "#E87D3E", "#10B981", "#8B5CF6", "#F59E0B"]

export function PlatformPerformance({
  data,
  available,
  onRetry,
}: {
  data: PlatformMetric[]
  available: boolean
  onRetry?: () => void
}) {
  const { t, locale } = useTranslation()
  const [metric, setMetric] = useState<MetricKey>("orders")

  const chartConfig = {
    value: { label: t.dashboard.orders, color: "#1E5A99" },
  } satisfies ChartConfig

  const rows = [...data].sort((a, b) => b[metric] - a[metric]).slice(0, 8)
  const isCurrency = metric === "revenue"
  const isRate = metric === "completionRate"
  const maxValue = Math.max(1, ...rows.map((r) => r[metric]))

  if (!available)
    return (
      <ChartCard title={t.dashboard.platformPerformance} description={t.dashboard.platformPerformanceDesc}>
        <OfflineState onRetry={onRetry} />
      </ChartCard>
    )
  if (rows.length === 0)
    return (
      <ChartCard title={t.dashboard.platformPerformance} description={t.dashboard.platformPerformanceDesc}>
        <EmptyState title={t.dashboard.emptyDashboard} />
      </ChartCard>
    )

  return (
    <ChartCard
      title={t.dashboard.platformPerformance}
      description={t.dashboard.platformPerformanceDesc}
      action={
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          {(
            [
              ["orders", t.dashboard.orders],
              ["revenue", t.dashboard.revenue],
              ["completionRate", t.dashboard.completionRate],
            ] as [MetricKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMetric(key)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
                metric === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 0 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <XAxis type="number" hide domain={[0, maxValue]} />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            width={92}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--color-muted, rgba(0,0,0,0.04))" }}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value: unknown) => (
                  <div className="flex w-full items-center justify-between gap-6">
                    <span className="text-muted-foreground">{chartConfig.value.label}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {isRate
                        ? `${formatNumber(locale, Number(value))}%`
                        : isCurrency
                          ? formatCurrency(locale, Number(value))
                          : formatNumber(locale, Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey={metric} radius={[0, 6, 6, 0]} barSize={18} isAnimationActive={false}>
            {rows.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}
