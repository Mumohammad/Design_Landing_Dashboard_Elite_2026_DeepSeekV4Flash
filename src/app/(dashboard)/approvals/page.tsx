"use client"

// Approvals inbox (Prompt E) — one surface for every pending decision across
// the three existing sources: expenses, driver leave requests, and driver
// applications. Server-filtered through the capped fetch_pending_approvals
// RPC (50/100 clamp), decisions via the atomic transition RPCs behind the
// one-action-per-type write path (src/lib/approvals/actions.ts).
//
// Repo precedent: audit-log/users module surfaces — EnterpriseModulePage
// shell, KPI chips, filter toolbar, CSV export, bilingual AR/EN, deferred
// load effects, useState (no react-query).

import { Suspense, useCallback, useEffect, useState } from "react"
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
  const [refreshTick, setRefreshTick] = useState(0)
  const [filters, setFilters] = useState<ApprovalFilterState>(() => ({ ...EMPTY_FILTERS }))
  const [target, setTarget] = useState<DecisionTarget | null>(null)
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null)

  const load = useCallback(
    async (f: ApprovalFilterState, silent = false) => {
      if (!silent) setIsLoading(true)
      try {
        const result = await fetchApprovalsPage({ ...f }, APPROVALS_PAGE_SIZE_DEFAULT)
        setData(result)
        setLoadFailed(false)
      } catch {
        setLoadFailed(true)
        if (!silent) setData(null)
      }
      if (!silent) setIsLoading(false)
    },
    []
  )

  // Deferred load (repo pattern) — refetches when filters change.
  useEffect(() => {
    const id = setTimeout(() => void load(filters), 0)
    return () => clearTimeout(id)
  }, [load, filters, refreshTick])

  const setFilter = <K extends keyof ApprovalFilterState>(key: K, value: ApprovalFilterState[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }))

  const rows = data?.rows ?? []

  const kpiCards: KpiCardData[] = [
    { label: isAr ? "قرارات معلقة" : "Pending decisions", value: data?.kpis.total ?? 0, icon: ClipboardCheck, color: "#1E5A99" },
    { label: isAr ? "مصروفات" : "Expenses", value: data?.kpis.expenses ?? 0, icon: ExternalLink, color: "#E87D3E" },
    { label: isAr ? "إجازات" : "Leave requests", value: data?.kpis.leaves ?? 0, icon: Clock, color: "#0EA5E9" },
    { label: isAr ? "طلبات توظيف" : "Applications", value: data?.kpis.applications ?? 0, icon: ClipboardCheck, color: "#6366F1" },
  ]

  const requesterOf = (r: ApprovalQueueRow): string =>
    maskRequesterName(r.item_type, r.requester, r.subject_meta?.full_name ?? null, true)

  const consentOf = (r: ApprovalQueueRow): boolean => {
    // Applicant-name masking gate; other sources are not data subjects here.
    if (r.item_type !== "application") return true
    const options = data?.requesterOptions ?? []
    void options
    // Applications surface masked initials unless a matching consented
    // profile exists — resolved server-side into requestersConsented by
    // users.id; the queue row's item_id maps 1:1 to the application, and
    // the applicants roster is tenant-scoped, so default to masked (fail-
    // closed) and let the server response open it.
    return data?.requestersConsented[r.item_id] ?? false
  }

  const exportCsv = () => {
    if (rows.length === 0) return
    const csv = approvalsToCsv(
      ["Type", "Subject", "Requester", "Requested at", "Age (days)", "Deep link", "PDPL"],
      rows.map((r) => [
        r.item_type,
        subjectLine(r, false),
        requesterOf(r),
        r.requested_at,
        pendingAgeDays(r.requested_at),
        itemDeepLink(r),
        consentOf(r) ? "granted" : "masked",
      ])
    )
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `approvals-${new Date().toISOString().slice(0, 10)}.csv`
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
            style={{ backgroundColor: `${meta.color}15`, color: meta.color }}
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
          <span className={cn("text-xs", masked ? "text-muted-foreground italic" : "text-foreground")}>
            {requesterOf(r)}
            {masked && (
              <span className="ms-1 text-[10px] text-muted-foreground">
                {isAr ? "(مقنّع — PDPL)" : "(masked — PDPL)"}
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
      {loadFailed && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {isAr
            ? "تعذر تحميل قائمة القرارات — حاول التحديث."
            : "Could not load the approvals queue — try refreshing."}
        </div>
      )}

      {/* Filter + export toolbar (server-side filters — one capped page) */}
      <div className="mb-4 space-y-3 rounded-2xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.type} onValueChange={(v) => setFilter("type", v as ApprovalItemType | "all")}>
            <SelectTrigger className="h-9 w-40 rounded-xl bg-muted/30 text-xs">
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
          <Input
            type="date"
            aria-label={isAr ? "من تاريخ" : "From date"}
            value={filters.from}
            onChange={(e) => setFilter("from", e.target.value)}
            className="h-9 w-40 rounded-xl bg-muted/30 text-xs"
          />
          <Input
            type="date"
            aria-label={isAr ? "إلى تاريخ" : "To date"}
            value={filters.to}
            onChange={(e) => setFilter("to", e.target.value)}
            className="h-9 w-40 rounded-xl bg-muted/30 text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {isAr
              ? `${rows.length} قرار (حد الصفحة 50/100)`
              : `${rows.length} decisions (page cap 50/100)`}
          </span>
          <div className="ms-auto flex items-center gap-2">
            {isFiltersActive(filters) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 rounded-xl text-xs"
                onClick={() => setFilters({ ...EMPTY_FILTERS })}
              >
                {isAr ? "مسح الفلاتر" : "Clear filters"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl"
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              {isAr ? "تحديث" : "Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl"
              onClick={exportCsv}
              disabled={rows.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {isAr ? "تصدير CSV" : "Export CSV"}
            </Button>
          </div>
        </div>
      </div>

      <EnterpriseModulePage<ApprovalQueueRow>
        title={isAr ? "صندوق القرارات" : "Approvals Inbox"}
        subtitle={
          isAr
            ? "كل القرارات المعلقة في مكان واحد — موافقة أو رفض مع سبب إلزامي وسجل تدقيق"
            : "Every pending decision in one queue — approve or reject with a mandatory reason and full audit trail"
        }
        kpiCards={kpiCards}
        searchPlaceholder={isAr ? "بحث..." : "Search..."}
        searchValue=""
        onSearchChange={() => {
          // Search is intentionally a no-op: filtering is server-side via the
          // capped RPC (type + date range); the shell requires the props.
        }}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowActions={(r) => (
          <div data-row-actions onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 rounded-lg text-xs text-emerald-600 hover:text-emerald-700"
                onClick={() => openDecision(r, "approved")}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isAr ? "موافقة" : "Approve"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 rounded-lg text-xs text-destructive hover:text-destructive"
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
            void load(filters, true)
          }
        }}
        onDone={() => void load(filters, true)}
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
