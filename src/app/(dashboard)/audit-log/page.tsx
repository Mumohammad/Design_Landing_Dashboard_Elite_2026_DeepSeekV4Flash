"use client"

// Audit-Trail surface (Prompt D) — read-only explorer over `audit_log`.
//
// Live DB reads via fetchAuditTrailPage() (admin client behind
// requirePermission("audit_log","read")), newest-first, server-side filters
// with hard pagination caps (50 default / 100 max — keyset pagination is
// deferred by prior decision). Per the drivers/users module precedent:
// EnterpriseModulePage shell, KPI chips, filter toolbar, CSV export,
// bilingual AR/EN, deferred-load effects. NO write paths — this module never
// inserts, updates, or deletes anything.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  Boxes,
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  FileSearch,
  History,
  RefreshCw,
  Users,
} from "lucide-react"

import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { fetchAuditTrailPage, type AuditTrailPageData, type AuditTrailRow } from "@/lib/audit-trail/queries"
import {
  ACTION_META,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AUDIT_PAGE_SIZE_DEFAULT,
  EMPTY_FILTERS,
  MODULE_META,
  auditToCsv,
  entityDrillHref,
  maskAuditMetadata,
  prettyMetadata,
  type AuditFilterState,
} from "@/lib/audit-trail/audit-utils"
import { formatDualDate } from "@/lib/formatting/hijri"
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

function isFiltersActive(f: AuditFilterState): boolean {
  return (
    f.from !== "" ||
    f.to !== "" ||
    f.actor !== "all" ||
    f.action !== "all" ||
    f.module !== "all" ||
    f.entityType !== "all" ||
    f.entityId !== ""
  )
}

function AuditTrailInner() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const isAr = locale === "ar"
  const searchParams = useSearchParams()

  const [data, setData] = useState<AuditTrailPageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Drill-down entries arrive as /audit-log?entityType=…&entityId=… — read
  // once on mount so the list opens pre-filtered on that entity's history.
  const [filters, setFilters] = useState<AuditFilterState>(() => ({
    ...EMPTY_FILTERS,
    entityType: searchParams.get("entityType") ?? "all",
    entityId: searchParams.get("entityId") ?? "",
  }))

  const load = useCallback(
    async (f: AuditFilterState, silent = false) => {
      if (!silent) setIsLoading(true)
      try {
        const result = await fetchAuditTrailPage({ ...f }, AUDIT_PAGE_SIZE_DEFAULT)
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

  // Deferred load (repo pattern) — refetches whenever filters change.
  useEffect(() => {
    const id = setTimeout(() => void load(filters), 0)
    return () => clearTimeout(id)
  }, [load, filters, refreshTick])

  // Keep the drill-down URL (?entityType=…&entityId=…) and filter state in
  // sync when navigation happens (row action → URL → filters → refetch).
  useEffect(() => {
    const id = setTimeout(() => {
      const et = searchParams.get("entityType")
      const eid = searchParams.get("entityId") ?? ""
      setFilters((prev) =>
        et !== null && (et !== prev.entityType || eid !== prev.entityId)
          ? { ...prev, entityType: et, entityId: eid }
          : prev
      )
    }, 0)
    return () => clearTimeout(id)
  }, [searchParams])

  const filteredActive = isFiltersActive(filters)

  const setFilter = <K extends keyof AuditFilterState>(key: K, value: AuditFilterState[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }))

  // Facets: constrained lists, plus any live value currently selected (real
  // rows can carry entity types outside the catalog — keep them selectable).
  const moduleOptions = useMemo(() => {
    const set = new Set<string>(Object.keys(MODULE_META))
    if (filters.module !== "all") set.add(filters.module)
    return Array.from(set)
  }, [filters.module])

  const entityTypeOptions = useMemo(() => {
    const set = new Set<string>(AUDIT_ENTITY_TYPES)
    if (filters.entityType !== "all") set.add(filters.entityType)
    return Array.from(set)
  }, [filters.entityType])

  const rows = data?.rows ?? []

  const kpiCards: KpiCardData[] = [
    { label: isAr ? "أحداث التدقيق" : "Audit events", value: data?.kpis.total ?? 0, icon: FileSearch, color: "#1E5A99" },
    { label: isAr ? "منفذون مختلفون" : "Distinct actors", value: data?.kpis.distinctActors ?? 0, icon: Users, color: "#10B981" },
    { label: isAr ? "كيانات مختلفة" : "Distinct entities", value: data?.kpis.distinctEntities ?? 0, icon: Boxes, color: "#F59E0B" },
    {
      label: isAr ? "إجراءات النظام" : "System actions",
      value: rows.filter((r) => !r.actor_id).length,
      icon: Bot,
      color: "#64748B",
    },
  ]

  const consentOf = (authId: string | null): boolean =>
    authId ? (data?.actorsConsented[authId] ?? false) : true

  const exportCsv = () => {
    if (!data || rows.length === 0) return
    const csv = auditToCsv(
      ["Timestamp", "Actor", "Module", "Action", "Entity type", "Entity ID", "Reason", "PDPL", "Metadata"],
      rows.map((r) => {
        const consent = consentOf(r.actor_id)
        const meta = r.new_values ?? r.old_values
        return [
          r.created_at,
          r.actor_id ? (data.actorNames[r.actor_id] ?? r.actor_id) : "system",
          r.module,
          r.action,
          r.entity_type,
          r.entity_id,
          r.reason,
          consent ? "granted" : "masked",
          meta ? JSON.stringify(maskAuditMetadata(meta, consent)) : "",
        ]
      })
    )
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const columns: TableColumn<AuditTrailRow>[] = [
    {
      key: "created_at",
      header: isAr ? "الوقت" : "Timestamp",
      render: (r) => (
        <span dir="ltr" className="block max-w-56 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {formatDualDate(r.created_at, isAr)}
        </span>
      ),
    },
    {
      key: "module",
      header: isAr ? "الوحدة" : "Module",
      render: (r) => {
        const meta = MODULE_META[r.module]
        return (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: `${meta?.color ?? "#64748B"}15`,
              color: meta?.color ?? "#64748B",
            }}
          >
            {isAr ? (meta?.ar ?? r.module) : (meta?.en ?? r.module)}
          </span>
        )
      },
    },
    {
      key: "action",
      header: isAr ? "الإجراء" : "Action",
      render: (r) => (
        <span dir="ltr" className="text-xs font-medium text-foreground">
          {isAr ? (ACTION_META[r.action]?.ar ?? r.action) : (ACTION_META[r.action]?.en ?? r.action)}
        </span>
      ),
    },
    {
      key: "entity_type",
      header: isAr ? "الكيان" : "Entity",
      render: (r) =>
        r.entity_type ? (
          <span dir="ltr" className="text-xs text-muted-foreground">
            {r.entity_type}
            {r.entity_id ? <span className="font-mono opacity-70"> · {r.entity_id.slice(0, 8)}</span> : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "actor_id",
      header: isAr ? "المنفّذ" : "Actor",
      render: (r) =>
        r.actor_id ? (
          <span className="text-xs text-foreground">
            {data?.actorNames[r.actor_id] ?? (
              <span dir="ltr" className="font-mono text-muted-foreground">
                {r.actor_id.slice(0, 8)}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs italic text-muted-foreground">{isAr ? "النظام" : "system"}</span>
        ),
    },
    {
      key: "reason",
      header: isAr ? "السبب / البيانات" : "Reason / metadata",
      render: (r) => {
        const meta = r.new_values ?? r.old_values
        const hasMeta = Boolean(meta && Object.keys(meta).length > 0)
        const isOpen = expanded.has(r.id)
        if (!r.reason && !hasMeta) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <div className="max-w-xs">
            {r.reason && (
              <div className="truncate text-xs text-foreground" title={r.reason}>
                {r.reason}
              </div>
            )}
            {hasMeta && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpanded(r.id)
                  }}
                  className={cn(
                    "mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-400",
                    r.reason && "mt-1"
                  )}
                >
                  {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {isAr ? "البيانات الوصفية" : "Metadata"}
                  <span className="text-muted-foreground">({isAr ? "مطوي" : "collapsed"})</span>
                </button>
                {isOpen && (
                  <pre
                    dir="ltr"
                    className="mt-1 max-h-48 overflow-auto rounded-lg border border-border/50 bg-muted/20 p-2 text-left text-[11px] leading-relaxed"
                  >
                    {prettyMetadata(meta, consentOf(r.actor_id)) ?? "{}"}
                  </pre>
                )}
              </>
            )}
          </div>
        )
      },
    },
  ]

  const noResults = !isLoading && rows.length === 0

  return (
    <div className="px-4 py-4 lg:px-6">
      {loadFailed && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {isAr
            ? "تعذر تحميل سجل التدقيق — حاول التحديث."
            : "Could not load the audit trail — try refreshing."}
        </div>
      )}

      {/* Filter + export toolbar (server-side filters — one capped page) */}
      <div className="mb-4 space-y-3 rounded-2xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
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
          <Select value={filters.actor} onValueChange={(v) => setFilter("actor", v)}>
            <SelectTrigger className="h-9 w-44 rounded-xl bg-muted/30 text-xs">
              <SelectValue placeholder={isAr ? "المنفّذ" : "Actor"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "كل المنفّذين" : "All actors"}</SelectItem>
              {(data?.actorOptions ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.action} onValueChange={(v) => setFilter("action", v)}>
            <SelectTrigger className="h-9 w-40 rounded-xl bg-muted/30 text-xs">
              <SelectValue placeholder={isAr ? "الإجراء" : "Action"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "كل الإجراءات" : "All actions"}</SelectItem>
              {AUDIT_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {isAr ? ACTION_META[a].ar : ACTION_META[a].en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.module} onValueChange={(v) => setFilter("module", v)}>
            <SelectTrigger className="h-9 w-40 rounded-xl bg-muted/30 text-xs">
              <SelectValue placeholder={isAr ? "الوحدة" : "Module"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "كل الوحدات" : "All modules"}</SelectItem>
              {moduleOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {isAr ? (MODULE_META[m]?.ar ?? m) : (MODULE_META[m]?.en ?? m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.entityType} onValueChange={(v) => setFilter("entityType", v)}>
            <SelectTrigger className="h-9 w-40 rounded-xl bg-muted/30 text-xs">
              <SelectValue placeholder={isAr ? "نوع الكيان" : "Entity type"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? "كل الأنواع" : "All types"}</SelectItem>
              {entityTypeOptions.map((et) => (
                <SelectItem key={et} value={et}>
                  {et}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            dir="ltr"
            placeholder={isAr ? "معرّف الكيان (UUID)" : "Entity ID (UUID)"}
            aria-label={isAr ? "معرّف الكيان" : "Entity ID"}
            value={filters.entityId}
            onChange={(e) => setFilter("entityId", e.target.value)}
            className="h-9 w-56 rounded-xl bg-muted/30 font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {isAr ? `${rows.length} حدث (حد الصفحة 50/100)` : `${rows.length} events (page cap 50/100)`}
          </span>
          <div className="ms-auto flex items-center gap-2">
            {filteredActive && (
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

      <EnterpriseModulePage<AuditTrailRow>
        title={t.nav.auditLog}
        subtitle={
          isAr
            ? "سجل التدقيق غير القابل للتغيير — قراءة فقط، مع فلاتر وتصدير"
            : "Immutable audit trail — read-only, with filters and export"
        }
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={filters.entityId}
        onSearchChange={(v) => setFilter("entityId", v)}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        onRowClick={(r) => {
          if (r.entity_type && r.entity_id) router.push(entityDrillHref(r.entity_type, r.entity_id))
        }}
        rowActions={(r) =>
          r.entity_type && r.entity_id ? (
            <div data-row-actions onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 rounded-lg text-xs"
                onClick={() => router.push(entityDrillHref(r.entity_type as string, r.entity_id as string))}
              >
                <History className="h-3.5 w-3.5" />
                {isAr ? "سجل الكيان" : "Entity history"}
              </Button>
            </div>
          ) : null
        }
        emptyStateMessage={
          noResults
            ? filteredActive
              ? isAr
                ? "لا توجد أحداث تدقيق مطابقة لهذه الفلاتر"
                : "No audit events match these filters"
              : isAr
                ? "لا توجد أحداث تدقيق بعد"
                : "No audit events yet"
            : ""
        }
      />
    </div>
  )
}

export default function AuditLogPage() {
  return (
    <Suspense fallback={null}>
      <AuditTrailInner />
    </Suspense>
  )
}
