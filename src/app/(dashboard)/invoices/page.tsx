"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslation } from "@/hooks/use-translation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { FileText, Clock, CheckCircle2, AlertTriangle, ReceiptText, ArrowUpRight } from "lucide-react"
import { InvoicesManager } from "./components/invoices-manager"
import { ScrollReveal } from "@/components/ui/scroll-reveal"
import { listPlatformPayments, type PlatformPaymentListRow as PaymentRow } from "@/lib/platforms-module/payment-queries"

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  pending: { ar: "معلقة", en: "Pending", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/20" },
  partial: { ar: "جزئية", en: "Partial", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/20" },
  paid: { ar: "مدفوعة", en: "Paid", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/20" },
  overdue: { ar: "متأخرة", en: "Overdue", className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/20" },
  disputed: { ar: "نزاع", en: "Disputed", className: "bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-500/20" },
}

const MONTH_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

function fmtMoney(n: number): string { return n.toFixed(2) + " SAR" }
function fmtDate(date: string | null, locale: string): string {
  if (!date) return "—"
  const value = new Date(date)
  return Number.isFinite(value.getTime())
    ? value.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB", { timeZone: "UTC" })
    : "—"
}

function PlatformPaymentsTab() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const [result, setResult] = useState<{ data: PaymentRow[]; isLoading: boolean; error: string | null }>({ data: [], isLoading: true, error: null })
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const { data, isLoading, error } = result

  useEffect(() => {
    let active = true
    void listPlatformPayments().then(response => {
      if (!active) return
      setResult(response.success
        ? { data: response.rows, isLoading: false, error: null }
        : { data: [], isLoading: false, error: response.error })
    }).catch(() => {
      if (active) setResult({ data: [], isLoading: false, error: "Could not load platform payments. Try again." })
    })
    return () => { active = false }
  }, [revision])

  const needle = search.trim().toLocaleLowerCase()
  const filtered = needle
    ? data.filter(r => [r.platform?.name_ar, r.platform?.name_en, r.platform?.code, r.payment_ref,
      String(r.period_year), MONTH_AR[r.period_month - 1], MONTH_EN[r.period_month - 1],
    ].some(value => value?.toLocaleLowerCase().includes(needle)))
    : data
  const totalPages = Math.max(1, Math.ceil(filtered.length / 50))
  const currentPage = Math.min(page, totalPages)
  const visibleRows = filtered.slice((currentPage - 1) * 50, currentPage * 50)
  const platformName = (row: PaymentRow) => (locale === "ar"
    ? [row.platform?.name_ar, row.platform?.name_en, row.platform?.code]
    : [row.platform?.name_en, row.platform?.name_ar, row.platform?.code]
  ).find(value => value?.trim()) ?? (locale === "ar" ? "سجل المنصة" : "Platform record")

  const totalOutstanding = data.reduce((sum, row) => sum + row.outstanding_amount, 0)

  const kpiCards: KpiCardData[] = [
    { label: locale === "ar" ? "مدفوعات المنصات" : "Platform payments", value: data.length, icon: FileText, color: "#1E5A99" },
    { label: t.common.pending, value: data.filter(r => r.payment_status === "pending").length, icon: Clock, color: "#F59E0B" },
    { label: locale === "ar" ? "مدفوعة" : "Paid", value: data.filter(r => r.payment_status === "paid").length, icon: CheckCircle2, color: "#10B981" },
    { label: locale === "ar" ? "المستحق (ر.س)" : "Outstanding (SAR)", value: totalOutstanding.toFixed(2), icon: AlertTriangle, color: "#EF4444" },
  ]

  const columns: TableColumn<PaymentRow>[] = [
    {
      key: "period", header: "Period",
      render: (r) => <span className="tabular-nums text-sm">{(locale === "ar" ? MONTH_AR : MONTH_EN)[(r.period_month ?? 1) - 1]} {r.period_year}</span>,
    },
    { key: "platform", header: t.nav.platforms, render: (r) => <Link href={`/platforms/${r.platform_id}`} className="font-medium underline underline-offset-4">{platformName(r)}</Link> },
    { key: "expected_amount", header: "Expected", render: (r) => <span dir="ltr" className="tabular-nums">{fmtMoney(r.expected_amount)}</span> },
    { key: "received_amount", header: "Received", render: (r) => <span dir="ltr" className="tabular-nums text-emerald-700 dark:text-emerald-400">{fmtMoney(r.received_amount)}</span> },
    { key: "outstanding_amount", header: "Outstanding", render: (r) => <span dir="ltr" className={`tabular-nums ${r.outstanding_amount > 0 ? "text-red-700 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>{fmtMoney(r.outstanding_amount)}</span> },
    {
      key: "payment_status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.payment_status] ?? STATUS_META.pending
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{locale === "ar" ? s.ar : s.en}</span>
      },
    },
    { key: "payment_date", header: "Paid On", render: (r) => <span className="text-xs">{fmtDate(r.payment_date, locale)}</span> },
  ]

  return (
    <EnterpriseModulePage
      headingLevel="h2"
      title={locale === "ar" ? "مدفوعات المنصات" : "Platform payments"}
      subtitle={locale === "ar" ? "تسوية مدفوعات المنصات" : "Platform payment reconciliation"}
      primaryCtaLabel={locale === "ar" ? "إدارة مدفوعات المنصات" : "Manage platform payments"}
      primaryCtaIcon={ArrowUpRight}
      onPrimaryCta={() => router.push("/platforms")}
      kpiCards={!isLoading && !error ? kpiCards : undefined}
      searchPlaceholder={locale === "ar" ? "ابحث بالمنصة أو المرجع أو الفترة" : "Search platform, reference or period"}
      searchValue={search}
      onSearchChange={value => { setSearch(value); setPage(1) }}
      columns={columns}
      data={visibleRows}
      isLoading={isLoading}
      loadError={error ? locale === "ar"
        ? error === "Too many attempts. Wait before retrying." ? "محاولات كثيرة. انتظر قبل المحاولة مجددًا." : "تعذر تحميل مدفوعات المنصات. حاول مجددًا."
        : error : undefined}
      retryLabel={locale === "ar" ? "إعادة المحاولة" : "Try again"}
      onRetry={() => { setResult({ data: [], isLoading: true, error: null }); setRevision(value => value + 1) }}
      pagination={!isLoading && !error ? { totalRecords: filtered.length, currentPage, totalPages, onPageChange: setPage } : undefined}
      emptyStateMessage={t.common.noData}
    />
  )
}

export default function InvoicesPage() {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const [tab, setTab] = useState("invoices")

  return (
    <div className="px-4 lg:px-6 py-4 space-y-6 page-enter">
      <ScrollReveal disabled direction="fade" duration={400}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {ar ? "الفواتير" : "Invoices"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ar
              ? "محرك الفواتير: مسودة ← صادرة ← معتمدة، مع الإشعارات الدائنة والمدينة وتسوية مدفوعات المنصات"
              : "Manage customer and supplier invoices and reconcile platform payments."}
          </p>
        </div>
      </ScrollReveal>

      <ScrollReveal disabled direction="up" delay={60} duration={400}>
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
      </ScrollReveal>
    </div>
  )
}
