"use client"

import Link from "next/link"
import { type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { MetricValue } from "@/lib/analytics/types"
import { useCountUp } from "./use-count-up"
import { formatNumber } from "./format"

interface KpiCardProps {
  label: string
  metric: MetricValue
  /** Kept for API compatibility; KPI tiles carry no icon (Taste Skill app-screen rules). */
  icon?: LucideIcon
  /** Kept for API compatibility; values are set in ink, not a per-tile hue. */
  color?: string
  href?: string
  /** Kept for API compatibility; trends live in their own charts, not sparklines. */
  spark?: number[]
  /** Delta unit: "%" (default) or "pp" for percentage points. */
  deltaUnit?: "pct" | "pp"
  /** Format the value as currency. */
  currency?: boolean
  /** Show exact two-decimal financial amounts instead of the count animation. */
  exactCurrency?: boolean
}

export function KpiCard({
  label,
  metric,
  href,
  deltaUnit = "pct",
  currency = false,
  exactCurrency = false,
}: KpiCardProps) {
  const { locale, t } = useTranslation()
  const display = useCountUp(metric.available && !exactCurrency ? metric.value : 0)
  const valueText = currency && exactCurrency
    ? new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(metric.value)
    : display

  // Hide the delta when there is no real previous value (avoids fabricated
  // "+100%" chips when the previous period was zero).
  const hasDelta =
    metric.available &&
    metric.previous > 0 &&
    metric.delta !== 0 &&
    metric.previous !== metric.value
  const deltaPositive = metric.delta > 0
  const deltaText = deltaUnit === "pp" ? `${formatNumber(locale, Math.abs(metric.delta))}` : `${formatNumber(locale, Math.abs(metric.pct))}%`

  const card = (
    <div
      className={cn(
        "h-full rounded-lg border border-border bg-card p-5",
        href && "transition-colors hover:border-foreground/25",
      )}
    >
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground sm:text-[28px]">
        {metric.available ? valueText : "N/A"}
        {currency && metric.available && (
          <span className="ms-1.5 text-sm font-normal text-muted-foreground">
            {locale === "ar" ? "ر.س" : "SAR"}
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] tabular-nums text-muted-foreground">
        {hasDelta ? (
          <>
            <span className={cn("font-medium", deltaPositive ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
              {deltaPositive ? "+" : "−"}{deltaText}
            </span>{" "}
            {t.dashboard.vsPreviousPeriod}
          </>
        ) : (
          <span aria-label={t.dashboard.vsPreviousPeriod}>— {t.dashboard.vsPreviousPeriod}</span>
        )}
      </p>
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={label}>
        {card}
      </Link>
    )
  }
  return card
}
