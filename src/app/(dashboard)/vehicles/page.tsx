"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Car, CheckCircle2, Wrench, UserCheck, Plus, AlertCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { VehicleStatus, VehicleCondition, FuelType } from "@/types/vehicles"
import { CreateVehicleDialog } from "./components/create-vehicle-dialog"

interface VehicleRow {
  id: string
  vehicle_code: string | null
  plate_number: string
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  status: VehicleStatus
  condition_status: VehicleCondition
  fuel_type: FuelType | null
  odometer_current: number
  insurance_expiry: string | null
  registration_expiry: string | null
  inspection_expiry: string | null
  current_driver_id: string | null
}

type ExpiryState = "ok" | "soon" | "expired" | "none"

export default function VehiclesPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()

  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    async function loadVehicles() {
      setIsLoading(true)
      setError(null)
      const supabase = createClient()
      const { data, error: queryError } = await supabase
        .from("vehicles")
        .select(
          "id, vehicle_code, plate_number, make, model, year, color, status, condition_status, fuel_type, odometer_current, insurance_expiry, registration_expiry, inspection_expiry, current_driver_id"
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100)

      if (!active) return
      if (queryError) {
        setError(queryError.message)
        setVehicles([])
      } else {
        setVehicles((data as VehicleRow[] | null) ?? [])
      }
      setIsLoading(false)
    }
    loadVehicles()
    return () => {
      active = false
    }
  }, [reloadKey])

  const statusBadgeClass: Record<VehicleStatus, string> = {
    available:
      "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    assigned:
      "border-transparent bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
    in_maintenance:
      "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
    off_road:
      "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-400",
    retired:
      "border-transparent bg-gray-500/15 text-gray-600 dark:text-gray-400",
  }

  const conditionBadgeClass: Record<VehicleCondition, string> = {
    excellent:
      "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    good: "border-transparent bg-elite-blue-500/10 text-elite-blue-700 dark:text-elite-blue-300",
    fair: "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400",
    poor: "border-transparent bg-orange-500/10 text-orange-700 dark:text-orange-400",
    damaged: "border-transparent bg-red-500/10 text-red-700 dark:text-red-400",
  }

  const statusLabel: Record<VehicleStatus, string> = {
    available: t.vehicles.statusAvailable,
    assigned: t.vehicles.statusAssigned,
    in_maintenance: t.vehicles.statusMaintenance,
    off_road: t.vehicles.statusOffRoad,
    retired: t.vehicles.statusRetired,
  }

  const conditionLabel: Record<VehicleCondition, string> = {
    excellent: t.vehicles.conditionExcellent,
    good: t.vehicles.conditionGood,
    fair: t.vehicles.conditionFair,
    poor: t.vehicles.conditionPoor,
    damaged: t.vehicles.conditionDamaged,
  }

  const dateLocale = locale === "ar" ? "ar-EG" : "en-GB"

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return t.vehicles.notSet
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return t.vehicles.notSet
    return d.toLocaleDateString(dateLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  function expiryState(dateStr: string | null): ExpiryState {
    if (!dateStr) return "none"
    const expiry = new Date(dateStr)
    if (Number.isNaN(expiry.getTime())) return "none"
    const diffDays =
      (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    if (diffDays < 0) return "expired"
    if (diffDays <= 30) return "soon"
    return "ok"
  }

  function renderExpiry(dateStr: string | null) {
    const state = expiryState(dateStr)
    const label = formatDate(dateStr)
    if (state === "none") {
      return <span className="text-muted-foreground">{t.vehicles.notSet}</span>
    }
    if (state === "expired") {
      return (
        <Badge
          title={t.vehicles.expired}
          className="border-transparent bg-red-500/15 text-red-700 dark:text-red-400"
        >
          {label}
        </Badge>
      )
    }
    if (state === "soon") {
      return (
        <Badge
          title={t.vehicles.expiringSoon}
          className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400"
        >
          {label}
        </Badge>
      )
    }
    return <span className="text-foreground/80">{label}</span>
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter((v) =>
      [v.plate_number, v.vehicle_code, v.make, v.model]
        .filter((f): f is string => Boolean(f))
        .some((f) => f.toLowerCase().includes(q))
    )
  }, [vehicles, search])

  const kpiCards: KpiCardData[] = useMemo(
    () => [
      {
        label: t.vehicles.kpiTotal,
        value: vehicles.length,
        icon: Car,
        color: "#1E5A99",
      },
      {
        label: t.vehicles.kpiAvailable,
        value: vehicles.filter((v) => v.status === "available").length,
        icon: CheckCircle2,
        color: "#10B981",
      },
      {
        label: t.vehicles.kpiAssigned,
        value: vehicles.filter((v) => v.status === "assigned").length,
        icon: UserCheck,
        color: "#3B82F6",
      },
      {
        label: t.vehicles.kpiMaintenance,
        value: vehicles.filter((v) => v.status === "in_maintenance").length,
        icon: Wrench,
        color: "#F59E0B",
      },
    ],
    [t, vehicles]
  )

  const columns: TableColumn<VehicleRow>[] = [
    {
      key: "vehicle_code",
      header: t.vehicles.colCode,
      render: (row) =>
        row.vehicle_code ? (
          <span className="font-mono text-xs text-foreground/80">
            {row.vehicle_code}
          </span>
        ) : (
          <span className="text-muted-foreground">{t.vehicles.notSet}</span>
        ),
    },
    {
      key: "plate_number",
      header: t.vehicles.colPlate,
      render: (row) => (
        <span className="font-semibold text-foreground">{row.plate_number}</span>
      ),
    },
    {
      key: "make",
      header: t.vehicles.colVehicle,
      render: (row) => {
        const name = `${row.make ?? ""} ${row.model ?? ""}`.trim()
        return name ? (
          <span className="text-foreground/90">{name}</span>
        ) : (
          <span className="text-muted-foreground">{t.vehicles.notSet}</span>
        )
      },
    },
    {
      key: "year",
      header: t.vehicles.colYear,
      render: (row) =>
        row.year ? (
          <span className="tabular-nums text-foreground/80">{row.year}</span>
        ) : (
          <span className="text-muted-foreground">{t.vehicles.notSet}</span>
        ),
    },
    {
      key: "status",
      header: t.vehicles.colStatus,
      render: (row) => (
        <Badge className={statusBadgeClass[row.status]}>
          {statusLabel[row.status]}
        </Badge>
      ),
    },
    {
      key: "condition_status",
      header: t.vehicles.colCondition,
      render: (row) => (
        <Badge className={conditionBadgeClass[row.condition_status]}>
          {conditionLabel[row.condition_status]}
        </Badge>
      ),
    },
    {
      key: "odometer_current",
      header: t.vehicles.colOdometer,
      render: (row) => (
        <span className="tabular-nums text-foreground/80">
          {row.odometer_current.toLocaleString(dateLocale)} {t.vehicles.unitKm}
        </span>
      ),
    },
    {
      key: "insurance_expiry",
      header: t.vehicles.colInsurance,
      render: (row) => renderExpiry(row.insurance_expiry),
    },
  ]

  if (error) {
    return (
      <div className="px-4 lg:px-6">
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm py-16 text-center">
          <AlertCircle className="h-8 w-8 text-red-500" />
          <p className="text-sm text-muted-foreground">{t.common.error}</p>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            {t.common.retry}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 lg:px-6">
      <EnterpriseModulePage
        title={t.vehicles.title}
        subtitle={t.vehicles.subtitle}
        primaryCtaLabel={t.vehicles.addVehicle}
        primaryCtaIcon={Plus}
        onPrimaryCta={() => setAddOpen(true)}
        kpiCards={kpiCards}
        searchPlaceholder={t.vehicles.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        columns={columns}
        data={filtered}
        onRowClick={(row) => router.push(`/vehicles/${row.id}`)}
        emptyStateMessage={t.vehicles.emptyMessage}
        emptyStateAction={{
          label: t.vehicles.addVehicle,
          onClick: () => setAddOpen(true),
        }}
        isLoading={isLoading}
      >
        <CreateVehicleDialog open={addOpen} onOpenChange={setAddOpen} />
      </EnterpriseModulePage>
    </div>
  )
}
