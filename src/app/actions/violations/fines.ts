"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"

export type FineActionResult<T = Record<string, number>> = { ok: true; data: T } | { ok: false; error: string; errorAr: string }

const rowSchema = z.object({
  external_ref: z.string().trim().min(1).max(100),
  vehicle_plate: z.string().trim().max(40).nullable(),
  violation_date: z.iso.date().nullable(),
  fine_amount: z.number().min(0).max(1_000_000).nullable(),
  violation_location: z.string().trim().max(300).nullable(),
  violation_type_code: z.string().trim().max(100).nullable(),
  payment_deadline: z.iso.date().nullable(),
  external_source: z.string().trim().max(100).nullable(),
})
const importSchema = z.object({ rows: z.array(rowSchema).min(1).max(1000), source: z.enum(["manual", "najm", "moi", "absher"]), batchRef: z.string().trim().max(100).nullable() })

function fail(message: string | undefined): { ok: false; error: string; errorAr: string } {
  const m = message ?? ""
  if (m.includes("AUTH007") || /permission/i.test(m)) return { ok: false, error: "You do not have permission to manage traffic fines.", errorAr: "ليست لديك صلاحية إدارة المخالفات المرورية." }
  if (m.includes("FIN011")) return { ok: false, error: "A violation was already created for this fine.", errorAr: "تم إنشاء مخالفة لهذه الغرامة مسبقاً." }
  if (m.includes("FIN012")) return { ok: false, error: "Choose an active driver.", errorAr: "اختر سائقاً نشطاً." }
  if (m.includes("FIN00")) return { ok: false, error: m.replace(/^.*FIN\d+:\s*/, ""), errorAr: "بيانات الملف غير صالحة. راجع الأسطر وحاول مجدداً." }
  return { ok: false, error: "Could not complete the action. Try again.", errorAr: "تعذر تنفيذ العملية. حاول مجدداً." }
}

export async function importTrafficFines(input: unknown): Promise<FineActionResult> {
  try {
    await requirePermission("violations", "create")
    const parsed = importSchema.parse(input)
    const db = await createClient()
    const { data, error } = await db.rpc("import_external_fines", { p_rows: parsed.rows, p_source: parsed.source, p_batch_ref: parsed.batchRef })
    if (error) return fail(error.message)
    revalidatePath("/violations/fines")
    return { ok: true, data: data as Record<string, number> }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}

export async function rematchTrafficFines(): Promise<FineActionResult> {
  try {
    await requirePermission("violations", "update")
    const db = await createClient()
    const { data, error } = await db.rpc("rematch_external_fines")
    if (error) return fail(error.message)
    return { ok: true, data: data as Record<string, number> }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}

const resolveSchema = z.object({
  id: z.uuid(),
  action: z.enum(["assign", "ignore", "duplicate", "reopen"]),
  driverId: z.uuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

export async function resolveTrafficFine(input: unknown): Promise<FineActionResult<{ status: string }>> {
  try {
    await requirePermission("violations", "update")
    const p = resolveSchema.parse(input)
    const db = await createClient()
    const { data, error } = await db.rpc("resolve_external_fine", { p_id: p.id, p_action: p.action, p_driver_id: p.driverId ?? null, p_violation_id: null, p_note: p.note ?? null })
    if (error) return fail(error.message)
    return { ok: true, data: { status: String(data?.status ?? "") } }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}

/** Creates an open violation (deduction = fine amount) for the matched driver
 *  through the standard driver-operations RPC, then links it to the fine. */
export async function createViolationFromFine(fineId: unknown): Promise<FineActionResult<{ violationId: string }>> {
  try {
    await requirePermission("violations", "create")
    if (!(await getCurrentUser())) return fail("permission")
    const id = z.uuid().parse(fineId)
    const db = await createClient()
    const { data: fine, error: readError } = await db.from("external_fine_imports")
      .select("id, external_ref, vehicle_plate, violation_date, violation_location, violation_type_code, fine_amount, matched_driver_id, status")
      .eq("id", id).maybeSingle()
    if (readError || !fine) return fail(readError?.message)
    if (fine.status === "violation_created") return fail("FIN011")
    if (!fine.matched_driver_id) return { ok: false, error: "Assign a driver to this fine first.", errorAr: "عيّن سائقاً لهذه المخالفة أولاً." }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date())
    const description = [
      `Traffic fine ${fine.external_ref}`,
      fine.violation_type_code ? `type ${fine.violation_type_code}` : null,
      fine.vehicle_plate ? `plate ${fine.vehicle_plate}` : null,
    ].filter(Boolean).join(" · ")
    const { data: created, error } = await db.rpc("save_driver_profile_operation", {
      p_surface: "violations",
      p_driver_id: fine.matched_driver_id,
      p_input: {
        violation_type_id: null,
        incident_date: fine.violation_date ?? today,
        incident_location: fine.violation_location,
        incident_description: description,
        deduction_amount: Number(fine.fine_amount ?? 0),
        status: "open",
      },
      p_id: null,
      p_expected_updated_at: null,
    })
    if (error || !created?.id) return fail(error?.message)
    const { error: linkError } = await db.rpc("resolve_external_fine", { p_id: id, p_action: "link_violation", p_driver_id: null, p_violation_id: created.id, p_note: null })
    if (linkError) return fail(linkError.message)
    revalidatePath(`/drivers/${fine.matched_driver_id}`)
    revalidatePath("/violations")
    return { ok: true, data: { violationId: created.id as string } }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}
