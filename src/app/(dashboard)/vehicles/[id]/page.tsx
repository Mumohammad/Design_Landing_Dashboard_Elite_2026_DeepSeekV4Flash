"use client"

import { LocalizedText } from "@/components/localized-text"
import { useEffect, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
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
import { VehicleRecordControls } from "@/components/vehicles/vehicle-record-controls"
import { FleetDocumentsPanel, FleetHandoverPanel } from "@/components/vehicles/fleet-history-panels"
import { AssignDriverCard } from "@/components/vehicles/assign-driver-card"

interface VehicleDetail {
  version: number
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
    <div className="rounded-xl border border-border/50 bg-card/60 p-3">
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
    <div className="rounded-2xl border border-border/50 bg-card/60 shadow-sm p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-elite-blue-500" />
        {title}
      </h3>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</dl>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/50 bg-muted/20 p-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function TabLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}

export default function VehicleDetailPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [revision,setRevision]=useState(0)
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
        .select("*")
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
  }, [id,revision])

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
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/50 bg-card/60 py-16 text-center">
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
    <div className="page-enter px-4 lg:px-6 space-y-6">
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
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/60 shadow-sm p-6">
        <div
          className="absolute top-0 right-0 h-32 w-32 rounded-full opacity-[0.06]"
          style={{ backgroundColor: "#1E5A99", transform: "translate(30%, -30%)" }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-elite-blue-600 dark:text-elite-blue-300">
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

      <VehicleRecordControls vehicle={{...vehicle,make:vehicle.make??"",model:vehicle.model??""}} onSaved={()=>setRevision(v=>v+1)}/>

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

            {/* Two-way wiring (Prompt F): current-driver card deep-linked into
                the drivers profile, with assign/unassign through the SHARED
                server actions — the mirror of the drivers-profile card. */}
            <AssignDriverCard
              vehicleId={vehicle.id}
              vehicleStatus={vehicle.status}
              isAr={locale === "ar"}
              onChanged={()=>setRevision(v=>v+1)}
            />
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <FleetDocumentsPanel vehicleId={vehicle.id}/>
        </TabsContent>
        <TabsContent value="assignments" className="mt-4">
          <AssignmentsTab vehicleId={vehicle.id} t={t} formatDate={formatDate} />
        </TabsContent>
        <TabsContent value="handover" className="mt-4">
          <FleetHandoverPanel vehicleId={vehicle.id}/>
        </TabsContent>
        <TabsContent value="maintenance" className="mt-4">
          <MaintenanceTab vehicleId={vehicle.id} t={t} formatDate={formatDate} />
        </TabsContent>
        <TabsContent value="odometer" className="mt-4">
          <OdometerTab vehicleId={vehicle.id} t={t} odometerUnit={odometerUnit} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ──────────── Assignments Tab ────────────

type VehicleAssignment = {
  id: string
  driver_id: string
  assigned_at: string
  unassigned_at: string | null
  is_current: boolean
  assignment_reason: string | null
  handover_odometer: number | null
  return_odometer: number | null
  notes: string | null
  driver: { full_name_ar: string; driver_code: string } | null
}

function AssignmentsTab({
  vehicleId,
  t,
  formatDate,
}: {
  vehicleId: string
  t: ReturnType<typeof useTranslation>["t"]
  formatDate: (d: string | null) => string
}) {
  const [assignments, setAssignments] = useState<VehicleAssignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from("vehicle_assignments")
        .select("id, driver_id, assigned_at, unassigned_at, is_current, assignment_reason, handover_odometer, return_odometer, notes, driver:drivers(full_name_ar, driver_code)")
        .eq("vehicle_id", vehicleId)
        .is("deleted_at", null)
        .order("assigned_at", { ascending: false })
      if (active) {
        setAssignments((data as unknown as VehicleAssignment[]) ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [vehicleId])

  if (loading) return <TabLoading />
  if (assignments.length === 0) return <EmptyState message={t.vehicles.noAssignments} />

  const current = assignments.filter((a) => a.is_current)
  const past = assignments.filter((a) => !a.is_current)

  return (
    <div className="space-y-4">
      {current.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
            {t.vehicles.currentAssignment}
          </h4>
          <div className="space-y-2">
            {current.map((a) => (
              <AssignmentCard key={a.id} assignment={a} t={t} formatDate={formatDate} />
            ))}
          </div>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
            {t.vehicles.pastAssignments}
          </h4>
          <div className="space-y-2">
            {past.map((a) => (
              <AssignmentCard key={a.id} assignment={a} t={t} formatDate={formatDate} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AssignmentCard({
  assignment,
  t,
  formatDate,
}: {
  assignment: VehicleAssignment
  t: ReturnType<typeof useTranslation>["t"]
  formatDate: (d: string | null) => string
}) {
  const driverName = assignment.driver?.full_name_ar ?? assignment.driver?.driver_code ?? "—"
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{driverName}</p>
            <p className="text-xs text-muted-foreground">{assignment.driver?.driver_code}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Badge className={assignment.is_current
            ? "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "border-transparent bg-gray-500/15 text-gray-600 dark:text-gray-400"
          }>
            {assignment.is_current ? t.vehicles.active : t.vehicles.ended}
          </Badge>
          <span className="text-muted-foreground">{t.vehicles.assignedAt}: {formatDate(assignment.assigned_at)}</span>
          {assignment.unassigned_at && (
            <span className="text-muted-foreground">{t.vehicles.unassignedAt}: {formatDate(assignment.unassigned_at)}</span>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {assignment.handover_odometer != null && (
          <span>{t.vehicles.handoverOdometer}: <span className="tabular-nums text-foreground">{assignment.handover_odometer.toLocaleString()}</span></span>
        )}
        {assignment.return_odometer != null && (
          <span>{t.vehicles.returnOdometer}: <span className="tabular-nums text-foreground">{assignment.return_odometer.toLocaleString()}</span></span>
        )}
        {assignment.assignment_reason && (
          <span>{t.vehicles.assignmentReason}: {assignment.assignment_reason}</span>
        )}
        <Link
          href={`/drivers/${assignment.driver_id}`}
          className="inline-flex items-center gap-1 font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-400"
        >
          {assignment.is_current ? "Open driver profile" : "Driver profile"}
        </Link>
      </div>
    </div>
  )
}

// ──────────── Maintenance Tab ────────────

type MaintenanceEvent = {
  id: string
  maintenance_type: string
  status: string
  reported_at: string
  fault_description: string | null
  provider: string | null
  cost: number | null
  date_in: string | null
  date_out: string | null
  odometer_at_service: number | null
  next_service_km: number | null
  next_service_date: string | null
  notes: string | null
}

function MaintenanceTab({
  vehicleId,
  t,
  formatDate,
}: {
  vehicleId: string
  t: ReturnType<typeof useTranslation>["t"]
  formatDate: (d: string | null) => string
}) {
  const [events, setEvents] = useState<MaintenanceEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from("vehicle_maintenance_events")
        .select("id, maintenance_type, status, reported_at, fault_description, provider, cost, date_in, date_out, odometer_at_service, next_service_km, next_service_date, notes")
        .eq("vehicle_id", vehicleId)
        .is("deleted_at", null)
        .order("reported_at", { ascending: false })
      if (active) {
        setEvents((data as MaintenanceEvent[]) ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [vehicleId])

  const typeLabel = (type: string): string => {
    const map: Record<string, string> = {
      preventive: t.vehicles.typePreventive,
      emergency: t.vehicles.typeEmergency,
      periodic: t.vehicles.typePeriodic,
      repair: t.vehicles.typeRepair,
    }
    return map[type] ?? type
  }

  const typeBadgeClass = (type: string): string => {
    const map: Record<string, string> = {
      preventive: "bg-blue-500/15 text-blue-600 border-blue-500/20",
      emergency: "bg-red-500/15 text-red-600 border-red-500/20",
      periodic: "bg-amber-500/15 text-amber-600 border-amber-500/20",
      repair: "bg-orange-500/15 text-orange-600 border-orange-500/20",
    }
    return map[type] ?? "bg-gray-500/15 text-gray-600 border-gray-500/20"
  }

  const statusLabelFn = (status: string): string => {
    const map: Record<string, string> = {
      open: t.vehicles.statusOpen,
      in_progress: t.vehicles.statusInProgress,
      completed: t.vehicles.statusCompleted,
      cancelled: t.vehicles.statusCancelled,
    }
    return map[status] ?? status
  }

  const statusBadgeClass = (status: string): string => {
    const map: Record<string, string> = {
      open: "bg-amber-500/15 text-amber-600 border-amber-500/20",
      in_progress: "bg-blue-500/15 text-blue-600 border-blue-500/20",
      completed: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
      cancelled: "bg-red-500/15 text-red-600 border-red-500/20",
    }
    return map[status] ?? "bg-gray-500/15 text-gray-600 border-gray-500/20"
  }

  if (loading) return <TabLoading />
  if (events.length === 0) return <EmptyState message={t.vehicles.noMaintenanceEvents} />

  return (
    <div className="space-y-3">
      {events.map((ev) => (
        <div
          key={ev.id}
          className="rounded-xl border border-border/50 bg-card/60 p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                <Wrench className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={typeBadgeClass(ev.maintenance_type)}>
                    {typeLabel(ev.maintenance_type)}
                  </Badge>
                  <Badge className={statusBadgeClass(ev.status)}>
                    {statusLabelFn(ev.status)}
                  </Badge>
                </div>
                {ev.fault_description && (
                  <p className="mt-1.5 text-sm text-foreground line-clamp-2">{ev.fault_description}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{t.vehicles.reportedAt}: {formatDate(ev.reported_at)}</span>
              {ev.cost != null && (
                <span>{t.vehicles.cost}: <span className="tabular-nums text-foreground font-medium">{Number(ev.cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            {ev.provider && <span>{t.vehicles.provider}: {ev.provider}</span>}
            {ev.date_in && <span>{t.vehicles.dateIn}: {formatDate(ev.date_in)}</span>}
            {ev.date_out && <span>{t.vehicles.dateOut}: {formatDate(ev.date_out)}</span>}
            {ev.odometer_at_service != null && (
              <span className="tabular-nums">{ev.odometer_at_service.toLocaleString()} <LocalizedText text="km" /></span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ──────────── Odometer Tab ────────────

type OdometerLog = {
  id: string
  reading: number
  recorded_at: string
  source: string
  notes: string | null
}

function OdometerTab({
  vehicleId,
  t,
  odometerUnit,
}: {
  vehicleId: string
  t: ReturnType<typeof useTranslation>["t"]
  odometerUnit: string
}) {
  const [logs, setLogs] = useState<OdometerLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from("vehicle_odometer_logs")
        .select("id, reading, recorded_at, source, notes")
        .eq("vehicle_id", vehicleId)
        .is("deleted_at", null)
        .order("recorded_at", { ascending: false })
      if (active) {
        setLogs((data as OdometerLog[]) ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [vehicleId])

  const sourceLabel = (source: string): string => {
    const map: Record<string, string> = {
      manual: t.vehicles.sourceManual,
      gps: t.vehicles.sourceGps,
      obd: t.vehicles.sourceObd,
      import: t.vehicles.sourceImport,
    }
    return map[source] ?? source
  }

  const sourceBadgeClass = (source: string): string => {
    const map: Record<string, string> = {
      manual: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
      gps: "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
      obd: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
      import: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    }
    return map[source] ?? "bg-gray-500/15 text-gray-600 dark:text-gray-400"
  }

  if (loading) return <TabLoading />
  if (logs.length === 0) return <EmptyState message={t.vehicles.noOdometerLogs} />

  return (
    <div className="space-y-0">
      {logs.map((log, i) => {
        const prev = logs[i + 1] // next in time (array is desc)
        const delta = prev ? log.reading - prev.reading : null
        return (
          <div key={log.id} className="relative flex gap-4">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/50 border border-border/50">
                <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              {i < logs.length - 1 && <div className="w-px flex-1 bg-border/50 my-1" />}
            </div>
            <div className="flex-1 pb-4">
              <div className="rounded-xl border border-border/50 bg-card/60 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {log.reading.toLocaleString()} {odometerUnit}
                    </span>
                    {delta != null && delta !== 0 && (
                      <span className={`ml-2 text-xs font-medium ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {delta > 0 ? "+" : ""}{delta.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={sourceBadgeClass(log.source)}>
                      {sourceLabel(log.source)}
                    </Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(log.recorded_at).toLocaleString(undefined, {
                        year: "numeric", month: "short", day: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                {log.notes && (
                  <p className="mt-1.5 text-xs text-muted-foreground">{log.notes}</p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
