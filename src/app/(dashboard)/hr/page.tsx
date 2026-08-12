"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Users, ClipboardCheck, Award, GraduationCap } from "lucide-react"

interface PerformanceRow {
  id: string
  review_period: string
  review_date: string
  overall_score: number | null
  status: string
  driver: { full_name_ar: string; driver_code: string } | null
}

const STATUS_META: Record<string, { ar: string; className: string }> = {
  pending: { ar: "معلقة", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  in_progress: { ar: "جارية", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  completed: { ar: "مكتملة", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  cancelled: { ar: "ملغاة", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

function fmtDate(date: string): string {
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

export default function HRPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<PerformanceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("performance_reviews")
        .select("id,review_period,review_date,overall_score,status,driver:drivers(full_name_ar,driver_code)")
        .is("deleted_at", null)
        .order("review_date", { ascending: false })
        .limit(100)
      if (error) { console.error(error); setData([]) }
      else { setData((result as unknown as PerformanceRow[]) ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.driver?.full_name_ar?.includes(search) || r.review_period?.includes(search))
    : data

  const kpiCards: KpiCardData[] = [
    { label: t.nav.hrManagement, value: data.length, icon: Users, color: "#1E5A99" },
    { label: t.common.pending, value: data.filter(r => r.status === "pending").length, icon: ClipboardCheck, color: "#F59E0B" },
    { label: t.common.approved, value: data.filter(r => r.status === "completed").length, icon: Award, color: "#10B981" },
    { label: t.common.active, value: data.filter(r => r.overall_score !== null && r.overall_score >= 80).length, icon: GraduationCap, color: "#8B5CF6" },
  ]

  const columns: TableColumn<PerformanceRow>[] = [
    { key: "driver", header: t.nav.drivers, render: (r) => <span className="font-medium">{r.driver?.full_name_ar ?? "—"}</span> },
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
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.ar}</span>
      },
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.hrManagement}
        subtitle={t.common.status}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
