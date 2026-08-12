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
import {
  type ApplicationStatus,
  type DriverApplication,
} from "@/types/applications"
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  XCircle,
} from "lucide-react"

type ApplicationListItem = Pick<
  DriverApplication,
  | "id"
  | "application_number"
  | "full_name"
  | "mobile"
  | "city"
  | "work_type"
  | "driver_category"
  | "status"
  | "platform_codes"
  | "submitted_at"
>

const LIST_FIELDS = [
  "id",
  "application_number",
  "full_name",
  "mobile",
  "city",
  "work_type",
  "driver_category",
  "status",
  "platform_codes",
  "submitted_at",
].join(", ")

const STATUS_META: Record<
  ApplicationStatus,
  { ar: string; en: string; className: string }
> = {
  submitted: {
    ar: "مقدَّم",
    en: "Submitted",
    className:
      "bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/20",
  },
  under_review: {
    ar: "قيد المراجعة",
    en: "Under Review",
    className:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20",
  },
  approved: {
    ar: "مقبول",
    en: "Approved",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
  },
  rejected: {
    ar: "مرفوض",
    en: "Rejected",
    className:
      "bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20",
  },
}

const WORK_TYPE_META: Record<string, { ar: string; en: string }> = {
  full_time: { ar: "دوام كامل", en: "Full-time" },
  freelancer: { ar: "مستقل", en: "Freelancer" },
}

const CATEGORY_META: Record<string, { ar: string; en: string }> = {
  sponsored_type_1: { ar: "كفيل نوع ١", en: "Sponsored T1" },
  sponsored_type_2: { ar: "كفيل نوع ٢", en: "Sponsored T2" },
  freelancer: { ar: "مستقل", en: "Freelancer" },
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d)
}

export default function ApplicationsPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const isAr = locale === "ar"

  const [applications, setApplications] = useState<ApplicationListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">(
    "all"
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_applications")
        .select(LIST_FIELDS)
        .order("created_at", { ascending: false })
        .limit(200)

      if (cancelled) return
      if (error) {
        console.error("Failed to load applications:", error)
        setApplications([])
      } else {
        setApplications((data ?? []) as unknown as ApplicationListItem[])
      }
      setIsLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return applications.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false
      if (!q) return true
      return (
        (a.full_name ?? "").toLowerCase().includes(q) ||
        (a.application_number ?? "").toLowerCase().includes(q) ||
        (a.mobile ?? "").includes(q) ||
        (a.city ?? "").toLowerCase().includes(q)
      )
    })
  }, [applications, search, statusFilter])

  const countBy = (s: ApplicationStatus) =>
    applications.filter((a) => a.status === s).length

  const kpiCards: KpiCardData[] = [
    {
      label: isAr ? "إجمالي الطلبات" : "Total Applications",
      value: applications.length,
      icon: ClipboardList,
      color: "#1E5A99",
    },
    {
      label: isAr ? "بانتظار المراجعة" : "Pending Review",
      value: countBy("submitted") + countBy("under_review"),
      icon: Clock,
      color: "#F59E0B",
    },
    {
      label: t.common.approved,
      value: countBy("approved"),
      icon: CheckCircle2,
      color: "#10B981",
    },
    {
      label: t.common.rejected,
      value: countBy("rejected"),
      icon: XCircle,
      color: "#EF4444",
    },
  ]

  const columns: TableColumn<ApplicationListItem>[] = [
    {
      key: "full_name",
      header: isAr ? "المتقدم" : "Applicant",
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">
            {row.full_name || "—"}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {row.application_number}
          </div>
        </div>
      ),
    },
    {
      key: "mobile",
      header: isAr ? "الجوال" : "Phone",
      render: (row) => (
        <span dir="ltr" className="tabular-nums text-foreground/80">
          {row.mobile || "—"}
        </span>
      ),
    },
    {
      key: "work_type",
      header: isAr ? "نوع العمل" : "Work Type",
      render: (row) => {
        const wt = WORK_TYPE_META[row.work_type]
        const cat = row.driver_category
          ? CATEGORY_META[row.driver_category]
          : null
        return (
          <div className="min-w-0">
            <div className="text-sm text-foreground/80">
              {wt ? (isAr ? wt.ar : wt.en) : "—"}
            </div>
            {cat && (
              <div className="text-xs text-muted-foreground">
                {isAr ? cat.ar : cat.en}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: "platform_codes",
      header: isAr ? "المنصات" : "Platforms",
      render: (row) => {
        const codes = Array.isArray(row.platform_codes)
          ? row.platform_codes
          : []
        if (codes.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <span className="inline-flex max-w-40 flex-wrap gap-1">
            {codes.slice(0, 3).map((c) => (
              <span
                key={c}
                className="inline-flex items-center rounded-full bg-muted/50 px-1.5 py-0.5 text-[11px] text-foreground/70"
              >
                {c}
              </span>
            ))}
            {codes.length > 3 && (
              <span className="text-[11px] text-muted-foreground">
                +{codes.length - 3}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: "submitted_at",
      header: isAr ? "تاريخ التقديم" : "Submitted",
      render: (row) => (
        <span className="whitespace-nowrap text-foreground/80">
          {fmtDate(row.submitted_at)}
        </span>
      ),
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
              s.className
            )}
          >
            {isAr ? s.ar : s.en}
          </span>
        )
      },
    },
  ]

  const statusTabs: { value: ApplicationStatus | "all"; label: string }[] = [
    { value: "all", label: isAr ? "الكل" : "All" },
    { value: "submitted", label: isAr ? "مقدَّم" : "Submitted" },
    { value: "under_review", label: isAr ? "قيد المراجعة" : "Under Review" },
    { value: "approved", label: isAr ? "مقبول" : "Approved" },
    { value: "rejected", label: isAr ? "مرفوض" : "Rejected" },
  ]

  return (
    <div className="px-4 py-4 lg:px-6">
      <EnterpriseModulePage<ApplicationListItem>
        title={t.nav.applications}
        subtitle={
          isAr
            ? "مراجعة طلبات التسجيل وقبولها أو رفضها وتنزيل المستندات"
            : "Review driver registration applications, approve or reject, and download documents"
        }
        kpiCards={kpiCards}
        searchPlaceholder={isAr ? "ابحث بالاسم أو الرقم أو الجوال..." : "Search by name, number, or phone..."}
        searchValue={search}
        onSearchChange={setSearch}
        toolbarActions={
          <div className="flex flex-wrap gap-1 rounded-xl border border-border/50 bg-muted/20 p-1">
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  statusFilter === tab.value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/applications/${row.id}`)}
        emptyStateMessage={
          isAr
            ? "لا توجد طلبات مطابقة"
            : "No matching applications yet"
        }
      />
    </div>
  )
}
