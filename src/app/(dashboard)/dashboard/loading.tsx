export default function Loading() {
  return (
    <div className="space-y-6 p-6" aria-busy="true" aria-label="جارٍ التحميل">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-44 animate-pulse rounded-xl bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded-lg bg-muted/70" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-border/50 bg-card/60" />
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/60">
        <div className="h-12 border-b border-border/40 bg-muted/40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border/30 px-4 py-3.5 last:border-0">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="h-4 flex-1 animate-pulse rounded-lg bg-muted/70" />
            <div className="hidden h-4 w-20 animate-pulse rounded-lg bg-muted/50 sm:block" />
            <div className="hidden h-4 w-16 animate-pulse rounded-lg bg-muted/50 md:block" />
          </div>
        ))}
      </div>
    </div>
  )
}
