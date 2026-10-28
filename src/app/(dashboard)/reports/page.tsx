"use client"

import { useCallback, useEffect, useState } from "react"
import { useTablePage } from "@/hooks/use-table-page"
import { substringFilter } from "@/lib/supabase/search-filter"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { BarChart3, FileCheck, Clock, AlertCircle, Download, FilePlus2, Loader2 } from "lucide-react"
import { generateReportAction } from "@/lib/reports/actions"
import { REPORT_TYPES, REPORT_TYPE_AR, REPORT_TYPE_EN, type ReportType } from "@/lib/reports/generator"

interface ReportRow {
  id: string
  report_type: string
  output_format: string
  status: string
  file_name: string | null
  file_url: string | null
  file_size_bytes: number | null
  expires_at: string
  created_at: string
  error_message: string | null
}

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  generating: { ar: "جاري الإنشاء", en: "Generating", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  completed: { ar: "مكتمل", en: "Completed", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  failed: { ar: "فشل", en: "Failed", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  expired: { ar: "منتهي", en: "Expired", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

function fmtBytes(bytes: number | null): string {
  if (!bytes) return "—"
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

function fmtDate(date: string): string {
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export default function ReportsPage() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"
  const reportNames = ar ? REPORT_TYPE_AR : REPORT_TYPE_EN
  const buildQuery = useCallback((term: string) => {
    let query = createClient().from("report_generation_log")
      .select("id,report_type,output_format,status,file_name,file_url,file_size_bytes,expires_at,created_at,error_message", { count: "exact" })
    if (term.trim()) {
      // report_type is a Postgres enum: search translated labels, then filter
      // by allowlisted enum values rather than applying ILIKE to the enum.
      const text = term.trim().toLowerCase()
      const matches = REPORT_TYPES.filter((type) => [type, REPORT_TYPE_AR[type], REPORT_TYPE_EN[type]]
        .some((name) => name.toLowerCase().includes(text)))
      query = query.or([substringFilter(["file_name"], term), ...matches.map((type) => `report_type.eq.${type}`)].join(","))
    }
    return query.order("created_at", { ascending: false }).order("id")
  }, [])
  const { rows: data, loading: isLoading, search, setSearch, pagination, reload, error: loadError } = useTablePage<ReportRow>(buildQuery)
  const [counts, setCounts] = useState<number[] | null>(null)
  const [reportType, setReportType] = useState<ReportType>("payroll_summary")
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const loadCounts = useCallback(async () => {
    const results = await Promise.all([null, "completed", "generating", "failed"].map((status) => {
      const query = createClient().from("report_generation_log").select("id", { count: "exact", head: true })
      return status ? query.eq("status", status) : query
    }))
    setCounts(results.some((result) => result.error || result.count === null) ? null : results.map((result) => result.count!))
  }, [])
  useEffect(() => { const timer = setTimeout(() => void loadCounts(), 0); return () => clearTimeout(timer) }, [loadCounts])

  async function handleGenerate() {
    setIsGenerating(true)
    setFeedback(null)
    const res = await generateReportAction(reportType, { year, month })
    setIsGenerating(false)
    if (res.success) {
      setFeedback({ type: "ok", text: ar ? "تم إنشاء التقرير بنجاح." : "Report generated successfully." })
    } else {
      setFeedback({ type: "err", text: res.error ?? "Error" })
    }
    reload()
    await loadCounts()
  }

  async function handleDownload(row: ReportRow) {
    if (!row.file_url) return
    setDownloadingId(row.id)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.storage
        .from("generated-reports")
        .createSignedUrl(row.file_url, 3600)
      if (error || !data?.signedUrl) throw new Error(error?.message ?? "No signed URL")
      window.open(data.signedUrl, "_blank")
    } catch (e) {
      setFeedback({ type: "err", text: e instanceof Error ? e.message : "Download failed" })
    }
    setDownloadingId(null)
  }

  const kpiCards: KpiCardData[] = [
    { label: t.nav.reports, value: counts?.[0] ?? "—", icon: BarChart3, color: "#1E5A99" },
    { label: t.common.approved, value: counts?.[1] ?? "—", icon: FileCheck, color: "#10B981" },
    { label: t.common.pending, value: counts?.[2] ?? "—", icon: Clock, color: "#F59E0B" },
    { label: t.common.error, value: counts?.[3] ?? "—", icon: AlertCircle, color: "#EF4444" },
  ]

  const columns: TableColumn<ReportRow>[] = [
    {
      key: "report_type", header: "Type",
      render: (r) => <span className="font-medium">{reportNames[r.report_type as ReportType] ?? r.report_type}</span>,
    },
    { key: "output_format", header: "Format", render: (r) => <span dir="ltr" className="text-xs uppercase font-mono">{r.output_format}</span> },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.generating
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{ar ? s.ar : s.en}</span>
      },
    },
    { key: "file_name", header: "File", render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{r.file_name ?? "—"}</span> },
    { key: "file_size_bytes", header: "Size", render: (r) => <span dir="ltr" className="tabular-nums text-xs">{fmtBytes(r.file_size_bytes)}</span> },
    { key: "created_at", header: "Created", render: (r) => <span dir="ltr" className="text-xs">{fmtDate(r.created_at)}</span> },
    { key: "expires_at", header: "Expires", render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{fmtDate(r.expires_at)}</span> },
    {
      key: "download", header: ar ? "تنزيل" : "Download",
      render: (r) =>
        r.status === "completed" && r.file_url ? (
          <button
            onClick={() => handleDownload(r)}
            disabled={downloadingId === r.id}
            className="inline-flex items-center gap-1 rounded-lg border border-elite-blue-500/25 bg-elite-blue-600/10 px-2 py-1 text-xs font-medium text-elite-blue-600 transition-colors hover:bg-elite-blue-600/20 disabled:opacity-50"
          >
            {downloadingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {ar ? "تنزيل" : "Download"}
          </button>
        ) : r.status === "failed" ? (
          <span className="text-xs text-red-500" title={r.error_message ?? ""}>{ar ? "فشل" : "Failed"}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.reports}
        subtitle={ar ? "تقارير قابلة للتصدير مع سجل توليد" : "Exportable reports with a generation log"}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={ar ? "نوع التقرير" : "Report type"}
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt} value={rt} disabled={rt === "custom"}>{reportNames[rt]}{rt === "custom" ? (ar ? " — غير متاح بعد" : " — not available yet") : ""}</option>
              ))}
            </select>
            <select
              aria-label={ar ? "شهر التقرير" : "Report month"}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {(ar ? MONTH_NAMES_AR : MONTH_NAMES_EN).map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              aria-label={ar ? "سنة التقرير" : "Report year"}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-elite-blue-600 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-elite-blue-700 disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
              {ar ? "إنشاء تقرير" : "Generate report"}
            </button>
            {feedback && (
              <span className={`text-xs font-medium ${feedback.type === "ok" ? "text-emerald-600" : "text-red-500"}`}>
                {feedback.text}
              </span>
            )}
          </div>
        }
        columns={columns}
        data={data}
        pagination={pagination}
        loadError={loadError ? (ar ? "تعذر تحميل التقارير. أعد المحاولة." : "Could not load reports. Try again.") : undefined}
        onRetry={() => { reload(); void loadCounts() }}
        retryLabel={t.common.retry}
        isLoading={isLoading}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
