"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitDrivers } from "@/lib/auth/rate-limit"
import { RIDER_ID_PATTERN } from "@/lib/drivers/platforms"

export type PlatformAccountResult = { ok: true; id: string } | { ok: false; error: string; errorAr: string }

const saveSchema = z.object({
  driverId: z.uuid(),
  platformCode: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,39}$/),
  platformDriverId: z.string().trim().regex(RIDER_ID_PATTERN),
  status: z.enum(["active", "suspended", "inactive"]).default("active"),
  isPrimary: z.boolean().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
})
const removeSchema = z.object({ id: z.uuid(), driverId: z.uuid() })

function failure(message: string | undefined): Extract<PlatformAccountResult, { ok: false }> {
  const m = message ?? ""
  if (m.includes("DPA006")) return { ok: false, error: "This rider ID is already linked to another driver on the same platform.", errorAr: "رقم المندوب مرتبط بسائق آخر على نفس المنصة." }
  if (m.includes("DPA003")) return { ok: false, error: "Rider ID may contain letters, digits, dot, dash, slash or underscore (max 64).", errorAr: "رقم المندوب يقبل الحروف والأرقام والنقطة والشرطة فقط (حتى 64)." }
  if (m.includes("AUTH007") || m.includes("permission")) return { ok: false, error: "You do not have permission to edit drivers.", errorAr: "ليست لديك صلاحية تعديل السائقين." }
  if (m.includes("Rate limit")) return { ok: false, error: "Too many changes. Try again shortly.", errorAr: "تغييرات كثيرة. حاول بعد قليل." }
  if (m.includes("DPA007")) return { ok: false, error: "The platform account no longer exists. Reload.", errorAr: "حساب المنصة لم يعد موجوداً. أعد التحميل." }
  return { ok: false, error: "Could not save the platform account. Try again.", errorAr: "تعذر حفظ حساب المنصة. حاول مجدداً." }
}

async function guard() {
  await requirePermission("drivers", "update")
  const user = await getCurrentUser()
  if (!user) throw new Error("permission")
  if (!(await rateLimitDrivers(user.id)).success) throw new Error("Rate limit")
}

export async function saveDriverPlatformAccount(input: unknown): Promise<PlatformAccountResult> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return failure(parsed.error.issues.some((i) => i.path[0] === "platformDriverId") ? "DPA003" : undefined)
  try {
    await guard()
    const v = parsed.data
    const db = await createClient()
    const { data, error } = await db.rpc("save_driver_platform_account", {
      p_driver_id: v.driverId,
      p_platform_code: v.platformCode,
      p_platform_driver_id: v.platformDriverId,
      p_status: v.status,
      p_is_primary: v.isPrimary,
      p_notes: v.notes ?? null,
    })
    if (error || !data?.id) return failure(error?.code === "23505" ? "DPA006" : error?.message)
    revalidatePath("/drivers/" + v.driverId)
    return { ok: true, id: String(data.id) }
  } catch (error) {
    return failure(error instanceof Error ? error.message : undefined)
  }
}

export async function removeDriverPlatformAccount(input: unknown): Promise<PlatformAccountResult> {
  const parsed = removeSchema.safeParse(input)
  if (!parsed.success) return failure(undefined)
  try {
    await guard()
    const db = await createClient()
    const { error } = await db.rpc("remove_driver_platform_account", { p_id: parsed.data.id })
    if (error) return failure(error.message)
    revalidatePath("/drivers/" + parsed.data.driverId)
    return { ok: true, id: parsed.data.id }
  } catch (error) {
    return failure(error instanceof Error ? error.message : undefined)
  }
}
