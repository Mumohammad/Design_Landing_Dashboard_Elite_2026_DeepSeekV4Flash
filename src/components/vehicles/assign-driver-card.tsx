"use client"

// Vehicle-side current-driver card (Prompt F Part 1) — the mirror of the
// drivers profile's VehicleAssignmentCard. Reads the CURRENT assignment +
// deep-links into the drivers profile; assign/unassign go through the SHARED
// server actions (src/lib/vehicles/assignments.ts) — no duplicated write path.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  assignVehicleToDriver,
  unassignVehicleFromDriver,
} from "@/lib/vehicles/assignments"
import { Car, ExternalLink, Loader2, Unlink, UserCheck } from "lucide-react"

type CurrentAssignment = {
  id: string
  driver_id: string
  assigned_at: string | null
  assignment_reason: string | null
  drivers: {
    full_name_ar: string | null
    full_name_en: string | null
    driver_code: string | null
    status: string | null
  } | null
}

type DriverOption = {
  id: string
  full_name_ar: string | null
  full_name_en: string | null
  driver_code: string | null
  status: string
}

export function AssignDriverCard({
  vehicleId,
  vehicleStatus,
  isAr,
}: {
  vehicleId: string
  vehicleStatus: string
  isAr: boolean
}) {
  const [assignment, setAssignment] = useState<CurrentAssignment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [driverId, setDriverId] = useState<string>("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [unassigning, setUnassigning] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("vehicle_assignments")
      .select(
        "id, driver_id, assigned_at, assignment_reason, drivers(full_name_ar, full_name_en, driver_code, status)",
      )
      .eq("vehicle_id", vehicleId)
      .eq("is_current", true)
      .is("deleted_at", null)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    setAssignment((data as unknown as CurrentAssignment | null) ?? null)
    setIsLoading(false)
  }, [vehicleId])

  useEffect(() => {
    // Defer to a task boundary so the compiler does not trace the initial
    // setState (loading flag) as a synchronous write inside the effect body
    // (same pattern as the drivers list page).
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const openAssignDialog = async () => {
    setDriverId("")
    setReason("")
    setDialogOpen(true)
    // Employable drivers only — the shared action enforces the same guard
    // server-side; this keeps the picker honest.
    const { data } = await createClient()
      .from("drivers")
      .select("id, full_name_ar, full_name_en, driver_code, status")
      .in("status", ["active", "on_leave"])
      .is("deleted_at", null)
      .is("current_vehicle_id", null)
      .order("driver_code", { ascending: true })
      .limit(100)
    setDrivers((data as DriverOption[]) ?? [])
  }

  const assign = async () => {
    if (saving || !driverId) return
    setSaving(true)
    const res = await assignVehicleToDriver({
      vehicleId,
      driverId,
      assignment_reason: reason.trim() || null,
    })
    setSaving(false)
    if (res.success) {
      toast.success(isAr ? "تم تعيين السائق للمركبة" : "Driver assigned to vehicle")
      setDialogOpen(false)
      await load()
    } else {
      toast.error(res.error ?? "Failed to assign driver")
    }
  }

  const unassign = async () => {
    if (unassigning || !assignment) return
    setUnassigning(true)
    const res = await unassignVehicleFromDriver({
      vehicleId,
      driverId: assignment.driver_id,
    })
    setUnassigning(false)
    if (res.success) {
      toast.success(isAr ? "تم إلغاء تعيين السائق" : "Driver unassigned")
      await load()
    } else {
      toast.error(res.error ?? "Failed to unassign driver")
    }
  }

  if (isLoading) {
    return <Skeleton className="h-40 rounded-2xl lg:col-span-2" />
  }

  const d = assignment?.drivers
  const driverName = d?.full_name_ar ?? d?.full_name_en ?? d?.driver_code ?? "—"

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm lg:col-span-2">
      <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
        <UserCheck className="h-4 w-4 text-elite-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">
          {isAr ? "السائق الحالي" : "Current Driver"}
        </h3>
      </div>

      {assignment && d ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm font-semibold text-foreground">{driverName}</span>
            {d.driver_code && (
              <span className="font-mono text-xs text-muted-foreground">{d.driver_code}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {assignment.assigned_at
                ? `${isAr ? "منذ" : "since"} ${assignment.assigned_at.slice(0, 10)}`
                : ""}
            </span>
            <Link
              href={`/drivers/${assignment.driver_id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-400"
            >
              {isAr ? "فتح ملف السائق" : "Open driver profile"}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={unassigning}
            onClick={() => void unassign()}
          >
            {unassigning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Unlink className="h-3.5 w-3.5" />
            )}
            {isAr ? "إلغاء التعيين" : "Unassign"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {vehicleStatus === "available"
              ? isAr
                ? "لا يوجد سائق معيّن حالياً"
                : "No driver assigned currently"
              : isAr
                ? `لا يوجد سائق معيّن — حالة المركبة: ${vehicleStatus}`
                : `No driver assigned — vehicle status: ${vehicleStatus}`}
          </p>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void openAssignDialog()}
            disabled={vehicleStatus !== "available"}
            title={
              vehicleStatus !== "available"
                ? isAr
                  ? "المركبة غير متاحة للتعيين"
                  : "Vehicle is not available for assignment"
                : undefined
            }
          >
            <Car className="h-3.5 w-3.5" />
            {isAr ? "تعيين سائق" : "Assign driver"}
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "تعيين سائق للمركبة" : "Assign a driver"}</DialogTitle>
            <DialogDescription>
              {isAr
                ? "اختر سائقًا نشطًا بدون مركبة حالية لتعيينه لهذه المركبة."
                : "Pick an active driver without a current vehicle to assign to this one."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assign-driver">{isAr ? "السائق" : "Driver"}</Label>
              <select
                id="assign-driver"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className="flex h-10 w-full rounded-xl border border-border/50 bg-muted/20 px-3 text-sm"
              >
                <option value="">
                  {drivers.length === 0
                    ? isAr
                      ? "لا يوجد سائقون متاحون"
                      : "No available drivers"
                    : isAr
                      ? "اختر سائقًا"
                      : "Select driver"}
                </option>
                {drivers.map((dr) => (
                  <option key={dr.id} value={dr.id}>
                    {(dr.full_name_ar ?? dr.full_name_en ?? dr.driver_code ?? dr.id) +
                      (dr.driver_code ? ` · ${dr.driver_code}` : "")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assign-reason-veh">
                {isAr ? "السبب (اختياري)" : "Reason (optional)"}
              </Label>
              <Input
                id="assign-reason-veh"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={isAr ? "مثال: تعيين تشغيلي" : "e.g. operational assignment"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={() => void assign()} disabled={saving || !driverId}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Car className="h-4 w-4" />}
              {isAr ? "تعيين" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
