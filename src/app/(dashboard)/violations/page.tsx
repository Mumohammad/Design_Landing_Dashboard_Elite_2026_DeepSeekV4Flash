"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { ShieldAlert, AlertCircle, MessageSquareWarning, DollarSign } from "lucide-react"

interface ViolationRow {
  id: string
  violation_ref: string
  incident_date: string
  status: string
  severity: string
  deduction_amount: number
  dispute_deadline: string | null
  incident_description: string
  driver: { full_name_ar: string; driver_code: string } | null
}

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
  deduction_applied: { ar: "خصم مطبق", en: "Deducted", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
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
  const { t } = useTranslation()
  const [data, setData] = useState<ViolationRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("violations")
        .select("id,violation_ref,incident_date,status,severity,deduction_amount,dispute_deadline,incident_description,driver:drivers(full_name_ar,driver_code)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100)
      if (error) { console.error(error); setData([]) }
      else { setData((result as unknown as ViolationRow[]) ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.violation_ref?.includes(search) || r.driver?.full_name_ar?.includes(search) || r.driver?.driver_code?.includes(search))
    : data

  const totalDeductions = data.filter(r => r.status === "deduction_applied").reduce((s, r) => s + (r.deduction_amount ?? 0), 0)

  const kpiCards: KpiCardData[] = [
    { label: t.nav.violations, value: data.length, icon: ShieldAlert, color: "#1E5A99" },
    { label: t.common.pending, value: data.filter(r => r.status === "open").length, icon: AlertCircle, color: "#F59E0B" },
    { label: t.dashboard.pendingViolations, value: data.filter(r => r.status === "disputed").length, icon: MessageSquareWarning, color: "#EF4444" },
    { label: "Deductions (SAR)", value: totalDeductions.toFixed(0), icon: DollarSign, color: "#8B5CF6" },
  ]

  const columns: TableColumn<ViolationRow>[] = [
    { key: "violation_ref", header: "Ref", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.violation_ref}</span> },
    { key: "driver", header: t.nav.drivers, render: (r) => <span className="font-medium">{r.driver?.full_name_ar ?? "—"}</span> },
    { key: "incident_date", header: "Date", render: (r) => <span dir="ltr">{fmtDate(r.incident_date)}</span> },
    {
      key: "severity", header: "Severity",
      render: (r) => {
        const s = SEVERITY_META[r.severity] ?? SEVERITY_META.minor
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.ar}</span>
      },
    },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.open
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.ar}</span>
      },
    },
    { key: "deduction_amount", header: "Deduction", render: (r) => <span dir="ltr" className="tabular-nums">{r.deduction_amount?.toFixed(2) ?? "0.00"} SAR</span> },
    {
      key: "dispute_deadline", header: "Dispute Deadline",
      render: (r) => {
        if (!r.dispute_deadline) return <span className="text-muted-foreground">—</span>
        const expired = isExpired(r.dispute_deadline)
        const soon = isExpiringSoon(r.dispute_deadline)
        const cls = expired ? "text-red-600 font-medium" : soon ? "text-amber-600 font-medium" : "text-muted-foreground"
        const suffix = expired ? " (expired)" : soon ? " (soon)" : ""
        return <span dir="ltr" className={cls}>{fmtDate(r.dispute_deadline)}{suffix}</span>
      },
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.violations}
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
