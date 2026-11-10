"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitDrivers } from "@/lib/auth/rate-limit"
import { driverCreateSchema } from "@/types/drivers"
import { emit } from "@/lib/webhooks/events"

export type DriverImportResult =
  | { ok: true; results: { line: number; ok: boolean; id?: string; error?: string }[] }
  | { ok: false; error: string; errorAr: string }

const batchSchema = z.array(z.object({ line: z.number().int().min(1), input: z.unknown() })).min(1).max(50)

function friendly(message: string): string {
  if (message.includes("23505") || /duplicate|already exists/i.test(message)) return "A driver with this code, iqama or mobile already exists."
  return message.replace(/^[A-Z]+\d+:\s*/, "").slice(0, 200)
}

/** Creates up to 50 drivers per call (the dialog sends batches). Each row is
 *  created independently through the same audited RPC as the create form. */
export async function importDriversBatch(batch: unknown): Promise<DriverImportResult> {
  try {
    await requirePermission("drivers", "create")
    const user = await getCurrentUser()
    if (!user) return { ok: false, error: "Not authenticated.", errorAr: "يجب تسجيل الدخول." }
    if (!(await rateLimitDrivers(user.id)).success) return { ok: false, error: "Too many imports. Wait a minute and continue.", errorAr: "عمليات استيراد كثيرة. انتظر دقيقة ثم تابع." }
    const rows = batchSchema.parse(batch)
    const db = await createClient()
    const results: { line: number; ok: boolean; id?: string; error?: string }[] = []
    for (const row of rows) {
      const parsed = driverCreateSchema.safeParse(row.input)
      if (!parsed.success) { results.push({ line: row.line, ok: false, error: parsed.error.issues[0]?.message ?? "Invalid row" }); continue }
      const input = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v]))
      const { data, error } = await db.rpc("mutate_driver_profile", { p_action: "create", p_input: input, p_id: null, p_expected_version: null })
      if (error || !data?.id) { results.push({ line: row.line, ok: false, error: friendly(error?.code === "23505" ? "23505" : error?.message ?? "Not saved") }); continue }
      results.push({ line: row.line, ok: true, id: data.id })
      emit("driver.created", user.tenantId, { id: data.id, name: String(input.full_name_ar ?? ""), code: String(input.driver_code ?? ""), status: String(input.status ?? "draft") })
    }
    revalidatePath("/drivers")
    return { ok: true, results }
  } catch (error) {
    const m = error instanceof Error ? error.message : ""
    if (/permission|AUTH/i.test(m)) return { ok: false, error: "You do not have permission to create drivers.", errorAr: "ليست لديك صلاحية إضافة سائقين." }
    return { ok: false, error: "Import failed. Check the file and try again.", errorAr: "فشل الاستيراد. راجع الملف وحاول مجدداً." }
  }
}
