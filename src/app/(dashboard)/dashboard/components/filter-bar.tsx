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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-card p-2.5 sm:flex sm:flex-wrap sm:gap-3 sm:p-3 lg:justify-between">
      {/* Period presets */}
      <div role="group" aria-label={isAr ? "الفترة الزمنية" : "Time period"} className="flex min-w-0 items-center gap-1 rounded-md bg-muted/60 p-0.5 sm:p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            aria-pressed={filters.period === p}
            onClick={() => onChange({ ...filters, period: p })}
            className={cn(
              "min-h-11 min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors sm:min-h-0 sm:flex-none sm:px-3",
              filters.period === p
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.dashboard[PERIOD_KEYS[p]]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="col-span-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select
          value={filters.platform}
          onValueChange={(v) => onChange({ ...filters, platform: v })}
        >
          <SelectTrigger className="h-11 min-w-0 w-full sm:h-9 sm:w-40" aria-label={isAr ? "منصة التشغيل" : "Operating platform"}>
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
          <SelectTrigger className="h-11 min-w-0 w-full sm:h-9 sm:w-40" aria-label={isAr ? "فئة السائق" : "Driver category"}>
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
      </div>

      <div className="col-start-2 row-start-1 flex items-center gap-2 sm:ms-auto">
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
            aria-label={t.dashboard.refresh}
            title={t.dashboard.refresh}
            className="gap-1.5 max-sm:w-11 max-sm:px-0"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">{t.dashboard.refresh}</span>
          </Button>
      </div>
    </div>
  )
}
