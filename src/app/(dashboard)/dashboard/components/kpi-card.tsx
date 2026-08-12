"use client"

import * as React from "react"
import Link from "next/link"
import { Area, AreaChart, ResponsiveContainer } from "recharts"
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { MetricValue } from "@/lib/analytics/types"
import { useCountUp } from "./use-count-up"
import { formatNumber } from "./format"

interface KpiCardProps {
  label: string
  metric: MetricValue
  icon: LucideIcon
  color: string
  href?: string
  /** Sparkline series (optional). */
  spark?: number[]
  /** Delta unit: "%" (default) or "pp" for percentage points. */
  deltaUnit?: "pct" | "pp"
  /** Format the value as currency. */
  currency?: boolean
}

export function KpiCard({
  label,
  metric,
  icon: Icon,
  color,
  href,
  spark,
  deltaUnit = "pct",
  currency = false,
}: KpiCardProps) {
  const { locale, t } = useTranslation()
  const gradientId = React.useId().replace(/:/g, "")
  const display = useCountUp(metric.available ? metric.value : 0)

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
        "group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-5 shadow-sm transition-all duration-200",
        href && "hover:-translate-y-0.5 hover:border-elite-blue-500/40 hover:shadow-md hover:shadow-elite-blue-500/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105"
          style={{ backgroundColor: `${color}14`, color }}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
          {metric.available ? display : "N/A"}
          {currency && metric.available && (
            <span className="ms-1.5 text-sm font-semibold text-muted-foreground">
              {locale === "ar" ? "ر.س" : "SAR"}
            </span>
          )}
        </span>
        {hasDelta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
              deltaPositive
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400",
            )}
          >
            {deltaPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {deltaText}
          </span>
        )}
      </div>

      {spark && spark.length > 1 && metric.available ? (
        <div className="h-9 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#spark-${gradientId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Minus className="h-3 w-3" />
          {t.dashboard.vsPreviousPeriod}
        </span>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block focus-visible:outline-none" aria-label={label}>
        {card}
      </Link>
    )
  }
  return card
}
