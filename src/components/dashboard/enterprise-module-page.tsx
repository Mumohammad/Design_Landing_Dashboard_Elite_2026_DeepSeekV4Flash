import { LocalizedText, useUiText } from "@/components/localized-text"
import * as React from "react"
import { Plus, Search, ChevronLeft, ChevronRight, Inbox, AlertCircle, Download, X } from "lucide-react"
import { escapeCsvCell } from "@/lib/csv-cell"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ScrollReveal, StaggerContainer } from "@/components/ui/scroll-reveal"

// ── Types ────────────────────────────────────────────────────────

export interface KpiCardData {
  label: string
  value: string | number
  icon?: React.ComponentType<{ className?: string }>
  color?: string // brand color for decorative circle, e.g. "#1E5A99"
}

export interface TableColumn<T> {
  key: keyof T | string
  header: string
  render?: (row: T) => React.ReactNode
  className?: string
  /** Plain value for "Export selected"; defaults to row[key] when primitive. */
  exportValue?: (row: T) => string | number | null | undefined
}

export interface PaginationData {
  totalRecords: number
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export interface EnterpriseModulePageProps<T> {
  // Header
  title: string
  subtitle?: string
  primaryCtaLabel?: string
  onPrimaryCta?: () => void
  primaryCtaIcon?: React.ComponentType<{ className?: string }>

  // KPI cards (optional)
  kpiCards?: KpiCardData[]

  // Toolbar
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  toolbarActions?: React.ReactNode // export/import dropdowns, filter buttons

  // Table
  columns: TableColumn<T>[]
  data: T[]
  rowActions?: (row: T) => React.ReactNode // rendered on hover
  onRowClick?: (row: T) => void
  emptyStateMessage?: string
  emptyStateAction?: { label: string; onClick: () => void }

  // Pagination (optional)
  pagination?: PaginationData

  // Loading
  isLoading?: boolean
  loadError?: string
  onRetry?: () => void
  retryLabel?: string

  // Bulk selection: checkbox column + action bar with "Export selected".
  // On by default for rows with ids; pass selectable={false} to disable.
  selectable?: boolean
  bulkActions?: (rows: T[], clear: () => void) => React.ReactNode
  exportFileName?: string

  // Children (for dialog/form content rendered by parent)
  children?: React.ReactNode

  // className override
  className?: string
}

// ── KPI Card (Premium 2026) ──────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color = "#1E5A99" }: KpiCardData) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5 shadow-sm transition-all duration-300 hover:shadow-black/[0.04] hover:border-border/80 hover:-translate-y-0.5">
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground"><LocalizedText text={label} /></span>
          {Icon && (
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110"
              style={{ backgroundColor: `${color}15` }}
            >
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>
        <div className="mt-3 text-2xl font-bold tabular-nums text-foreground">
          {value}
        </div>
      </div>
    </div>
  )
}

// ── Skeleton row (Premium) ──────────────────────────────────────

function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr className="border-b border-border/20 last:border-0">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="flex items-center gap-3">
            {i === 0 && <div className="h-8 w-8 animate-pulse rounded-lg bg-muted/30" />}
            <div className="space-y-1.5">
              <div className="h-3.5 w-3/4 animate-pulse rounded-md bg-muted/30" style={{ animationDelay: `${i * 100}ms` }} />
              {i === 0 && <div className="h-2.5 w-1/2 animate-pulse rounded-md bg-muted/20" style={{ animationDelay: `${i * 100 + 50}ms` }} />}
            </div>
          </div>
        </td>
      ))}
    </tr>
  )
}

// ── Empty state (Premium) ───────────────────────────────────────

function EmptyState({
  message,
  action,
}: {
  message: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div data-testid="module-empty-state" className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="relative">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 border border-border/50">
          <Inbox className="h-7 w-7 text-muted-foreground/60" />
        </div>
      </div>
      <p className="mt-5 text-sm font-medium text-muted-foreground"><LocalizedText text={message} /></p>
      {action && (
        <Button
          size="sm"
          className="mt-5 rounded-xl bg-elite-blue-500 hover:bg-elite-blue-600 text-white shadow-elite-blue-500/20 h-9 px-5"
          onClick={action.onClick}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          <LocalizedText text={action.label} />
        </Button>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────

export function EnterpriseModulePage<T extends { id?: string }>({
  title,
  subtitle,
  primaryCtaLabel,
  onPrimaryCta,
  primaryCtaIcon: CtaIcon = Plus,
  kpiCards,
  searchPlaceholder = "Search...",
  searchValue,
  onSearchChange,
  toolbarActions,
  columns,
  data,
  rowActions,
  onRowClick,
  emptyStateMessage = "No records yet",
  emptyStateAction,
  pagination,
  isLoading = false,
  loadError,
  onRetry,
  retryLabel = "Try again",
  children,
  className,
  selectable = true,
  bulkActions,
  exportFileName,
}: EnterpriseModulePageProps<T>) {
  const ui = useUiText()
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const canSelect = selectable && data.some((r) => typeof r.id === "string")
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  // Drop selections that are no longer on the page (filter/paging changes).
  React.useEffect(() => {
    setSelectedIds((prev) => {
      const ids = new Set(data.map((r) => r.id).filter((x): x is string => typeof x === "string"))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [data])
  const selectedRows = canSelect ? data.filter((r) => r.id && selectedIds.has(r.id)) : []
  const allSelected = canSelect && selectedRows.length > 0 && selectedRows.length === data.filter((r) => r.id).length
  const clearSelection = React.useCallback(() => setSelectedIds(new Set()), [])
  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(data.map((r) => r.id).filter((x): x is string => typeof x === "string")))
  const exportSelected = () => {
    const header = columns.map((c) => ui(c.header))
    const lines = selectedRows.map((row) =>
      columns
        .map((c) => {
          if (c.exportValue) return c.exportValue(row)
          const v = (row as Record<string, unknown>)[c.key as string]
          return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : ""
        })
        .map(escapeCsvCell)
        .join(","),
    )
    const csv = "\uFEFF" + [header.map(escapeCsvCell).join(","), ...lines].join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${exportFileName ?? "export"}-selected-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  const actionColumnCount = (rowActions ? 1 : 0) + (canSelect ? 1 : 0)

  return (
    <div className={cn("space-y-6 page-enter", className)}>
      {/* 1. PAGE HEADER */}
      <ScrollReveal direction="fade" duration={400}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-elite-blue-600 dark:text-elite-blue-300">
              <CtaIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                <LocalizedText text={title} />
              </h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-0.5"><LocalizedText text={subtitle} /></p>
              )}
            </div>
          </div>
          {primaryCtaLabel && onPrimaryCta && (
            <Button
              onClick={onPrimaryCta}
              className="bg-elite-blue-500 hover:bg-elite-blue-600 text-white shadow-elite-blue-500/20 rounded-xl h-10 px-5 font-semibold text-sm transition-all duration-200 hover:shadow-elite-blue-500/25 hover:-translate-y-0.5"
            >
              <CtaIcon className="mr-1.5 h-4 w-4" />
              <LocalizedText text={primaryCtaLabel} />
            </Button>
          )}
        </div>
      </ScrollReveal>

      {/* 2. KPI CARDS */}
      {kpiCards && kpiCards.length > 0 && (
        <StaggerContainer staggerDelay={60} direction="up">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {kpiCards.map((card, i) => (
              <KpiCard key={i} {...card} />
            ))}
          </div>
        </StaggerContainer>
      )}

      {/* 3. TOOLBAR */}
      <ScrollReveal direction="up" delay={80} duration={400}>
        {(searchValue !== undefined || toolbarActions) && (
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                maxLength={200}
                aria-label={ui(searchPlaceholder)}
                placeholder={ui(searchPlaceholder)}
                value={searchValue}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="pl-10 h-10 bg-muted/20 border-border/50 rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-elite-blue-500/30 focus-visible:border-elite-blue-500/30 transition-all duration-200"
              />
            </div>
            {toolbarActions && <div className="flex gap-2 flex-wrap">{toolbarActions}</div>}
          </div>
        )}
      </ScrollReveal>

      {/* Bulk action bar */}
      {canSelect && selectedRows.length > 0 && (
        <div
          data-testid="bulk-action-bar"
          role="toolbar"
          aria-label={ar ? "إجراءات جماعية" : "Bulk actions"}
          className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/95 px-4 py-2 text-sm shadow-sm dark:border-sky-900 dark:bg-sky-950/90"
        >
          <span className="font-semibold">{ar ? `تم تحديد ${selectedRows.length}` : `${selectedRows.length} selected`}</span>
          <div className="mx-1 h-5 w-px bg-sky-200 dark:bg-sky-800" />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg" onClick={exportSelected}>
            <Download className="h-3.5 w-3.5" />
            {ar ? "تصدير المحدد (CSV)" : "Export selected (CSV)"}
          </Button>
          {bulkActions?.(selectedRows, clearSelection)}
          <Button type="button" size="sm" variant="ghost" className="ms-auto h-8 gap-1 rounded-lg" onClick={clearSelection}>
            <X className="h-3.5 w-3.5" />
            {ar ? "إلغاء التحديد" : "Clear"}
          </Button>
        </div>
      )}

      {/* 4. DATA TABLE */}
      <ScrollReveal direction="up" delay={120} duration={500}>
        <div className="rounded-2xl border border-border/50 bg-card/60 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/20">
                <tr>
                  {canSelect && (
                    <th className="w-10 px-4 py-3.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-sky-600"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = selectedRows.length > 0 && !allSelected
                        }}
                        onChange={toggleAll}
                        aria-label={ar ? "تحديد الكل" : "Select all"}
                        data-testid="bulk-select-all"
                      />
                    </th>
                  )}
                  {columns.map((col) => (
                    <th
                      key={String(col.key)}
                      className={cn(
                        "px-4 py-3.5 text-left text-xs font-semibold text-muted-foreground",
                        col.className
                      )}
                    >
                      <LocalizedText text={col.header} />
                    </th>
                  ))}
                  {rowActions && <th className="px-4 py-3.5 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <SkeletonRow
                      key={i}
                      columns={columns.length + actionColumnCount}
                    />
                  ))
                ) : loadError || data.length === 0 ? null : (
                  data.map((row, i) => (
                    <tr
                      key={row.id ?? i}
                      onClick={() => onRowClick?.(row)}
                      className={cn(
                        "group/row transition-all duration-200 border-b border-border/10 last:border-0",
                        onRowClick
                          ? "cursor-pointer hover:bg-muted/20"
                          : "hover:bg-muted/15"
                      )}
                    >
                      {canSelect && (
                        <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                          {row.id && (
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-sky-600"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleRow(row.id as string)}
                              aria-label={ar ? "تحديد الصف" : "Select row"}
                            />
                          )}
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={String(col.key)}
                          className={cn(
                            "px-4 py-3 text-sm text-foreground/80",
                            col.className
                          )}
                        >
                          {col.render
                            ? col.render(row)
                            : String(
                                (row as Record<string, unknown>)[
                                  col.key as string
                                ] ?? ""
                              )}
                        </td>
                      ))}
                      {rowActions && (
                        <td className="px-4 py-3">
                          <div className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-200">
                            {rowActions(row)}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {/* Empty/error actions stay inside the visible panel, independently
              of a wide table's horizontal scroll position (including RTL). */}
          {!isLoading && (loadError ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <AlertCircle aria-hidden="true" className="h-6 w-6 text-destructive" />
              <p className="text-sm text-foreground">{loadError}</p>
              {onRetry && <Button variant="outline" onClick={onRetry}>{retryLabel}</Button>}
            </div>
          ) : data.length === 0 ? <EmptyState message={emptyStateMessage} action={emptyStateAction} /> : null)}

          {/* 5. PAGINATION */}
          {pagination && (
            <div className="border-t border-border/30 px-4 py-3.5 flex items-center justify-between bg-muted/10">
              <p className="text-xs text-muted-foreground">
                {pagination.totalRecords} <LocalizedText text="records · Page" /> {pagination.currentPage} <LocalizedText text="of" />{" "}
                {pagination.totalPages}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  aria-label={ui("Previous page")}
                  disabled={isLoading || !!loadError || pagination.currentPage <= 1}
                  onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  aria-label={ui("Next page")}
                  disabled={isLoading || !!loadError || pagination.currentPage >= pagination.totalPages}
                  onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollReveal>

      {/* 6. DIALOG / FORM (rendered by parent via children) */}
      {children}
    </div>
  )
}
