"use client"

import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useTranslation } from "@/hooks/use-translation"
import type { TrendPoint } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatBucketLabel, formatNumber } from "./format"

export function RevenueTrend({
  data,
  available,
  onRetry,
}: {
  data: TrendPoint[]
  available: boolean
  onRetry?: () => void
}) {
  const { t, locale } = useTranslation()
  const hasPayroll = data.some((p) => (p.payroll ?? 0) > 0)

  const chartConfig = {
    revenue: { label: t.dashboard.revenue, color: "#1E5A99" },
    payroll: { label: t.dashboard.netPayroll, color: "#E87D3E" },
  } satisfies ChartConfig

  if (!available)
    return (
      <ChartCard title={t.dashboard.revenueVsPayroll} description={t.dashboard.revenueVsPayrollDesc}>
        <OfflineState onRetry={onRetry} />
      </ChartCard>
    )
  if (data.length === 0)
    return (
      <ChartCard title={t.dashboard.revenueVsPayroll} description={t.dashboard.revenueVsPayrollDesc}>
        <EmptyState title={t.dashboard.emptyDashboard} />
      </ChartCard>
    )

  return (
    <ChartCard title={t.dashboard.revenueVsPayroll} description={t.dashboard.revenueVsPayrollDesc}>
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <ComposedChart data={data} margin={{ left: -6, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v: string) => formatBucketLabel(locale, v)}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={52} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v: unknown) => formatBucketLabel(locale, String(v))}
                formatter={(value: unknown, name: unknown) => (
                  <div className="flex w-full items-center justify-between gap-6">
                    <span className="text-muted-foreground">{name as string}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {formatNumber(locale, Number(value))} {locale === "ar" ? "ر.س" : "SAR"}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Area
            dataKey="revenue"
            type="monotone"
            fill="var(--color-revenue)"
            fillOpacity={0.18}
            stroke="var(--color-revenue)"
            strokeWidth={2}
            dot={false}
          />
          {hasPayroll && (
            <Line
              dataKey="payroll"
              type="monotone"
              stroke="var(--color-payroll)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </ChartCard>
  )
}
