"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { cn } from "@/lib/utils"
import { CreateDriverDialog } from "./components/create-driver-dialog"
import type { Driver, DriverCategory, DriverStatus } from "@/types/drivers"
import { CalendarClock, CheckCircle2, UserX, Users } from "lucide-react"

type DriverListItem = Pick<
  Driver,
  | "id"
  | "driver_code"
  | "full_name_ar"
  | "full_name_en"
  | "primary_mobile"
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
    ar: "منهى",
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

export default function DriversPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const isAr = locale === "ar"

  const [drivers, setDrivers] = useState<DriverListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadDrivers() {
      setIsLoading(true)
      const supabase = createClient()
      const { data, error } = await supabase
        .from("drivers")
        .select(DRIVER_FIELDS)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100)

      if (cancelled) return
      if (error) {
        console.error("Failed to load drivers:", error)
        setDrivers([])
      } else {
        setDrivers((data ?? []) as unknown as DriverListItem[])
      }
      setIsLoading(false)
    }
    loadDrivers()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return drivers
    return drivers.filter(
      (d) =>
        (d.full_name_ar ?? "").toLowerCase().includes(q) ||
        (d.full_name_en ?? "").toLowerCase().includes(q) ||
        (d.driver_code ?? "").toLowerCase().includes(q) ||
        (d.primary_mobile ?? "").includes(q),
    )
  }, [drivers, search])

  const activeCount = drivers.filter((d) => d.status === "active").length
  const onLeaveCount = drivers.filter((d) => d.status === "on_leave").length
  const suspendedCount = drivers.filter((d) => d.status === "suspended").length

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
  ]

  const columns: TableColumn<DriverListItem>[] = [
    {
      key: "full_name_ar",
      header: isAr ? "السائق" : "Driver",
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-xs font-semibold text-white">
            {row.full_name_ar?.slice(0, 1) ?? row.full_name_en?.slice(0, 1) ?? "?"}
          </div>
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

  return (
    <div className="px-4 py-4 lg:px-6">
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
        emptyStateMessage={isAr ? "لا يوجد سائقون بعد" : "No drivers yet"}
        emptyStateAction={{
          label: t.common.addNew,
          onClick: () => setDialogOpen(true),
        }}
      >
        <CreateDriverDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </EnterpriseModulePage>
    </div>
  )
}
