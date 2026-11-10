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
import { fetchReportDownload, reportHasExpired, ReportDownloadError } from "@/lib/reports/download"

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

function fmtDate(date: string, ar: boolean): string {
  const value = new Date(date)
  return Number.isFinite(value.getTime()) ? value.toLocaleDateString(ar ? "ar-SA-u-ca-gregory" : "en-GB") : "—"
}

const FEEDBACK = {
  generated: { ar: "تم إنشاء التقرير بنجاح.", en: "Report generated successfully." },
  generateFailed: { ar: "تعذر إنشاء التقرير. أعد المحاولة.", en: "Could not generate the report. Try again." },
  permission: { ar: "ليس لديك صلاحية تصدير التقارير. تواصل مع مسؤول الشركة.", en: "You do not have permission to export reports. Contact your company administrator." },
  session: { ar: "انتهت جلستك. سجل الدخول مجددًا لإنشاء التقرير.", en: "Your session has expired. Sign in again to generate the report." },
  rateLimit: { ar: "بلغت حد ١٠ تقارير في الساعة. أعد المحاولة لاحقًا.", en: "You reached the limit of 10 reports per hour. Try again later." },
  unsupported: { ar: "اختر أحد أنواع التقارير المتاحة.", en: "Choose one of the available report types." },
  invalidPeriod: { ar: "اختر سنة وشهرًا صحيحين للتقرير.", en: "Choose a valid reporting year and month." },
  tooLarge: { ar: "يتجاوز التقرير ١٠٠٬٠٠٠ صف. اختر فترة أقصر.", en: "This report exceeds 100,000 rows. Choose a smaller reporting period." },
  changed: { ar: "تغيرت بيانات التقرير أثناء إنشائه. أعد المحاولة للحصول على ملف متسق.", en: "Report data changed during generation. Retry to export a consistent result." },
  incomplete: { ar: "تعذر قراءة التقرير كاملًا. أعد المحاولة؛ لم يتم إنشاء ملف جزئي.", en: "Could not read the complete report. Retry; no partial file was generated." },
  downloadFailed: { ar: "تعذر تنزيل التقرير. أعد المحاولة.", en: "Could not download the report. Try again." },
  expired: { ar: "انتهت صلاحية التقرير. أنشئ تقريرًا جديدًا لتنزيله.", en: "This report has expired. Generate a new report to download it." },
} as const

type FeedbackCode = keyof typeof FEEDBACK
function generationFailure(error?: string): FeedbackCode {
  switch (error) {
    case "Not authenticated.": return "session"
    case "You do not have permission to perform this action.":
    case "ليس لديك صلاحية للقيام بهذا الإجراء.": return "permission"
    case "Rate limit exceeded (10 reports/hour). Try again later.": return "rateLimit"
    case "This report type is not supported yet. Choose one of the available reports.": return "unsupported"
    case "Choose a valid reporting year and month.": return "invalidPeriod"
    case "This report exceeds 100,000 rows. Choose a smaller reporting period.": return "tooLarge"
    case "Report data changed during generation. Retry to export a consistent result.": return "changed"
    case "Could not read report data. Retry the report; no partial file was generated.":
    case "The database returned an incomplete report. Retry; no partial file was generated.": return "incomplete"
    default: return "generateFailed"
  }
}

const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export default function ReportsPage() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"
  const reportNames = ar ? REPORT_TYPE_AR : REPORT_TYPE_EN
  const buildQuery = useCallback((term: string) => {
    let query = createClient().from("report_generation_log")
      .select("id,report_type,output_format,status,file_name,file_url,file_size_bytes,expires_at,created_at", { count: "exact" })
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
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; code: FeedbackCode } | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const loadCounts = useCallback(async () => {
    try {
      const results = await Promise.all([null, "completed", "generating", "failed"].map((status) => {
        const query = createClient().from("report_generation_log").select("id", { count: "exact", head: true })
        return status ? query.eq("status", status) : query
      }))
      setCounts(results.some((result) => result.error || result.count === null) ? null : results.map((result) => result.count!))
    } catch {
      setCounts(null)
    }
  }, [])
  useEffect(() => { const timer = setTimeout(() => void loadCounts(), 0); return () => clearTimeout(timer) }, [loadCounts])

  async function handleGenerate() {
    if (isGenerating) return
    setIsGenerating(true)
    setFeedback(null)
    try {
      const res = await generateReportAction(reportType, { year, month })
      setFeedback(res.success ? { type: "ok", code: "generated" } : { type: "err", code: generationFailure(res.error) })
    } catch {
      setFeedback({ type: "err", code: "generateFailed" })
    } finally {
      setIsGenerating(false)
      reload()
      await loadCounts()
    }
  }

  async function handleDownload(row: ReportRow) {
    if (downloadingId) return
    setDownloadingId(row.id)
    setFeedback(null)
    try {
      const bucket = createClient().storage.from("generated-reports")
      const result = await fetchReportDownload(row, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", (path, ttl, options) => bucket.createSignedUrl(path, ttl, options))
      const objectUrl = URL.createObjectURL(result.blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = result.filename
      document.body.appendChild(link)
      try { link.click() } finally {
        link.remove()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      }
    } catch (error) {
      setFeedback({ type: "err", code: error instanceof ReportDownloadError && error.code === "expired" ? "expired" : "downloadFailed" })
    } finally {
      setDownloadingId(null)
    }
  }

  const kpiCards: KpiCardData[] = [
    { label: t.nav.reports, value: counts?.[0] ?? "—", icon: BarChart3, color: "#1E5A99" },
    { label: ar ? STATUS_META.completed.ar : STATUS_META.completed.en, value: counts?.[1] ?? "—", icon: FileCheck, color: "#10B981" },
    { label: ar ? STATUS_META.generating.ar : STATUS_META.generating.en, value: counts?.[2] ?? "—", icon: Clock, color: "#F59E0B" },
    { label: t.common.error, value: counts?.[3] ?? "—", icon: AlertCircle, color: "#EF4444" },
  ]

  const columns: TableColumn<ReportRow>[] = [
    {
      key: "report_type", header: ar ? "النوع" : "Type",
      render: (r) => <span className="font-medium">{reportNames[r.report_type as ReportType] ?? r.report_type}</span>,
    },
    { key: "output_format", header: ar ? "الصيغة" : "Format", render: (r) => <span dir="ltr" className="text-xs uppercase font-mono">{r.output_format}</span> },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[reportHasExpired(r) ? "expired" : r.status] ?? STATUS_META.generating
        return <span data-testid={"report-status-" + r.id} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{ar ? s.ar : s.en}</span>
      },
    },
    { key: "file_name", header: ar ? "الملف" : "File", render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{r.file_name ?? "—"}</span> },
    { key: "file_size_bytes", header: ar ? "الحجم" : "Size", render: (r) => <span dir="ltr" className="tabular-nums text-xs">{fmtBytes(r.file_size_bytes)}</span> },
    { key: "created_at", header: ar ? "تاريخ الإنشاء" : "Created", render: (r) => <span dir="ltr" className="text-xs">{fmtDate(r.created_at, ar)}</span> },
    { key: "expires_at", header: ar ? "انتهاء الصلاحية" : "Expires", render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{fmtDate(r.expires_at, ar)}</span> },
    {
      key: "download", header: ar ? "تنزيل" : "Download",
      render: (r) =>
        r.status === "completed" && r.file_url && !reportHasExpired(r) ? (
          <button
            onClick={() => handleDownload(r)}
            disabled={downloadingId !== null}
            data-testid={"report-download-" + r.id}
            aria-label={ar ? "تنزيل " + (r.file_name ?? "التقرير") : "Download " + (r.file_name ?? "report")}
            className="inline-flex items-center gap-1 rounded-lg border border-elite-blue-500/25 bg-elite-blue-600/10 px-2 py-1 text-xs font-medium text-elite-blue-600 transition-colors hover:bg-elite-blue-600/20 disabled:opacity-50"
          >
            {downloadingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {ar ? "تنزيل" : "Download"}
          </button>
        ) : reportHasExpired(r) ? (
          <span className="text-xs text-muted-foreground">{ar ? "انتهت الصلاحية" : "Expired"}</span>
        ) : r.status === "failed" ? (
          <span className="text-xs text-red-500">{ar ? "فشل" : "Failed"}</span>
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
              disabled={isGenerating}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
            >
              {/* "custom" is not offered until it is implemented. */}
              {REPORT_TYPES.filter((rt) => rt !== "custom").map((rt) => (
                <option key={rt} value={rt}>{reportNames[rt]}</option>
              ))}
            </select>
            <select
              aria-label={ar ? "شهر التقرير" : "Report month"}
              value={month}
              disabled={isGenerating}
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
              disabled={isGenerating}
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
              <span role={feedback.type === "err" ? "alert" : "status"} className={`text-xs font-medium ${feedback.type === "ok" ? "text-emerald-600" : "text-red-500"}`}>
                {FEEDBACK[feedback.code][ar ? "ar" : "en"]}
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
