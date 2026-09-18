"use server"

// Server Actions for the Drivers module (Module 1).
//
// - createDriver      — drivers:create → inserts a driver record + audit entry
// - updateDriver      — drivers:update → edits profile fields + audit entry
// - setDriverStatus   — drivers:update → lifecycle transitions with reason + audit
// - archiveDriver     — drivers:delete → soft delete (archived) + audit entry
//
// Authorization is enforced server-side with requirePermission(); RLS on the
// drivers table remains the data boundary. Writes go through the service-role
// admin client so tenant/actor columns are set explicitly.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitDrivers } from "@/lib/auth/rate-limit"
import {
  driverCreateSchema,
  driverStatusSchema,
  driverUpdateSchema,
  type DriverCreateInput,
  type DriverStatus,
  type DriverUpdateInput,
} from "@/types/drivers"
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

/* ------------------------------------------------------------------ */
/* updateDriver — edit profile fields (status goes via setDriverStatus) */
/* ------------------------------------------------------------------ */

export async function updateDriver(
  driverId: string,
  input: DriverUpdateInput,
): Promise<ActionResult> {
  try {
    await requirePermission("drivers", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    if (!z.string().uuid().safeParse(driverId).success) {
      return { success: false, error: "Invalid driver id." }
    }

    const parsed = driverUpdateSchema.parse(input)

    const admin = createAdminClient()
    const { data: existing, error: fetchError } = await admin
      .from("drivers")
      .select("id, status")
      .eq("id", driverId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError) return { success: false, error: fetchError.message }
    if (!existing) return { success: false, error: "Driver not found." }

    // Changed-fields-only update; keys absent from the payload stay untouched.
    const update: Record<string, unknown> = { updated_by: currentUser.authUserId }
    const set = (key: string, value: unknown) => {
      if (value !== undefined) update[key] = value
    }
    const str = (v: string | null | undefined) =>
      v === undefined ? undefined : v?.trim() || null

    if (parsed.driver_code !== undefined && parsed.driver_code?.trim()) {
      update.driver_code = parsed.driver_code.trim()
    }
    set("full_name_ar", str(parsed.full_name_ar))
    set("full_name_en", str(parsed.full_name_en))
    set("preferred_name", str(parsed.preferred_name))
    set("nationality", str(parsed.nationality))
    set(
      "nationality_code",
      parsed.nationality_code === undefined
        ? undefined
        : parsed.nationality_code?.trim().toUpperCase() || null,
    )
    set("date_of_birth", str(parsed.date_of_birth))
    set("place_of_birth", str(parsed.place_of_birth))
    set("gender", str(parsed.gender))
    set("marital_status", str(parsed.marital_status))
    set("iqama_number", str(parsed.iqama_number))
    set("iqama_issue_date", str(parsed.iqama_issue_date))
    set("iqama_expiry_date", str(parsed.iqama_expiry_date))
    set("profession_on_iqama", str(parsed.profession_on_iqama))
    set("passport_number", str(parsed.passport_number))
    set("passport_expiry_date", str(parsed.passport_expiry_date))
    set("license_number", str(parsed.license_number))
    set("license_type", str(parsed.license_type))
    set("license_issue_date", str(parsed.license_issue_date))
    set("license_expiry_date", str(parsed.license_expiry_date))
    set("primary_mobile", str(parsed.primary_mobile))
    set("secondary_mobile", str(parsed.secondary_mobile))
    set(
      "personal_email",
      parsed.personal_email === undefined
        ? undefined
        : parsed.personal_email?.trim().toLowerCase() || null,
    )
    set(
      "work_email",
      parsed.work_email === undefined
        ? undefined
        : parsed.work_email?.trim().toLowerCase() || null,
    )
    set("current_city", str(parsed.current_city))
    set("current_region", str(parsed.current_region))
    set("national_address", str(parsed.national_address))
    set("category", parsed.category)
    set("employment_type", parsed.employment_type)
    set("contract_type", parsed.contract_type)
    set("job_title", str(parsed.job_title))
    set("department", str(parsed.department))
    set("cost_center", str(parsed.cost_center))
    set("hire_date", str(parsed.hire_date))
    set("onboarding_date", str(parsed.onboarding_date))
    set("probation_start", str(parsed.probation_start))
    set("probation_end", str(parsed.probation_end))
    set("contract_start", str(parsed.contract_start))
    set("contract_end", str(parsed.contract_end))
    set("rehire_eligible", parsed.rehire_eligible)
    set("supervisor_id", str(parsed.supervisor_id))
    set("hr_owner_id", str(parsed.hr_owner_id))
    set("ops_owner_id", str(parsed.ops_owner_id))
    set("payroll_rule_id", str(parsed.payroll_rule_id))
    set("basic_salary", parsed.basic_salary)
    set("housing_allowance", parsed.housing_allowance)
    set("transport_allowance", parsed.transport_allowance)
    set("other_allowances", parsed.other_allowances)
    set("gosi_wage_basis", parsed.gosi_wage_basis)
    set("payroll_group", str(parsed.payroll_group))
    set("bank_name", str(parsed.bank_name))
    set(
      "iban",
      parsed.iban === undefined
        ? undefined
        : parsed.iban?.replace(/\s/g, "").toUpperCase() || null,
    )
    set("payment_method", str(parsed.payment_method))
    set("primary_platform_id", str(parsed.primary_platform_id))
    set("current_vehicle_id", str(parsed.current_vehicle_id))
    set("driver_type", str(parsed.driver_type))
    set("city_zone", str(parsed.city_zone))
    set("service_area", str(parsed.service_area))
    set("shift_type", str(parsed.shift_type))
    set("operational_state", str(parsed.operational_state))
    set("tags", parsed.tags)
    set("internal_notes", str(parsed.internal_notes))
    set("priority", str(parsed.priority))

    const changedKeys = Object.keys(update).filter((k) => k !== "updated_by")
    if (changedKeys.length === 0) {
      return { success: true, id: driverId }
    }

    const { error } = await admin.from("drivers").update(update).eq("id", driverId)
    if (error) return { success: false, error: error.message }

    const { updated_by: _ignored, ...changedValues } = update
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "drivers",
      action: "updated",
      entityType: "driver",
      entityId: driverId,
      newValues: { changed: changedKeys, values: changedValues },
    })

    revalidatePath("/drivers")
    revalidatePath(`/drivers/${driverId}`)
    return { success: true, id: driverId }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/* ------------------------------------------------------------------ */
/* setDriverStatus — lifecycle transitions                              */
/* ------------------------------------------------------------------ */

const statusChangeSchema = z.object({
  driverId: z.string().uuid(),
  status: driverStatusSchema,
  reason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
})

const REASON_REQUIRED: ReadonlySet<DriverStatus> = new Set([
  "suspended",
  "terminated",
  "blacklisted",
])
const TERMINAL_STATUSES: ReadonlySet<DriverStatus> = new Set([
  "terminated",
  "blacklisted",
])

export async function setDriverStatus(input: unknown): Promise<ActionResult> {
  try {
    await requirePermission("drivers", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = statusChangeSchema.parse(input)
    const { driverId, status, reason, note } = parsed

    if (REASON_REQUIRED.has(status) && (!reason || reason.length < 5)) {
      return {
        success: false,
        error: "A reason (min 5 characters) is required for this status change.",
      }
    }

    const admin = createAdminClient()
    const { data: existing, error: fetchError } = await admin
      .from("drivers")
      .select("id, status")
      .eq("id", driverId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError) return { success: false, error: fetchError.message }
    if (!existing) return { success: false, error: "Driver not found." }

    const from = existing.status as DriverStatus
    if (from === status) {
      return { success: false, error: `Driver is already ${status}.` }
    }
    if (TERMINAL_STATUSES.has(from)) {
      return {
        success: false,
        error: `Cannot change status from ${from}; create a new record or rehire flow instead.`,
      }
    }

    const update: Record<string, unknown> = {
      status,
      updated_by: currentUser.authUserId,
    }
    if (status === "terminated") {
      update.termination_date = new Date().toISOString().slice(0, 10)
      update.termination_reason = reason ?? null
    }

    const { error } = await admin.from("drivers").update(update).eq("id", driverId)
    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "drivers",
      action: "status_changed",
      entityType: "driver",
      entityId: driverId,
      newValues: { from, to: status, reason: reason ?? null, note: note ?? null },
    })

    // Compliance reflects status (e.g. suspended blocks eligibility).
    try {
      await admin.rpc("compute_driver_compliance", { p_driver_id: driverId })
    } catch {
      // best effort — the engine also runs on its own triggers
    }

    revalidatePath("/drivers")
    revalidatePath(`/drivers/${driverId}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/* ------------------------------------------------------------------ */
/* archiveDriver — soft delete (preferred over hard delete)             */
/* ------------------------------------------------------------------ */

const archiveSchema = z.object({
  driverId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
})

export async function archiveDriver(input: unknown): Promise<ActionResult> {
  try {
    await requirePermission("drivers", "delete")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = archiveSchema.parse(input)
    const { driverId, reason } = parsed

    const admin = createAdminClient()
    const { data: existing, error: fetchError } = await admin
      .from("drivers")
      .select("id, status")
      .eq("id", driverId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError) return { success: false, error: fetchError.message }
    if (!existing) return { success: false, error: "Driver not found." }

    const { error } = await admin
      .from("drivers")
      .update({
        deleted_at: new Date().toISOString(),
        archived_reason: reason,
        updated_by: currentUser.authUserId,
      })
      .eq("id", driverId)
    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "drivers",
      action: "archived",
      entityType: "driver",
      entityId: driverId,
      newValues: { reason, previousStatus: existing.status },
    })

    revalidatePath("/drivers")
    revalidatePath(`/drivers/${driverId}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
