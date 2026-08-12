"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { FileSearch, Plus, Edit, Trash2, ShieldCheck } from "lucide-react"

interface AuditRow {
  id: string
  module: string
  entity_type: string | null
  action: string
  actor_id: string | null
  ip_address: string | null
  created_at: string
  new_values: Record<string, unknown> | null
}

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  } catch { return iso }
}

const MODULE_AR: Record<string, string> = {
  drivers: "سائقين", vehicles: "مركبات", attendance: "حضور", payroll: "رواتب",
  violations: "مخالفات", expenses: "مصروفات", maintenance: "صيانة", invoices: "فواتير",
  accounting: "محاسبة", platforms: "منصات", hr: "موارد بشرية", reports: "تقارير",
  templates: "قوالب", users: "مستخدمين", roles: "أدوار", audit_log: "تدقيق",
  security: "أمان", settings: "إعدادات", assignments: "تسليمات",
}

export default function AuditLogPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<AuditRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("audit_log")
        .select("id,module,entity_type,action,actor_id,ip_address,created_at,new_values")
        .order("created_at", { ascending: false })
        .limit(200)
      if (error) { console.error(error); setData([]) }
      else { setData(result as AuditRow[] ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.module?.includes(search) || r.action?.includes(search) || r.entity_type?.includes(search))
    : data

  const moduleCounts = data.reduce((acc, r) => { acc[r.module] = (acc[r.module] ?? 0) + 1; return acc }, {} as Record<string, number>)
  const topModules = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]).slice(0, 4)

  const kpiCards: KpiCardData[] = [
    { label: t.nav.auditLog, value: data.length, icon: FileSearch, color: "#1E5A99" },
    { label: t.common.active, value: data.filter(r => r.action === "created").length, icon: Plus, color: "#10B981" },
    { label: "Updates", value: data.filter(r => r.action === "updated").length, icon: Edit, color: "#F59E0B" },
    { label: "Deletes", value: data.filter(r => r.action === "deleted").length, icon: Trash2, color: "#EF4444" },
  ]

  const columns: TableColumn<AuditRow>[] = [
    { key: "created_at", header: "Timestamp", render: (r) => <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(r.created_at)}</span> },
    { key: "module", header: "Module", render: (r) => <span className="text-sm font-medium">{MODULE_AR[r.module] ?? r.module}</span> },
    { key: "action", header: "Action", render: (r) => <span dir="ltr" className="text-xs font-mono">{r.action}</span> },
    { key: "entity_type", header: "Entity", render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{r.entity_type ?? "—"}</span> },
    { key: "actor_id", header: "Actor", render: (r) => <span dir="ltr" className="text-xs font-mono text-muted-foreground">{r.actor_id?.slice(0, 8) ?? "system"}</span> },
    { key: "ip_address", header: "IP", render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{r.ip_address ?? "—"}</span> },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.auditLog}
        subtitle={t.common.status === "الحالة" ? "سجل التدقيق غير القابل للتغيير" : "Immutable audit trail"}
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
