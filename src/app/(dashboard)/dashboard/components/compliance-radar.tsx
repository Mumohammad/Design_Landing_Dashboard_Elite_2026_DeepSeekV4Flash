"use client"

import Link from "next/link"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useTranslation } from "@/hooks/use-translation"
import type { ComplianceSummary } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatNumber } from "./format"

export function ComplianceRadar({
  compliance,
  available,
  onRetry,
}: {
  compliance: ComplianceSummary
  available: boolean
  onRetry?: () => void
}) {
  const { t, locale } = useTranslation()

  const chartConfig = {
    valid: { label: t.dashboard.valid, color: "#10B981" },
    expiring: { label: t.dashboard.expiring, color: "#F59E0B" },
    expired: { label: t.dashboard.expired, color: "#EF4444" },
  } satisfies ChartConfig

  const rows = [
    { name: t.dashboard.iqama, ...compliance.iqama },
    { name: t.dashboard.license, ...compliance.license },
    { name: t.dashboard.insurance, ...compliance.insurance },
    { name: t.dashboard.registration, ...compliance.registration },
  ]

  const total = rows.reduce((s, r) => s + r.valid + r.expiring + r.expired, 0)
  const expiringSoon = rows.reduce((s, r) => s + r.expiring, 0)
  const expired = rows.reduce((s, r) => s + r.expired, 0)

  if (!available)
    return (
      <ChartCard title={t.dashboard.complianceRadar} description={t.dashboard.complianceRadarDesc}>
        <OfflineState onRetry={onRetry} />
      </ChartCard>
    )
  if (total === 0)
    return (
      <ChartCard title={t.dashboard.complianceRadar} description={t.dashboard.complianceRadarDesc}>
        <EmptyState title={t.dashboard.emptyDashboard} description={t.dashboard.complianceRadarDesc} />
      </ChartCard>
    )

  return (
    <ChartCard
      title={t.dashboard.complianceRadar}
      description={t.dashboard.complianceRadarDesc}
      action={
        (expiringSoon > 0 || expired > 0) && (
          <Link
            href="/drivers"
            className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-500/20"
          >
            {expired > 0 ? `${expired} ${t.dashboard.expired}` : `${expiringSoon} ${t.dashboard.expiring}`}
          </Link>
        )
      }
    >
      <ChartContainer config={chartConfig} className="h-56 w-full">
        <BarChart data={rows} margin={{ left: -18, right: 8, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={36} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={
              <ChartTooltipContent
                labelClassName="mb-1"
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
          <Bar dataKey="valid" stackId="a" fill="var(--color-valid)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expiring" stackId="a" fill="var(--color-expiring)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expired" stackId="a" fill="var(--color-expired)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}
