"use server"

// Server Actions for the Drivers module (Module 1).
//
// - createDriver  — drivers:create → inserts a driver record + audit entry
//
// Authorization is enforced server-side with requirePermission(); RLS on the
// drivers table remains the data boundary. Writes go through the service-role
// admin client so tenant/actor columns are set explicitly.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitDrivers } from "@/lib/auth/rate-limit"
import { driverCreateSchema, type DriverCreateInput } from "@/types/drivers"
import { emit } from "@/lib/webhooks/events"

export type ActionResult = { success: boolean; error?: string; id?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

/**
 * Generate a short unique driver code when the user leaves the field empty.
 * The DB also enforces tenant-unique (driver_code) via a partial unique index.
 */
function generateDriverCode(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `DRV-${rand}`
}

/**
 * Create a new driver record for the current tenant.
 * GM / drivers:create only. Validates with the canonical driverCreateSchema
 * (Saudi mobile, iqama, IBAN, contract-date refines) and writes an audit row.
 */
export async function createDriver(input: DriverCreateInput): Promise<ActionResult> {
  try {
    await requirePermission("drivers", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Not authenticated." }
    }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    // Server-side re-validation — never trust the client.
    const parsed = driverCreateSchema.parse(input)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("drivers")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        driver_code: parsed.driver_code?.trim() || generateDriverCode(),
        full_name_ar: parsed.full_name_ar.trim(),
        full_name_en: parsed.full_name_en?.trim() || null,
        preferred_name: parsed.preferred_name?.trim() || null,
        nationality: parsed.nationality?.trim() || null,
        nationality_code: parsed.nationality_code?.trim().toUpperCase() || null,
        date_of_birth: parsed.date_of_birth || null,
        gender: parsed.gender?.trim() || null,
        iqama_number: parsed.iqama_number?.trim() || null,
        iqama_issue_date: parsed.iqama_issue_date || null,
        iqama_expiry_date: parsed.iqama_expiry_date || null,
        passport_number: parsed.passport_number?.trim() || null,
        passport_expiry_date: parsed.passport_expiry_date || null,
        license_number: parsed.license_number?.trim() || null,
        license_type: parsed.license_type?.trim() || null,
        license_expiry_date: parsed.license_expiry_date || null,
        primary_mobile: parsed.primary_mobile.trim(),
        secondary_mobile: parsed.secondary_mobile?.trim() || null,
        personal_email: parsed.personal_email?.trim().toLowerCase() || null,
        work_email: parsed.work_email?.trim().toLowerCase() || null,
        current_city: parsed.current_city?.trim() || null,
        current_region: parsed.current_region?.trim() || null,
        category: parsed.category,
        employment_type: parsed.employment_type ?? null,
        contract_type: parsed.contract_type ?? null,
        status: parsed.status,
        job_title: parsed.job_title?.trim() || null,
        department: parsed.department?.trim() || null,
        hire_date: parsed.hire_date || null,
        contract_start: parsed.contract_start || null,
        contract_end: parsed.contract_end || null,
        basic_salary: parsed.basic_salary ?? null,
        housing_allowance: parsed.housing_allowance ?? null,
        transport_allowance: parsed.transport_allowance ?? null,
        bank_name: parsed.bank_name?.trim() || null,
        iban: parsed.iban?.replace(/\s/g, "").toUpperCase() || null,
        internal_notes: parsed.internal_notes?.trim() || null,
      })
      .select("id")
      .single()

    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "drivers",
      action: "created",
      entityType: "driver",
      entityId: data.id,
      newValues: {
        driver_code: parsed.driver_code?.trim() || null,
        full_name_ar: parsed.full_name_ar.trim(),
        full_name_en: parsed.full_name_en?.trim() || null,
        category: parsed.category,
        status: parsed.status,
        primary_mobile: parsed.primary_mobile.trim(),
      },
    })

    emit("driver.created", currentUser.tenantId, {
      id: data.id,
      name: parsed.full_name_ar.trim(),
      code: parsed.driver_code?.trim() || "",
      status: parsed.status,
    })

    revalidatePath("/drivers")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
