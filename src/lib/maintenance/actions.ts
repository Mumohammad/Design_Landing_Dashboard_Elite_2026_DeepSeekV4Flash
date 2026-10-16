"use server"

// Server Actions for the Maintenance module (Module 2 — fleet maintenance).
//
// Surfaces the existing `vehicle_maintenance_events` +
// `vehicle_odometer_logs` tables (migrations 016/017) — no schema changes.
//
//   * createMaintenanceEvent       — maintenance:create
//   * updateMaintenanceEvent       — maintenance:update (edit while open)
//   * startMaintenanceEvent        — maintenance:update (open → in_progress)
//   * completeMaintenanceEvent     — maintenance:update (+ vehicle release)
//   * cancelMaintenanceEvent       — maintenance:update (mandatory reason)
//   * addOdometerReading           — maintenance:create (odometer log)
//   * exportMaintenanceCsv         — maintenance:export (BOM CSV)
//
// Every mutation: permission gate + tenant scope from server only + zod +
// audit row + revalidation; cross-surface effects emit driver events.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitVehicles } from "@/lib/auth/rate-limit"
import { toCsv } from "@/lib/accounting/csv-utils"
import { emit } from "@/lib/webhooks/events"
import {
  maintenanceEventCancelSchema,
  maintenanceEventCompleteSchema,
  maintenanceEventCreateSchema,
  maintenanceEventUpdateSchema,
  odometerLogCreateSchema,
  type MaintenanceEventCreateInput,
  type MaintenanceEventUpdateInput,
  type MaintenanceEventCompleteInput,
  type MaintenanceEventCancelInput,
  type OdometerLogCreateInput,
} from "@/types/maintenance"
import {
  isEventTransitionAllowed,
  vehicleReleaseTarget,
} from "./module-utils"

export type MaintenanceActionResult = { success: boolean; error?: string; id?: string }
export type MaintenanceExportResult = { success: boolean; csv?: string; error?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

// ── Shared vehicle release (complete/cancel of an in_maintenance vehicle) ──

/**
 * Release a vehicle that an event set to `in_maintenance` back to its
 * assignment-state-derived target. Composes the assignments semantics:
 *  - a live (is_current) vehicle_assignments row ⇒ `assigned`
 *  - otherwise ⇒ `available`
 * The conditional UPDATE re-checks the current status in the predicate so a
 * concurrent reassignment/maintenance claim cannot be clobbered.
 */
async function releaseVehicleFromMaintenance(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  vehicleId: string,
  actorAuthId: string
): Promise<void> {
  const { data: vehicle } = await admin
    .from("vehicles")
    .select("id, status, current_driver_id")
    .eq("id", vehicleId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle()
  if (!vehicle || vehicle.status !== "in_maintenance") return // nothing this module owns — never clobber off_road/retired

  const { data: assignment } = await admin
    .from("vehicle_assignments")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("tenant_id", tenantId)
    .eq("is_current", true)
    .is("deleted_at", null)
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const target = vehicleReleaseTarget(Boolean(assignment))

  const { data: released } = await admin
    .from("vehicles")
    .update({ status: target, updated_by: actorAuthId })
    // Conditional claim: only flips when the vehicle is still in_maintenance.
    .eq("id", vehicleId)
    .eq("tenant_id", tenantId)
    .eq("status", "in_maintenance")
    .select("id")
  void released
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createMaintenanceEvent(
  input: MaintenanceEventCreateInput
): Promise<MaintenanceActionResult> {
  try {
    await requirePermission("maintenance", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = maintenanceEventCreateSchema.parse(input)

    const admin = createAdminClient()

    // Vehicle must exist in the caller's tenant (server-side scope).
    const { data: vehicle } = await admin
      .from("vehicles")
      .select("id, plate_number, status")
      .eq("id", parsed.vehicle_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!vehicle) return { success: false, error: "Vehicle not found in your tenant." }

    // Reported-by driver (optional) must be a tenant driver.
    if (parsed.reported_by_driver_id) {
      const { data: driver } = await admin
        .from("drivers")
        .select("id, full_name_ar")
        .eq("id", parsed.reported_by_driver_id)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .maybeSingle()
      if (!driver) return { success: false, error: "Reported-by driver not found in your tenant." }
    }

    // Latest odometer reading from the log (pre-filled by the UI, re-checked
    // here server-side; the explicit reading wins when provided).
    const { data: lastOdo } = await admin
      .from("vehicle_odometer_logs")
      .select("reading")
      .eq("vehicle_id", parsed.vehicle_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const nowIso = new Date().toISOString()
    const { data, error } = await admin
      .from("vehicle_maintenance_events")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        vehicle_id: parsed.vehicle_id,
        maintenance_type: parsed.maintenance_type,
        reported_by_driver_id: parsed.reported_by_driver_id ?? null,
        reported_at: nowIso,
        fault_description: parsed.fault_description,
        provider: parsed.provider?.trim() || null,
        cost: parsed.cost ?? null,
        parts_replaced: parsed.parts_replaced?.trim() || null,
        odometer_at_service: parsed.odometer_at_service ?? lastOdo?.reading ?? null,
        date_in: parsed.date_in?.trim() || nowIso,
        status: "open",
        next_service_km: parsed.next_service_km ?? null,
        next_service_date: parsed.next_service_date?.trim() || null,
        notes: parsed.notes?.trim() || null,
      })
      .select("id")
      .single()

    if (error) return { success: false, error: error.message }
    const eventId = data.id

    // Auto-log the odometer reading at event creation (Prompt O Part 1).
    const odoReading = parsed.odometer_at_service ?? lastOdo?.reading ?? null
    if (odoReading !== null) {
      await admin.from("vehicle_odometer_logs").insert({
        tenant_id: currentUser.tenantId,
        vehicle_id: parsed.vehicle_id,
        reading: odoReading,
        recorded_at: nowIso,
        recorded_by: currentUser.authUserId,
        source: "manual",
        notes: `Auto-logged at maintenance event creation (${parsed.maintenance_type})`,
      })
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "maintenance",
      action: "maintenance_event_created",
      entityType: "vehicle_maintenance_event",
      entityId: eventId,
      newValues: {
        vehicle_id: parsed.vehicle_id,
        plate_number: vehicle.plate_number,
        maintenance_type: parsed.maintenance_type,
        status: "open",
        odometer_at_service: odoReading,
      },
    })

    // Cross-surface: the reported driver is affected.
    if (parsed.reported_by_driver_id) {
      emit("driver.updated", currentUser.tenantId, {
        id: parsed.reported_by_driver_id,
        name: "",
        changes: { maintenance_event_id: eventId, role: "reported_by" },
      })
    }

    revalidatePath("/maintenance")
    revalidatePath("/vehicles")
    return { success: true, id: eventId }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Edit while open ─────────────────────────────────────────────────────────

export async function updateMaintenanceEvent(
  input: MaintenanceEventUpdateInput
): Promise<MaintenanceActionResult> {
  try {
    await requirePermission("maintenance", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = maintenanceEventUpdateSchema.parse(input)
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from("vehicle_maintenance_events")
      .select("id, status")
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!existing) return { success: false, error: "Maintenance event not found." }
    if (existing.status !== "open") {
      return { success: false, error: "Only open events can be edited — complete or cancel instead." }
    }

    const { data, error } = await admin
      .from("vehicle_maintenance_events")
      .update({
        maintenance_type: parsed.maintenance_type,
        fault_description: parsed.fault_description,
        provider: parsed.provider?.trim() || null,
        cost: parsed.cost ?? null,
        parts_replaced: parsed.parts_replaced?.trim() || null,
        next_service_km: parsed.next_service_km ?? null,
        next_service_date: parsed.next_service_date?.trim() || null,
        notes: parsed.notes?.trim() || null,
        updated_by: currentUser.authUserId,
      })
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "open") // conditional UPDATE — a concurrently-completed event loses the race
      .is("deleted_at", null)
      .select("id")
      .single()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Event is no longer open." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "maintenance",
      action: "maintenance_event_updated",
      entityType: "vehicle_maintenance_event",
      entityId: parsed.id,
      newValues: {
        maintenance_type: parsed.maintenance_type,
        fault_description: parsed.fault_description,
        provider: parsed.provider?.trim() || null,
      },
    })

    revalidatePath("/maintenance")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Start (open → in_progress) ──────────────────────────────────────────────

export async function startMaintenanceEvent(id: string): Promise<MaintenanceActionResult> {
  try {
    await requirePermission("maintenance", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsedId = z.string().uuid().parse(id)
    const admin = createAdminClient()

    // Load the event (tenant-scoped) so the vehicle flip targets the right row.
    const { data: existing } = await admin
      .from("vehicle_maintenance_events")
      .select("id, status, vehicle_id")
      .eq("id", parsedId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!existing) return { success: false, error: "Maintenance event not found." }
    if (!isEventTransitionAllowed(existing.status as "open", "in_progress")) {
      return { success: false, error: `A ${existing.status} event cannot be started.` }
    }

    const { data, error } = await admin
      .from("vehicle_maintenance_events")
      .update({ status: "in_progress", updated_by: currentUser.authUserId })
      .eq("id", parsedId)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "open") // conditional claim — 0 rows ⇒ already started/closed
      .is("deleted_at", null)
      .select("id, vehicle_id")
      .single()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Event is no longer open." }

    // Flip the vehicle now that the event is claimed (authoritative).
    if (data.vehicle_id) {
      await admin
        .from("vehicles")
        .update({ status: "in_maintenance", updated_by: currentUser.authUserId })
        .eq("id", data.vehicle_id)
        .eq("tenant_id", currentUser.tenantId)
        .in("status", ["available", "assigned"])
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "maintenance",
      action: "maintenance_event_started",
      entityType: "vehicle_maintenance_event",
      entityId: parsedId,
      newValues: { from: "open", to: "in_progress" },
    })

    revalidatePath("/maintenance")
    revalidatePath("/vehicles")
    return { success: true, id: parsedId }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Complete ────────────────────────────────────────────────────────────────

export async function completeMaintenanceEvent(
  input: MaintenanceEventCompleteInput
): Promise<MaintenanceActionResult> {
  try {
    await requirePermission("maintenance", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = maintenanceEventCompleteSchema.parse(input)
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from("vehicle_maintenance_events")
      .select("id, status, vehicle_id, date_in")
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!existing) return { success: false, error: "Maintenance event not found." }
    if (!isEventTransitionAllowed(existing.status as "open" | "in_progress", "completed")) {
      return { success: false, error: `A ${existing.status} event cannot be completed.` }
    }

    const nowIso = new Date().toISOString()
    const { data, error } = await admin
      .from("vehicle_maintenance_events")
      .update({
        status: "completed",
        cost: parsed.cost,
        date_out: parsed.date_out?.trim() || nowIso,
        odometer_at_service: parsed.odometer_at_service ?? null,
        parts_replaced: parsed.parts_replaced?.trim() || null,
        notes: parsed.notes?.trim() || null,
        updated_by: currentUser.authUserId,
      })
      // Conditional claim on the live status — race-safe completion.
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .in("status", ["open", "in_progress"])
      .is("deleted_at", null)
      .select("id, vehicle_id")
      .single()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Event was already completed or cancelled." }
    const eventId = data.id

    // Persist the exit odometer as a log reading too.
    if (data.vehicle_id && parsed.odometer_at_service != null) {
      await admin.from("vehicle_odometer_logs").insert({
        tenant_id: currentUser.tenantId,
        vehicle_id: data.vehicle_id,
        reading: parsed.odometer_at_service,
        recorded_at: nowIso,
        recorded_by: currentUser.authUserId,
        source: "manual",
        notes: "Recorded at maintenance completion",
      })
    }

    // Vehicle status sync (compose assignments semantics).
    if (data.vehicle_id) {
      await releaseVehicleFromMaintenance(admin, currentUser.tenantId, data.vehicle_id, currentUser.authUserId)
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "maintenance",
      action: "maintenance_event_completed",
      entityType: "vehicle_maintenance_event",
      entityId: eventId,
      newValues: {
        status: "completed",
        cost: parsed.cost,
        date_out: parsed.date_out?.trim() || nowIso,
        odometer_at_service: parsed.odometer_at_service ?? null,
      },
    })

    revalidatePath("/maintenance")
    revalidatePath("/vehicles")
    return { success: true, id: eventId }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Cancel (mandatory reason) ───────────────────────────────────────────────

export async function cancelMaintenanceEvent(
  input: MaintenanceEventCancelInput
): Promise<MaintenanceActionResult> {
  try {
    await requirePermission("maintenance", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = maintenanceEventCancelSchema.parse(input)
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from("vehicle_maintenance_events")
      .select("id, status, vehicle_id")
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!existing) return { success: false, error: "Maintenance event not found." }
    if (!isEventTransitionAllowed(existing.status as "open" | "in_progress", "cancelled")) {
      return { success: false, error: `A ${existing.status} event cannot be cancelled.` }
    }

    const { data, error } = await admin
      .from("vehicle_maintenance_events")
      .update({
        status: "cancelled",
        notes: `Cancelled: ${parsed.reason}`,
        updated_by: currentUser.authUserId,
      })
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .in("status", ["open", "in_progress"])
      .is("deleted_at", null)
      .select("id, vehicle_id, notes")
      .single()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Event was already completed or cancelled." }

    if (data.vehicle_id) {
      await releaseVehicleFromMaintenance(admin, currentUser.tenantId, data.vehicle_id, currentUser.authUserId)
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "maintenance",
      action: "maintenance_event_cancelled",
      entityType: "vehicle_maintenance_event",
      entityId: parsed.id,
      newValues: { status: "cancelled", reason: parsed.reason },
    })

    revalidatePath("/maintenance")
    revalidatePath("/vehicles")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Odometer log ────────────────────────────────────────────────────────────

export async function addOdometerReading(
  input: OdometerLogCreateInput
): Promise<MaintenanceActionResult> {
  try {
    await requirePermission("maintenance", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = odometerLogCreateSchema.parse(input)
    const admin = createAdminClient()

    const { data: vehicle } = await admin
      .from("vehicles")
      .select("id")
      .eq("id", parsed.vehicle_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!vehicle) return { success: false, error: "Vehicle not found in your tenant." }

    const { data, error } = await admin
      .from("vehicle_odometer_logs")
      .insert({
        tenant_id: currentUser.tenantId,
        vehicle_id: parsed.vehicle_id,
        reading: parsed.reading,
        recorded_at: parsed.recorded_at?.trim() || new Date().toISOString(),
        recorded_by: currentUser.authUserId,
        source: parsed.source ?? "manual",
        notes: parsed.notes?.trim() || null,
      })
      .select("id")
      .single()

    if (error) {
      // VEH003 — the odometer-regression trigger rejects backwards readings.
      if (error.message.includes("VEH003")) {
        return { success: false, error: "Odometer regression: the reading is lower than the highest recorded value." }
      }
      return { success: false, error: error.message }
    }

    // Mirror the reading onto vehicles.odometer_current (also VEH003-guarded).
    await admin
      .from("vehicles")
      .update({ odometer_current: parsed.reading, updated_by: currentUser.authUserId })
      .eq("id", parsed.vehicle_id)
      .eq("tenant_id", currentUser.tenantId)

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "maintenance",
      action: "odometer_reading_added",
      entityType: "vehicle_odometer_log",
      entityId: data.id,
      newValues: { vehicle_id: parsed.vehicle_id, reading: parsed.reading },
    })

    revalidatePath("/maintenance")
    revalidatePath("/vehicles")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── CSV export (RFC-4180 + UTF-8 BOM) ───────────────────────────────────────

type MaintenanceListRow = {
  id: string
  maintenance_type: string
  status: string
  reported_at: string
  fault_description: string | null
  provider: string | null
  cost: number | null
  parts_replaced: string | null
  odometer_at_service: number | null
  date_in: string | null
  date_out: string | null
  next_service_km: number | null
  next_service_date: string | null
  vehicle: { plate_number: string | null; make: string | null; model: string | null } | null
  driver: { full_name_ar: string | null; full_name_en: string | null } | null
}

export async function exportMaintenanceCsv(): Promise<MaintenanceExportResult> {
  try {
    await requirePermission("maintenance", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("vehicle_maintenance_events")
      .select(
        "id,maintenance_type,status,reported_at,fault_description,provider,cost,parts_replaced,odometer_at_service,date_in,date_out,next_service_km,next_service_date," +
          "vehicle:vehicles(plate_number,make,model),driver:drivers(full_name_ar,full_name_en)"
      )
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("reported_at", { ascending: false })
      .limit(10_000)
    if (error) return { success: false, error: error.message }

    const rows = (data as unknown as MaintenanceListRow[] | null) ?? []
    const csv =
      "\uFEFF" +
      toCsv(
        ["Reported At", "Vehicle Plate", "Make/Model", "Type", "Status", "Reported By", "Fault", "Provider", "Cost (SAR)", "Odometer", "Date In", "Date Out", "Next Service (km)", "Next Service Date", "Parts Replaced"],
        rows.map((r) => [
          r.reported_at?.slice(0, 10) ?? "",
          r.vehicle?.plate_number ?? "",
          `${r.vehicle?.make ?? ""} ${r.vehicle?.model ?? ""}`.trim(),
          r.maintenance_type,
          r.status,
          r.driver?.full_name_en ?? r.driver?.full_name_ar ?? "",
          r.fault_description ?? "",
          r.provider ?? "",
          r.cost != null ? Number(r.cost).toFixed(2) : "",
          r.odometer_at_service ?? "",
          r.date_in?.slice(0, 10) ?? "",
          r.date_out?.slice(0, 10) ?? "",
          r.next_service_km ?? "",
          r.next_service_date ?? "",
          r.parts_replaced ?? "",
        ])
      )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "maintenance",
      action: "maintenance_exported",
      entityType: "vehicle_maintenance_event",
      entityId: null,
      newValues: { rows: rows.length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
