"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"

// Photo management: operational staff (same convention as driver-cards.ts).
const PHOTO_ROLES = new Set([
  "super_admin",
  "admin",
  "tenant_admin",
  "general_manager",
  "hr_manager",
  "fleet_manager",
  "supervisor",
  "operations_officer",
])

const PHOTO_BUCKET = "driver-photos"

const updateSchema = z.object({
  driverId: z.string().uuid(),
  filePath: z.string().min(8).max(400),
})
const removeSchema = z.object({ driverId: z.string().uuid() })

type Result =
  | { ok: true; filePath: string | null; signedUrl: string | null }
  | { ok: false; error: string }

async function requirePhotoRole() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "Not authenticated" }

  // users is keyed by auth_user_id; fall back to id for legacy rows.
  let { data: me } = await supabase
    .from("users")
    .select("id, tenant_id, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (!me) {
    const legacy = await supabase
      .from("users")
      .select("id, tenant_id, role, status")
      .eq("id", user.id)
      .maybeSingle()
    me = legacy.data
  }

  if (!me || me.status !== "active" || !PHOTO_ROLES.has(me.role)) {
    return { ok: false as const, error: "Not authorized to manage driver photos" }
  }
  return { ok: true as const, supabase, user, me }
}

async function recomputeCompliance(driverId: string) {
  const admin = createAdminClient()
  const { error } = await admin.rpc("compute_driver_compliance", {
    p_driver_id: driverId,
  })
  if (error) {
    logger.error(
      { err: error, driverId },
      "compute_driver_compliance failed after photo change",
    )
  }
}

/**
 * Point a driver profile at an uploaded photo object (driver-photos bucket).
 * photo_url stores the storage object path; consumers resolve a signed URL.
 */
export async function updateDriverPhoto(input: unknown): Promise<Result> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid photo payload" }
  const { driverId, filePath } = parsed.data

  const auth = await requirePhotoRole()
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, tenant_id")
    .eq("id", driverId)
    .is("deleted_at", null)
    .maybeSingle()
  if (!driver || driver.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Driver not found" }
  }

  const expectedPrefix = `${me.tenant_id}/${driverId}/photo-`
  if (!filePath.startsWith(expectedPrefix) || filePath.includes("..")) {
    return { ok: false, error: "Photo path does not match this driver" }
  }

  const { error: updateError } = await supabase
    .from("drivers")
    .update({ photo_url: filePath, updated_by: user.id })
    .eq("id", driverId)
  if (updateError) {
    logger.error({ err: updateError, driverId }, "failed to update driver photo")
    return { ok: false, error: "Failed to update the photo" }
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: driver.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver",
    entity_id: driverId,
    action: "photo_updated",
    new_values: { photo_url: filePath },
  })
  if (auditError) {
    logger.error({ err: auditError, driverId }, "photo update audit insert failed")
  }

  const admin = createAdminClient()
  const { data: signed } = await admin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(filePath, 3600)

  await recomputeCompliance(driverId)

  revalidatePath(`/drivers/${driverId}`)
  revalidatePath("/drivers")
  return { ok: true, filePath, signedUrl: signed?.signedUrl ?? null }
}

/** Remove the driver's photo (profile + card fall back to initials/icon). */
export async function removeDriverPhoto(input: unknown): Promise<Result> {
  const parsed = removeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }
  const { driverId } = parsed.data

  const auth = await requirePhotoRole()
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, tenant_id, photo_url")
    .eq("id", driverId)
    .is("deleted_at", null)
    .maybeSingle()
  if (!driver || driver.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Driver not found" }
  }

  const previous =
    typeof driver.photo_url === "string" ? driver.photo_url : null

  const { error: updateError } = await supabase
    .from("drivers")
    .update({ photo_url: null, updated_by: user.id })
    .eq("id", driverId)
  if (updateError) {
    logger.error({ err: updateError, driverId }, "failed to remove driver photo")
    return { ok: false, error: "Failed to remove the photo" }
  }

  // Best-effort storage cleanup for bucket-managed objects.
  if (
    previous &&
    !/^https?:\/\//i.test(previous) &&
    previous.startsWith(`${me.tenant_id}/`)
  ) {
    const admin = createAdminClient()
    const { error: removeError } = await admin.storage
      .from(PHOTO_BUCKET)
      .remove([previous])
    if (removeError) {
      logger.error(
        { err: removeError, driverId },
        "storage cleanup failed after photo removal",
      )
    }
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: driver.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver",
    entity_id: driverId,
    action: "photo_removed",
    old_values: { photo_url: previous },
  })
  if (auditError) {
    logger.error({ err: auditError, driverId }, "photo removal audit insert failed")
  }

  await recomputeCompliance(driverId)

  revalidatePath(`/drivers/${driverId}`)
  revalidatePath("/drivers")
  return { ok: true, filePath: null, signedUrl: null }
}
