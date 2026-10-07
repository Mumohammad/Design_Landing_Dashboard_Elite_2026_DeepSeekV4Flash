"use client"

// /reports — Reports hub (Prompt O Part 5). Three surfaces over the existing
// schema (migrations 024/025/028/059 — no changes):
//   * Reports tab  — report_generation_log history; the generate form rides
//     generateReportAction (permission + rate limit + zod + audit) and the
//     collectors read LIVE tables only (no zero-filled months).
//   * Templates tab — document_templates catalog (21 seeded) with the
//     template-driven generateDocumentAction (QR verify URL) as its consumer.
//   * Documents tab — generated_documents with print/archive transitions and
//     the public verify link.
// Downloads are time-boxed signed URLs against the `generated-reports` bucket.

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { archiveDocument, generateReportAction, markDocumentPrinted } from "@/lib/reports/actions"
import { REPORT_CATALOG, canArchiveDoc, canPrintDoc, formatBytes, isReportExpired, type CatalogReportType } from "@/lib/reports/module-utils"
import { generateDocumentAction } from "@/lib/templates/generator"
import { Archive, BarChart3, CheckCircle2, Clock, Download, FilePlus2, FileCheck2, Loader2, Printer, XCircle } from "lucide-react"

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

interface TemplateRow {
  id: string
  code: string
  name_ar: string
  name_en: string | null
  category: string
  description: string | null
  template_fields: unknown
}

interface DocRow {
  id: string
  doc_number: string
  status: string
  generated_at: string
  printed_at: string | null
  verify_url: string | null
  template: { name_ar: string | null; name_en: string | null } | null
}

interface DriverOption {
  id: string
  full_name_ar: string | null
  driver_code: string | null
}

interface VehicleOption {
  id: string
  vehicle_code: string | null
  plate_number: string | null
}

const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const TYPE_LABEL_KEY: Record<CatalogReportType, keyof ReturnType<typeof useTranslation>["t"]["reportsModule"]> = {
  driver_performance: "typeDriverPerformance",
  payroll_summary: "typePayrollSummary",
  fleet_cost: "typeFleetCost",
  revenue: "typeRevenue",
  violations_report: "typeViolationsReport",
  attendance_summary: "typeAttendanceSummary",
  executive_dashboard: "typeExecutiveDashboard",
  hs_reconciliation: "typeHsReconciliation",
}

export default function ReportsPage() {
  const { t } = useTranslation()
  const rm = t.reportsModule
  const isAr = t.common.status === "الحالة"

  const [log, setLog] = useState<ReportRow[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [docs, setDocs] = useState<DocRow[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState("reports")
  const [search, setSearch] = useState("")

  const [reportType, setReportType] = useState<CatalogReportType>("payroll_summary")
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // Template → document dialog (session-keyed).
  const [docTemplate, setDocTemplate] = useState<TemplateRow | null>(null)
  const [docDriverId, setDocDriverId] = useState("")
  const [docVehicleId, setDocVehicleId] = useState("")
  const [docBusy, setDocBusy] = useState(false)

  const needsPeriod = useMemo(
    () => REPORT_CATALOG.find((e) => e.type === reportType)?.requiresPeriod ?? false,
    [reportType]
  )

  // Never sets state synchronously: every setState sits behind an await, so
  // the effect body only starts the async job (setState-in-effect rule). The
  // initial spinner is the useState(true) default.
  const loadData = useCallback(async () => {
    const supabase = createClient()
    const [logRes, tplRes, docRes, drvRes, vehRes] = await Promise.all([
      supabase
        .from("report_generation_log")
        .select("id,report_type,output_format,status,file_name,file_url,file_size_bytes,expires_at,created_at,error_message")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("document_templates")
        .select("id,code,name_ar,name_en,category,description,template_fields")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("category", { ascending: true })
        .order("code", { ascending: true })
        .limit(200),
      supabase
        .from("generated_documents")
        .select("id,doc_number,status,generated_at,printed_at,verify_url,template:document_templates(name_ar,name_en)")
        .is("deleted_at", null)
        .order("generated_at", { ascending: false })
        .limit(100),
      supabase
        .from("drivers")
        .select("id,full_name_ar,driver_code")
        .in("status", ["active", "on_leave"])
        .is("deleted_at", null)
        .order("full_name_ar", { ascending: true })
        .limit(500),
      supabase
        .from("vehicles")
        .select("id,vehicle_code,plate_number")
        .is("deleted_at", null)
        .order("vehicle_code", { ascending: true })
        .limit(300),
    ])
    setLog((logRes.data as ReportRow[]) ?? [])
    setTemplates((tplRes.data as TemplateRow[]) ?? [])
    setDocs((docRes.data as unknown as DocRow[]) ?? [])
    setDrivers((drvRes.data as DriverOption[]) ?? [])
    setVehicles((vehRes.data as VehicleOption[]) ?? [])
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void (async () => {
      await Promise.resolve()
      await loadData()
    })()
  }, [loadData])

  function refreshAll() {
    void loadData()
  }

  async function handleGenerate() {
    setIsGenerating(true)
    const res = await generateReportAction(reportType, { year, month })
    setIsGenerating(false)
    if (res.success) {
      toast.success(rm.generateSuccess)
      refreshAll()
    } else {
      toast.error(res.error ?? "Error")
    }
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
      toast.error(e instanceof Error ? e.message : "Download failed")
    }
    setDownloadingId(null)
  }

  async function handleGenerateDocument() {
    if (!docTemplate) return
    setDocBusy(true)
    const res = await generateDocumentAction(
      docTemplate.id,
      docDriverId || undefined,
      docVehicleId || undefined
    )
    setDocBusy(false)
    if (res.success && res.html) {
      // Print-ready HTML from the action — open it in a new window.
      const w = window.open("", "_blank")
      if (w) {
        w.document.write(res.html)
        w.document.close()
      }
      toast.success(`${rm.docStatusGenerated}: ${res.docNumber ?? ""}`)
      setDocTemplate(null)
      refreshAll()
    } else {
      toast.error(res.error ?? "Error")
    }
  }

  async function handlePrintDoc(row: DocRow) {
    const res = await markDocumentPrinted({ id: row.id })
    if (res.success) {
      toast.success(rm.docStatusPrinted)
      refreshAll()
    } else toast.error(res.error ?? "Error")
  }

  async function handleArchiveDoc(row: DocRow) {
    const res = await archiveDocument({ id: row.id })
    if (res.success) {
      toast.success(rm.docStatusArchived)
      refreshAll()
    } else toast.error(res.error ?? "Error")
  }

  const filteredLog = useMemo(
    () =>
      search
        ? log.filter(
            (r) =>
              r.report_type?.includes(search.toLowerCase()) ||
              r.file_name?.toLowerCase().includes(search.toLowerCase())
          )
        : log,
    [log, search]
  )

  const now = useMemo(() => new Date(), [])

  const kpiCards: KpiCardData[] = [
    { label: rm.kpiTotalReports, value: log.length, icon: BarChart3, color: "#1E5A99" },
    { label: rm.kpiCompleted, value: log.filter((r) => r.status === "completed" && !isReportExpired(r.expires_at, now)).length, icon: CheckCircle2, color: "#10B981" },
    { label: rm.kpiGenerating, value: log.filter((r) => r.status === "generating").length, icon: Clock, color: "#F59E0B" },
    { label: rm.kpiFailed, value: log.filter((r) => r.status === "failed").length, icon: XCircle, color: "#EF4444" },
  ]

  const reportStatusLabel = (s: string) =>
    s === "completed" ? rm.statusCompleted
    : s === "generating" ? rm.statusGenerating
    : s === "failed" ? rm.statusFailed
    : s === "expired" ? rm.statusExpired
    : s

  const logColumns: TableColumn<ReportRow>[] = [
    {
      key: "report_type",
      header: rm.colType,
      render: (r) => {
        const cat = REPORT_CATALOG.find((e) => e.type === r.report_type)
        const label = cat ? (rm[TYPE_LABEL_KEY[cat.type]] as string) : r.report_type
        return <span className="font-medium">{label}</span>
      },
    },
    { key: "output_format", header: rm.colFormat, render: (r) => <span dir="ltr" className="text-xs uppercase font-mono">{r.output_format}</span> },
    {
      key: "status",
      header: rm.colStatus,
      render: (r) => {
        const expired = r.status === "completed" && isReportExpired(r.expires_at, now)
        const cls =
          r.status === "failed" ? "bg-red-500/15 text-red-600 border-red-500/20"
          : r.status === "completed" && !expired ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20"
          : expired ? "bg-gray-500/15 text-gray-600 border-gray-500/20"
          : "bg-blue-500/15 text-blue-600 border-blue-500/20"
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{expired ? rm.statusExpired : reportStatusLabel(r.status)}</span>
      },
    },
    { key: "file_name", header: rm.colFile, render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{r.file_name ?? "—"}</span> },
    { key: "file_size_bytes", header: rm.colSize, render: (r) => <span dir="ltr" className="tabular-nums text-xs">{formatBytes(r.file_size_bytes)}</span> },
    {
      key: "created_at",
      header: rm.colCreated,
      render: (r) => <span dir="ltr" className="text-xs">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}</span>,
    },
    {
      key: "download",
      header: rm.colDownload,
      render: (r) =>
        r.status === "completed" && r.file_url && !isReportExpired(r.expires_at, now) ? (
          <Button size="sm" variant="outline" disabled={downloadingId === r.id} onClick={() => void handleDownload(r)}>
            {downloadingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {rm.colDownload}
          </Button>
        ) : r.status === "failed" ? (
          <span className="text-xs text-red-500" title={r.error_message ?? ""}>{rm.statusFailed}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ]

  const templateFieldsCount = (f: unknown): number =>
    Array.isArray(f) ? f.length : f && typeof f === "object" ? Object.keys(f as object).length : 0

  const templateColumns: TableColumn<TemplateRow>[] = [
    { key: "code", header: rm.colTemplateCode, render: (r) => <span dir="ltr" className="font-mono text-xs">{r.code}</span> },
    {
      key: "name",
      header: rm.colTemplateName,
      render: (r) => <span className="font-medium">{r.name_ar}{r.name_en ? <span className="ms-1 text-xs text-muted-foreground">{r.name_en}</span> : null}</span>,
    },
    { key: "category", header: rm.colCategory, render: (r) => <span dir="ltr" className="inline-flex items-center rounded-full border border-border/50 bg-muted/20 px-2 py-0.5 text-xs">{r.category}</span> },
    { key: "fields", header: rm.colFields, render: (r) => <span dir="ltr" className="tabular-nums text-xs">{templateFieldsCount(r.template_fields)}</span> },
    { key: "description", header: rm.colDescription, render: (r) => <span className="text-xs text-muted-foreground">{r.description ?? "—"}</span> },
    {
      key: "actions",
      header: t.common.actions,
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => { setDocDriverId(""); setDocVehicleId(""); setDocTemplate(r) }}>
          <FilePlus2 className="h-3.5 w-3.5" />
          {rm.generateDoc}
        </Button>
      ),
    },
  ]

  const docStatusLabel = (s: string) =>
    s === "draft" ? rm.docStatusDraft
    : s === "generated" ? rm.docStatusGenerated
    : s === "printed" ? rm.docStatusPrinted
    : s === "archived" ? rm.docStatusArchived
    : s

  const docColumns: TableColumn<DocRow>[] = [
    { key: "doc_number", header: rm.colDocNumber, render: (r) => <span dir="ltr" className="font-mono text-xs">{r.doc_number}</span> },
    { key: "template", header: rm.colTemplate, render: (r) => r.template?.name_ar ?? "—" },
    {
      key: "status",
      header: rm.colStatus,
      render: (r) => {
        const cls =
          r.status === "archived" ? "bg-gray-500/15 text-gray-600 border-gray-500/20"
          : r.status === "printed" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20"
          : "bg-blue-500/15 text-blue-600 border-blue-500/20"
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{docStatusLabel(r.status)}</span>
      },
    },
    { key: "generated_at", header: rm.colGeneratedAt, render: (r) => <span dir="ltr" className="text-xs">{r.generated_at.slice(0, 10)}</span> },
    { key: "printed_at", header: rm.colPrintedAt, render: (r) => <span dir="ltr" className="text-xs">{r.printed_at?.slice(0, 10) ?? "—"}</span> },
    {
      key: "verify",
      header: rm.colVerify,
      render: (r) =>
        r.verify_url ? (
          <a href={r.verify_url} target="_blank" rel="noreferrer" className="text-xs text-elite-blue-600 hover:underline" dir="ltr">
            {rm.verifyLink}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "actions",
      header: t.common.actions,
      render: (r) => (
        <div className="flex items-center gap-1">
          {canPrintDoc(r.status) && (
            <Button size="sm" variant="ghost" title={rm.printDoc} onClick={() => void handlePrintDoc(r)}>
              <Printer className="h-3.5 w-3.5" />
            </Button>
          )}
          {canArchiveDoc(r.status) && (
            <Button size="sm" variant="ghost" title={rm.archiveDoc} onClick={() => void handleArchiveDoc(r)}>
              <Archive className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="reports">{rm.tabReports}</TabsTrigger>
          <TabsTrigger value="templates">{rm.tabTemplates}</TabsTrigger>
          <TabsTrigger value="documents">{rm.tabDocuments}</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="mt-0">
          <EnterpriseModulePage
            title={t.nav.reports}
            subtitle={rm.subtitle}
            kpiCards={kpiCards}
            primaryCtaIcon={FileCheck2}
            searchPlaceholder={t.common.searchPlaceholder}
            searchValue={search}
            onSearchChange={setSearch}
            toolbarActions={
              <div className="flex flex-wrap items-center gap-2">
                <Select value={reportType} onValueChange={(v) => setReportType(v as CatalogReportType)}>
                  <SelectTrigger className="h-9 w-52"><SelectValue placeholder={rm.selectType} /></SelectTrigger>
                  <SelectContent>
                    {REPORT_CATALOG.map((e) => (
                      <SelectItem key={e.type} value={e.type}>{rm[TYPE_LABEL_KEY[e.type]] as string}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsPeriod && (
                  <>
                    <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                      <SelectTrigger className="h-9 w-28"><SelectValue placeholder={rm.selectMonth} /></SelectTrigger>
                      <SelectContent>
                        {(isAr ? MONTH_NAMES_AR : MONTH_NAMES_EN).map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                      <SelectTrigger className="h-9 w-24"><SelectValue placeholder={rm.selectYear} /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                          <SelectItem key={y} value={String(y)}>{String(y)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
                <Button onClick={() => void handleGenerate()} disabled={isGenerating}>
                  {isGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-1 h-4 w-4" />}
                  {rm.generateReport}
                </Button>
              </div>
            }
            columns={logColumns}
            data={filteredLog}
            isLoading={isLoading}
            emptyStateMessage={rm.noReports}
          />
        </TabsContent>

        <TabsContent value="templates" className="mt-0">
          <EnterpriseModulePage
            title={rm.templatesTitle}
            subtitle={rm.generateDocDesc}
            primaryCtaIcon={FilePlus2}
            columns={templateColumns}
            data={templates}
            isLoading={isLoading}
            emptyStateMessage={rm.noTemplates}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-0">
          <EnterpriseModulePage
            title={rm.docsTitle}
            primaryCtaIcon={FileCheck2}
            columns={docColumns}
            data={docs}
            isLoading={isLoading}
            emptyStateMessage={rm.noDocuments}
          />
        </TabsContent>
      </Tabs>

      {docTemplate && (
        <Dialog open onOpenChange={(o) => !o && setDocTemplate(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{rm.generateDoc} — {docTemplate.name_ar}</DialogTitle>
              <DialogDescription>{rm.generateDocDesc}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>{t.nav.drivers}</Label>
                <Select value={docDriverId || "auto"} onValueChange={(v) => setDocDriverId(v === "auto" ? "" : v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{isAr ? "أول سائق متاح" : "First available driver"}</SelectItem>
                    {drivers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.full_name_ar ?? "—"}{d.driver_code ? ` (${d.driver_code})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {docTemplate.category === "vehicle" && (
                <div className="grid gap-1.5">
                  <Label>{t.nav.vehicles}</Label>
                  <Select value={docVehicleId || "auto"} onValueChange={(v) => setDocVehicleId(v === "auto" ? "" : v)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{isAr ? "أول مركبة متاحة" : "First available vehicle"}</SelectItem>
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.vehicle_code ?? "—"} {v.plate_number ? `(${v.plate_number})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">{rm.colFields}: {templateFieldsCount(docTemplate.template_fields)}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDocTemplate(null)} disabled={docBusy}>{t.common.cancel}</Button>
              <Button onClick={() => void handleGenerateDocument()} disabled={docBusy}>
                {docBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {rm.generateDoc}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
