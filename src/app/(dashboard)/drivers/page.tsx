"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
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
      "bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/20",
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

function isExpiringSoon(row: DriverListItem): boolean {
  const dates = [row.iqama_expiry_date, row.license_expiry_date]
  return dates.some((d) => {
    const days = daysUntil(d)
    return days !== null && days >= 0 && days <= EXPIRY_WINDOW_DAYS
  })
}

function DriverAvatar({
  name,
  photoUrl,
}: {
  name: string | null
  photoUrl: string | null
}) {
  const initial = name?.slice(0, 1) ?? "?"
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, not build-time optimizable
        <img
          src={photoUrl}
          alt={name ?? ""}
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-xs font-semibold text-white">
          {initial}
        </span>
      )}
    </div>
  )
}

export default function DriversPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const isAr = locale === "ar"

  const [drivers, setDrivers] = useState<DriverListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | DriverStatus>("all")
  const [categoryFilter, setCategoryFilter] = useState<"all" | DriverCategory>("all")
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})

  const loadDrivers = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from("drivers")
      .select(DRIVER_FIELDS)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100)

    if (error) {
      console.error("Failed to load drivers:", error)
      if (!silent) setDrivers([])
    } else {
      setDrivers((data ?? []) as unknown as DriverListItem[])
    }
    if (!silent) setIsLoading(false)
  }, [])

  useEffect(() => {
    // Defer to a task boundary so the compiler does not trace the initial
    // setState (loading flag) as a synchronous write inside the effect body.
    const id = setTimeout(() => void loadDrivers(), 0)
    return () => clearTimeout(id)
  }, [loadDrivers])

  // Refetch silently when any driver surface reports a change (photo, status, edit…)
  useEffect(() => {
    return subscribeDriverChanged(() => {
      void loadDrivers(true)
    })
  }, [loadDrivers])

  // Batch-resolve signed URLs for storage-path photos (one effect per list load).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const paths = drivers
        .map((d) => d.photo_url)
        .filter((p): p is string => typeof p === "string" && p.length > 0 && !/^https?:\/\//i.test(p))
      const missing = paths.filter((p) => !(p in photoUrls))
      if (missing.length === 0) return
      const supabase = createClient()
      const entries = await Promise.all(
        missing.map(async (path) => {
          const { data } = await supabase.storage
            .from("driver-photos")
            .createSignedUrl(path, 3600)
          return [path, data?.signedUrl ?? ""] as const
        }),
      )
      if (cancelled) return
      const direct: Record<string, string> = {}
      for (const d of drivers) {
        if (typeof d.photo_url === "string" && /^https?:\/\//i.test(d.photo_url)) {
          direct[d.photo_url] = d.photo_url
        }
      }
      setPhotoUrls((prev) => ({ ...prev, ...direct, ...Object.fromEntries(entries) }))
    })()
    return () => {
      cancelled = true
    }
  }, [drivers]) // eslint-disable-line react-hooks/exhaustive-deps -- photoUrls map grows monotonically

  const filtered = useMemo(() => {
    let rows = drivers
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (d) =>
          (d.full_name_ar ?? "").toLowerCase().includes(q) ||
          (d.full_name_en ?? "").toLowerCase().includes(q) ||
          (d.driver_code ?? "").toLowerCase().includes(q) ||
          (d.primary_mobile ?? "").includes(q),
      )
    }
    if (statusFilter !== "all") rows = rows.filter((d) => d.status === statusFilter)
    if (categoryFilter !== "all") rows = rows.filter((d) => d.category === categoryFilter)
    if (expiringOnly) rows = rows.filter(isExpiringSoon)
    return rows
  }, [drivers, search, statusFilter, categoryFilter, expiringOnly])

  const activeCount = drivers.filter((d) => d.status === "active").length
  const onLeaveCount = drivers.filter((d) => d.status === "on_leave").length
  const suspendedCount = drivers.filter((d) => d.status === "suspended").length
  const expiringCount = drivers.filter(isExpiringSoon).length

  const kpiCards: KpiCardData[] = [
    { label: t.dashboard.totalDrivers, value: drivers.length, icon: Users, color: "#1E5A99" },
    {
      label: isAr ? "نشط" : "Active",
      value: activeCount,
      icon: CheckCircle2,
      color: "#10B981",
    },
    {
      label: isAr ? "في إجازة" : "On Leave",
      value: onLeaveCount,
      icon: CalendarClock,
      color: "#F59E0B",
    },
    {
      label: isAr ? "معلّق" : "Suspended",
      value: suspendedCount,
      icon: UserX,
      color: "#EF4444",
    },
    {
      label: isAr ? "وثائق تنتهي قريبًا" : "Expiring documents",
      value: expiringCount,
      icon: AlertTriangle,
      color: "#F97316",
    },
  ]

  const exportCsv = () => {
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
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = filtered.map((d) =>
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
        .map(escape)
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
  }

  const columns: TableColumn<DriverListItem>[] = [
    {
      key: "full_name_ar",
      header: isAr ? "السائق" : "Driver",
      render: (row) => (
        <div className="flex items-center gap-3">
          <DriverAvatar
            name={row.full_name_ar ?? row.full_name_en}
            photoUrl={row.photo_url ? (photoUrls[row.photo_url] ?? null) : null}
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
    drivers.length > 0 &&
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
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-sm">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as "all" | DriverStatus)}
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
          onValueChange={(v) => setCategoryFilter(v as "all" | DriverCategory)}
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
            onCheckedChange={setExpiringOnly}
          />
          <Label htmlFor="expiring-only" className="text-xs text-muted-foreground">
            {isAr ? `تنتهي خلال ${EXPIRY_WINDOW_DAYS} يوم` : `Expiring ≤ ${EXPIRY_WINDOW_DAYS}d`}
          </Label>
        </div>
        <div className="ms-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {isAr
              ? `${filtered.length} من ${drivers.length}`
              : `${filtered.length} of ${drivers.length}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-xl"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {isAr ? "تصدير CSV" : "Export CSV"}
          </Button>
        </div>
      </div>

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
        <CreateDriverDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </EnterpriseModulePage>
    </div>
  )
}
