"use server"
// Public driver portal actions. The caller is anonymous: every call re-resolves
// the portal token server-side and only ever touches that driver's rows/paths.
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolvePortalLink } from "@/lib/driver-portal/server"
import { hashPortalToken, matchesPortalFileSignature } from "@/lib/driver-portal/token"
import { DOC_UPLOAD_TYPES } from "@/lib/drivers/documents"

const BUCKET = "driver-portal-uploads"
const MAX = 10 * 1024 * 1024
const MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" }

type Fail = { ok: false; error: string; errorAr: string }
const fail = (error: string, errorAr: string): Fail => ({ ok: false, error, errorAr })
const EXPIRED = fail("This link has expired or was revoked. Ask your supervisor for a new one.", "انتهت صلاحية الرابط أو تم إلغاؤه. اطلب رابطاً جديداً من المشرف.")

const date = z.iso.date()
const start = z.object({ token: z.string(), docType: z.enum(DOC_UPLOAD_TYPES as unknown as [string, ...string[]]), size: z.number().int().positive().max(MAX), mime: z.string() })
const finish = z.object({ token: z.string(), path: z.string().max(300), docType: z.enum(DOC_UPLOAD_TYPES as unknown as [string, ...string[]]), docNumber: z.string().trim().max(100).optional(), expiryDate: date.optional(), note: z.string().trim().max(500).optional() })
const reservation = z.object({ id: z.uuid(), path: z.string().min(1).max(300) })
const completion = z.object({ id: z.uuid(), replayed: z.boolean() })
const unavailable = () => fail("Upload could not be confirmed. Try again.", "تعذر تأكيد الرفع. حاول مجدداً.")
function databaseFailure(message: string | undefined): Fail {
  if (message?.includes("DPU001")) return EXPIRED
  if (message?.includes("DPU002")) return fail("You have too many documents waiting for review or still uploading. Try again later.", "لديك مستندات كثيرة بانتظار المراجعة أو لا تزال قيد الرفع. حاول لاحقاً.")
  if (message?.includes("DPU003")) return fail("Daily upload limit reached. Try again tomorrow.", "تم بلوغ الحد اليومي للرفع. حاول غداً.")
  return unavailable()
}

export async function startPortalUpload(input: unknown): Promise<{ ok: true; path: string; uploadToken: string } | Fail> {
  const p = start.safeParse(input)
  if (!p.success) return fail("Choose a photo or PDF up to 10 MB.", "اختر صورة أو ملف PDF بحجم لا يتجاوز 10 ميجابايت.")
  const ext = MIME[p.data.mime]
  if (!ext) return fail("Only photos (JPG, PNG, HEIC) or PDF files are accepted.", "يقبل النظام الصور (JPG, PNG, HEIC) أو ملفات PDF فقط.")
  try {
    const link = await resolvePortalLink(p.data.token)
    if (!link) return EXPIRED
    const admin = createAdminClient()
    const tokenHash = hashPortalToken(p.data.token)
    const reserved = await admin.rpc("reserve_driver_portal_upload", { p_token_hash: tokenHash, p_doc_type: p.data.docType, p_size: p.data.size, p_mime: p.data.mime })
    if (reserved.error) return databaseFailure(reserved.error.message)
    const parsed = reservation.safeParse(reserved.data)
    if (!parsed.success) return unavailable()
    const { id, path } = parsed.data
    if (path !== `${link.tenant_id}/${link.driver_id}/${p.data.docType}-${id}.${ext}`) return unavailable()
    const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false })
    if (signed.error || !signed.data?.token || signed.data.path !== path) return unavailable()
    // Never expose a capability unless the post-signing authorization check and
    // reservation activation both succeeded. Unknown outcomes remain charged.
    const activated = await admin.rpc("activate_driver_portal_upload", { p_token_hash: tokenHash, p_path: path })
    if (activated.error) return databaseFailure(activated.error.message)
    const active = reservation.safeParse(activated.data)
    if (!active.success || active.data.id !== id || active.data.path !== path) return unavailable()
    return { ok: true, path, uploadToken: signed.data.token }
  } catch { return unavailable() }
}

export async function finishPortalUpload(input: unknown): Promise<{ ok: true } | Fail> {
  const p = finish.safeParse(input)
  if (!p.success) return fail("Check the details and try again.", "تحقق من البيانات وحاول مجدداً.")
  try {
    const link = await resolvePortalLink(p.data.token)
    if (!link) return EXPIRED
    const prefix = `${link.tenant_id}/${link.driver_id}/`
    const name = p.data.path.slice(prefix.length)
    if (!p.data.path.startsWith(prefix) || !/^[a-z_]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif|pdf)$/.test(name) || !name.startsWith(`${p.data.docType}-`)) return fail("Invalid upload.", "ملف غير صالح.")
    const admin = createAdminClient()
    const prior = await admin.from("driver_portal_submissions").select("id").eq("file_path", p.data.path).eq("tenant_id", link.tenant_id).eq("driver_id", link.driver_id).eq("link_id", link.id).maybeSingle()
    if (prior.error) return unavailable()
    if (!prior.data) {
      const { data: list, error } = await admin.storage.from(BUCKET).list(prefix.slice(0, -1), { search: name, limit: 1 })
      if (error) return unavailable()
      const obj = list?.find(o => o.name === name)
      const size = Number((obj?.metadata as { size?: number } | undefined)?.size ?? 0)
      const mime = String((obj?.metadata as { mimetype?: string } | undefined)?.mimetype ?? "")
      if (!obj || !Number.isInteger(size) || size <= 0 || size > MAX || !MIME[mime] || !name.endsWith(`.${MIME[mime]}`)) return unavailable()
      const downloaded = await admin.storage.from(BUCKET).download(p.data.path)
      if (downloaded.error || !downloaded.data || downloaded.data.size !== size || (downloaded.data.type && downloaded.data.type !== mime)) return unavailable()
      const header = new Uint8Array(await downloaded.data.slice(0, 32).arrayBuffer())
      if (!matchesPortalFileSignature(header, mime)) return fail("The file content doesn't match its type. Choose the original photo or PDF.", "محتوى الملف لا يطابق نوعه. اختر الصورة الأصلية أو ملف PDF.")
    }
    // The RPC re-locks and rechecks the live token, tenant, driver, reservation
    // and Storage metadata. It alone owns insertion, replay, quota and audit.
    const result = await admin.rpc("complete_driver_portal_upload", {
      p_token_hash: hashPortalToken(p.data.token), p_path: p.data.path, p_doc_type: p.data.docType,
      p_doc_number: p.data.docNumber || null, p_expiry_date: p.data.expiryDate || null, p_note: p.data.note || null,
    })
    if (result.error) return databaseFailure(result.error.message)
    if (!completion.safeParse(result.data).success) return unavailable()
    return { ok: true }
  } catch { return unavailable() }
}
