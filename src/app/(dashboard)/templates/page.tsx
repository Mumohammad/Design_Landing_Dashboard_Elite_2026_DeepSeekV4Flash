"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { FileText, Car, Package, Briefcase, Printer, Loader2 } from "lucide-react"
import { generateDocumentAction } from "@/lib/templates/generator"

interface TemplateRow {
  id: string
  code: string
  name_ar: string
  name_en: string | null
  category: string
  description: string | null
  is_active: boolean
}

const CATEGORY_META: Record<string, { ar: string; className: string; icon: typeof Car }> = {
  vehicle: { ar: "مركبة", className: "bg-blue-500/15 text-blue-600 border-blue-500/20", icon: Car },
  gear: { ar: "معدات", className: "bg-amber-500/15 text-amber-600 border-amber-500/20", icon: Package },
  hr: { ar: "موارد بشرية", className: "bg-purple-500/15 text-purple-600 border-purple-500/20", icon: Briefcase },
  operations: { ar: "عمليات", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20", icon: FileText },
}

export default function TemplatesPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<TemplateRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("document_templates")
        .select("id,code,name_ar,name_en,category,description,is_active")
        .is("deleted_at", null)
        .order("category", { ascending: true })
        .order("code", { ascending: true })
      if (error) { console.error(error); setData([]) }
      else { setData(result as TemplateRow[] ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  async function handleGenerate(row: TemplateRow) {
    setGeneratingId(row.id)
    setFeedback(null)
    const res = await generateDocumentAction(row.id)
    setGeneratingId(null)
    if (res.success && res.html) {
      const win = window.open("", "_blank")
      if (win) {
        win.document.write(res.html)
        win.document.close()
        setTimeout(() => win.print(), 300)
      }
      setFeedback({ type: "ok", text: `تم إنشاء ${res.docNumber}` })
    } else {
      setFeedback({ type: "err", text: res.error ?? "Error" })
    }
  }

  const filtered = search
    ? data.filter(r => r.name_ar?.includes(search) || r.code?.toLowerCase().includes(search.toLowerCase()))
    : data

  const kpiCards: KpiCardData[] = [
    { label: t.nav.templates, value: data.length, icon: FileText, color: "#1E5A99" },
    { label: "Vehicle", value: data.filter(r => r.category === "vehicle").length, icon: Car, color: "#0EA5E9" },
    { label: "HR", value: data.filter(r => r.category === "hr").length, icon: Briefcase, color: "#8B5CF6" },
    { label: "Operations", value: data.filter(r => r.category === "operations").length, icon: Package, color: "#10B981" },
  ]

  const columns: TableColumn<TemplateRow>[] = [
    { key: "code", header: "Code", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.code}</span> },
    { key: "name_ar", header: t.common.status, render: (r) => <span className="font-medium">{r.name_ar}</span> },
    {
      key: "category", header: "Category",
      render: (r) => {
        const m = CATEGORY_META[r.category] ?? CATEGORY_META.operations
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>{m.ar}</span>
      },
    },
    { key: "description", header: "Description", render: (r) => <span className="text-muted-foreground text-xs line-clamp-1">{r.description ?? "—"}</span> },
    {
      key: "is_active", header: t.common.status,
      render: (r) => r.is_active
        ? <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">{t.common.active}</span>
        : <span className="inline-flex items-center rounded-full border border-gray-500/20 bg-gray-500/15 px-2 py-0.5 text-xs font-medium text-gray-600">{t.common.inactive}</span>,
    },
    {
      key: "generate", header: t.common.status === "الحالة" ? "إنشاء" : "Generate",
      render: (r) => (
        <button
          onClick={() => handleGenerate(r)}
          disabled={generatingId === r.id || !r.is_active}
          className="inline-flex items-center gap-1 rounded-lg border border-elite-blue-500/25 bg-elite-blue-600/10 px-2 py-1 text-xs font-medium text-elite-blue-600 transition-colors hover:bg-elite-blue-600/20 disabled:opacity-50"
        >
          {generatingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3" />}
          {t.common.status === "الحالة" ? "توليد" : "Generate"}
        </button>
      ),
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.templates}
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
      {feedback && (
        <p className={`mt-3 text-xs font-medium ${feedback.type === "ok" ? "text-emerald-600" : "text-red-500"}`}>
          {feedback.text}
        </p>
      )}
    </div>
  )
}
