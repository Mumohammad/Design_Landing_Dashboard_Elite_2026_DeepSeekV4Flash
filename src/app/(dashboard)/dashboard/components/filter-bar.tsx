"use client"

import { RefreshCw, Radio } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import { formatRelative } from "./format"
import type { DashboardFilters, DashboardPeriod } from "@/lib/analytics/types"

const PERIODS: DashboardPeriod[] = ["7d", "30d", "90d", "12m"]

const PERIOD_KEYS: Record<DashboardPeriod, "period7d" | "period30d" | "period90d" | "period12m"> = {
  "7d": "period7d",
  "30d": "period30d",
  "90d": "period90d",
  "12m": "period12m",
}

const CATEGORIES = [
  { value: "sponsored_type1", en: "Sponsored T1", ar: "كفيل نوع ١" },
  { value: "sponsored_type2", en: "Sponsored T2", ar: "كفيل نوع ٢" },
  { value: "freelancer", en: "Freelancer", ar: "مستقل" },
]

export function FilterBar({
  filters,
  onChange,
  onRefresh,
  refreshing,
  platforms,
  generatedAt,
}: {
  filters: DashboardFilters
  onChange: (filters: DashboardFilters) => void
  onRefresh: () => void
  refreshing: boolean
  platforms: { code: string; name: string }[]
  generatedAt: string | null
}) {
  const { t, locale } = useTranslation()
  const isAr = locale === "ar"

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      {/* Period presets */}
      <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => onChange({ ...filters, period: p })}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              filters.period === p
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.dashboard[PERIOD_KEYS[p]]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.platform}
          onValueChange={(v) => onChange({ ...filters, platform: v })}
        >
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.dashboard.allPlatforms}</SelectItem>
            {platforms.map((p) => (
              <SelectItem key={p.code} value={p.code}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.category}
          onValueChange={(v) => onChange({ ...filters, category: v })}
        >
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.dashboard.allCategories}</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {isAr ? c.ar : c.en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="hidden h-6 w-px bg-border sm:block" />

        <div className="flex items-center gap-2">
          {generatedAt && (
            <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex">
              <Radio className="h-3 w-3 text-emerald-500" />
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{t.dashboard.live}</span>
              <span>
                {t.dashboard.lastUpdated}: {formatRelative(locale, generatedAt)}
              </span>
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {t.dashboard.refresh}
          </Button>
        </div>
      </div>
    </div>
  )
}
