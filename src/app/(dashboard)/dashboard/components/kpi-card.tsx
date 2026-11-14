"use client"

import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import type { MetricValue } from "@/lib/analytics/types"
import { formatNumber } from "./format"

interface KpiCardProps {
  label: string
  metric: MetricValue
  /** Kept for API compatibility; KPI tiles carry no icon (Taste Skill app-screen rules). */
  icon?: LucideIcon
  /** Kept for API compatibility; values are set in ink, not a per-tile hue. */
  color?: string
  href?: string
  spark?: number[]
  deltaUnit?: "pct" | "pp"
  currency?: boolean
  exactCurrency?: boolean
}

export function KpiCard({label,metric,href,deltaUnit="pct",currency=false,exactCurrency=false}: KpiCardProps) {
  const {locale,t}=useTranslation()
  const valueText=currency && exactCurrency
    ? new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(metric.value)
    : formatNumber(locale,Math.round(metric.value))
  const hasDelta=metric.available && metric.previous>0 && metric.delta!==0 && metric.previous!==metric.value
  const increasing=metric.delta>0
  const deltaText=deltaUnit === "pp" ? formatNumber(locale,Math.abs(metric.delta)) : `${formatNumber(locale,Math.abs(metric.pct))}%`
  const card=(
    <div className="h-full min-w-0 bg-card p-4 transition-colors group-hover:bg-accent">
      <div className="text-sm font-medium leading-6 text-muted-foreground">{label}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground" dir="ltr">
          {metric.available ? valueText : "—"}
        </span>
        {currency && metric.available && <span className="text-xs font-medium text-muted-foreground">{locale === "ar" ? "ر.س" : "SAR"}</span>}
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {hasDelta && <span className="inline-flex items-center gap-1 font-medium tabular-nums text-foreground" dir="ltr">
          {increasing ? <ArrowUpRight className="size-3.5" aria-hidden="true"/> : <ArrowDownRight className="size-3.5" aria-hidden="true"/>}
          <span>{increasing ? "+" : "−"}{deltaText}{deltaUnit === "pp" && <span className="ms-1">{locale === "ar" ? "نقطة" : "pp"}</span>}</span>
        </span>}
        <span>{t.dashboard.vsPreviousPeriod}</span>
      </div>
    </div>
  )
  return href ? <Link href={href} className="group block h-full focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" aria-label={label}>{card}</Link> : card
}
