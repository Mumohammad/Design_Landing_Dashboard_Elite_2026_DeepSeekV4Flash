"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import {
  DRIVER_PHOTO_BUCKET,
  DRIVER_PHOTO_MAX_BYTES,
  DRIVER_PHOTO_MIME_TYPES,
  driverPhotoImageMeta,
  isDriverPhotoObjectPath,
  isDriverPhotoPathValid,
} from "@/lib/drivers/photo"

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

const updateSchema = z.object({
  driverId: z.string().uuid(),
  filePath: z.string().min(8).max(400),
  // Defense-in-depth: mirrors the client-side file checks so a crafted
  // request cannot point photo_url at an object the bucket would reject.
  contentType: z.string().optional(),
  size: z.number().int().positive().optional(),
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
 * Best-effort storage cleanup. Storage RLS grants authenticated users only
 * INSERT/SELECT, so object deletion goes through the service-role client.
 */
async function removePhotoObject(objectPath: string, driverId: string) {
  const admin = createAdminClient()
  const { error } = await admin.storage.from(DRIVER_PHOTO_BUCKET).remove([objectPath])
  if (error) {
    logger.error({ err: error, driverId, objectPath }, "driver photo object cleanup failed")
  }
}

/**
 * Point a driver profile at an uploaded photo object (driver-photos bucket).
 * photo_url stores the storage object path; consumers resolve a signed URL.
 */
export async function updateDriverPhoto(input: unknown): Promise<Result> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid photo payload" }
  const { driverId, filePath, contentType, size } = parsed.data

  if (typeof contentType === "string" && contentType !== "") {
    const meta = driverPhotoImageMeta({ name: filePath, type: contentType } as File)
    if (!meta.ok || !DRIVER_PHOTO_MIME_TYPES.has(meta.contentType)) {
      return { ok: false, error: "Unsupported image format" }
    }
  }
  if (typeof size === "number" && size > DRIVER_PHOTO_MAX_BYTES) {
    return { ok: false, error: "Image is too large (max 5MB)" }
  }

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

  if (!isDriverPhotoPathValid(filePath, me.tenant_id, driverId)) {
    return { ok: false, error: "Photo path does not match this driver" }
  }

  const { error: updateError } = await supabase
    .from("drivers")
    .update({ photo_url: filePath, updated_by: user.id })
    .eq("id", driverId)
  if (updateError) {
    logger.error({ err: updateError, driverId }, "failed to update driver photo")
    // The just-uploaded object is orphaned — clean it up so the bucket does
    // not accumulate dead files and retry paths never collide.
    await removePhotoObject(filePath, driverId)
    return { ok: false, error: "Failed to update the photo" }
  }

  // Replace: drop the previous object when it is a bucket-managed path and
  // differs from the new one (prevents broken URLs from stale deletions).
  const previous = driver.photo_url
  if (
    isDriverPhotoObjectPath(previous) &&
    previous !== filePath &&
    previous.startsWith(`${me.tenant_id}/`)
  ) {
    await removePhotoObject(previous, driverId)
  }

  // audit_log is INSERT-only via service role (ADR-007: no authenticated
  // INSERT policy — an authenticated-client insert is RLS-denied silently).
  const { error: auditError } = await createAdminClient()
    .from("audit_log")
    .insert({
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
    .from(DRIVER_PHOTO_BUCKET)
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

  // Best-effort storage cleanup for bucket-managed objects (legacy full URLs
  // are external and left untouched).
  if (isDriverPhotoObjectPath(previous) && previous.startsWith(`${me.tenant_id}/`)) {
    await removePhotoObject(previous, driverId)
  }

  const { error: auditError } = await createAdminClient()
    .from("audit_log")
    .insert({
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
