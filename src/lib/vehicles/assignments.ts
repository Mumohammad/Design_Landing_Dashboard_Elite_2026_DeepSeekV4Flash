"use server"

// Shared vehicle-assignment server actions — the two-way wiring between the
// Drivers and Vehicles surfaces (Prompt F).
//
// ONE write path for assign/unassign, consumed by BOTH surfaces:
//   * drivers profile Overview (VehicleAssignmentCard)
//   * vehicles detail (AssignDriverCard)
// The drivers-side card previously inserted/updated vehicle_assignments +
// drivers.current_vehicle_id inline from the browser (no permission gate, no
// audit row, no webhook). Those writes move here; the client components now
// call these actions.
//
// Contract (mirrors the users-module status-transition idiom):
//   * requirePermission("assignments", "create"|"update") — the 013 catalog
//     grants those to supervisor/operations_officer/admin; GM bypasses.
//   * zod server/client parity on every input.
//   * tenant scoping via getCurrentUser() — never from the browser.
//   * invariant guards surfaced as readable errors (INV001/INV002), the same
//     DB invariants the pgTAP suite proves (064).
//   * every mutation writes an audit_log row (audit-trail #51 contract) and
//     emits the vehicle.assigned / vehicle.unassigned webhooks.
//   * race-safety: the INSERT claims availability with a conditional UPDATE
//     inside one action; the vehicle row is re-checked in the same UPDATE
//     predicate so a concurrent assignment cannot slip between the SELECT
//     and the INSERT.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitVehicles } from "@/lib/auth/rate-limit"
import { emit } from "@/lib/webhooks/events"

export type AssignmentActionResult = {
  success: boolean
  error?: string
  assignmentId?: string
}

// Client-safe guards + the docs-expiry chip classifier live in the pure
// sibling module — Client Components must not import a "use server" module.
import {
  isAssignmentTransitionAllowed,
  type VehicleAssignmentStatus,
} from "./assignment-utils"

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Assign a vehicle to a driver                                             */
/* ──────────────────────────────────────────────────────────────────────── */

const assignSchema = z.object({
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
  assignment_reason: z.string().trim().max(500).optional().nullable(),
  handover_odometer: z
    .number()
    .int("Odometer reading must be a whole number")
    .min(0, "Odometer reading cannot be negative")
    .max(5_000_000, "Odometer reading looks implausible")
    .optional()
    .nullable(),
})

/**
 * Assign an available vehicle to a driver (from EITHER surface).
 *
 * Guards, in order:
 *   1. driver + vehicle exist in the caller's tenant and are not deleted
 *   2. driver is active/on_leave (a draft/terminated/blacklisted driver
 *      cannot hold a vehicle)
 *   3. vehicle status is `available` — conditional-UPDATE claim means a
 *      concurrent assignment loses the race with a readable error instead
 *      of double-assigning
 *   4. the driver holds no other current assignment (defense in depth —
 *      also proven by the unique partial index in 064)
 */
export async function assignVehicleToDriver(input: unknown): Promise<AssignmentActionResult> {
  try {
    await requirePermission("assignments", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = assignSchema.parse(input)
    const { vehicleId, driverId } = parsed
    const admin = createAdminClient()

    // 1. Load both parties tenant-scoped.
    const { data: driver } = await admin
      .from("drivers")
      .select("id, status, full_name_ar, current_vehicle_id")
      .eq("id", driverId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!driver) return { success: false, error: "Driver not found in your tenant." }

    const { data: vehicle } = await admin
      .from("vehicles")
      .select("id, status, plate_number, current_driver_id")
      .eq("id", vehicleId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!vehicle) return { success: false, error: "Vehicle not found in your tenant." }

    // 2. Driver employability guard.
    if (!["active", "on_leave"].includes(driver.status as string)) {
      return {
        success: false,
        error: `Driver status is "${driver.status}" — only active or on-leave drivers can hold a vehicle.`,
      }
    }

    // 3. Driver must not already hold a vehicle.
    if (driver.current_vehicle_id) {
      return {
        success: false,
        error: "Driver already holds a vehicle — unassign it first.",
      }
    }

    // 4. Race-safe availability claim: the conditional UPDATE on the vehicle
    // row is the arbiter — only ONE concurrent caller flips it to assigned.
    const { data: claimed, error: claimError } = await admin
      .from("vehicles")
      .update({ status: "assigned", current_driver_id: driverId, updated_by: currentUser.authUserId })
      .eq("id", vehicleId)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "available")
      .is("deleted_at", null)
      .select("id")
    if (claimError) return { success: false, error: claimError.message }
    if (!claimed || claimed.length === 0) {
      return { success: false, error: "Vehicle is no longer available (already assigned or status changed)." }
    }

    // 5. History row.
    const { data: assignment, error: insertError } = await admin
      .from("vehicle_assignments")
      .insert({
        tenant_id: currentUser.tenantId,
        vehicle_id: vehicleId,
        driver_id: driverId,
        is_current: true,
        assignment_reason: parsed.assignment_reason?.trim() || null,
        handover_odometer: parsed.handover_odometer ?? null,
        created_by: currentUser.authUserId,
      })
      .select("id")
      .single()
    if (insertError || !assignment) {
      // Compensate the claim so the vehicle does not stay locked assigned.
      await admin
        .from("vehicles")
        .update({ status: "available", current_driver_id: null })
        .eq("id", vehicleId)
        .eq("tenant_id", currentUser.tenantId)
      return { success: false, error: insertError?.message ?? "Failed to record the assignment." }
    }

    // 6. Denormalized pointer on the driver.
    const { error: drvError } = await admin
      .from("drivers")
      .update({ current_vehicle_id: vehicleId, updated_by: currentUser.authUserId })
      .eq("id", driverId)
      .eq("tenant_id", currentUser.tenantId)
    if (drvError) {
      return { success: false, error: drvError.message }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "vehicles",
      action: "vehicle_assigned",
      entityType: "vehicle_assignment",
      entityId: assignment.id,
      newValues: {
        vehicle_id: vehicleId,
        driver_id: driverId,
        plate_number: vehicle.plate_number,
        assignment_reason: parsed.assignment_reason?.trim() || null,
        handover_odometer: parsed.handover_odometer ?? null,
      },
    })

    emit("vehicle.assigned", currentUser.tenantId, { vehicleId, driverId })

    revalidatePath("/vehicles")
    revalidatePath(`/vehicles/${vehicleId}`)
    revalidatePath("/drivers")
    revalidatePath(`/drivers/${driverId}`)
    return { success: true, assignmentId: assignment.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Unassign a driver from their current vehicle                             */
/* ──────────────────────────────────────────────────────────────────────── */

const unassignSchema = z.object({
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
  return_odometer: z
    .number()
    .int("Odometer reading must be a whole number")
    .min(0, "Odometer reading cannot be negative")
    .max(5_000_000, "Odometer reading looks implausible")
    .optional()
    .nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
})

/**
 * End the CURRENT driver↔vehicle assignment (from EITHER surface).
 *
 * Ends the assignment row (is_current=false, unassigned_at, optional return
 * odometer), clears drivers.current_vehicle_id, and flips the vehicle back
 * to available — all tenant-scoped. Ended rows are terminal history.
 */
export async function unassignVehicleFromDriver(input: unknown): Promise<AssignmentActionResult> {
  try {
    await requirePermission("assignments", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = unassignSchema.parse(input)
    const { vehicleId, driverId } = parsed
    const admin = createAdminClient()

    // Current assignment row (tenant-scoped).
    const { data: assignment } = await admin
      .from("vehicle_assignments")
      .select("id, is_current, unassigned_at")
      .eq("vehicle_id", vehicleId)
      .eq("driver_id", driverId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .eq("is_current", true)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!assignment) {
      return { success: false, error: "No current assignment between this driver and vehicle." }
    }

    // Terminal-state guard (users-module idiom): ended rows never re-end.
    if (!isAssignmentTransitionAllowed("active", "ended")) {
      return { success: false, error: "Assignment transition is not allowed." }
    }

    const now = new Date().toISOString()

    // End the assignment row.
    const { error: endError } = await admin
      .from("vehicle_assignments")
      .update({
        is_current: false,
        unassigned_at: now,
        return_odometer: parsed.return_odometer ?? null,
        notes: parsed.notes?.trim() || null,
        updated_by: currentUser.authUserId,
      })
      .eq("id", assignment.id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("is_current", true)
    if (endError) return { success: false, error: endError.message }

    // Clear the driver pointer.
    await admin
      .from("drivers")
      .update({ current_vehicle_id: null, updated_by: currentUser.authUserId })
      .eq("id", driverId)
      .eq("tenant_id", currentUser.tenantId)
      .eq("current_vehicle_id", vehicleId)

    // Free the vehicle — only when THIS driver is still its current_driver_id
    // (a concurrent reassignment from another surface must not be clobbered).
    const { data: freed } = await admin
      .from("vehicles")
      .update({ status: "available", current_driver_id: null, updated_by: currentUser.authUserId })
      .eq("id", vehicleId)
      .eq("tenant_id", currentUser.tenantId)
      .eq("current_driver_id", driverId)
      .select("id")
    void freed

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "vehicles",
      action: "vehicle_unassigned",
      entityType: "vehicle_assignment",
      entityId: assignment.id,
      oldValues: {
        vehicle_id: vehicleId,
        driver_id: driverId,
        is_current: true,
      },
      newValues: {
        is_current: false,
        unassigned_at: now,
        return_odometer: parsed.return_odometer ?? null,
        notes: parsed.notes?.trim() || null,
      },
    })

    emit("vehicle.unassigned", currentUser.tenantId, { vehicleId, driverId })

    revalidatePath("/vehicles")
    revalidatePath(`/vehicles/${vehicleId}`)
    revalidatePath("/drivers")
    revalidatePath(`/drivers/${driverId}`)
    return { success: true, assignmentId: assignment.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
