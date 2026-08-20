"use client"

import { cn } from "@/lib/utils"

/**
 * Premium animated skeleton loader with shimmer effect.
 * Usage:
 * <Skeleton className="h-4 w-[200px]" />
 * <SkeletonCard />
 * <SkeletonTable rows={5} cols={4} />
 */

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-muted/50 after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_2s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/5 after:to-transparent dark:after:via-white/[0.03]",
        className
      )}
      {...props}
    />
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border/30 bg-card/50 p-6", className)}>
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="mt-6 space-y-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[85%]" />
        <Skeleton className="h-3 w-[70%]" />
      </div>
    </div>
  )
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div className={cn("rounded-2xl border border-border/30 bg-card/50 overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-border/30 bg-muted/20 px-6 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1 rounded-md" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center gap-4 border-b border-border/20 px-6 py-3 last:border-0"
          style={{ animationDelay: `${rowIdx * 50}ms` }}
        >
          {Array.from({ length: cols }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className={cn(
                "h-3 rounded-md",
                colIdx === 0 ? "w-32" : "flex-1"
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonKpiRow({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
