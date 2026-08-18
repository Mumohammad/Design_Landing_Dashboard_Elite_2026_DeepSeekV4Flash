"use server"

// Server Actions for the Vehicles module (Module 2).
//
// - createVehicle — vehicles:create → inserts a vehicle record + audit entry
//
// Authorization is enforced server-side with requirePermission(); RLS on the
// vehicles table remains the data boundary. Writes go through the service-role
// admin client so tenant/actor columns are set explicitly.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { vehicleCreateSchema, type VehicleCreateInput } from "@/types/vehicles"

export type ActionResult = { success: boolean; error?: string; id?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

/**
 * Generate a short unique vehicle code when the user leaves the field empty.
 * The DB also enforces tenant-unique (vehicle_code) via a partial unique index.
 */
function generateVehicleCode(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `VEH-${rand}`
}

/**
 * Create a new vehicle record for the current tenant.
 * vehicles:create only. Validates with the canonical vehicleCreateSchema
 * (Saudi plate format, make/model required, year bounds) and writes an audit row.
 */
export async function createVehicle(input: VehicleCreateInput): Promise<ActionResult> {
  try {
    await requirePermission("vehicles", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Not authenticated." }
    }

    // Server-side re-validation — never trust the client.
    const parsed = vehicleCreateSchema.parse(input)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("vehicles")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        vehicle_code: parsed.vehicle_code?.trim() || generateVehicleCode(),
        plate_number: parsed.plate_number.trim(),
        plate_type: parsed.plate_type?.trim() || null,
        make: parsed.make.trim(),
        model: parsed.model.trim(),
        year: parsed.year ?? null,
        color: parsed.color?.trim() || null,
        chassis_number: parsed.chassis_number?.trim() || null,
        engine_number: parsed.engine_number?.trim() || null,
        vin: parsed.vin?.trim() || null,
        status: parsed.status ?? "available",
        condition_status: parsed.condition_status ?? "good",
        fuel_type: parsed.fuel_type ?? null,
        odometer_current: parsed.odometer_current ?? 0,
        odometer_last_service: parsed.odometer_last_service ?? null,
        odometer_unit: parsed.odometer_unit?.trim() || "km",
        purchase_date: parsed.purchase_date || null,
        warranty_expiry: parsed.warranty_expiry || null,
        insurance_expiry: parsed.insurance_expiry || null,
        insurance_provider: parsed.insurance_provider?.trim() || null,
        insurance_policy_number: parsed.insurance_policy_number?.trim() || null,
        inspection_expiry: parsed.inspection_expiry || null,
        registration_expiry: parsed.registration_expiry || null,
        operating_card_expiry: parsed.operating_card_expiry || null,
        current_driver_id: parsed.current_driver_id ?? null,
        primary_platform_id: parsed.primary_platform_id ?? null,
        transmission: parsed.transmission?.trim() || null,
        seats: parsed.seats ?? null,
        cargo_capacity: parsed.cargo_capacity ?? null,
        photo_url: parsed.photo_url?.trim() || null,
        notes: parsed.notes?.trim() || null,
        tags: parsed.tags && parsed.tags.length > 0 ? parsed.tags.map((s) => s.trim()) : null,
      })
      .select("id")
      .single()

    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "vehicles",
      action: "created",
      entityType: "vehicle",
      entityId: data.id,
      newValues: {
        vehicle_code: parsed.vehicle_code?.trim() || null,
        plate_number: parsed.plate_number.trim(),
        make: parsed.make.trim(),
        model: parsed.model.trim(),
        status: parsed.status ?? "available",
      },
    })

    revalidatePath("/vehicles")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
