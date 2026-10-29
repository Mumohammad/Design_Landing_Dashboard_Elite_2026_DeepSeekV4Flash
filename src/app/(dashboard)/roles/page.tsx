"use client"

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useEffect, useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { ShieldCheck, Star, Lock, Eye } from "lucide-react"
import { fetchRoles, type RoleRow } from "@/lib/auth/user-reads"


export default function RolesPage() {
  const { t, locale } = useTranslation()
  const ui = useUiText()
  const [data, setData] = useState<RoleRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      try {
        const result = await fetchRoles()
        setData(result)
      } catch {
        setData([])
      }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.name_ar?.includes(search) || r.name?.includes(search))
    : data

  const kpiCards: KpiCardData[] = [
    { label: t.nav.roles, value: data.length, icon: ShieldCheck, color: "#1E5A99" },
    { label: ui("System"), value: data.filter(r => r.is_system_role).length, icon: Lock, color: "#EF4444" },
    { label: ui("General manager"), value: data.filter(r => r.name === "general_manager").length, icon: Star, color: "#F59E0B" },
    { label: ui("Read-only"), value: data.filter(r => r.name === "readonly_auditor").length, icon: Eye, color: "#64748B" },
  ]

  const columns: TableColumn<RoleRow>[] = [
    {
      key: "name_ar", header: t.nav.roles,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{locale === "ar" ? (r.name_ar ?? r.name) : (r.name_en ?? r.name)}</span>
          {r.is_system_role && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>
      ),
    },
    { key: "name_en", header: "English", render: (r) => <span dir="ltr" className="text-sm text-muted-foreground">{r.name_en ?? r.name}</span> },
    { key: "name", header: ui("Code"), render: (r) => <span dir="ltr" className="font-mono text-xs">{r.name}</span> },
    { key: "description", header: ui("Description"), render: (r) => <span className="text-xs text-muted-foreground">{r.description ?? "—"}</span> },
    {
      key: "is_system_role", header: t.common.status,
      render: (r) => r.is_system_role
        ? <span className="inline-flex items-center rounded-full border border-red-500/20 bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600"><LocalizedText text="System" /></span>
        : <span className="inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-600"><LocalizedText text="Custom" /></span>,
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.roles}
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
