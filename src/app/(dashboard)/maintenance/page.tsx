"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Wrench, Clock, CheckCircle2, AlertCircle } from "lucide-react"

interface MaintenanceRow {
  id: string
  maintenance_type: string
  status: string
  reported_at: string
  fault_description: string
  cost: number | null
  provider: string | null
  date_in: string | null
  date_out: string | null
  vehicle: { plate_number: string; make: string; model: string } | null
  driver: { full_name_ar: string } | null
}

const TYPE_META: Record<string, { ar: string; className: string }> = {
  preventive: { ar: "وقائية", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  emergency: { ar: "طارئة", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  periodic: { ar: "دورية", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  repair: { ar: "إصلاح", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
}

const STATUS_META: Record<string, { ar: string; className: string }> = {
  open: { ar: "مفتوحة", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  in_progress: { ar: "جارية", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  completed: { ar: "مكتملة", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  cancelled: { ar: "ملغاة", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

function fmtDate(date: string | null): string {
  if (!date) return "—"
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

export default function MaintenancePage() {
  const { t } = useTranslation()
  const [data, setData] = useState<MaintenanceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("vehicle_maintenance_events")
        .select(`
          id,maintenance_type,status,reported_at,fault_description,cost,provider,date_in,date_out,
          vehicle:vehicles(plate_number,make,model),
          driver:drivers(full_name_ar)
        `)
        .is("deleted_at", null)
        .order("reported_at", { ascending: false })
        .limit(100)
      if (error) { console.error(error); setData([]) }
      else { setData((result as unknown as MaintenanceRow[]) ?? []) }
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = search
    ? data.filter(r => r.vehicle?.plate_number?.includes(search) || r.fault_description?.includes(search) || r.provider?.includes(search))
    : data

  const totalCost = data.reduce((s, r) => s + (r.cost ?? 0), 0)

  const kpiCards: KpiCardData[] = [
    { label: t.nav.maintenance, value: data.length, icon: Wrench, color: "#1E5A99" },
    { label: t.common.pending, value: data.filter(r => r.status === "open").length, icon: Clock, color: "#F59E0B" },
    { label: t.common.approved, value: data.filter(r => r.status === "completed").length, icon: CheckCircle2, color: "#10B981" },
    { label: "Cost (SAR)", value: totalCost.toFixed(0), icon: AlertCircle, color: "#8B5CF6" },
  ]

  const columns: TableColumn<MaintenanceRow>[] = [
    {
      key: "vehicle", header: t.nav.vehicles,
      render: (r) => <span className="font-medium">{r.vehicle ? `${r.vehicle.make} ${r.vehicle.model}` : "—"} <span dir="ltr" className="text-xs text-muted-foreground">({r.vehicle?.plate_number})</span></span>,
    },
    {
      key: "maintenance_type", header: t.common.status,
      render: (r) => {
        const m = TYPE_META[r.maintenance_type] ?? TYPE_META.repair
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>{m.ar}</span>
      },
    },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.open
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.ar}</span>
      },
    },
    { key: "fault_description", header: "Fault", render: (r) => <span className="text-xs text-muted-foreground line-clamp-1">{r.fault_description ?? "—"}</span> },
    { key: "cost", header: "Cost", render: (r) => <span dir="ltr" className="tabular-nums text-sm">{r.cost != null ? r.cost.toFixed(2) + " SAR" : "—"}</span> },
    { key: "provider", header: "Provider", render: (r) => <span className="text-xs text-muted-foreground">{r.provider ?? "—"}</span> },
    { key: "date_in", header: "Date In", render: (r) => <span dir="ltr" className="text-xs">{fmtDate(r.date_in)}</span> },
    { key: "date_out", header: "Date Out", render: (r) => <span dir="ltr" className="text-xs">{fmtDate(r.date_out)}</span> },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.maintenance}
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
