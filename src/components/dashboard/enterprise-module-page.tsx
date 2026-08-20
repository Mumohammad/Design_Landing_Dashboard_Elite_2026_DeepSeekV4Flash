import * as React from "react"
import { Plus, Search, ChevronLeft, ChevronRight, Inbox } from "lucide-react"
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

// ── KPI Card (Premium 2026) ──────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color = "#1E5A99" }: KpiCardData) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-5 shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-black/[0.04] hover:border-border/80 hover:-translate-y-0.5">
      {/* Animated gradient accent top line */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] opacity-60 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
      {/* Soft glow behind icon */}
      <div
        className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-[0.04] group-hover:opacity-[0.08] transition-opacity duration-500 blur-xl"
        style={{ backgroundColor: color }}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-elite-blue-500/20 to-elite-orange-500/20 blur-2xl scale-150" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 border border-border/50 backdrop-blur-sm">
          <Inbox className="h-7 w-7 text-muted-foreground/60" />
        </div>
      </div>
      <p className="mt-5 text-sm font-medium text-muted-foreground">{message}</p>
      {action && (
        <Button
          size="sm"
          className="mt-5 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 hover:from-elite-blue-600 hover:to-elite-blue-700 text-white shadow-lg shadow-elite-blue-500/20 h-9 px-5"
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
    <div className={cn("space-y-6 page-enter", className)}>
      {/* 1. PAGE HEADER */}
      <ScrollReveal direction="fade" duration={400}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/25">
              <CtaIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {primaryCtaLabel && onPrimaryCta && (
            <Button
              onClick={onPrimaryCta}
              className="bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 hover:from-elite-blue-600 hover:to-elite-blue-700 text-white shadow-lg shadow-elite-blue-500/20 rounded-xl h-10 px-5 font-semibold text-sm transition-all duration-200 hover:shadow-xl hover:shadow-elite-blue-500/25 hover:-translate-y-0.5"
            >
              <CtaIcon className="mr-1.5 h-4 w-4" />
              {primaryCtaLabel}
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
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="pl-10 h-10 bg-muted/20 border-border/50 rounded-xl text-sm focus-visible:ring-1 focus-visible:ring-elite-blue-500/30 focus-visible:border-elite-blue-500/30 transition-all duration-200"
              />
            </div>
            {toolbarActions && <div className="flex gap-2 flex-wrap">{toolbarActions}</div>}
          </div>
        )}
      </ScrollReveal>

      {/* 4. DATA TABLE */}
      <ScrollReveal direction="up" delay={120} duration={500}>
        <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/20">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={String(col.key)}
                      className={cn(
                        "px-4 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                        col.className
                      )}
                    >
                      {col.header}
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
                        "group/row transition-all duration-200 border-b border-border/10 last:border-0",
                        onRowClick
                          ? "cursor-pointer hover:bg-muted/20 hover:shadow-[inset_3px_0_0_0_var(--elite-blue-500)]"
                          : "hover:bg-muted/15"
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

          {/* 5. PAGINATION */}
          {pagination && (
            <div className="border-t border-border/30 px-4 py-3.5 flex items-center justify-between bg-muted/10">
              <p className="text-xs text-muted-foreground">
                {pagination.totalRecords} records · Page {pagination.currentPage} of{" "}
                {pagination.totalPages}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  disabled={pagination.currentPage <= 1}
                  onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  disabled={pagination.currentPage >= pagination.totalPages}
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
