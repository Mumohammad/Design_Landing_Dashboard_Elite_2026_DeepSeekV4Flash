"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { createClient } from "@/lib/supabase/server"
import { operationSurfaceSchema, parseOperationInput, type OperationSurface } from "./schema"

export type OperationResult = { success: boolean; error?: string; id?: string; updated_at?: string }
const identity = z.object({ driverId: z.uuid(), id: z.uuid().optional(), expectedUpdatedAt: z.iso.datetime({ offset: true }).optional() })
const moduleFor = (surface: OperationSurface) => surface === "attendance" ? "attendance" : surface === "violations" ? "violations" : "hr"
function message(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Check the form values"
  return error instanceof Error ? error.message : "Could not save this record. Try again."
}
export async function saveDriverProfileOperation(surfaceInput: OperationSurface, driverId: string, input: unknown, id?: string, expectedUpdatedAt?: string): Promise<OperationResult> {
  try {
    const surface = operationSurfaceSchema.parse(surfaceInput)
    const keys = identity.parse({ driverId, id, expectedUpdatedAt })
    await requirePermission(moduleFor(surface), id ? "update" : "create")
    if (!await getCurrentUser()) throw new Error("Not authenticated")
    const parsed = parseOperationInput(surface, input)
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("save_driver_profile_operation", { p_surface: surface, p_driver_id: keys.driverId, p_input: parsed, p_id: keys.id ?? null, p_expected_updated_at: keys.expectedUpdatedAt ?? null })
    if (error) throw new Error(error.message)
    if (!data?.id) throw new Error("The record was not saved. Reload and try again.")
    revalidatePath(`/drivers/${driverId}`)
    revalidatePath(surface === "performance" || surface === "training" ? "/hr" : `/${surface}`)
    return { success: true, id: data.id, updated_at: data.updated_at }
  } catch (error) { return { success: false, error: message(error) } }
}
export async function archiveDriverProfileOperation(surfaceInput: OperationSurface, driverId: string, id: string, expectedUpdatedAt: string): Promise<OperationResult> {
  try {
    const surface = operationSurfaceSchema.parse(surfaceInput)
    const keys = identity.required().parse({ driverId, id, expectedUpdatedAt })
    await requirePermission(moduleFor(surface), "delete")
    if (!await getCurrentUser()) throw new Error("Not authenticated")
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("archive_driver_profile_operation", { p_surface: surface, p_driver_id: keys.driverId, p_id: keys.id, p_expected_updated_at: keys.expectedUpdatedAt })
    if (error) throw new Error(error.message)
    if (!data?.id) throw new Error("The record was not archived. Reload and try again.")
    revalidatePath(`/drivers/${driverId}`)
    revalidatePath(surface === "performance" || surface === "training" ? "/hr" : `/${surface}`)
    return { success: true, id: data.id }
  } catch (error) { return { success: false, error: message(error) } }
}
