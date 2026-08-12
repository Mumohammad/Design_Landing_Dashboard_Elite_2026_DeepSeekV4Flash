"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Users, CheckCircle2, Clock, UserX } from "lucide-react"

interface UserRow {
  id: string
  employee_code: string | null
  full_name_ar: string | null
  full_name_en: string | null
  email: string
  role: string
  status: string
  last_login_at: string | null
  two_factor_enabled: boolean
}

const ROLE_AR: Record<string, string> = {
  general_manager: "مدير عام",
  admin: "مدير نظام",
  accountant: "محاسب",
  supervisor: "مشرف",
  hr_officer: "موارد بشرية",
  operations_officer: "عمليات",
  payroll_officer: "رواتب",
  platform_coordinator: "منسق منصات",
  readonly_auditor: "مدقق",
}

const STATUS_META: Record<string, { ar: string; className: string }> = {
  active: { ar: "نشط", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  inactive: { ar: "غير نشط", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  locked: { ar: "مقفل", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  pending_invite: { ar: "دعوة معلقة", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  terminated: { ar: "منهى", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

function fmtDate(date: string | null): string {
  if (!date) return "—"
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

export default function UsersPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<UserRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("users")
        .select("id,employee_code,full_name_ar,full_name_en,email,role,status,last_login_at,two_factor_enabled")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100)
      if (error) { console.error(error); setData([]) }
      else { setData(result as UserRow[] ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.full_name_ar?.includes(search) || r.email?.includes(search) || r.employee_code?.includes(search))
    : data

  const kpiCards: KpiCardData[] = [
    { label: t.nav.users, value: data.length, icon: Users, color: "#1E5A99" },
    { label: t.common.active, value: data.filter(r => r.status === "active").length, icon: CheckCircle2, color: "#10B981" },
    { label: t.common.pending, value: data.filter(r => r.status === "pending_invite").length, icon: Clock, color: "#F59E0B" },
    { label: t.common.inactive, value: data.filter(r => r.status === "locked" || r.status === "terminated").length, icon: UserX, color: "#EF4444" },
  ]

  const columns: TableColumn<UserRow>[] = [
    { key: "employee_code", header: "Code", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.employee_code ?? "—"}</span> },
    { key: "full_name_ar", header: t.common.status, render: (r) => <span className="font-medium">{r.full_name_ar ?? r.full_name_en ?? r.email}</span> },
    { key: "email", header: "Email", render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{r.email}</span> },
    { key: "role", header: "Role", render: (r) => <span className="text-sm">{ROLE_AR[r.role] ?? r.role}</span> },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.inactive
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.ar}</span>
      },
    },
    { key: "two_factor_enabled", header: "2FA", render: (r) => r.two_factor_enabled ? <span className="text-emerald-600 text-xs">✓</span> : <span className="text-muted-foreground text-xs">—</span> },
    { key: "last_login_at", header: "Last Login", render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{fmtDate(r.last_login_at)}</span> },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.users}
        subtitle={t.common.status}
        primaryCtaLabel={t.common.addNew}
        onPrimaryCta={() => {}}
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
