import * as React from "react"
import { Plus, Search, ChevronLeft, ChevronRight, Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

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

  // Children (for dialog/form content rendered by parent)
  children?: React.ReactNode

  // className override
  className?: string
}

// ── KPI Card ─────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color = "#1E5A99" }: KpiCardData) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-4 shadow-sm hover:shadow-md transition-shadow">
      <div
        className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-[0.06]"
        style={{ backgroundColor: color, transform: "translate(30%, -30%)" }}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">
          {value}
        </div>
      </div>
    </div>
  )
}

// ── Skeleton row ────────────────────────────────────────────────

function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted/40" />
        </td>
      ))}
    </tr>
  )
}

// ── Empty state ─────────────────────────────────────────────────

function EmptyState({
  message,
  action,
}: {
  message: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
      {action && (
        <Button
          size="sm"
          className="mt-4 rounded-lg bg-elite-blue-500 hover:bg-elite-blue-600 text-white"
          onClick={action.onClick}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {action.label}
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
  children,
  className,
}: EnterpriseModulePageProps<T>) {
  const actionColumnCount = rowActions ? 1 : 0

  return (
    <div className={cn("space-y-6", className)}>
      {/* 1. PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {primaryCtaLabel && onPrimaryCta && (
          <Button
            onClick={onPrimaryCta}
            className="bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 hover:from-elite-blue-600 hover:to-elite-blue-700 text-white shadow-lg shadow-elite-blue-500/20 rounded-xl h-10 px-5 font-semibold text-sm"
          >
            <CtaIcon className="mr-1.5 h-4 w-4" />
            {primaryCtaLabel}
          </Button>
        )}
      </div>

      {/* 2. KPI CARDS */}
      {kpiCards && kpiCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpiCards.map((card, i) => (
            <KpiCard key={i} {...card} />
          ))}
        </div>
      )}

      {/* 3. TOOLBAR */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="pl-10 h-9 bg-muted/30 border-0 rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-elite-blue-500/30"
          />
        </div>
        {toolbarActions && <div className="flex gap-2">{toolbarActions}</div>}
      </div>

      {/* 4. DATA TABLE */}
      <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30">
              <tr>
                {columns.map((col) => (
                  <th
                    key={String(col.key)}
                    className={cn(
                      "px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                      col.className
                    )}
                  >
                    {col.header}
                  </th>
                ))}
                {rowActions && <th className="px-4 py-3 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow
                    key={i}
                    columns={columns.length + actionColumnCount}
                  />
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + actionColumnCount}>
                    <EmptyState message={emptyStateMessage} action={emptyStateAction} />
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr
                    key={row.id ?? i}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      "hover:bg-muted/20 transition-colors group",
                      onRowClick && "cursor-pointer"
                    )}
                  >
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
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
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

        {/* 5. PAGINATION */}
        {pagination && (
          <div className="border-t border-border/30 px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {pagination.totalRecords} records · Page {pagination.currentPage} of{" "}
              {pagination.totalPages}
            </p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg"
                disabled={pagination.currentPage <= 1}
                onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg"
                disabled={pagination.currentPage >= pagination.totalPages}
                onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 6. DIALOG / FORM (rendered by parent via children) */}
      {children}
    </div>
  )
}
