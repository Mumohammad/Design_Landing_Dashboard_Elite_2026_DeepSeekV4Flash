"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@/lib/supabase/admin"
import { recomputeDriverCompliance } from "@/lib/compliance/recompute"

const inputSchema = z.object({
  driverId: z.string().uuid(),
  filePath: z.string().min(8).max(400),
})

const EDITOR_ROLES = new Set([
  "super_admin",
  "tenant_admin",
  "hr_manager",
  "fleet_manager",
])

type Result =
  | { success: true; filePath: string; signedUrl: string | null }
  | { success: false; error: string }

/**
 * Point a driver profile at an uploaded photo object (driver-photos bucket).
 * photo_url stores the storage object path; consumers resolve a signed URL.
 */
export async function updateDriverPhoto(input: unknown): Promise<Result> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: "Invalid photo payload" }
  }
  const { driverId, filePath } = parsed.data

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: "Not authenticated" }
  }

  const { data: me } = await supabase
    .from("users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!me?.tenant_id || !EDITOR_ROLES.has(me.role ?? "")) {
    return { success: false, error: "Not allowed to update the driver photo" }
  }
  const tenantId = me.tenant_id as string

  const { data: driver } = await supabase
    .from("drivers")
    .select("id")
    .eq("id", driverId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle()
  if (!driver) {
    return { success: false, error: "Driver not found" }
  }

  const expectedPrefix = `${tenantId}/${driverId}/photo-`
  if (!filePath.startsWith(expectedPrefix) || filePath.includes("..")) {
    return { success: false, error: "Photo path does not match this driver" }
  }

  const service = createAdminClient()
  const { data: previous } = await service
    .from("drivers")
    .select("photo_url")
    .eq("id", driverId)
    .maybeSingle()

  const { error: updateError } = await service
    .from("drivers")
    .update({ photo_url: filePath })
    .eq("id", driverId)
  if (updateError) {
    return { success: false, error: updateError.message }
  }

  await service.from("audit_logs").insert({
    tenant_id: tenantId,
    user_id: user.id,
    action: "photo_updated",
    entity_type: "drivers",
    entity_id: driverId,
    new_values: { photo_url: filePath },
  })

  const { data: signed } = await service.storage
    .from("driver-photos")
    .createSignedUrl(filePath, 3600)

  try {
    await recomputeDriverCompliance(service, tenantId, driverId)
  } catch (err) {
    console.error("Compliance recompute after photo update failed:", err)
  }

  console.info("Driver photo updated", {
    driverId,
    previous: previous?.photo_url ?? null,
    next: filePath,
  })

  revalidatePath(`/drivers/${driverId}`)
  revalidatePath("/drivers")
  return { success: true, filePath, signedUrl: signed?.signedUrl ?? null }
}
