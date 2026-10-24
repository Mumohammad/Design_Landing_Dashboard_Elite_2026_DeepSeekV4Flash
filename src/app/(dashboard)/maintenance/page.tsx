"use client"

// /maintenance — fleet maintenance workspace (Prompt O Part 1).
// Composes vehicle_maintenance_events + vehicle_odometer_logs over the
// existing RLS-boundary client. KPIs, filters, CSV export, CRUD dialogs and
// the per-vehicle odometer dialog live here; mutations ride the server
// actions (requirePermission + audit + revalidation).

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Wrench, Clock, CheckCircle2, Car, Plus, Download, Gauge, Pencil, Play, XCircle, CheckCheck, Archive } from "lucide-react"
import { fetchFleetRows } from "@/lib/vehicles/query-pages"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
import { formatDualDate } from "@/lib/formatting/hijri"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Button } from "@/components/ui/button"
import {
  startMaintenanceEvent,
  exportMaintenanceCsv,
} from "@/lib/maintenance/actions"
import { eventKpiBucket } from "@/lib/maintenance/module-utils"
import {
  EventDialogs,
  type MaintenanceEventRow,
  type VehicleOption,
  type DriverOption,
} from "./components/event-dialogs"
import { OdometerDialog } from "./components/odometer-dialog"

const PAGE_SIZE = 25

export default function MaintenancePage() {
  const { t } = useTranslation()
  const m = t.maintenanceModule
  const vm = t.vehicles
  const isAr = t.common.status === "الحالة"

  const [rows, setRows] = useState<MaintenanceEventRow[]>([])
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [vehiclesInMaintenance, setVehiclesInMaintenance] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError,setLoadError]=useState(false)
  const [page,setPage]=useState(1)

  // filters
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [vehicleFilter, setVehicleFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  // dialogs
  const [dialogKind, setDialogKind] = useState<"create" | "edit" | "complete" | "cancel" | "archive" | null>(null)
  const [activeEvent, setActiveEvent] = useState<MaintenanceEventRow | null>(null)
  const [odometerVehicle, setOdometerVehicle] = useState<{ id: string; label: string } | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setLoadError(false)
    const supabase = createClient()
    const [eventsRes, vehiclesRes, driversRes, inMaintRes] = await Promise.all([
      fetchFleetRows<MaintenanceEventRow>(()=>supabase
        .from("vehicle_maintenance_events")
        .select(
          "id,version,vehicle_id,maintenance_type,status,reported_at,fault_description,provider,cost,parts_replaced,odometer_at_service,date_in,date_out,next_service_km,next_service_date,notes," +
            "vehicle:vehicles(plate_number,make,model)," +
            "driver:drivers(full_name_ar,full_name_en)"
        )
        .is("deleted_at", null)
        .order("reported_at", { ascending: false })
        .order("id")),
      fetchFleetRows<VehicleOption>(()=>supabase
        .from("vehicles")
        .select("id,plate_number,make,model,odometer_current")
        .is("deleted_at", null)
        .order("plate_number", { ascending: true })
        .order("id")),
      fetchFleetRows<DriverOption>(()=>supabase
        .from("drivers")
        .select("id,full_name_ar,full_name_en")
        .is("deleted_at", null)
        .in("status", ["active", "on_leave"])
        .order("full_name_ar", { ascending: true })
        .order("id")),
      supabase
        .from("vehicles")
        .select("id", { count: "exact", head: true })
        .eq("status", "in_maintenance")
        .is("deleted_at", null),
    ])
    if(eventsRes.error||vehiclesRes.error||driversRes.error||inMaintRes.error){setLoadError(true);setRows([]);setIsLoading(false);return}
    setRows((eventsRes.data as unknown as MaintenanceEventRow[]) ?? [])
    setVehicles((vehiclesRes.data as VehicleOption[]) ?? [])
    setDrivers((driversRes.data as DriverOption[]) ?? [])
    setVehiclesInMaintenance(inMaintRes.count ?? 0)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadData()
      void cancelled
    })()
    return () => {
      cancelled = true
    }
  }, [loadData])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false
      if (typeFilter !== "all" && r.maintenance_type !== typeFilter) return false
      if (vehicleFilter !== "all" && r.vehicle_id !== vehicleFilter) return false
      if (dateFrom && (r.reported_at ?? "") < dateFrom) return false
      if (dateTo && (r.reported_at ?? "").slice(0, 10) > dateTo) return false
      if (search) {
        const hay = `${r.vehicle?.plate_number ?? ""} ${r.fault_description ?? ""} ${r.provider ?? ""} ${r.driver?.full_name_ar ?? ""} ${r.driver?.full_name_en ?? ""}`.toLowerCase()
        if (!hay.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [rows, statusFilter, typeFilter, vehicleFilter, dateFrom, dateTo, search])

  const kpis = useMemo(() => {
    const now = new Date()
    let open = 0
    let inProg = 0
    let completedMonth = 0
    let costSum = 0
    let costCount = 0
    for (const r of rows) {
      const bucket = eventKpiBucket(r.status, r.reported_at, now)
      if (bucket === "open") open++
      else if (bucket === "in_progress") inProg++
      else if (bucket === "completed_this_month") completedMonth++
      if (r.cost != null) {
        costSum += Number(r.cost)
        costCount++
      }
    }
    return { open, inProg, completedMonth, avgCost: costCount > 0 ? costSum / costCount : null }
  }, [rows])

  const kpiCards: KpiCardData[] = [
    { label: m.kpiOpen, value: kpis.open, icon: Wrench, color: "#F59E0B" },
    { label: m.kpiInProgress, value: kpis.inProg, icon: Clock, color: "#1E5A99" },
    { label: m.kpiCompletedMonth, value: kpis.completedMonth, icon: CheckCircle2, color: "#10B981" },
    { label: m.kpiAvgCost, value: kpis.avgCost != null ? kpis.avgCost.toFixed(0) + " " + (isAr ? "ر.س" : "SAR") : "—", icon: Car, color: "#8B5CF6" },
    { label: m.kpiVehiclesInMaintenance, value: vehiclesInMaintenance, icon: Car, color: "#EF4444" },
  ]

  const columns: TableColumn<MaintenanceEventRow>[] = [
    {
      key: "vehicle",
      header: t.nav.vehicles,
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {r.vehicle ? `${r.vehicle.make ?? ""} ${r.vehicle.model ?? ""}`.trim() || "—" : "—"}
          </span>
          <span dir="ltr" className="text-xs text-muted-foreground">{r.vehicle?.plate_number ?? ""}</span>
        </div>
      ),
    },
    {
      key: "maintenance_type",
      header: vm.maintenanceType,
      render: (r) => {
        const map: Record<string, string> = { preventive: vm.typePreventive, emergency: vm.typeEmergency, periodic: vm.typePeriodic, repair: vm.typeRepair }
        const cls: Record<string, string> = {
          preventive: "bg-blue-500/15 text-blue-600 border-blue-500/20",
          emergency: "bg-red-500/15 text-red-600 border-red-500/20",
          periodic: "bg-amber-500/15 text-amber-600 border-amber-500/20",
          repair: "bg-orange-500/15 text-orange-600 border-orange-500/20",
        }
        const key = r.maintenance_type in map ? r.maintenance_type : "repair"
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls[key]}`}>{map[key]}</span>
      },
    },
    {
      key: "status",
      header: t.common.status,
      render: (r) => {
        const map: Record<string, string> = { open: vm.statusOpen, in_progress: vm.statusInProgress, completed: vm.statusCompleted, cancelled: vm.statusCancelled }
        const cls: Record<string, string> = {
          open: "bg-amber-500/15 text-amber-600 border-amber-500/20",
          in_progress: "bg-blue-500/15 text-blue-600 border-blue-500/20",
          completed: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
          cancelled: "bg-red-500/15 text-red-600 border-red-500/20",
        }
        const key = r.status in map ? r.status : "open"
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls[key]}`}>{map[key]}</span>
      },
    },
    {
      key: "reported_by",
      header: m.colReportedBy,
      render: (r) =>
        r.driver ? (
          <span className="text-sm">{r.driver.full_name_ar || r.driver.full_name_en}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "fault_description", header: m.colFault, render: (r) => <span className="line-clamp-1 max-w-[16rem] text-xs text-muted-foreground">{r.fault_description ?? "—"}</span> },
    { key: "cost", header: m.colCost, render: (r) => <span dir="ltr" className="tabular-nums text-sm">{r.cost != null ? Number(r.cost).toFixed(2) : "—"}</span> },
    { key: "odometer", header: m.colOdometer, render: (r) => <span dir="ltr" className="tabular-nums text-xs">{r.odometer_at_service != null ? r.odometer_at_service.toLocaleString() : "—"}</span> },
    { key: "date_in", header: m.colDateIn, render: (r) => <span dir="ltr" className="text-xs">{r.date_in ? formatDualDate(r.date_in, isAr) : "—"}</span> },
    {
      key: "actions_col",
      header: t.common.actions,
      render: (r) => (
        <div className="flex items-center gap-1">
          {(r.status === "open" || r.status === "cancelled") && <Button size="sm" variant="ghost" title={isAr?"أرشفة":"Archive"} onClick={()=>{setActiveEvent(r);setDialogKind("archive")}}><Archive className="size-4"/></Button>}
          {(r.status === "open" || r.status === "in_progress") && (
            <>
              {r.status === "open" && (
                <Button
                  size="sm"
                  variant="ghost"
                  title={m.startEvent}
                  disabled={startingId === r.id}
                  onClick={async () => {
                    setStartingId(r.id)
                    const res = await startMaintenanceEvent(r.id,r.version)
                    setStartingId(null)
                    if (res.success) {
                      toast.success(isAr ? "بدأ العمل على الحدث" : "Event started")
                      await loadData()
                    } else {
                      toast.error(res.error ?? "Error")
                    }
                  }}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              )}
              {r.status==="open"&&<Button size="sm" variant="ghost" title={t.common.edit} onClick={() => { setActiveEvent(r); setDialogKind("edit") }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>}
              <Button size="sm" variant="ghost" title={m.completeEvent} onClick={() => { setActiveEvent(r); setDialogKind("complete") }}>
                <CheckCheck className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" title={m.cancelEvent} onClick={() => { setActiveEvent(r); setDialogKind("cancel") }}>
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {r.vehicle_id && (
            <Button
              size="sm"
              variant="ghost"
              title={m.viewOdometer}
              onClick={() => setOdometerVehicle({ id: r.vehicle_id, label: r.vehicle?.plate_number ?? "" })}
            >
              <Gauge className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  async function handleExport() {
    const res = await exportMaintenanceCsv()
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `maintenance-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(m.exported)
    } else {
      toast.error(res.error ?? "Error")
    }
  }

  function handleDone(errMsg: string | null) {
    if (errMsg) {
      toast.error(errMsg)
    } else {
      toast.success(t.common.saved)
      setDialogKind(null)
      setActiveEvent(null)
      loadData()
    }
  }

  const activeVehicle = vehicles.find((v) => v.id === activeEvent?.vehicle_id) ?? null
  const defaultOdometer = activeVehicle?.odometer_current ?? null

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.maintenance}
        subtitle={m.subtitle}
        kpiCards={loadError?kpiCards.map(card=>({...card,value:"—"})):kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel={m.addEvent}
        primaryCtaIcon={Plus}
        onPrimaryCta={() => { setActiveEvent(null); setDialogKind("create") }}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm" aria-label={m.filterStatus}>
              <option value="all">{m.filterStatus}: {t.common.all}</option>
              <option value="open">{vm.statusOpen}</option>
              <option value="in_progress">{vm.statusInProgress}</option>
              <option value="completed">{vm.statusCompleted}</option>
              <option value="cancelled">{vm.statusCancelled}</option>
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm" aria-label={m.filterType}>
              <option value="all">{m.filterType}: {t.common.all}</option>
              <option value="preventive">{vm.typePreventive}</option>
              <option value="emergency">{vm.typeEmergency}</option>
              <option value="periodic">{vm.typePeriodic}</option>
              <option value="repair">{vm.typeRepair}</option>
            </select>
            <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm" aria-label={m.filterVehicle}>
              <option value="all">{m.filterVehicle}: {t.common.all}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.plate_number ?? v.id.slice(0, 8)}</option>
              ))}
            </select>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm" aria-label={m.filterDateFrom} />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm" aria-label={m.filterDateTo} />
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-1 h-4 w-4" />
              {t.common.export}
            </Button>
          </div>
        }
        columns={columns}
        data={filtered.slice((Math.min(page,Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)))-1)*PAGE_SIZE,Math.min(page,Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)))*PAGE_SIZE)}
        pagination={{totalRecords:filtered.length,currentPage:Math.min(page,Math.max(1,Math.ceil(filtered.length/PAGE_SIZE))),totalPages:Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)),onPageChange:setPage}}
        loadError={loadError?(isAr?"تعذر تحميل الصيانة. أعد المحاولة.":"Could not load maintenance. Try again."):undefined}
        onRetry={()=>void loadData()}
        retryLabel={t.common.retry}
        isLoading={isLoading}
        emptyStateMessage={t.common.noData}
        emptyStateAction={filtered.length === 0 && rows.length > 0 ? { label: t.common.clearFilters, onClick: () => { setStatusFilter("all"); setTypeFilter("all"); setVehicleFilter("all"); setDateFrom(""); setDateTo(""); setSearch("") } } : undefined}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {filtered.length > PAGE_SIZE
          ? `${t.common.recordsCount}: ${filtered.length}`
          : null}
        {" · "}
        <Link href="/vehicles" className="underline underline-offset-2">{t.nav.vehicles}</Link>
      </p>

      <EventDialogs
        kind={dialogKind}
        event={activeEvent}
        vehicles={vehicles}
        drivers={drivers}
        defaultOdometer={defaultOdometer}
        onClose={() => { setDialogKind(null); setActiveEvent(null) }}
        onDone={handleDone}
      />
      <OdometerDialog
        vehicleId={odometerVehicle?.id ?? null}
        vehicleLabel={odometerVehicle?.label ?? ""}
        onClose={() => setOdometerVehicle(null)}
      />
    </div>
  )
}
