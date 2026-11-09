"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/auth/authorization"
import { GOV_CHECK_TYPES } from "@/lib/drivers/government-checks"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const schema = z.object({
  driverId: z.uuid(), checkType: z.enum(GOV_CHECK_TYPES), result: z.enum(["ok", "issue", "pending"]),
  reference: z.string().trim().max(100).optional(), notes: z.string().trim().max(1000).optional(), checkedOn: date.optional(), nextDueOn: date.optional(),
})

export async function recordGovernmentCheck(input: unknown): Promise<{ ok: true } | { ok: false; error: string; errorAr: string }> {
  try {
    await requirePermission("drivers", "update")
    const p = schema.parse(input)
    const db = await createClient()
    const { error } = await db.rpc("record_driver_government_check", {
      p_driver_id: p.driverId, p_check_type: p.checkType, p_result: p.result, p_reference: p.reference ?? null, p_notes: p.notes ?? null, p_checked_on: p.checkedOn ?? null, p_next_due_on: p.nextDueOn ?? null,
    })
    if (error) {
      const m = error.message ?? ""
      if (m.includes("GOV001")) return { ok: false, error: "The check date cannot be in the future.", errorAr: "لا يمكن أن يكون تاريخ الفحص في المستقبل." }
      if (m.includes("GOV002")) return { ok: false, error: "Next due date must be after the check date.", errorAr: "يجب أن يكون الموعد القادم بعد تاريخ الفحص." }
      if (m.includes("AUTH007")) return { ok: false, error: "You do not have permission to record checks.", errorAr: "ليست لديك صلاحية تسجيل الفحوصات." }
      return { ok: false, error: "Could not save the check. Try again.", errorAr: "تعذر حفظ الفحص. حاول مجدداً." }
    }
    revalidatePath(`/drivers/${p.driverId}`)
    return { ok: true }
  } catch { return { ok: false, error: "Check the details and try again.", errorAr: "تحقق من البيانات وحاول مجدداً." } }
}
