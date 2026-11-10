"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/auth/authorization"

export type EvidenceResult = { ok: true; photos: number; driverSigned: boolean; supervisorSigned: boolean } | { ok: false; error: string; errorAr: string }

const schema = z.object({
  formId: z.uuid(),
  photos: z.array(z.string().min(10).max(300)).max(24).optional(),
  signer: z.enum(["driver", "supervisor"]).optional(),
  signaturePath: z.string().min(10).max(300).optional(),
}).refine((v) => (v.photos?.length ?? 0) > 0 || (v.signer && v.signaturePath), "Nothing to attach")

function fail(m: string | undefined): { ok: false; error: string; errorAr: string } {
  const s = m ?? ""
  if (s.includes("AUTH007") || /permission/i.test(s)) return { ok: false, error: "You do not have permission to update handovers.", errorAr: "ليست لديك صلاحية تعديل محاضر التسليم." }
  if (s.includes("HOE002")) return { ok: false, error: "This handover is fully signed and can no longer change.", errorAr: "المحضر موقّع بالكامل ولا يمكن تعديله." }
  if (s.includes("HOE003")) return { ok: false, error: "Up to 24 photos per handover.", errorAr: "الحد الأقصى 24 صورة لكل محضر." }
  if (s.includes("HOE006")) return { ok: false, error: "Already signed.", errorAr: "تم التوقيع مسبقاً." }
  return { ok: false, error: "Could not save the evidence. Try again.", errorAr: "تعذر حفظ المرفقات. حاول مجدداً." }
}

export async function attachHandoverEvidence(input: unknown): Promise<EvidenceResult> {
  try {
    await requirePermission("assignments", "update")
    const p = schema.parse(input)
    const db = await createClient()
    const { data, error } = await db.rpc("attach_handover_evidence", {
      p_form_id: p.formId, p_photos: p.photos?.length ? p.photos : null, p_signer: p.signer ?? null, p_signature_path: p.signaturePath ?? null,
    })
    if (error) return fail(error.message)
    revalidatePath("/vehicles")
    return { ok: true, photos: Number(data?.photos ?? 0), driverSigned: !!data?.driver_acknowledged_at, supervisorSigned: !!data?.supervisor_acknowledged_at }
  } catch (e) { return fail(e instanceof Error ? e.message : undefined) }
}
