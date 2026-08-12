"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Wallet, Clock, DollarSign, CheckCircle2 } from "lucide-react"

interface ExpenseRow {
  id: string
  expense_code: string | null
  expense_type: string
  amount: number
  currency: string
  expense_date: string
  description: string | null
  is_approved: boolean
  vendor: string | null
  driver: { full_name_ar: string; driver_code: string } | null
}

const TYPE_META: Record<string, { ar: string; en: string; className: string }> = {
  fuel: { ar: "وقود", en: "Fuel", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  advance: { ar: "سلفة", en: "Advance", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  operational: { ar: "تشغيلي", en: "Operational", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  platform_commission: { ar: "عمولة", en: "Commission", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  maintenance: { ar: "صيانة", en: "Maintenance", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  other: { ar: "أخرى", en: "Other", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

function fmtDate(date: string): string {
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

export default function ExpensesPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<ExpenseRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("expenses")
        .select("id,expense_code,expense_type,amount,currency,expense_date,description,is_approved,vendor,driver:drivers(full_name_ar,driver_code)")
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .limit(100)
      if (error) { console.error(error); setData([]) }
      else { setData((result as unknown as ExpenseRow[]) ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.expense_code?.includes(search) || r.driver?.full_name_ar?.includes(search) || r.vendor?.includes(search))
    : data

  const totalAmount = data.reduce((s, r) => s + (r.amount ?? 0), 0)
  const approvedAmount = data.filter(r => r.is_approved).reduce((s, r) => s + (r.amount ?? 0), 0)

  const kpiCards: KpiCardData[] = [
    { label: t.nav.expenses, value: data.length, icon: Wallet, color: "#1E5A99" },
    { label: t.common.pending, value: data.filter(r => !r.is_approved).length, icon: Clock, color: "#F59E0B" },
    { label: "Total (SAR)", value: totalAmount.toFixed(0), icon: DollarSign, color: "#EF4444" },
    { label: t.common.approved, value: approvedAmount.toFixed(0), icon: CheckCircle2, color: "#10B981" },
  ]

  const columns: TableColumn<ExpenseRow>[] = [
    { key: "expense_code", header: "Code", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.expense_code ?? "—"}</span> },
    {
      key: "expense_type", header: t.common.status,
      render: (r) => {
        const m = TYPE_META[r.expense_type] ?? TYPE_META.other
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>{m.ar}</span>
      },
    },
    { key: "amount", header: "Amount", render: (r) => <span dir="ltr" className="tabular-nums font-medium">{r.amount?.toFixed(2) ?? "0.00"} SAR</span> },
    { key: "expense_date", header: "Date", render: (r) => <span dir="ltr">{fmtDate(r.expense_date)}</span> },
    { key: "driver", header: t.nav.drivers, render: (r) => <span>{r.driver?.full_name_ar ?? "—"}</span> },
    { key: "vendor", header: "Vendor", render: (r) => <span className="text-muted-foreground">{r.vendor ?? "—"}</span> },
    {
      key: "is_approved", header: t.common.status,
      render: (r) => r.is_approved
        ? <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">{t.common.approved}</span>
        : <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">{t.common.pending}</span>,
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.expenses}
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
