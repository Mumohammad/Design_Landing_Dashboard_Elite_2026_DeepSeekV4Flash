"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTablePage } from "@/hooks/use-table-page"
import { substringFilter } from "@/lib/supabase/search-filter"
import { collectRows } from "@/lib/reports/collect-rows"
import { escapeCsvCell } from "@/lib/csv-cell"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
import { logPhotoRenderFailure } from "@/lib/drivers/photo"
import { DriverPhotoProvider, useDriverPhoto } from "@/components/drivers/photo-provider"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CreateDriverDialog } from "./components/create-driver-dialog"
import DriverActionsMenu from "@/components/drivers/driver-actions-menu"
import type { Driver, DriverCategory, DriverStatus } from "@/types/drivers"
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  UserX,
  Users,
} from "lucide-react"

type DriverListItem = Pick<
  Driver,
  | "id"
  | "driver_code"
  | "full_name_ar"
  | "full_name_en"
  | "primary_mobile"
  | "photo_url"
  | "category"
  | "status"
  | "nationality"
  | "iqama_expiry_date"
  | "license_expiry_date"
  | "hire_date"
  | "profile_completeness_score"
>

const DRIVER_FIELDS = [
  "id",
  "driver_code",
  "full_name_ar",
  "full_name_en",
  "primary_mobile",
  "photo_url",
  "category",
  "status",
  "nationality",
  "iqama_expiry_date",
  "license_expiry_date",
  "hire_date",
  "profile_completeness_score",
].join(", ")

const STATUS_META: Record<DriverStatus, { ar: string; en: string; className: string }> = {
  active: {
    ar: "نشط",
    en: "Active",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
  },
  on_leave: {
    ar: "في إجازة",
    en: "On Leave",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20",
  },
  suspended: {
    ar: "معلّق",
    en: "Suspended",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
  draft: {
    ar: "مسودة",
    en: "Draft",
    className:
      "bg-gray-500/15 text-gray-700 dark:text-gray-300 border border-gray-500/20",
  },
  terminated: {
    ar: "منهي",
    en: "Terminated",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
  blacklisted: {
    ar: "محظور",
    en: "Blacklisted",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
}

const CATEGORY_META: Record<DriverCategory, { ar: string; en: string; className: string }> = {
  sponsored_type1: {
    ar: "كفيل نوع ١",
    en: "Sponsored T1",
    className:
      "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300 border border-elite-blue-500/20",
  },
  sponsored_type2: {
    ar: "كفيل نوع ٢",
    en: "Sponsored T2",
    className:
      "bg-teal-500/15 text-teal-700 dark:text-teal-400 border border-teal-500/20",
  },
  freelancer: {
    ar: "مستقل",
    en: "Freelancer",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20",
  },
}

const EXPIRY_WINDOW_DAYS = 30

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
}

function expiryWindow() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })
  const until = new Date(`${today}T00:00:00Z`)
  until.setUTCDate(until.getUTCDate() + EXPIRY_WINDOW_DAYS)
  return { today, until: until.toISOString().slice(0, 10) }
}
function expiringFilter() {
  const { today, until } = expiryWindow()
  return ["iqama_expiry_date", "license_expiry_date"].map((column) =>
    `and(${column}.gte.${today},${column}.lte.${until})`).join(",")
}

function DriverAvatar({
  name,
  photoPath,
  driverId,
}: {
  name: string | null
  photoPath: string | null
  driverId: string
}) {
  const initial = name?.slice(0, 1) ?? "?"
  // Provider resolves (and re-signs) the signed URL for this row's photo.
  return (
    <DriverPhotoProvider driverId={driverId} initialPhotoPath={photoPath}>
      <DriverAvatarImage name={name} initial={initial} />
    </DriverPhotoProvider>
  )
}

function DriverAvatarImage({ name, initial }: { name: string | null; initial: string }) {
  const { photoUrl } = useDriverPhoto()
  // Signed URLs expire; a deleted object 404s. Fall back to the initials
  // avatar instead of rendering a broken image.
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, not build-time optimizable
        <img
          src={photoUrl}
          alt={name ?? ""}
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
          onError={() => {
            logPhotoRenderFailure(photoUrl)
            setImgFailed(true)
          }}
        />
      ) : null}
      {!photoUrl || imgFailed ? (
        <span className="flex h-full w-full items-center justify-center bg-elite-blue-500 text-xs font-semibold text-white">
          {initial}
        </span>
      ) : null}
    </div>
  )
}

export default function DriversPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const isAr = locale === "ar"

  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | DriverStatus>("all")
  const [categoryFilter, setCategoryFilter] = useState<"all" | DriverCategory>("all")
  const [expiringOnly, setExpiringOnly] = useState(false)

  const buildQuery = useCallback((term: string) => {
    let query = createClient().from("drivers").select(DRIVER_FIELDS, { count: "exact" }).is("deleted_at", null)
    if (term.trim()) query = query.or(substringFilter(["full_name_ar", "full_name_en", "driver_code", "primary_mobile"], term))
    if (statusFilter !== "all") query = query.eq("status", statusFilter)
    if (categoryFilter !== "all") query = query.eq("category", categoryFilter)
    if (expiringOnly) query = query.or(expiringFilter())
    return query.order("created_at", { ascending: false }).order("id")
  }, [statusFilter, categoryFilter, expiringOnly])
  const { rows: drivers, search, setSearch, loading: isLoading, error, pagination, reload } = useTablePage<DriverListItem>(buildQuery)
  const [counts, setCounts] = useState<number[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const loadCounts = useCallback(async () => {
    const base = () => createClient().from("drivers").select("id", { count: "exact", head: true }).is("deleted_at", null)
    const results = await Promise.all([
      base(), base().eq("status", "active"), base().eq("status", "on_leave"), base().eq("status", "suspended"),
      base().or(expiringFilter()),
      base().or("nationality.ilike.%saudi%,nationality.ilike.%سعودي%"),
      base().lte("iqama_expiry_date", expiryWindow().until)
        .or("nationality.is.null,and(nationality.not.ilike.%saudi%,nationality.not.ilike.%سعودي%)"),
    ])
    setCounts(results.some((result) => result.error || result.count === null) ? null : results.map((result) => result.count!))
  }, [])
  useEffect(() => { const timer = setTimeout(() => void loadCounts(), 0); return () => clearTimeout(timer) }, [loadCounts])
  useEffect(() => subscribeDriverChanged(() => { reload(); void loadCounts() }), [reload, loadCounts])
  const filtered = drivers
  const saudiPct = counts && counts[0] > 0 ? Math.round(counts[5] / counts[0] * 100) : 0
  const expiringIqamaCount = counts?.[6] ?? 0

  const kpiCards: KpiCardData[] = [
    { label: t.dashboard.totalDrivers, value: counts?.[0] ?? "—", icon: Users, color: "#1E5A99" },
    {
      label: isAr ? `نسبة السعودة ${saudiPct}%` : `Saudization ${saudiPct}%`,
      value: counts ? `${counts[5]}/${counts[0]}` : "—",
      icon: CheckCircle2,
      color: "#10B981",
    },
    {
      label: isAr ? "نشط" : "Active",
      value: counts?.[1] ?? "—",
      icon: CheckCircle2,
      color: "#10B981",
    },
    {
      label: isAr ? "في إجازة" : "On Leave",
      value: counts?.[2] ?? "—",
      icon: CalendarClock,
      color: "#F59E0B",
    },
    {
      label: isAr ? "معلّق" : "Suspended",
      value: counts?.[3] ?? "—",
      icon: UserX,
      color: "#EF4444",
    },
    {
      label: isAr ? "وثائق تنتهي قريبًا" : "Expiring documents",
      value: counts?.[4] ?? "—",
      icon: AlertTriangle,
      color: "#F97316",
    },
    {
      label: isAr ? "إقامات تنتهي قريبًا" : "Iqamas expiring ≤30d",
      value: counts?.[6] ?? "—",
      icon: AlertTriangle,
      color: expiringIqamaCount > 0 ? "#EF4444" : "#64748B",
    },
  ]

  const exportCsv = async () => {
    setExporting(true)
    setExportError(false)
    try {
      const exportRows = await collectRows(() => buildQuery(search))
      const header = [
        "Driver Code",
        "Name (AR)",
        "Name (EN)",
        "Phone",
        "Category",
        "Status",
        "Iqama Expiry",
        "License Expiry",
        "Hire Date",
        "Completeness %",
      ]
      const lines = exportRows.map((d) =>
        [
          d.driver_code,
          d.full_name_ar,
          d.full_name_en,
          d.primary_mobile,
          d.category,
          d.status,
          d.iqama_expiry_date,
          d.license_expiry_date,
          d.hire_date,
          d.profile_completeness_score,
        ]
          .map(escapeCsvCell)
          .join(","),
      )
      const csv = "\uFEFF" + [header.join(","), ...lines].join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `drivers-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError(true)
    } finally { setExporting(false) }
  }

  const columns: TableColumn<DriverListItem>[] = [
    {
      key: "full_name_ar",
      header: isAr ? "السائق" : "Driver",
      render: (row) => (
        <div className="flex items-center gap-3">
          <DriverAvatar
            name={row.full_name_ar ?? row.full_name_en}
            photoPath={row.photo_url ?? null}
            driverId={row.id}
          />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">
              {row.full_name_ar ?? "—"}
            </div>
            {row.driver_code && (
              <div className="truncate text-xs text-muted-foreground">
                {row.driver_code}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "primary_mobile",
      header: isAr ? "الجوال" : "Phone",
      render: (row) => (
        <span dir="ltr" className="tabular-nums text-foreground/80">
          {row.primary_mobile || "—"}
        </span>
      ),
    },
    {
      key: "category",
      header: isAr ? "الفئة" : "Category",
      render: (row) => {
        const cat = CATEGORY_META[row.category]
        return (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              cat.className,
            )}
          >
            {isAr ? cat.ar : cat.en}
          </span>
        )
      },
    },
    {
      key: "status",
      header: t.common.status,
      render: (row) => {
        const s = STATUS_META[row.status]
        return (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              s.className,
            )}
          >
            {isAr ? s.ar : s.en}
          </span>
        )
      },
    },
    {
      key: "iqama_expiry_date",
      header: isAr ? "انتهاء الوثائق" : "Doc expiry",
      render: (row) => {
        const dates = [
          { label: isAr ? "إقامة" : "Iqama", days: daysUntil(row.iqama_expiry_date) },
          { label: isAr ? "رخصة" : "License", days: daysUntil(row.license_expiry_date) },
        ].filter((d) => d.days !== null)
        if (dates.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex flex-col gap-0.5">
            {dates.map((d) => {
              const days = d.days as number
              const cls =
                days < 0
                  ? "text-red-600 dark:text-red-400"
                  : days <= EXPIRY_WINDOW_DAYS
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
              return (
                <span key={d.label} className={cn("text-xs tabular-nums", cls)}>
                  {d.label}: {days < 0
                    ? isAr
                      ? "منتهية"
                      : "expired"
                    : isAr
                      ? `${days} يوم`
                      : `${days}d`}
                </span>
              )
            })}
          </div>
        )
      },
    },
    {
      key: "profile_completeness_score",
      header: isAr ? "الاكتمال" : "Completeness",
      render: (row) => {
        const score = row.profile_completeness_score ?? 0
        const barColor =
          score >= 80
            ? "bg-emerald-500"
            : score >= 50
              ? "bg-amber-500"
              : "bg-red-500"
        return (
          <div className="flex items-center gap-2">
            <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", barColor)}
                style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{score}%</span>
          </div>
        )
      },
    },
  ]

  const noResults =
    !isLoading &&
    (search.trim() !== "" || statusFilter !== "all" || categoryFilter !== "all" || expiringOnly) &&
    filtered.length === 0

  return (
    <div
      className="px-4 py-4 lg:px-6"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest("[data-row-actions]")) return
        const tr = target.closest("tr")
        if (!tr || tr.parentElement?.tagName !== "TBODY") return
        const idx = Array.from(tr.parentElement.children).indexOf(tr)
        const row = filtered[idx]
        if (row) router.push(`/drivers/${row.id}`)
      }}
    >
      {/* Filter + export toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-card/60 px-4 py-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v as "all" | DriverStatus); pagination.onPageChange(1) }}
        >
          <SelectTrigger className="h-9 w-36 rounded-xl bg-muted/30 text-xs">
            <SelectValue placeholder={isAr ? "الحالة" : "Status"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
            {(Object.keys(STATUS_META) as DriverStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {isAr ? STATUS_META[s].ar : STATUS_META[s].en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={categoryFilter}
          onValueChange={(v) => { setCategoryFilter(v as "all" | DriverCategory); pagination.onPageChange(1) }}
        >
          <SelectTrigger className="h-9 w-40 rounded-xl bg-muted/30 text-xs">
            <SelectValue placeholder={isAr ? "الفئة" : "Category"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الفئات" : "All categories"}</SelectItem>
            {(Object.keys(CATEGORY_META) as DriverCategory[]).map((c) => (
              <SelectItem key={c} value={c}>
                {isAr ? CATEGORY_META[c].ar : CATEGORY_META[c].en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="expiring-only"
            checked={expiringOnly}
            onCheckedChange={(value) => { setExpiringOnly(value); pagination.onPageChange(1) }}
          />
          <Label htmlFor="expiring-only" className="text-xs text-muted-foreground">
            {isAr ? `تنتهي خلال ${EXPIRY_WINDOW_DAYS} يوم` : `Expiring ≤ ${EXPIRY_WINDOW_DAYS}d`}
          </Label>
        </div>
        <div className="ms-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {isAr
              ? `${filtered.length} من ${pagination.totalRecords}`
              : `${filtered.length} of ${pagination.totalRecords}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-xl"
            onClick={exportCsv}
            disabled={isLoading || exporting || !!error || pagination.totalRecords === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? (isAr ? "جاري التصدير…" : "Exporting…") : (isAr ? "تصدير CSV" : "Export CSV")}
          </Button>
        </div>
      </div>

      {exportError && <p role="alert" className="mb-4 text-sm text-destructive">{isAr ? "تعذر تصدير القائمة الكاملة. أعد المحاولة." : "Could not export the complete list. Try again."}</p>}
      <EnterpriseModulePage<DriverListItem>
        title={t.nav.drivers}
        subtitle={
          isAr
            ? "إدارة ملفات السائقين وتفاصيل التعيين"
            : "Manage driver profiles and assignment details"
        }
        primaryCtaLabel={t.common.addNew}
        onPrimaryCta={() => setDialogOpen(true)}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        pagination={pagination}
        loadError={error ? (isAr ? "تعذر تحميل السائقين. أعد المحاولة." : "Could not load drivers. Try again.") : undefined}
        onRetry={() => { reload(); void loadCounts() }}
        retryLabel={t.common.retry}
        onRowClick={(row) => router.push(`/drivers/${row.id}`)}
        rowActions={(row) => (
          <div
            data-row-actions
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <DriverActionsMenu
              driverId={row.id}
              isAr={isAr}
              variant="icon"
              showOpenItem
            />
          </div>
        )}
        emptyStateMessage={
          noResults
            ? isAr
              ? "لا توجد نتائج مطابقة للفلاتر"
              : "No drivers match the current filters"
            : isAr
              ? "لا يوجد سائقون بعد"
              : "No drivers yet"
        }
        emptyStateAction={
          noResults
            ? undefined
            : {
                label: t.common.addNew,
                onClick: () => setDialogOpen(true),
              }
        }
      >
        <CreateDriverDialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) { reload(); void loadCounts() }
        }} />
      </EnterpriseModulePage>
    </div>
  )
}
