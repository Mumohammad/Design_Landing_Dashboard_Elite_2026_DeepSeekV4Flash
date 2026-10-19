"use client"

import { useCallback } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { performanceQuery, performanceSummary, type PerformanceRow } from "@/lib/operations/overview-queries"
import { useTablePage } from "@/hooks/use-table-page"
import { useReadSummary } from "@/hooks/use-read-summary"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Users, ClipboardCheck, Award, GraduationCap } from "lucide-react"

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  pending: { ar: "معلقة", en: "Pending", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  in_progress: { ar: "جارية", en: "In progress", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  completed: { ar: "مكتملة", en: "Completed", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  cancelled: { ar: "ملغاة", en: "Cancelled", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

function fmtDate(date: string): string {
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

export default function HRPage() {
  const { t, locale } = useTranslation()
  const buildQuery = useCallback((term: string) => performanceQuery(createClient(), term), [])
  const { rows, loading, error, search, setSearch, pagination, reload } = useTablePage<PerformanceRow>(buildQuery)
  const readSummary = useCallback((signal: AbortSignal) => performanceSummary(createClient(), signal), [])
  const summary = useReadSummary(readSummary)
  const counts = summary.value

  const kpiCards: KpiCardData[] = [
    { label: locale === "ar" ? "تقييمات الأداء" : "Performance reviews", value: counts?.[0] ?? "—", icon: Users, color: "#1E5A99" },
    { label: t.common.pending, value: counts?.[1] ?? "—", icon: ClipboardCheck, color: "#F59E0B" },
    { label: locale === "ar" ? "مكتملة" : "Completed", value: counts?.[2] ?? "—", icon: Award, color: "#10B981" },
    { label: locale === "ar" ? "الدرجة ٨٠ فأعلى" : "Score 80 or above", value: counts?.[3] ?? "—", icon: GraduationCap, color: "#8B5CF6" },
  ]

  const columns: TableColumn<PerformanceRow>[] = [
    { key: "driver", header: t.nav.drivers, render: (r) => r.driver ? <Link className="font-medium underline underline-offset-4" href={`/drivers/${r.driver_id}`}>{r.driver.full_name_ar}</Link> : "—" },
    { key: "review_period", header: "Period", render: (r) => <span dir="ltr" className="text-sm">{r.review_period}</span> },
    { key: "review_date", header: "Date", render: (r) => <span dir="ltr">{fmtDate(r.review_date)}</span> },
    {
      key: "overall_score", header: "Score",
      render: (r) => {
        if (r.overall_score == null) return <span className="text-muted-foreground">—</span>
        const cls = r.overall_score >= 80 ? "text-emerald-600" : r.overall_score >= 60 ? "text-amber-600" : "text-red-600"
        return <span dir="ltr" className={`tabular-nums font-medium ${cls}`}>{r.overall_score.toFixed(1)}</span>
      },
    },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.pending
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{locale === "ar" ? s.ar : s.en}</span>
      },
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.hrManagement}
        subtitle={locale === "ar" ? "إدارة التقييمات من ملف السائق. الملخص لجميع التقييمات." : "Manage reviews from the driver profile. Summary covers all reviews."}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        columns={columns}
        data={rows}
        isLoading={loading}
        pagination={pagination}
        loadError={error || summary.error ? (locale === "ar" ? "تعذر تحميل التقييمات أو الملخص. أعد المحاولة." : "Could not load reviews or their summary. Try again.") : undefined}
        onRetry={() => { reload(); summary.reload() }}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
