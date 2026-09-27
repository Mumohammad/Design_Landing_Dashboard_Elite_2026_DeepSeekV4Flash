"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Banknote,
  Download,
  Inbox,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { toCsv } from "@/lib/analytics/dashboard-utils"
import { formatDualDate } from "@/lib/formatting/hijri"

// ── Types ────────────────────────────────────────────────────────────────────

type PaymentStatus = "pending" | "allocated" | "partially_allocated" | "void"
type PaymentMethod = "cash" | "transfer" | "cheque" | "wps" | "card"

interface PaymentRow {
  id: string
  payment_ref: string | null
  direction: "in" | "out"
  payment_date: string
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  reference: string | null
  customer: { name_ar: string; name_en: string | null } | null
  supplier: { name_ar: string; name_en: string | null } | null
}

const PAYMENT_SELECT =
  "id,payment_ref,direction,payment_date,amount,method,status,reference," +
  "customer:customers(name_ar,name_en),supplier:suppliers(name_ar,name_en)"

const STATUS_META: Record<PaymentStatus, { ar: string; en: string; className: string }> = {
  pending: {
    ar: "معلّق",
    en: "Pending",
    className: "bg-amber-500/15 text-amber-600 border-amber-500/20",
  },
  partially_allocated: {
    ar: "مسند جزئياً",
    en: "Partially allocated",
    className: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  },
  allocated: {
    ar: "مسند بالكامل",
    en: "Allocated",
    className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  },
  void: {
    ar: "ملغى",
    en: "Void",
    className: "bg-gray-500/15 text-gray-600 border-gray-500/20",
  },
}

const METHOD_META: Record<PaymentMethod, { ar: string; en: string }> = {
  cash: { ar: "نقداً", en: "Cash" },
  transfer: { ar: "تحويل", en: "Transfer" },
  cheque: { ar: "شيك", en: "Cheque" },
  wps: { ar: "حماية الأجور", en: "WPS" },
  card: { ar: "بطاقة", en: "Card" },
}

function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function PaymentsPage() {
  const { t, locale } = useTranslation()
  const isAr = locale === "ar"

  const [data, setData] = useState<PaymentRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState("")
  const [isExporting, setIsExporting] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(false)
    const supabase = createClient()
    const { data: rows, error } = await supabase
      .from("finance_payments")
      .select(PAYMENT_SELECT)
      .is("deleted_at", null)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100)
    if (error) {
      console.error(error)
      setLoadError(true)
      setData([])
    } else {
      setData((rows as unknown as PaymentRow[]) ?? [])
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ── Derived ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return data
    const q = search.trim().toLowerCase()
    return data.filter(
      (r) =>
        r.payment_ref?.toLowerCase().includes(q) ||
        r.reference?.toLowerCase().includes(q) ||
        r.customer?.name_ar?.includes(search.trim()) ||
        r.customer?.name_en?.toLowerCase().includes(q) ||
        r.supplier?.name_ar?.includes(search.trim()) ||
        r.supplier?.name_en?.toLowerCase().includes(q),
    )
  }, [data, search])

  const active = useMemo(() => data.filter((r) => r.status !== "void"), [data])
  const inflow = useMemo(
    () => active.filter((r) => r.direction === "in").reduce((s, r) => s + (r.amount ?? 0), 0),
    [active],
  )
  const outflow = useMemo(
    () => active.filter((r) => r.direction === "out").reduce((s, r) => s + (r.amount ?? 0), 0),
    [active],
  )
  const unallocated = useMemo(
    () =>
      active
        .filter((r) => r.status === "pending" || r.status === "partially_allocated")
        .reduce((s, r) => s + (r.amount ?? 0), 0),
    [active],
  )

  // ── CSV export (RFC-4180 + UTF-8 BOM per repo convention) ──────────────
  const exportCsv = () => {
    if (filtered.length === 0) return
    setIsExporting(true)
    try {
      const csv = toCsv(
        [
          "Payment Ref",
          "Direction",
          "Date",
          "Amount (SAR)",
          "Method",
          "Status",
          "Customer/Supplier",
          "Reference",
        ],
        filtered.map((r) => [
          r.payment_ref ?? r.id.slice(0, 8),
          r.direction === "in" ? "receipt (in)" : "payment (out)",
          r.payment_date,
          r.amount,
          METHOD_META[r.method]?.en ?? r.method,
          STATUS_META[r.status]?.en ?? r.status,
          r.customer?.name_ar ?? r.supplier?.name_ar ?? "",
          r.reference ?? "",
        ]),
      )
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }

  const kpiCards: KpiCardData[] = [
    { label: isAr ? "عدد المدفوعات" : "Payments", value: data.length, icon: Wallet, color: "#1E5A99" },
    { label: isAr ? "تحصيلات (داخل)" : "Receipts In (SAR)", value: fmtMoney(inflow), icon: ArrowDownLeft, color: "#10B981" },
    { label: isAr ? "مدفوعات (خارج)" : "Payments Out (SAR)", value: fmtMoney(outflow), icon: ArrowUpRight, color: "#EF4444" },
    { label: isAr ? "غير مسند" : "Unallocated (SAR)", value: fmtMoney(unallocated), icon: Ban, color: "#F59E0B" },
  ]

  const columns: TableColumn<PaymentRow>[] = [
    {
      key: "payment_ref",
      header: isAr ? "المرجع" : "Ref",
      render: (r) => (
        <span dir="ltr" className="font-mono text-xs font-medium">
          {r.payment_ref ?? r.id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "direction",
      header: isAr ? "الاتجاه" : "Direction",
      render: (r) =>
        r.direction === "in" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">
            <ArrowDownLeft className="h-3 w-3" />
            {isAr ? "تحصيل" : "In"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-500">
            <ArrowUpRight className="h-3 w-3" />
            {isAr ? "سداد" : "Out"}
          </span>
        ),
    },
    {
      key: "payment_date",
      header: isAr ? "التاريخ" : "Date",
      render: (r) => (
        <span dir="ltr" className="tabular-nums text-xs">
          {formatDualDate(new Date(r.payment_date + "T00:00:00"), isAr)}
        </span>
      ),
    },
    {
      key: "amount",
      header: isAr ? "المبلغ" : "Amount",
      render: (r) => (
        <span dir="ltr" className="tabular-nums font-semibold">
          {fmtMoney(r.amount)} <span className="text-xs text-muted-foreground">SAR</span>
        </span>
      ),
    },
    {
      key: "method",
      header: isAr ? "الطريقة" : "Method",
      render: (r) => {
        const m = METHOD_META[r.method]
        return <span>{m ? (isAr ? m.ar : m.en) : r.method}</span>
      },
    },
    {
      key: "status",
      header: t.common.status,
      render: (r) => {
        const m = STATUS_META[r.status]
        return m ? (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>
            {isAr ? m.ar : m.en}
          </span>
        ) : (
          <span>{r.status}</span>
        )
      },
    },
    {
      key: "party",
      header: isAr ? "العميل / المورد" : "Customer / Supplier",
      render: (r) => {
        const name = r.customer?.name_ar ?? r.supplier?.name_ar ?? null
        return name ? (
          <span className="text-foreground/80">{name}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
    },
    {
      key: "reference",
      header: isAr ? "الإسناد" : "Allocation ref",
      render: (r) => {
        if (!r.reference) return <span className="text-muted-foreground">—</span>
        const target = r.direction === "in" ? "/invoices" : "/expenses"
        return (
          <Link
            href={target}
            onClick={(e) => e.stopPropagation()}
            dir="ltr"
            className="font-mono text-xs text-elite-blue-600 underline-offset-2 hover:underline dark:text-elite-blue-400"
          >
            {r.reference}
          </Link>
        )
      },
    },
  ]

  return (
    <div className="px-4 py-4 lg:px-6">
      <EnterpriseModulePage
        title={isAr ? "المدفوعات" : "Payments"}
        subtitle={
          isAr
            ? "سجل التحصيلات والمدفوعات وحالة إسنادها للفواتير والمصروفات"
            : "Receipts and payments ledger with allocation status against invoices and expenses"
        }
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyStateMessage={
          loadError
            ? isAr
              ? "تعذّر تحميل المدفوعات — أعد المحاولة"
              : "Failed to load payments — retry"
            : t.common.noData
        }
        toolbarActions={
          <>
            <button
              onClick={() => void load()}
              disabled={isLoading}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/30 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t.common.retry}
            </button>
            <button
              onClick={exportCsv}
              disabled={isExporting || filtered.length === 0 || isLoading}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/30 disabled:opacity-50"
            >
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isAr ? "تصدير CSV" : "Export CSV"}
            </button>
          </>
        }
      />

      {loadError && !isLoading && data.length === 0 && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          <Inbox className="h-4 w-4" />
          {isAr ? "تعذّر تحميل سجل المدفوعات" : "Could not load the payments ledger"}
        </div>
      )}

      {!isLoading && !loadError && data.length === 0 && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
          <Banknote className="h-4 w-4" />
          {isAr
            ? "لا توجد مدفوعات مسجّلة بعد — تُسجّل تلقائياً عند تحصيل الفواتير أو سداد المصروفات"
            : "No payments recorded yet — receipts are created when invoices are collected, payments when expenses are settled"}
        </div>
      )}
    </div>
  )
}
