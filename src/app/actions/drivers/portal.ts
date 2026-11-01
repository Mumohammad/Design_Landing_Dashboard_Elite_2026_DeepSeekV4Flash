"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/auth/authorization"
import { generatePortalToken, hashPortalToken } from "@/lib/driver-portal/token"

type Fail = { ok: false; error: string; errorAr: string }
function fail(m: string | undefined): Fail {
  const s = m ?? ""
  if (s.includes("AUTH007") || /permission/i.test(s)) return { ok: false, error: "You do not have permission to manage driver portal links.", errorAr: "ليست لديك صلاحية إدارة روابط بوابة السائق." }
  if (s.includes("DPA001")) return { ok: false, error: "Driver not found.", errorAr: "السائق غير موجود." }
  if (s.includes("DPS002")) return { ok: false, error: "This submission was already reviewed.", errorAr: "تمت مراجعة هذا الطلب مسبقاً." }
  if (s.includes("DPS003")) return { ok: false, error: "Register the document in the vault first.", errorAr: "سجّل المستند في الخزنة أولاً." }
  return { ok: false, error: "Something went wrong. Try again.", errorAr: "حدث خطأ. حاول مجدداً." }
}

/** Issue a new portal link (revokes older ones). Returns the path with the one-time-visible token. */
export async function issueDriverPortalLink(input: unknown): Promise<{ ok: true; path: string; expiresAt: string } | Fail> {
  try {
    await requirePermission("drivers", "update")
    const p = z.object({ driverId: z.uuid(), days: z.number().int().min(1).max(90).default(30) }).parse(input)
    const token = generatePortalToken()
    const db = await createClient()
    const { data, error } = await db.rpc("issue_driver_portal_link", { p_driver_id: p.driverId, p_token_hash: hashPortalToken(token), p_days: p.days })
    if (error) return fail(error.message)
    revalidatePath(`/drivers/${p.driverId}`)
    return { ok: true, path: `/driver-portal/${token}`, expiresAt: String(data?.expires_at ?? "") }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}

export async function revokeDriverPortalLinks(input: unknown): Promise<{ ok: true; revoked: number } | Fail> {
  try {
    await requirePermission("drivers", "update")
    const p = z.object({ driverId: z.uuid() }).parse(input)
    const db = await createClient()
    const { data, error } = await db.rpc("revoke_driver_portal_links", { p_driver_id: p.driverId })
    if (error) return fail(error.message)
    return { ok: true, revoked: Number(data ?? 0) }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}

export async function reviewPortalSubmission(input: unknown): Promise<{ ok: true } | Fail> {
  try {
    await requirePermission("drivers", "update")
    const p = z.object({ id: z.uuid(), action: z.enum(["accept", "reject"]), note: z.string().trim().max(500).optional(), documentId: z.uuid().optional() }).parse(input)
    const db = await createClient()
    const { error } = await db.rpc("review_driver_portal_submission", { p_id: p.id, p_action: p.action, p_note: p.note ?? null, p_document_id: p.documentId ?? null })
    if (error) return fail(error.message)
    return { ok: true }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}
