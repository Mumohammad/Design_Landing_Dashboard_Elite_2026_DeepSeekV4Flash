"use client"

import { Lightbulb, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { Insight } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { formatNumber } from "./format"

export function Insights({ insights }: { insights: Insight[] }) {
  const { t, locale } = useTranslation()

  if (insights.length === 0) return null

  const kindMeta: Record<Insight["kind"], { icon: LucideIcon; chip: string }> = {
    positive: { icon: TrendingUp, chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    negative: { icon: TrendingDown, chip: "bg-red-500/10 text-red-600 dark:text-red-400" },
    neutral: { icon: Lightbulb, chip: "bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300" },
  }

  const textFor = (i: Insight): string => {
    const n = formatNumber(locale, i.value)
    const platform = i.secondary ?? ""
    switch (i.key) {
      case "orders":
        return i.kind === "positive"
          ? t.dashboard.insightOrdersUp.replace("{n}", n)
          : t.dashboard.insightOrdersDown.replace("{n}", n)
      case "completion":
        return i.kind === "positive"
          ? t.dashboard.insightCompletionUp.replace("{n}", n)
          : t.dashboard.insightCompletionDown.replace("{n}", n)
      case "revenue":
        return i.kind === "positive"
          ? t.dashboard.insightRevenueUp.replace("{n}", n)
          : t.dashboard.insightRevenueDown.replace("{n}", n)
      case "maintenance":
        return i.kind === "positive"
          ? t.dashboard.insightMaintenanceDown.replace("{n}", n)
          : t.dashboard.insightMaintenanceUp.replace("{n}", n)
      case "best_platform":
        return t.dashboard.insightBestPlatform.replace("{platform}", platform).replace("{n}", n)
      case "below_target":
        return t.dashboard.insightBelowTarget.replace("{n}", n)
    }
  }

  return (
    <ChartCard title={t.dashboard.operationsInsights}>
      <ul className="space-y-2">
        {insights.map((i) => {
          const meta = kindMeta[i.kind]
          const Icon = meta.icon
          return (
            <li
              key={i.id}
              className="flex items-start gap-3 rounded-xl border border-border/60 p-3"
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", meta.chip)}>
                <Icon className="h-4 w-4" />
              </span>
              <p className="text-[13px] leading-relaxed text-foreground/90">{textFor(i)}</p>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
