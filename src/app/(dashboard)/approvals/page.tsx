"use client"

// Approvals inbox (Prompt E) — one surface for every pending decision across
// the three existing sources: expenses, driver leave requests, and driver
// applications. Caller-bound database pages and exact filtered totals;
// decisions via the guarded transition RPCs behind the
// one-action-per-type write path (src/lib/approvals/actions.ts).
//
// Repo precedent: audit-log/users module surfaces — EnterpriseModulePage
// shell, KPI chips, filter toolbar, CSV export, bilingual AR/EN, deferred
// load effects, useState (no react-query).

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  ExternalLink,
  RefreshCw,
  XCircle,
} from "lucide-react"

import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { fetchApprovalsPage, type ApprovalsPageData } from "@/lib/approvals/queries"
import {
  APPROVALS_PAGE_SIZE_DEFAULT,
  APPROVAL_ITEM_TYPES,
  APPROVAL_TYPE_META,
  EMPTY_FILTERS,
  approvalsToCsv,
  isFiltersActive,
  isStale,
  itemDeepLink,
  maskRequesterName,
  pendingAgeDays,
  subjectLine,
  type ApprovalFilterState,
  type ApprovalItemType,
  type ApprovalQueueRow,
} from "@/lib/approvals/approvals-utils"
import { DecisionDialog, type DecisionTarget } from "./components/decision-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"

function ApprovalsInner() {
  const { locale } = useTranslation()
  const isAr = locale === "ar"

  const [data, setData] = useState<ApprovalsPageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const requestSequence = useRef(0)
  const [page, setPage] = useState(1)
  const [refreshTick, setRefreshTick] = useState(0)
  const [filters, setFilters] = useState<ApprovalFilterState>(() => ({ ...EMPTY_FILTERS }))
  const [target, setTarget] = useState<DecisionTarget | null>(null)
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null)

  const load = useCallback(async (f: ApprovalFilterState, currentPage: number, isActive: () => boolean) => {
    const sequence = ++requestSequence.current
    setIsLoading(true)
    setLoadFailed(false)
    setData(null)
    try {
      const result = await fetchApprovalsPage(f, APPROVALS_PAGE_SIZE_DEFAULT, currentPage)
      if (isActive() && sequence === requestSequence.current) setData(result)
    } catch {
      if (isActive() && sequence === requestSequence.current) setLoadFailed(true)
    } finally {
      if (isActive() && sequence === requestSequence.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const id = setTimeout(() => void load(filters, page, () => active), 200)
    return () => { clearTimeout(id); active = false }
  }, [load, filters, page, refreshTick])

  const setFilter = <K extends keyof ApprovalFilterState>(key: K, value: ApprovalFilterState[K]) => {
    requestSequence.current++
    setData(null)
    setIsLoading(true)
    setPage(1)
    setFilters(prev => ({ ...prev, [key]: value }))
  }
  const refresh = () => {
    requestSequence.current++
    setData(null)
    setIsLoading(true)
    setRefreshTick(n => n + 1)
  }

  const rows = data?.rows ?? []

  const kpiCards: KpiCardData[] = [
    { label: isAr ? "قرارات معلقة" : "Pending decisions", value: data?.kpis.total ?? "—", icon: ClipboardCheck, color: "#1E5A99" },
    { label: isAr ? "مصروفات" : "Expenses", value: data?.kpis.expenses ?? "—", icon: ExternalLink, color: "#E87D3E" },
    { label: isAr ? "إجازات" : "Leave requests", value: data?.kpis.leaves ?? "—", icon: Clock, color: "#0EA5E9" },
    { label: isAr ? "طلبات توظيف" : "Applications", value: data?.kpis.applications ?? "—", icon: ClipboardCheck, color: "#0F766E" },
  ]

  const requesterOf = (r: ApprovalQueueRow): string =>
    maskRequesterName(r.item_type, r.requester, r.subject_meta?.full_name ?? null, false)

  // Public applications have no verified link to a users-table consent record.
  const consentOf = (r: ApprovalQueueRow): boolean => r.item_type !== "application"

  const exportCsv = () => {
    if (isLoading || loadFailed || rows.length === 0) return
    const csv = approvalsToCsv(
      isAr ? ["النوع", "الموضوع", "مقدّم الطلب", "تاريخ الطلب", "العمر (أيام)", "رابط الوحدة", "عرض الاسم"]
        : ["Type", "Subject", "Requester", "Requested at", "Age (days)", "Deep link", "Name visibility"],
      rows.map((r) => [
        isAr ? APPROVAL_TYPE_META[r.item_type].ar : APPROVAL_TYPE_META[r.item_type].en,
        subjectLine(r, false),
        requesterOf(r),
        r.requested_at,
        pendingAgeDays(r.requested_at),
        itemDeepLink(r),
        consentOf(r) ? (isAr ? "حسب صلاحية الوحدة" : "module access") : (isAr ? "الأحرف الأولى فقط" : "initials only"),
      ])
    )
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `approvals-page-${data?.page ?? 1}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const openDecision = (row: ApprovalQueueRow, d: "approved" | "rejected") => {
    setTarget({ row, consent: consentOf(row) })
    setDecision(d)
  }

  const columns: TableColumn<ApprovalQueueRow>[] = [
    {
      key: "item_type",
      header: isAr ? "النوع" : "Type",
      render: (r) => {
        const meta = APPROVAL_TYPE_META[r.item_type]
        return (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${meta.color}15`, color: "var(--foreground)" }}
          >
            {isAr ? meta.ar : meta.en}
          </span>
        )
      },
    },
    {
      key: "subject",
      header: isAr ? "الموضوع" : "Subject",
      render: (r) => (
        <span className="block max-w-64 truncate text-sm font-medium text-foreground" title={subjectLine(r, isAr)}>
          {subjectLine(r, isAr)}
        </span>
      ),
    },
    {
      key: "requester",
      header: isAr ? "مقدِّم الطلب" : "Requester",
      render: (r) => {
        const masked = r.item_type === "application" && !consentOf(r)
        return (
          <span className={cn("text-sm", masked ? "text-muted-foreground italic" : "text-foreground")}>
            {requesterOf(r)}
            {masked && (
              <span className="ms-1 text-sm text-muted-foreground">
                {isAr ? "(الأحرف الأولى فقط)" : "(initials only)"}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: "age",
      header: isAr ? "العمر" : "Age",
      render: (r) => {
        const days = pendingAgeDays(r.requested_at)
        const stale = isStale(r.requested_at)
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs tabular-nums",
              stale ? "font-medium text-destructive" : "text-muted-foreground"
            )}
            title={r.requested_at}
          >
            {stale && <AlertTriangle className="h-3 w-3" />}
            {isAr ? `${days} أيام` : `${days}d`}
          </span>
        )
      },
    },
    {
      key: "requested_at",
      header: isAr ? "التاريخ" : "Requested",
      render: (r) => (
        <span dir="ltr" className="block max-w-52 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {new Date(r.requested_at).toLocaleDateString(isAr ? "ar-SA-u-ca-gregory" : "en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
    },
  ]

  const noResults = !isLoading && rows.length === 0

  return (
    <div className="px-4 py-4 lg:px-6">
      {/* Server filters apply to the complete permitted pending queue. */}
      <div className="mb-4 space-y-3 rounded-2xl border border-border/50 bg-card/60 px-4 py-3">
        <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <div className="col-span-2 grid gap-1.5 sm:w-40">
            <span className="text-sm text-muted-foreground">{isAr ? "نوع القرار" : "Decision type"}</span>
            <Select value={filters.type} onValueChange={(v) => setFilter("type", v as ApprovalItemType | "all")}>
              <SelectTrigger aria-label={isAr ? "نوع القرار" : "Decision type"} className="h-10 w-full rounded-xl bg-muted/30 text-base sm:text-sm">
                <SelectValue placeholder={isAr ? "النوع" : "Type"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isAr ? "كل الأنواع" : "All types"}</SelectItem>
                {APPROVAL_ITEM_TYPES.map((tp) => (
                  <SelectItem key={tp} value={tp}>
                    {isAr ? APPROVAL_TYPE_META[tp].ar : APPROVAL_TYPE_META[tp].en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="grid min-w-0 gap-1.5 sm:w-40">
            <span className="text-sm text-muted-foreground">{isAr ? "من تاريخ" : "From date"}</span>
            <Input
              type="date"
              aria-label={isAr ? "من تاريخ" : "From date"}
              value={filters.from}
              onChange={(e) => setFilter("from", e.target.value)}
              className="h-10 min-w-0 w-full rounded-xl bg-muted/30 text-base sm:text-sm"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 sm:w-40">
            <span className="text-sm text-muted-foreground">{isAr ? "إلى تاريخ" : "To date"}</span>
            <Input
              type="date"
              aria-label={isAr ? "إلى تاريخ" : "To date"}
              value={filters.to}
              onChange={(e) => setFilter("to", e.target.value)}
              className="h-10 min-w-0 w-full rounded-xl bg-muted/30 text-base sm:text-sm"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {isAr
              ? data ? `${rows.length} من ${data.kpis.total} قرار مطابق` : "—"
              : data ? `${rows.length} of ${data.kpis.total} matching decisions` : "—"}
          </span>
          <div className="ms-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            {isFiltersActive(filters) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 rounded-xl text-xs"
                onClick={() => { setPage(1); setData(null); setIsLoading(true); requestSequence.current++; setFilters({ ...EMPTY_FILTERS }) }}
              >
                {isAr ? "مسح الفلاتر" : "Clear filters"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl"
              onClick={refresh}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              {isAr ? "تحديث" : "Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl"
              onClick={exportCsv}
              disabled={isLoading || loadFailed || rows.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {isAr ? "تصدير هذه الصفحة" : "Export this page"}
            </Button>
          </div>
        </div>
      </div>

      <EnterpriseModulePage<ApprovalQueueRow>
        primaryCtaIcon={ClipboardCheck}
        title={isAr ? "صندوق القرارات" : "Approvals Inbox"}
        subtitle={
          isAr
            ? "راجع المصروفات وطلبات الإجازة والتوظيف المعلقة"
            : "Review pending expenses, leave requests and applications"
        }
        kpiCards={kpiCards}
        searchPlaceholder={isAr ? "بحث في المراجع والبيانات الظاهرة..." : "Search references and visible details..."}
        searchValue={filters.search}
        onSearchChange={value => setFilter("search", value)}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        loadError={loadFailed ? (isAr ? "تعذر تحميل قائمة القرارات. أعد المحاولة." : "Could not load the approvals queue. Try again.") : undefined}
        onRetry={refresh}
        retryLabel={isAr ? "إعادة المحاولة" : "Retry"}
        className="[&_tbody_td:last-child>div]:opacity-100"
        pagination={data ? {
          totalRecords: data.kpis.total, currentPage: data.page, totalPages: data.totalPages,
          onPageChange: nextPage => { requestSequence.current++; setData(null); setIsLoading(true); setPage(nextPage) },
        } : undefined}
        rowActions={(r) => (
          <div data-row-actions onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 rounded-lg text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
                onClick={() => openDecision(r, "approved")}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isAr ? "موافقة" : "Approve"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 rounded-lg text-xs text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                onClick={() => openDecision(r, "rejected")}
              >
                <XCircle className="h-3.5 w-3.5" />
                {isAr ? "رفض" : "Reject"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg"
                title={isAr ? "فتح في الوحدة" : "Open in module"}
                onClick={() => {
                  const href = itemDeepLink(r)
                  if (href) window.location.assign(href)
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="sr-only">{isAr ? "فتح في الوحدة" : "Open in module"}</span>
              </Button>
            </div>
          </div>
        )}
        emptyStateMessage={
          noResults
            ? isFiltersActive(filters)
              ? isAr
                ? "لا توجد قرارات معلقة مطابقة لهذه الفلاتر"
                : "No pending decisions match these filters"
              : isAr
                ? "لا توجد قرارات معلقة — كل شيء تم البت فيه"
                : "No pending decisions — everything has been actioned"
            : ""
        }
      />

      <DecisionDialog
        target={target}
        decision={decision}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null)
            setDecision(null)
          }
        }}
        onDone={refresh}
      />
    </div>
  )
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={null}>
      <ApprovalsInner />
    </Suspense>
  )
}
