"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Shield, Lock, AlertTriangle, KeyRound } from "lucide-react"

interface SecurityUserRow {
  id: string
  email: string
  full_name_ar: string | null
  role: string
  status: string
  two_factor_enabled: boolean
  must_change_password: boolean
  failed_login_attempts: number
  locked_until: string | null
  last_login_at: string | null
}

const ROLE_AR: Record<string, string> = {
  general_manager: "مدير عام", admin: "مدير نظام", accountant: "محاسب",
  supervisor: "مشرف", hr_officer: "موارد بشرية", operations_officer: "عمليات",
  payroll_officer: "رواتب", platform_coordinator: "منسق منصات", readonly_auditor: "مدقق",
}

function fmtDate(date: string | null): string {
  if (!date) return "—"
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

export default function SecurityPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<SecurityUserRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("users")
        .select("id,email,full_name_ar,role,status,two_factor_enabled,must_change_password,failed_login_attempts,locked_until,last_login_at")
        .is("deleted_at", null)
        .order("failed_login_attempts", { ascending: false })
        .limit(100)
      if (error) { console.error(error); setData([]) }
      else { setData(result as SecurityUserRow[] ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.email?.includes(search) || r.full_name_ar?.includes(search))
    : data

  const kpiCards: KpiCardData[] = [
    { label: t.nav.security, value: data.length, icon: Shield, color: "#1E5A99" },
    { label: "2FA Active", value: data.filter(r => r.two_factor_enabled).length, icon: KeyRound, color: "#10B981" },
    { label: "Must Change", value: data.filter(r => r.must_change_password).length, icon: Lock, color: "#F59E0B" },
    { label: "Locked", value: data.filter(r => r.status === "locked" || r.failed_login_attempts > 0).length, icon: AlertTriangle, color: "#EF4444" },
  ]

  const columns: TableColumn<SecurityUserRow>[] = [
    { key: "email", header: "Email", render: (r) => <span dir="ltr" className="text-sm">{r.email}</span> },
    { key: "full_name_ar", header: t.common.status, render: (r) => <span>{r.full_name_ar ?? "—"}</span> },
    { key: "role", header: "Role", render: (r) => <span className="text-sm">{ROLE_AR[r.role] ?? r.role}</span> },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const cls = r.status === "active" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20"
          : r.status === "locked" ? "bg-red-500/15 text-red-600 border-red-500/20"
          : "bg-amber-500/15 text-amber-600 border-amber-500/20"
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{r.status}</span>
      },
    },
    { key: "two_factor_enabled", header: "2FA", render: (r) => r.two_factor_enabled ? <span className="text-emerald-600 text-xs">✓</span> : <span className="text-muted-foreground text-xs">—</span> },
    { key: "failed_login_attempts", header: "Failed", render: (r) => r.failed_login_attempts > 0 ? <span className="text-red-600 font-medium tabular-nums">{r.failed_login_attempts}</span> : <span className="text-muted-foreground tabular-nums">0</span> },
    { key: "locked_until", header: "Locked Until", render: (r) => r.locked_until ? <span dir="ltr" className="text-xs text-red-600">{fmtDate(r.locked_until)}</span> : <span className="text-muted-foreground">—</span> },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.security}
        subtitle={t.common.status === "الحالة" ? "حالة الأمان والجلسات" : "Security status and sessions"}
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
