"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { BarChart3, FileCheck, Clock, AlertCircle, Download, FilePlus2, Loader2 } from "lucide-react"
import { generateReportAction } from "@/lib/reports/actions"
import { REPORT_TYPES, REPORT_TYPE_AR, type ReportType } from "@/lib/reports/generator"

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
  const { t } = useTranslation()
  const ar = t.common.status === "الحالة"
  const [data, setData] = useState<ReportRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [reportType, setReportType] = useState<ReportType>("payroll_summary")
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    const { data: result, error } = await supabase
      .from("report_generation_log")
      .select("id,report_type,output_format,status,file_name,file_url,file_size_bytes,expires_at,created_at,error_message")
      .order("created_at", { ascending: false })
      .limit(100)
    if (error) { console.error(error); setData([]) }
    else { setData((result as ReportRow[]) ?? []) }
    setIsLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

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
    await load()
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

  const filtered = search
    ? data.filter(r => r.report_type?.includes(search) || r.file_name?.includes(search))
    : data

  const kpiCards: KpiCardData[] = [
    { label: t.nav.reports, value: data.length, icon: BarChart3, color: "#1E5A99" },
    { label: t.common.approved, value: data.filter(r => r.status === "completed").length, icon: FileCheck, color: "#10B981" },
    { label: t.common.pending, value: data.filter(r => r.status === "generating").length, icon: Clock, color: "#F59E0B" },
    { label: t.common.error, value: data.filter(r => r.status === "failed").length, icon: AlertCircle, color: "#EF4444" },
  ]

  const columns: TableColumn<ReportRow>[] = [
    {
      key: "report_type", header: "Type",
      render: (r) => <span className="font-medium">{REPORT_TYPE_AR[r.report_type as ReportType] ?? r.report_type}</span>,
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
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt} value={rt}>{REPORT_TYPE_AR[rt]}</option>
              ))}
            </select>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {(ar ? MONTH_NAMES_AR : MONTH_NAMES_EN).map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
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
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:from-elite-blue-700 hover:to-elite-blue-800 disabled:opacity-50"
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
        data={filtered}
        isLoading={isLoading}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
