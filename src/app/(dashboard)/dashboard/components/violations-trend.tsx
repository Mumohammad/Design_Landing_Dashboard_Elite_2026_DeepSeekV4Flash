"use client"

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useTranslation } from "@/hooks/use-translation"
import type { TrendPoint } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatBucketLabel, formatNumber } from "./format"

export function ViolationsTrend({
  data,
  available,
  onRetry,
}: {
  data: TrendPoint[]
  available: boolean
  onRetry?: () => void
}) {
  const { t, locale } = useTranslation()

  const chartConfig = {
    violations: { label: t.dashboard.violations, color: "#EF4444" },
    penalties: { label: t.dashboard.penalties, color: "#E87D3E" },
  } satisfies ChartConfig

  if (!available)
    return (
      <ChartCard title={t.dashboard.violationsTrend} description={t.dashboard.violationsTrendDesc}>
        <OfflineState onRetry={onRetry} />
      </ChartCard>
    )
  if (data.length === 0)
    return (
      <ChartCard title={t.dashboard.violationsTrend} description={t.dashboard.violationsTrendDesc}>
        <EmptyState title={t.dashboard.emptyDashboard} description={t.dashboard.violationsTrendDesc} />
      </ChartCard>
    )

  return (
    <ChartCard title={t.dashboard.violationsTrend} description={t.dashboard.violationsTrendDesc}>
      <ChartContainer config={chartConfig} className="h-56 w-full">
        <ComposedChart data={data} margin={{ left: -18, right: -6, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: string) => formatBucketLabel(locale, v)}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={36} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v: unknown) => formatBucketLabel(locale, String(v))}
                formatter={(value: unknown, name: unknown) => (
                  <div className="flex w-full items-center justify-between gap-6">
                    <span className="text-muted-foreground">{name as string}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {name === t.dashboard.penalties
                        ? `${formatNumber(locale, Number(value))} ${locale === "ar" ? "ر.س" : "SAR"}`
                        : formatNumber(locale, Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="violations" fill="var(--color-violations)" radius={[4, 4, 0, 0]} barSize={22} isAnimationActive={false} />
          <Line dataKey="penalties" type="monotone" stroke="var(--color-penalties)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ChartContainer>
    </ChartCard>
  )
}
