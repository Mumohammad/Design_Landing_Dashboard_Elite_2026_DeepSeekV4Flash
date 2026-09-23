"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import { Car, ExternalLink, Loader2, Unlink } from "lucide-react"

type CurrentAssignment = {
  id: string
  vehicle_id: string
  assigned_at: string | null
  assignment_reason: string | null
  vehicles: { id: string; plate_number: string | null; make: string | null; model: string | null } | null
}

type VehicleOption = {
  id: string
  vehicle_code: string | null
  plate_number: string | null
  make: string | null
  model: string | null
}

/** Current vehicle + plate for the driver profile Overview tab, with assign/unassign. */
export function VehicleAssignmentCard({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [assignment, setAssignment] = useState<CurrentAssignment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [vehicleId, setVehicleId] = useState<string>("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [unassigning, setUnassigning] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("vehicle_assignments")
      .select(
        "id, vehicle_id, assigned_at, assignment_reason, vehicles(plate_number, make, model)",
      )
      .eq("driver_id", driverId)
      .eq("is_current", true)
      .is("deleted_at", null)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    setAssignment((data as CurrentAssignment | null) ?? null)
    setIsLoading(false)
  }, [driverId])

  useEffect(() => {
    void load()
  }, [load])

  const openAssignDialog = async () => {
    setVehicleId("")
    setReason("")
    setDialogOpen(true)
    const { data } = await createClient()
      .from("vehicles")
      .select("id, vehicle_code, plate_number, make, model")
      .eq("status", "available")
      .is("deleted_at", null)
      .order("vehicle_code", { ascending: true })
      .limit(100)
    setVehicles((data as VehicleOption[]) ?? [])
  }

  const tenantId = async (): Promise<string> => {
    const {
      data: { session },
    } = await createClient().auth.getSession()
    return (session?.user?.user_metadata?.tenant_id as string | undefined) ?? ""
  }

  const assign = async () => {
    if (saving || !vehicleId) return
    setSaving(true)
    try {
      const supabase = createClient()
      const tid = await tenantId()
      if (!tid) throw new Error(isAr ? "لم يتم تحديد المستأجر" : "Tenant not resolved")
      const { error } = await supabase.from("vehicle_assignments").insert({
        tenant_id: tid,
        vehicle_id: vehicleId,
        driver_id: driverId,
        is_current: true,
        assignment_reason: reason.trim() || null,
      })
      if (error) throw error
      const { error: drvError } = await supabase
        .from("drivers")
        .update({ current_vehicle_id: vehicleId })
        .eq("id", driverId)
      if (drvError) throw drvError
      toast.success(isAr ? "تم تعيين المركبة" : "Vehicle assigned")
      setDialogOpen(false)
      await load()
      emitDriverChanged({ driverId, action: "assignment" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign vehicle")
    } finally {
      setSaving(false)
    }
  }

  const unassign = async () => {
    if (unassigning || !assignment) return
    setUnassigning(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from("vehicle_assignments")
        .update({ is_current: false, unassigned_at: new Date().toISOString() })
        .eq("id", assignment.id)
      if (error) throw error
      const { error: drvError } = await supabase
        .from("drivers")
        .update({ current_vehicle_id: null })
        .eq("id", driverId)
      if (drvError) throw drvError
      toast.success(isAr ? "تم إلغاء التعيين" : "Vehicle unassigned")
      await load()
      emitDriverChanged({ driverId, action: "assignment" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unassign vehicle")
    } finally {
      setUnassigning(false)
    }
  }

  if (isLoading) {
    return <Skeleton className="h-40 rounded-2xl lg:col-span-2" />
  }

  const v = assignment?.vehicles

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm lg:col-span-2">
      <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
        <Car className="h-4 w-4 text-elite-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">
          {isAr ? "المركبة الحالية" : "Current Vehicle"}
        </h3>
      </div>

      {assignment && v ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm font-semibold text-foreground">
              {[v.make, v.model].filter(Boolean).join(" ") || "—"}
            </span>
            {v.plate_number && (
              <span
                className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-xs text-foreground"
                dir="ltr"
              >
                {v.plate_number}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {assignment.assigned_at
                ? `${isAr ? "منذ" : "since"} ${assignment.assigned_at.slice(0, 10)}`
                : ""}
            </span>
            <Link
              href={`/vehicles/${v.id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-400"
            >
              {isAr ? "فتح سجل المركبة" : "Open vehicle record"}
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
            {isAr ? "لا توجد مركبة معيّنة حالياً" : "No vehicle assigned currently"}
          </p>
          <Button size="sm" className="gap-1.5" onClick={() => void openAssignDialog()}>
            <Car className="h-3.5 w-3.5" />
            {isAr ? "تعيين مركبة" : "Assign vehicle"}
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? "تعيين مركبة للسائق" : "Assign a vehicle"}</DialogTitle>
            <DialogDescription>
              {isAr
                ? "اختر مركبة متاحة لتعيينها لهذا السائق."
                : "Pick an available vehicle to assign to this driver."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assign-vehicle">{isAr ? "المركبة" : "Vehicle"}</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger id="assign-vehicle">
                  <SelectValue
                    placeholder={
                      vehicles.length === 0
                        ? isAr
                          ? "لا توجد مركبات متاحة"
                          : "No available vehicles"
                        : isAr
                          ? "اختر مركبة"
                          : "Select vehicle"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {[v.make, v.model].filter(Boolean).join(" ")}
                      {v.plate_number ? ` · ${v.plate_number}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assign-reason">{isAr ? "السبب (اختياري)" : "Reason (optional)"}</Label>
              <Input
                id="assign-reason"
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
            <Button onClick={() => void assign()} disabled={saving || !vehicleId}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Car className="h-4 w-4" />}
              {isAr ? "تعيين" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
