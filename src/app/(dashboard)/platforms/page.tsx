"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { LayoutTemplate, CheckCircle2, MapPin, DollarSign } from "lucide-react"

interface PlatformRow {
  id: string
  code: string
  name_ar: string
  name_en: string | null
  brand_color: string | null
  is_active: boolean
  rate_type: string
  rate_per_order: number | null
  rate_card: Record<string, unknown> | null
  sort_order: number
}

const RATE_TYPE_META: Record<string, { ar: string; en: string; className: string }> = {
  flat: { ar: "ثابت", en: "Flat", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  distance_based: { ar: "مسافة", en: "Distance", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  tiered: { ar: "متدرج", en: "Tiered", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  custom: { ar: "مخصص", en: "Custom", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

export default function PlatformsPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<PlatformRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("delivery_platforms")
        .select("id,code,name_ar,name_en,brand_color,is_active,rate_type,rate_per_order,rate_card,sort_order")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
      if (error) { console.error(error); setData([]) }
      else { setData((result as PlatformRow[]) ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.name_ar?.includes(search) || r.code?.toLowerCase().includes(search.toLowerCase()))
    : data

  const kpiCards: KpiCardData[] = [
    { label: t.nav.platforms, value: data.length, icon: LayoutTemplate, color: "#1E5A99" },
    { label: t.common.active, value: data.filter(r => r.is_active).length, icon: CheckCircle2, color: "#10B981" },
    { label: "Distance", value: data.filter(r => r.rate_type === "distance_based").length, icon: MapPin, color: "#8B5CF6" },
    { label: "Flat", value: data.filter(r => r.rate_type === "flat").length, icon: DollarSign, color: "#0EA5E9" },
  ]

  const columns: TableColumn<PlatformRow>[] = [
    {
      key: "name_ar", header: t.nav.platforms,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.brand_color ?? "#1E5A99" }} />
          <span className="font-medium">{r.name_ar}</span>
        </div>
      ),
    },
    { key: "code", header: "Code", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.code}</span> },
    {
      key: "rate_type", header: "Rate Type",
      render: (r) => {
        const m = RATE_TYPE_META[r.rate_type] ?? RATE_TYPE_META.flat
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>{m.ar}</span>
      },
    },
    {
      key: "rate_per_order", header: "Rate",
      render: (r) => {
        if (r.rate_type === "flat" && r.rate_per_order != null) {
          return <span dir="ltr" className="tabular-nums">{r.rate_per_order.toFixed(2)} SAR</span>
        }
        if (r.rate_type === "distance_based") {
          const base = (r.rate_card as Record<string, number> | null)?.base_rate
          return <span dir="ltr" className="tabular-nums text-muted-foreground">{base ? base.toFixed(2) + " SAR base" : "Distance"}</span>
        }
        return <span className="text-muted-foreground">—</span>
      },
    },
    {
      key: "is_active", header: t.common.status,
      render: (r) => r.is_active
        ? <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">{t.common.active}</span>
        : <span className="inline-flex items-center rounded-full border border-gray-500/20 bg-gray-500/15 px-2 py-0.5 text-xs font-medium text-gray-600">{t.common.inactive}</span>,
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.platforms}
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
