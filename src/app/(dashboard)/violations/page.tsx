"use client"

import { LocalizedText } from "@/components/localized-text"
import { useCallback } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { violationsQuery, violationsSummary, type ViolationRow } from "@/lib/operations/overview-queries"
import { useTablePage } from "@/hooks/use-table-page"
import { useReadSummary } from "@/hooks/use-read-summary"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { ShieldAlert, AlertCircle, MessageSquareWarning, DollarSign } from "lucide-react"

const SEVERITY_META: Record<string, { ar: string; en: string; className: string }> = {
  minor: { ar: "بسيطة", en: "Minor", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  moderate: { ar: "متوسطة", en: "Moderate", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  major: { ar: "كبيرة", en: "Major", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  critical: { ar: "حرجة", en: "Critical", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  open: { ar: "مفتوحة", en: "Open", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  under_review: { ar: "مراجعة", en: "Review", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  disputed: { ar: "معترض", en: "Disputed", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  resolved: { ar: "محلولة", en: "Resolved", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  deduction_applied: { ar: "خصم مطبق", en: "Deducted", className: "bg-teal-500/15 text-teal-600 border-teal-500/20" },
  waived: { ar: "إعفاء", en: "Waived", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  closed: { ar: "مغلقة", en: "Closed", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  acknowledged: { ar: "معتمدة", en: "Acknowledged", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  escalated: { ar: "تصعيد", en: "Escalated", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

function fmtDate(date: string | null): string {
  if (!date) return "—"
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

function isExpiringSoon(deadline: string | null): boolean {
  if (!deadline) return false
  const days = (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return days <= 3
}

function isExpired(deadline: string | null): boolean {
  if (!deadline) return false
  return new Date(deadline).getTime() < Date.now()
}

export default function ViolationsPage() {
  const { t, locale } = useTranslation()
  const buildQuery = useCallback((term: string) => violationsQuery(createClient(), term), [])
  const { rows, loading, error, search, setSearch, pagination, reload } = useTablePage<ViolationRow>(buildQuery)
  const readSummary = useCallback((signal: AbortSignal) => violationsSummary(createClient(), signal), [])
  const summary = useReadSummary(readSummary)
  const counts = summary.value?.counts

  const kpiCards: KpiCardData[] = [
    { label: t.nav.violations, value: counts?.[0] ?? "—", icon: ShieldAlert, color: "#1E5A99" },
    { label: locale === "ar" ? "مفتوحة" : "Open", value: counts?.[1] ?? "—", icon: AlertCircle, color: "#F59E0B" },
    { label: locale === "ar" ? "معترض عليها" : "Disputed", value: counts?.[2] ?? "—", icon: MessageSquareWarning, color: "#EF4444" },
    { label: "Deductions (SAR)", value: summary.value?.deductions.toFixed(2) ?? "—", icon: DollarSign, color: "#0F766E" },
  ]

  const columns: TableColumn<ViolationRow>[] = [
    { key: "violation_ref", header: "Ref", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.violation_ref}</span> },
    { key: "driver", header: t.nav.drivers, render: (r) => r.driver && r.driver_id ? <Link className="font-medium underline underline-offset-4" href={`/drivers/${r.driver_id}`}>{r.driver.full_name_ar}</Link> : "—" },
    { key: "incident_date", header: "Date", render: (r) => <span dir="ltr">{fmtDate(r.incident_date)}</span> },
    {
      key: "severity", header: "Severity",
      render: (r) => {
        const s = SEVERITY_META[r.severity] ?? SEVERITY_META.minor
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{locale === "ar" ? s.ar : s.en}</span>
      },
    },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.open
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{locale === "ar" ? s.ar : s.en}</span>
      },
    },
    { key: "deduction_amount", header: "Deduction", render: (r) => <span dir="ltr" className="tabular-nums">{r.deduction_amount?.toFixed(2) ?? "0.00"} <LocalizedText text="SAR" /></span> },
    {
      key: "dispute_deadline", header: "Dispute Deadline",
      render: (r) => {
        if (!r.dispute_deadline) return <span className="text-muted-foreground">—</span>
        const expired = isExpired(r.dispute_deadline)
        const soon = isExpiringSoon(r.dispute_deadline)
        const cls = expired ? "text-red-600 font-medium" : soon ? "text-amber-600 font-medium" : "text-muted-foreground"
        const suffix = expired ? (locale === "ar" ? " (منتهية)" : " (expired)") : soon ? (locale === "ar" ? " (قريباً)" : " (soon)") : ""
        return <span dir="ltr" className={cls}>{fmtDate(r.dispute_deadline)}{suffix}</span>
      },
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.violations}
        subtitle={locale === "ar" ? "إدارة المخالفات من ملف السائق. الملخص لجميع المخالفات." : "Manage violations from the driver profile. Summary covers all violations."}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        columns={columns}
        data={rows}
        isLoading={loading}
        pagination={pagination}
        loadError={error || summary.error ? (locale === "ar" ? "تعذر تحميل المخالفات أو الملخص. أعد المحاولة." : "Could not load violations or their summary. Try again.") : undefined}
        onRetry={() => { reload(); summary.reload() }}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
