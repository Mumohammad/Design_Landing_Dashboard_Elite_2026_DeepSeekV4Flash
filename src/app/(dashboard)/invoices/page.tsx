"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { FileText, Clock, CheckCircle2, AlertTriangle, ReceiptText } from "lucide-react"
import { InvoicesManager } from "./components/invoices-manager"

interface PaymentRow {
  id: string
  period_year: number
  period_month: number
  expected_amount: number
  received_amount: number
  outstanding_amount: number
  payment_status: string
  payment_date: string | null
  payment_ref: string | null
  platform: { name_ar: string; code: string } | null
}

const STATUS_META: Record<string, { ar: string; className: string }> = {
  pending: { ar: "معلقة", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  partial: { ar: "جزئية", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  paid: { ar: "مدفوعة", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  overdue: { ar: "متأخرة", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  disputed: { ar: "نزاع", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
}

const MONTH_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]

function fmtMoney(n: number): string { return n.toFixed(2) + " SAR" }
function fmtDate(date: string | null): string { if (!date) return "—"; try { return new Date(date).toLocaleDateString("en-GB") } catch { return date } }

function PlatformPaymentsTab() {
  const { t } = useTranslation()
  const [data, setData] = useState<PaymentRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("platform_payments")
        .select(`
          id,period_year,period_month,expected_amount,received_amount,outstanding_amount,
          payment_status,payment_date,payment_ref,
          platform:delivery_platforms(name_ar,code)
        `)
        .is("deleted_at", null)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .limit(100)
      if (error) { console.error(error); setData([]) }
      else { setData((result as unknown as PaymentRow[]) ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.platform?.name_ar?.includes(search) || r.platform?.code?.includes(search) || r.payment_ref?.includes(search))
    : data

  const totalOutstanding = data.reduce((s, r) => s + (r.outstanding_amount ?? 0), 0)

  const kpiCards: KpiCardData[] = [
    { label: t.nav.invoices, value: data.length, icon: FileText, color: "#1E5A99" },
    { label: t.common.pending, value: data.filter(r => r.payment_status === "pending").length, icon: Clock, color: "#F59E0B" },
    { label: t.common.approved, value: data.filter(r => r.payment_status === "paid").length, icon: CheckCircle2, color: "#10B981" },
    { label: "Outstanding (SAR)", value: totalOutstanding.toFixed(0), icon: AlertTriangle, color: "#EF4444" },
  ]

  const columns: TableColumn<PaymentRow>[] = [
    {
      key: "period", header: "Period",
      render: (r) => <span dir="ltr" className="tabular-nums text-sm">{MONTH_AR[(r.period_month ?? 1) - 1]} {r.period_year}</span>,
    },
    { key: "platform", header: t.nav.platforms, render: (r) => <span className="font-medium">{r.platform?.name_ar ?? "—"}</span> },
    { key: "expected_amount", header: "Expected", render: (r) => <span dir="ltr" className="tabular-nums">{fmtMoney(r.expected_amount)}</span> },
    { key: "received_amount", header: "Received", render: (r) => <span dir="ltr" className="tabular-nums text-emerald-600">{fmtMoney(r.received_amount)}</span> },
    { key: "outstanding_amount", header: "Outstanding", render: (r) => <span dir="ltr" className={`tabular-nums ${r.outstanding_amount > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>{fmtMoney(r.outstanding_amount)}</span> },
    {
      key: "payment_status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.payment_status] ?? STATUS_META.pending
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.ar}</span>
      },
    },
    { key: "payment_date", header: "Paid On", render: (r) => <span dir="ltr" className="text-xs">{fmtDate(r.payment_date)}</span> },
  ]

  return (
    <EnterpriseModulePage
      title={t.nav.invoices}
      subtitle="تسوية مدفوعات المنصات / Platform payment reconciliation"
      kpiCards={kpiCards}
      searchPlaceholder={t.common.searchPlaceholder}
      searchValue={search}
      onSearchChange={setSearch}
      columns={columns}
      data={filtered}
      isLoading={isLoading}
      emptyStateMessage={t.common.noData}
    />
  )
}

export default function InvoicesPage() {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const [tab, setTab] = useState("invoices")

  return (
    <div className="px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {ar ? "الفواتير" : "Invoices"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ar
            ? "محرك الفواتير: مسودة ← صادرة ← معتمدة، مع الإشعارات الدائنة والمدينة وتسوية مدفوعات المنصات"
            : "Invoice engine: draft → issued → finalized, credit/debit notes, and platform payment reconciliation"}
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="invoices" className="gap-2">
            <ReceiptText className="h-4 w-4" />
            {ar ? "الفواتير" : "Invoices"}
          </TabsTrigger>
          <TabsTrigger value="platforms" className="gap-2">
            <FileText className="h-4 w-4" />
            {ar ? "تسوية المنصات" : "Platform payments"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4">
          <InvoicesManager />
        </TabsContent>

        <TabsContent value="platforms" className="mt-4">
          <PlatformPaymentsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
