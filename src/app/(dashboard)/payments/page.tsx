"use client"

import { LocalizedText } from "@/components/localized-text"
import { useState } from "react"
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
import { useAccountingPage } from "@/hooks/use-accounting-page"
import { readAccountingPage } from "@/lib/accounting/paged-reads"
import { formatVatMoney } from "@/lib/accounting/vat-position"
import { toast } from "@/lib/toast"

// ── Types ────────────────────────────────────────────────────────────────────

type PaymentStatus = "pending" | "allocated" | "partially_allocated" | "void"
type PaymentMethod = "cash" | "transfer" | "cheque" | "wps" | "card"

interface PaymentRow {
  id: string
  payment_ref: string | null
  direction: "in" | "out"
  payment_date: string
  amount: string
  method: PaymentMethod
  status: PaymentStatus
  reference: string | null
  customers: { name_ar: string; name_en: string | null } | null
  suppliers: { name_ar: string; name_en: string | null } | null
}

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

function fmtMoney(n: string | null | undefined): string { return formatVatMoney(n ?? "0") }

export default function PaymentsPage() {
  const { t, locale } = useTranslation()
  const isAr = locale === "ar"

  const ledger = useAccountingPage<PaymentRow>("payments")
  const { rows: data, loading: isLoading, error: loadError, search, setSearch, reload: load } = ledger
  const [isExporting, setIsExporting] = useState(false)
  const summary = ledger.summary

  // ── CSV export (RFC-4180 + UTF-8 BOM per repo convention) ──────────────
  const exportCsv = async () => {
    setIsExporting(true)
    try {
      const exported = await readAccountingPage<PaymentRow>(createClient(), "payments", { search, exporting: true })
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
        exported.rows.map((r) => [
          r.payment_ref ?? r.id.slice(0, 8),
          r.direction === "in" ? "receipt (in)" : "payment (out)",
          r.payment_date,
          r.amount,
          METHOD_META[r.method]?.en ?? r.method,
          STATUS_META[r.status]?.en ?? r.status,
          (() => { const party = r.customers ?? r.suppliers; return (isAr ? (party?.name_ar ?? party?.name_en) : (party?.name_en ?? party?.name_ar)) ?? "" })(),
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
    } catch {
      toast.error(isAr ? "تعذر تصدير جميع المدفوعات. أعد المحاولة." : "Could not export all payments. Retry.")
    } finally {
      setIsExporting(false)
    }
  }

  const kpiCards: KpiCardData[] = [
    { label: isAr ? "عدد المدفوعات" : "Payments", value: summary?.payment_count ?? "—", icon: Wallet, color: "#1E5A99" },
    { label: isAr ? "تحصيلات (داخل)" : "Receipts In (SAR)", value: summary ? fmtMoney(summary.inflow) : "—", icon: ArrowDownLeft, color: "#10B981" },
    { label: isAr ? "مدفوعات (خارج)" : "Payments Out (SAR)", value: summary ? fmtMoney(summary.outflow) : "—", icon: ArrowUpRight, color: "#EF4444" },
    { label: isAr ? "غير مسند" : "Unallocated (SAR)", value: summary ? fmtMoney(summary.unallocated) : "—", icon: Ban, color: "#F59E0B" },
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
          {fmtMoney(r.amount)} <span className="text-xs text-muted-foreground"><LocalizedText text="SAR" /></span>
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
        const party = r.customers ?? r.suppliers
        const name = isAr ? (party?.name_ar ?? party?.name_en) : (party?.name_en ?? party?.name_ar)
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
        data={data}
        pagination={ledger.pagination}
        loadError={loadError ? (isAr ? "تعذر تحميل المدفوعات." : "Could not load payments.") : undefined}
        onRetry={load}
        retryLabel={t.common.retry}
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
              onClick={load}
              disabled={isLoading}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/20 px-3 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/30 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t.common.retry}
            </button>
            <button
              onClick={() => void exportCsv()}
              disabled={isExporting || ledger.count === 0 || isLoading}
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
