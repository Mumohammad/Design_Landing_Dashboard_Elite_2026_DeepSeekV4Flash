"use server"

import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"

// Photo updates are operational work (same gate as document registration).
const PHOTO_ROLES = new Set(["general_manager", "admin", "supervisor", "operations_officer"])

const schema = z.object({
  driverId: z.string().uuid(),
  filePath: z.string().trim().min(5).max(500),
})

type Result = { ok: true } | { ok: false; error: string }

export async function updateDriverPhoto(input: unknown): Promise<Result> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not authenticated" }

  const { data: me } = await supabase
    .from("users")
    .select("id, tenant_id, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (!me || me.status !== "active" || !PHOTO_ROLES.has(me.role)) {
    return { ok: false, error: "Not authorized to update driver photos" }
  }

  const { driverId, filePath } = parsed.data

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, tenant_id")
    .eq("id", driverId)
    .maybeSingle()
  if (!driver || driver.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Driver not found" }
  }

  // Photo must live under this tenant/driver folder in the driver-photos bucket.
  if (!filePath.startsWith(`${driver.tenant_id}/${driverId}/photo-`)) {
    return { ok: false, error: "Invalid file path" }
  }

  const { error } = await supabase
    .from("drivers")
    .update({ photo_url: filePath, updated_by: user.id })
    .eq("id", driverId)
  if (error) {
    logger.error({ err: error, driverId }, "failed to update driver photo")
    return { ok: false, error: "Failed to update photo" }
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
    logger.error({ err: auditError, driverId }, "photo audit insert failed")
  }

  // photo is an engine requirement — recompute so the status flips to valid.
  const admin = createAdminClient()
  const { error: rpcError } = await admin.rpc("compute_driver_compliance", { p_driver_id: driverId })
  if (rpcError) {
    logger.error({ err: rpcError, driverId }, "compute_driver_compliance failed after photo update")
  }

  return { ok: true }
}
