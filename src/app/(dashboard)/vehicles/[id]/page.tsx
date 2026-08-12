"use client"

import { useEffect, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Car,
  LayoutGrid,
  FileText,
  ClipboardList,
  Wrench,
  Gauge,
  IdCard,
  Activity,
  CalendarClock,
  Settings2,
  UserCheck,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import type { VehicleStatus, VehicleCondition, FuelType } from "@/types/vehicles"

interface VehicleDetail {
  id: string
  vehicle_code: string | null
  plate_number: string
  plate_type: string | null
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  vin: string | null
  chassis_number: string | null
  fuel_type: FuelType | null
  status: VehicleStatus
  condition_status: VehicleCondition
  odometer_current: number
  odometer_unit: string
  current_driver_id: string | null
  insurance_expiry: string | null
  registration_expiry: string | null
  inspection_expiry: string | null
  photo_url: string | null
}

type ExpiryState = "ok" | "soon" | "expired" | "none"

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ""
}

function Field({
  label,
  value,
  notSet,
}: {
  label: string
  value: ReactNode
  notSet: string
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground break-words">
        {isEmpty(value) ? (
          <span className="text-muted-foreground">{notSet}</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-sm p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-elite-blue-500" />
        {title}
      </h3>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</dl>
    </div>
  )
}

function PhasePlaceholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/50 bg-muted/20 p-10 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  )
}

export default function VehicleDetailPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function loadVehicle() {
      if (!id) return
      setIsLoading(true)
      setError(null)
      const supabase = createClient()
      const { data, error: queryError } = await supabase
        .from("vehicles")
        .select(
          "id, vehicle_code, plate_number, plate_type, make, model, year, color, vin, chassis_number, fuel_type, status, condition_status, odometer_current, odometer_unit, current_driver_id, insurance_expiry, registration_expiry, inspection_expiry, photo_url"
        )
        .eq("id", id)
        .is("deleted_at", null)
        .single()

      if (!active) return
      if (queryError) {
        setError(queryError.message)
        setVehicle(null)
      } else {
        setVehicle((data as VehicleDetail | null) ?? null)
      }
      setIsLoading(false)
    }
    loadVehicle()
    return () => {
      active = false
    }
  }, [id])

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

  const fuelLabel: Record<FuelType, string> = {
    petrol: t.vehicles.fuelPetrol,
    diesel: t.vehicles.fuelDiesel,
    hybrid: t.vehicles.fuelHybrid,
    electric: t.vehicles.fuelElectric,
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
      // eslint-disable-next-line react-hooks/purity -- expiry threshold computed at render
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

  if (isLoading) {
    return (
      <div className="px-4 lg:px-6">
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-elite-blue-500" />
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
        </div>
      </div>
    )
  }

  if (error || !vehicle) {
    return (
      <div className="px-4 lg:px-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 rounded-lg"
          onClick={() => router.push("/vehicles")}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4 rtl:rotate-180" />
          {t.vehicles.backToList}
        </Button>
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm py-16 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-base font-semibold text-foreground">
            {t.vehicles.notFoundTitle}
          </p>
          <p className="text-sm text-muted-foreground">
            {error ? t.common.error : t.vehicles.notFoundDesc}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 rounded-lg"
            onClick={() => router.push("/vehicles")}
          >
            {t.vehicles.backToList}
          </Button>
        </div>
      </div>
    )
  }

  const makeModel = `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()
  const odometerUnit = vehicle.odometer_unit || t.vehicles.unitKm
  const notSet = t.vehicles.notSet

  return (
    <div className="px-4 lg:px-6 space-y-6">
      {/* Back */}
      <Button
        variant="ghost"
        size="sm"
        className="rounded-lg"
        onClick={() => router.push("/vehicles")}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4 rtl:rotate-180" />
        {t.vehicles.backToList}
      </Button>

      {/* Profile header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-sm p-6">
        <div
          className="absolute top-0 right-0 h-32 w-32 rounded-full opacity-[0.06]"
          style={{ backgroundColor: "#1E5A99", transform: "translate(30%, -30%)" }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-elite-blue-500 to-elite-blue-700 text-white shadow-lg shadow-elite-blue-500/20">
            {vehicle.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={vehicle.photo_url}
                alt={vehicle.plate_number}
                className="h-full w-full object-cover"
              />
            ) : (
              <Car className="h-8 w-8" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {vehicle.plate_number}
              </h1>
              <Badge className={statusBadgeClass[vehicle.status]}>
                {statusLabel[vehicle.status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {makeModel || notSet}
              {vehicle.year ? ` · ${vehicle.year}` : ""}
              {vehicle.vehicle_code ? (
                <span className="font-mono"> · {vehicle.vehicle_code}</span>
              ) : null}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="h-auto flex-wrap gap-1 rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="overview" className="rounded-lg gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" />
            {t.vehicles.tabOverview}
          </TabsTrigger>
          <TabsTrigger value="documents" className="rounded-lg gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {t.vehicles.tabDocuments}
          </TabsTrigger>
          <TabsTrigger value="assignments" className="rounded-lg gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />
            {t.vehicles.tabAssignments}
          </TabsTrigger>
          <TabsTrigger value="handover" className="rounded-lg gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />
            {t.vehicles.tabHandover}
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="rounded-lg gap-1.5">
            <Wrench className="h-3.5 w-3.5" />
            {t.vehicles.tabMaintenance}
          </TabsTrigger>
          <TabsTrigger value="odometer" className="rounded-lg gap-1.5">
            <Gauge className="h-3.5 w-3.5" />
            {t.vehicles.tabOdometer}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionCard icon={IdCard} title={t.vehicles.sectionIdentity}>
              <Field label={t.vehicles.fieldCode} value={vehicle.vehicle_code} notSet={notSet} />
              <Field label={t.vehicles.fieldPlate} value={vehicle.plate_number} notSet={notSet} />
              <Field label={t.vehicles.fieldPlateType} value={vehicle.plate_type} notSet={notSet} />
              <Field label={t.vehicles.fieldMakeModel} value={makeModel || null} notSet={notSet} />
              <Field label={t.vehicles.fieldYear} value={vehicle.year} notSet={notSet} />
              <Field label={t.vehicles.fieldColor} value={vehicle.color} notSet={notSet} />
              <Field label={t.vehicles.fieldVin} value={vehicle.vin} notSet={notSet} />
              <Field label={t.vehicles.fieldChassis} value={vehicle.chassis_number} notSet={notSet} />
            </SectionCard>

            <SectionCard icon={Activity} title={t.vehicles.sectionStatus}>
              <Field
                label={t.vehicles.fieldStatus}
                value={
                  <Badge className={statusBadgeClass[vehicle.status]}>
                    {statusLabel[vehicle.status]}
                  </Badge>
                }
                notSet={notSet}
              />
              <Field
                label={t.vehicles.fieldCondition}
                value={
                  <Badge className={conditionBadgeClass[vehicle.condition_status]}>
                    {conditionLabel[vehicle.condition_status]}
                  </Badge>
                }
                notSet={notSet}
              />
              <Field
                label={t.vehicles.fieldFuel}
                value={vehicle.fuel_type ? fuelLabel[vehicle.fuel_type] : null}
                notSet={notSet}
              />
            </SectionCard>

            <SectionCard icon={CalendarClock} title={t.vehicles.sectionDates}>
              <Field
                label={t.vehicles.fieldInsurance}
                value={renderExpiry(vehicle.insurance_expiry)}
                notSet={notSet}
              />
              <Field
                label={t.vehicles.fieldRegistration}
                value={renderExpiry(vehicle.registration_expiry)}
                notSet={notSet}
              />
              <Field
                label={t.vehicles.fieldInspection}
                value={renderExpiry(vehicle.inspection_expiry)}
                notSet={notSet}
              />
            </SectionCard>

            <SectionCard icon={Settings2} title={t.vehicles.sectionSpecs}>
              <Field
                label={t.vehicles.fieldOdometer}
                value={
                  <span className="tabular-nums">
                    {vehicle.odometer_current.toLocaleString(dateLocale)}{" "}
                    {odometerUnit}
                  </span>
                }
                notSet={notSet}
              />
            </SectionCard>

            <SectionCard icon={UserCheck} title={t.vehicles.sectionAssignment}>
              <Field
                label={t.vehicles.fieldCurrentDriver}
                value={
                  vehicle.current_driver_id ? (
                    <Badge className="border-transparent bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300">
                      {t.vehicles.statusAssigned}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {t.vehicles.notAssigned}
                    </span>
                  )
                }
                notSet={notSet}
              />
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <PhasePlaceholder title={t.vehicles.comingSoon} desc={t.vehicles.comingSoonDesc} />
        </TabsContent>
        <TabsContent value="assignments" className="mt-4">
          <PhasePlaceholder title={t.vehicles.comingSoon} desc={t.vehicles.comingSoonDesc} />
        </TabsContent>
        <TabsContent value="handover" className="mt-4">
          <PhasePlaceholder title={t.vehicles.comingSoon} desc={t.vehicles.comingSoonDesc} />
        </TabsContent>
        <TabsContent value="maintenance" className="mt-4">
          <PhasePlaceholder title={t.vehicles.comingSoon} desc={t.vehicles.comingSoonDesc} />
        </TabsContent>
        <TabsContent value="odometer" className="mt-4">
          <PhasePlaceholder title={t.vehicles.comingSoon} desc={t.vehicles.comingSoonDesc} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
