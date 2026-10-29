"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { fetchApplicationsPage } from "@/lib/applications/review-actions"
import type { ApplicationsPageData } from "@/lib/applications/review-schema"
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
  withdrawn: {ar:"مسحوب",en:"Withdrawn",className:"border border-border bg-muted text-muted-foreground"},
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

  const [data,setData]=useState<ApplicationsPageData|null>(null)
  const [isLoading,setIsLoading]=useState(true)
  const [loadError,setLoadError]=useState(false)
  const [search,setSearch]=useState("")
  const [statusFilter,setStatusFilter]=useState<ApplicationStatus|"all">("all")
  const [archived,setArchived]=useState(false)
  const [page,setPage]=useState(1)
  const [revision,setRevision]=useState(0)
  useEffect(()=>{
   let cancelled=false
   const timer=setTimeout(async()=>{
    setIsLoading(true);setLoadError(false)
    try{const result=await fetchApplicationsPage({search,status:statusFilter,archived,page,pageSize:25});if(!cancelled){setData(result);setIsLoading(false)}}
    catch{if(!cancelled){setData(null);setLoadError(true);setIsLoading(false)}}
   },search?250:0)
   return()=>{cancelled=true;clearTimeout(timer)}
  },[search,statusFilter,archived,page,revision])
  const summary=data?.summary
  const kpiCards: KpiCardData[] = [
    {
      label: isAr ? "إجمالي الطلبات" : "Total Applications",
      value: summary?.total ?? "—",
      icon: ClipboardList,
      color: "#1E5A99",
    },
    {
      label: isAr ? "بانتظار المراجعة" : "Pending Review",
      value: summary?.pending ?? "—",
      icon: Clock,
      color: "#F59E0B",
    },
    {
      label: t.common.approved,
      value: summary?.approved ?? "—",
      icon: CheckCircle2,
      color: "#10B981",
    },
    {
      label: t.common.rejected,
      value: summary?.rejected ?? "—",
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
    { value: "withdrawn", label: isAr ? "مسحوب" : "Withdrawn" },
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
        onSearchChange={value=>{setSearch(value.slice(0,200));setPage(1);setIsLoading(true)}}
        toolbarActions={
          <div className="flex flex-wrap gap-1 rounded-xl border border-border/50 bg-muted/20 p-1">
            <label className="flex items-center gap-2 px-2 text-xs"><input type="checkbox" checked={archived} onChange={e=>{setArchived(e.target.checked);setPage(1);setIsLoading(true)}} />{isAr ? "السجل المؤرشف" : "Archived history"}</label>
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => {setStatusFilter(tab.value);setPage(1);setIsLoading(true)}}
                aria-pressed={statusFilter===tab.value}
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
        data={(data?.rows ?? []) as ApplicationListItem[]}
        pagination={{totalRecords:data?.total??0,currentPage:data?.page??page,totalPages:data?.totalPages??1,onPageChange:value=>{setPage(value);setIsLoading(true)}}}
        loadError={loadError ? (isAr ? "تعذر تحميل الطلبات وملخصها. أعد المحاولة." : "Could not load applications and their totals. Try again.") : undefined}
        onRetry={()=>setRevision(value=>value+1)}
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
