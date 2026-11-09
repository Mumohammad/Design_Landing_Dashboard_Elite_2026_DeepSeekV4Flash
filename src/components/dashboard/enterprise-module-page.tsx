"use client"

import { LocalizedText, useUiText } from "@/components/localized-text"
import * as React from "react"
import { Plus, Search, ChevronLeft, ChevronRight, Inbox, AlertCircle, Download, X } from "lucide-react"
import { escapeCsvCell } from "@/lib/csv-cell"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface KpiCardData {
  label: string
  value: string | number
  icon?: React.ComponentType<{ className?: string }>
  color?: string
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
  title: string
  headingLevel?: "h1" | "h2"
  subtitle?: string
  primaryCtaLabel?: string
  onPrimaryCta?: () => void
  primaryCtaIcon?: React.ComponentType<{ className?: string }>
  kpiCards?: KpiCardData[]
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  toolbarActions?: React.ReactNode
  columns: TableColumn<T>[]
  data: T[]
  rowActions?: (row: T) => React.ReactNode
  onRowClick?: (row: T) => void
  emptyStateMessage?: string
  emptyStateAction?: { label: string; onClick: () => void }
  pagination?: PaginationData
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
  className?: string
}

function KpiCard({ label, value }: KpiCardData) {
  return (
    <div className="min-w-0 bg-card px-5 py-4">
      <span className="text-sm text-muted-foreground"><LocalizedText text={label} /></span>
      <div data-testid="module-kpi-value" className="mt-2 text-2xl font-medium tabular-nums text-foreground">
        {value}
      </div>
    </div>
  )
}

function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr aria-hidden="true" className="border-b border-border/60 last:border-0">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 w-3/4 rounded bg-muted" />
        </td>
      ))}
    </tr>
  )
}

function EmptyState({
  message,
  action,
}: {
  message: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div data-testid="module-empty-state" className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <Inbox aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground"><LocalizedText text={message} /></p>
      {action && (
        <Button size="sm" className="mt-4" onClick={action.onClick}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          <LocalizedText text={action.label} />
        </Button>
      )}
    </div>
  )
}

const interactiveRowTarget = "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], [role='menuitem'], [role='combobox'], [role='slider'], [role='textbox'], [tabindex], [contenteditable]:not([contenteditable='false'])"

interface ModuleSelection {
  pageKey: string
  ids: ReadonlySet<string>
}

/** A record that leaves the visible page must not silently become selected again. */
export function reconcileModuleSelection(pageIds: readonly string[], current: ModuleSelection): ModuleSelection {
  const pageKey = JSON.stringify(pageIds)
  if (current.pageKey === pageKey) return current
  const visibleIds = new Set(pageIds)
  return { pageKey, ids: new Set([...current.ids].filter(id => visibleIds.has(id))) }
}

export function EnterpriseModulePage<T extends { id?: string }>({
  title,
  headingLevel = "h1",
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
  const kpiCount = kpiCards?.length ?? 0
  const kpiColumns = kpiCount <= 4 ? Math.max(1, kpiCount) : Math.min(6, Math.ceil(kpiCount / 2))
  const kpiLastSpan = kpiColumns - ((Math.max(1, kpiCount) - 1) % kpiColumns)
  const Heading = headingLevel
  const numericColumns = new Set(columns.filter((column) => data.some((row) =>
    typeof (row as Record<string, unknown>)[column.key as string] === "number"
  )).map((column) => String(column.key)))
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const pageIds = data.map(row => row.id).filter((id): id is string => typeof id === "string" && id.length > 0)
  const pageKey = JSON.stringify(pageIds)
  const canSelect = selectable && !isLoading && !loadError && pageIds.length > 0
  const [selection, setSelection] = React.useState<ModuleSelection>(() => ({ pageKey, ids: new Set() }))
  const currentSelection = reconcileModuleSelection(pageIds, selection)
  // React restarts this render before committing children. Updating only when
  // the page's IDs change avoids a stale selection frame and an effect loop.
  if (currentSelection !== selection) setSelection(currentSelection)
  const selectedIds = currentSelection.ids
  const selectedRows = canSelect ? data.filter((r) => r.id && selectedIds.has(r.id)) : []
  const allSelected = canSelect && selectedRows.length > 0 && selectedRows.length === pageIds.length
  const clearSelection = () => setSelection({ pageKey, ids: new Set() })
  const toggleRow = (id: string) =>
    setSelection((prev) => {
      const next = new Set(reconcileModuleSelection(pageIds, prev).ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { pageKey, ids: next }
    })
  const toggleAll = () =>
    setSelection({ pageKey, ids: allSelected ? new Set() : new Set(pageIds) })
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
    <div className={cn("min-w-0 space-y-6", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading className={cn("font-semibold tracking-tight text-foreground", headingLevel === "h1" ? "text-2xl" : "text-xl")}>
            <LocalizedText text={title} />
          </Heading>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground"><LocalizedText text={subtitle} /></p>
          )}
        </div>
        {primaryCtaLabel && onPrimaryCta && (
          <Button onClick={onPrimaryCta} className="shrink-0 self-start">
            <CtaIcon aria-hidden="true" className="h-4 w-4" />
            <LocalizedText text={primaryCtaLabel} />
          </Button>
        )}
      </div>

      {kpiCards && kpiCount > 0 && (
        // Equal columns plus their 1px rules fill the strip; count chooses the desktop grid.
        <div
          className={cn(
            "grid gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-[repeat(var(--kpi-columns),minmax(0,1fr))]",
            kpiCount === 1 ? "grid-cols-1" : "grid-cols-2",
            kpiCount > 1 && kpiCount % 2 !== 0 && "[&>:last-child]:col-span-2",
            "lg:[&>:last-child]:col-span-[var(--kpi-last-span)]"
          )}
          style={{ "--kpi-columns": kpiColumns, "--kpi-last-span": kpiLastSpan } as React.CSSProperties}
        >
          {kpiCards.map((card, i) => <KpiCard key={i} {...card} />)}
        </div>
      )}

      {(searchValue !== undefined || toolbarActions) && (
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          {searchValue !== undefined && (
            <div className="relative w-full sm:max-w-sm">
              <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                maxLength={200}
                aria-label={ui(searchPlaceholder)}
                placeholder={ui(searchPlaceholder)}
                value={searchValue}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="ps-10"
              />
            </div>
          )}
          {toolbarActions && <div className="flex flex-wrap gap-2 sm:ms-auto">{toolbarActions}</div>}
        </div>
      )}

      {canSelect && selectedRows.length > 0 && (
        <div data-testid="bulk-action-bar" role="toolbar" aria-label={ar ? "إجراءات جماعية" : "Bulk actions"} className="sticky top-16 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span className="font-medium" role="status">{ar ? `تم تحديد ${selectedRows.length}` : `${selectedRows.length} selected`}</span>
          <Button type="button" variant="outline" onClick={exportSelected}><Download aria-hidden="true" className="size-4" />{ar ? "تصدير المحدد (CSV)" : "Export selected (CSV)"}</Button>
          {bulkActions?.(selectedRows, clearSelection)}
          <Button type="button" variant="ghost" className="ms-auto" onClick={clearSelection}><X aria-hidden="true" className="size-4" />{ar ? "إلغاء التحديد" : "Clear"}</Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="relative isolate max-h-[min(65vh,42rem)] overflow-auto scroll-pt-12 print:scroll-pt-0 print:max-h-none print:overflow-visible">
          <table className="w-full text-start" aria-label={ui(title)} aria-busy={isLoading}>
            <thead>
              <tr>
                {canSelect && <th scope="col" className="sticky top-0 z-10 w-11 bg-card print:static max-sm:start-0 max-sm:z-30">
                  <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                    <input type="checkbox" className="size-4 accent-primary" checked={allSelected} ref={el => { if (el) el.indeterminate = selectedRows.length > 0 && !allSelected }} onChange={toggleAll} aria-label={ar ? "تحديد الكل" : "Select all"} data-testid="bulk-select-all" />
                  </label>
                </th>}
                {columns.map((col, columnIndex) => (
                  <th
                    key={String(col.key)}
                    scope="col"
                    className={cn(
                      "sticky top-0 z-10 bg-card px-4 print:static py-3 text-start text-xs font-medium text-muted-foreground",
                      columnIndex === 0 && (canSelect ? "max-sm:start-11 max-sm:z-20" : "max-sm:start-0 max-sm:z-20"),
                      numericColumns.has(String(col.key)) && "text-end tabular-nums",
                      col.className
                    )}
                  >
                    <LocalizedText text={col.header} />
                  </th>
                ))}
                {rowActions && <th scope="col" className="sticky top-0 z-10 w-10 bg-card print:static px-4 py-3"><span className="sr-only"><LocalizedText text="Actions" /></span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={columns.length + actionColumnCount} />)
              ) : loadError || data.length === 0 ? null : (
                data.map((row, i) => (
                  <tr
                    key={row.id ?? i}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={(event) => {
                      if (event.defaultPrevented) return
                      const control = event.target instanceof Element ? event.target.closest(interactiveRowTarget) : null
                      if (control && control !== event.currentTarget) return
                      onRowClick?.(row)
                    }}
                    onKeyDown={(event) => {
                      if (!onRowClick || event.target !== event.currentTarget || event.defaultPrevented) return
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onRowClick(row)
                      }
                    }}
                    className={cn(
                      "group/row outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      onRowClick && "cursor-pointer hover:outline-1 hover:-outline-offset-1 hover:outline-border"
                    )}
                  >
                    {canSelect && <td className="w-11 max-sm:sticky max-sm:start-0 max-sm:z-[2] max-sm:bg-card" onClick={event => event.stopPropagation()}>
                      {row.id && <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                        <input type="checkbox" className="size-4 accent-primary" checked={selectedIds.has(row.id)} onChange={() => toggleRow(row.id as string)} aria-label={ar ? "تحديد الصف" : "Select row"} />
                      </label>}
                    </td>}
                    {columns.map((col, columnIndex) => (
                      <td
                        key={String(col.key)}
                        className={cn(
                          "px-4 py-3 text-start text-sm tabular-nums text-foreground",
                          columnIndex === 0 && "max-sm:sticky max-sm:z-[1] max-sm:bg-card",
                          columnIndex === 0 && (canSelect ? "max-sm:start-11" : "max-sm:start-0"),
                          numericColumns.has(String(col.key)) && "text-end",
                          col.className
                        )}
                      >
                        {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key as string] ?? "")}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 [&_button]:min-h-9 [&_button]:min-w-9 max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11">
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
        {/* Keep state actions visible independently of the table's horizontal scroll. */}
        {!isLoading && (loadError ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <AlertCircle aria-hidden="true" className="h-6 w-6 text-destructive" />
            <p className="text-sm text-foreground">{loadError}</p>
            {onRetry && <Button variant="outline" onClick={onRetry}>{retryLabel}</Button>}
          </div>
        ) : data.length === 0 ? <EmptyState message={emptyStateMessage} action={emptyStateAction} /> : null)}

        {pagination && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-xs tabular-nums text-muted-foreground">
              {pagination.totalRecords} <LocalizedText text="records · Page" /> {pagination.currentPage} <LocalizedText text="of" />{" "}
              {pagination.totalPages}
            </p>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label={ui("Previous page")} disabled={isLoading || !!loadError || pagination.currentPage <= 1} onClick={() => pagination.onPageChange(pagination.currentPage - 1)}>
                <ChevronLeft aria-hidden="true" className="h-4 w-4 rtl:rotate-180" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={ui("Next page")} disabled={isLoading || !!loadError || pagination.currentPage >= pagination.totalPages} onClick={() => pagination.onPageChange(pagination.currentPage + 1)}>
                <ChevronRight aria-hidden="true" className="h-4 w-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
