"use client"

import { DatabaseZap, RefreshCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"

export function KpiSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("h-full bg-card p-4", className)}>
      <div className="h-6 w-24 animate-pulse rounded-sm bg-muted" />
      <div className="mt-2 h-8 w-20 animate-pulse rounded-sm bg-muted" />
      <div className="mt-2 h-5 w-28 animate-pulse rounded-sm bg-muted" />
    </div>
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-5", className)}>
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-4 w-36 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-52 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-6 w-16 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="mt-6 flex h-52 items-end gap-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-t-md bg-muted"
            style={{ height: `${25 + ((i * 37) % 55)}%`, opacity: 0.7 }}
          />
        ))}
      </div>
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-center">
      <DatabaseZap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-xs text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-center">
      <TriangleAlert className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
      <p className="text-sm font-semibold text-foreground">{t.dashboard.unableToLoad}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{t.dashboard.moduleOffline}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t.common.retry}
        </Button>
      )}
    </div>
  )
}
