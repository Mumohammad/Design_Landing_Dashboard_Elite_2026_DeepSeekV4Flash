"use client"

import { Lightbulb, Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { Insight } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { formatNumber } from "./format"

export function Insights({ insights }: { insights: Insight[] }) {
  const { t, locale } = useTranslation()

  if (insights.length === 0) return null

  const kindMeta: Record<Insight["kind"], { icon: LucideIcon; tone: string }> = {
    positive: { icon: TrendingUp, tone: "text-emerald-700 dark:text-emerald-400" },
    negative: { icon: TrendingDown, tone: "text-red-700 dark:text-red-400" },
    neutral: { icon: Lightbulb, tone: "text-muted-foreground" },
  }

  const textFor = (i: Insight): string => {
    const n = formatNumber(locale, i.value)
    const platform = i.secondary ?? ""
    if (i.value === 0) {
      const unchanged = {
        orders: locale === "ar" ? "الطلبات لم تتغير مقارنة بالفترة السابقة." : "Orders are unchanged from the previous period.",
        completion: locale === "ar" ? "معدل الإنجاز لم يتغير مقارنة بالفترة السابقة." : "Completion rate is unchanged from the previous period.",
        revenue: locale === "ar" ? "الإيرادات لم تتغير مقارنة بالفترة السابقة." : "Revenue is unchanged from the previous period.",
        maintenance: locale === "ar" ? "طلبات الصيانة لم تتغير مقارنة بالفترة السابقة." : "Maintenance jobs are unchanged from the previous period.",
      }
      if (i.key in unchanged) return unchanged[i.key as keyof typeof unchanged]
    }
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
          const unchanged = i.value === 0 && ["orders", "completion", "revenue", "maintenance"].includes(i.key)
          const meta = kindMeta[unchanged ? "neutral" : i.kind]
          const Icon = unchanged ? Minus : meta.icon
          return (
            <li
              key={i.id}
              className="flex items-start gap-3 py-3"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.tone)} aria-hidden="true" />
              <p className="text-sm leading-relaxed text-foreground">{textFor(i)}</p>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
