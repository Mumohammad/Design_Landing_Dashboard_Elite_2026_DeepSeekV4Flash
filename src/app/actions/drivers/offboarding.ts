"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/auth/authorization"
import { OFFBOARDING_EXIT_TYPES, OFFBOARDING_MANUAL_KEYS } from "@/lib/drivers/clearance-certificate"

export type OffboardingRecord = {
  id: string; driver_id: string; status: "in_progress" | "completed" | "cancelled"; exit_type: string; reason: string | null
  last_working_day: string | null; checklist: Record<string, { done?: boolean; at?: string; note?: string | null }>
  settlement_amount: number | null; settlement_notes: string | null; clearance_ref: string | null
  completed_at: string | null; created_at: string
}
export type OffboardingResult = { ok: true; record: OffboardingRecord } | { ok: false; error: string; errorAr: string }

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), driverId: z.uuid(), exitType: z.enum(OFFBOARDING_EXIT_TYPES), reason: z.string().trim().max(500).optional(), lastWorkingDay: z.iso.date().optional() }),
  z.object({ action: z.literal("check"), driverId: z.uuid(), key: z.enum(OFFBOARDING_MANUAL_KEYS), done: z.boolean(), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("update"), driverId: z.uuid(), exitType: z.enum(OFFBOARDING_EXIT_TYPES).optional(), reason: z.string().trim().max(500).optional(), lastWorkingDay: z.iso.date().optional(), settlementAmount: z.number().min(-1_000_000).max(1_000_000).nullable().optional(), settlementNotes: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("complete"), driverId: z.uuid() }),
  z.object({ action: z.literal("cancel"), driverId: z.uuid() }),
])

function fail(m: string | undefined): { ok: false; error: string; errorAr: string } {
  const s = m ?? ""
  const map: [string, string, string][] = [
    ["AUTH007", "You do not have permission to manage driver exits.", "ليست لديك صلاحية إدارة إنهاء خدمة السائقين."],
    ["OFB001", "An exit process is already in progress.", "يوجد إجراء إنهاء خدمة قائم بالفعل."],
    ["OFB002", "No exit process is in progress.", "لا يوجد إجراء إنهاء خدمة قائم."],
    ["OFB004", "Complete every checklist item first.", "أكمل جميع بنود قائمة المخالصة أولاً."],
    ["OFB005", "Return the assigned vehicle first.", "يجب استلام المركبة المسندة أولاً."],
    ["OFB006", "Deactivate the driver's platform accounts first.", "يجب إيقاف حسابات المنصات للسائق أولاً."],
    ["DPA001", "Driver not found.", "السائق غير موجود."],
  ]
  for (const [code, en, ar] of map) if (s.includes(code)) return { ok: false, error: en, errorAr: ar }
  if (/permission/i.test(s)) return { ok: false, error: map[0][1], errorAr: map[0][2] }
  return { ok: false, error: "Could not save the exit process. Try again.", errorAr: "تعذر حفظ إجراء إنهاء الخدمة. حاول مجدداً." }
}

export async function saveDriverOffboarding(input: unknown): Promise<OffboardingResult> {
  try {
    await requirePermission("drivers", "update")
    const p = schema.parse(input)
    const payload: Record<string, unknown> = {}
    if (p.action === "start") Object.assign(payload, { exit_type: p.exitType, reason: p.reason ?? "", last_working_day: p.lastWorkingDay ?? "" })
    if (p.action === "check") Object.assign(payload, { key: p.key, done: p.done, note: p.note ?? "" })
    if (p.action === "update") {
      if (p.exitType) payload.exit_type = p.exitType
      if (p.reason !== undefined) payload.reason = p.reason
      if (p.lastWorkingDay) payload.last_working_day = p.lastWorkingDay
      if (p.settlementAmount !== undefined) payload.settlement_amount = p.settlementAmount === null ? "" : String(p.settlementAmount)
      if (p.settlementNotes !== undefined) payload.settlement_notes = p.settlementNotes
    }
    const db = await createClient()
    const { data, error } = await db.rpc("save_driver_offboarding", { p_driver_id: p.driverId, p_action: p.action, p_payload: payload })
    if (error) return fail(error.message)
    revalidatePath(`/drivers/${p.driverId}`)
    return { ok: true, record: data as OffboardingRecord }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}
