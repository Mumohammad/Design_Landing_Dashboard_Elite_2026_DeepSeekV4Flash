"use server"
// Public driver portal actions. The caller is anonymous: every call re-resolves
// the portal token server-side and only ever touches that driver's rows/paths.
import { randomUUID } from "crypto"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolvePortalLink } from "@/lib/driver-portal/server"
import { DOC_UPLOAD_TYPES } from "@/lib/drivers/documents"

const BUCKET = "driver-portal-uploads"
const MAX = 10 * 1024 * 1024
const MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" }
const MAX_PENDING = 10
const MAX_PER_DAY = 20

type Fail = { ok: false; error: string; errorAr: string }
const fail = (error: string, errorAr: string): Fail => ({ ok: false, error, errorAr })
const EXPIRED = fail("This link has expired or was revoked. Ask your supervisor for a new one.", "انتهت صلاحية الرابط أو تم إلغاؤه. اطلب رابطاً جديداً من المشرف.")

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const start = z.object({ token: z.string(), docType: z.enum(DOC_UPLOAD_TYPES as unknown as [string, ...string[]]), size: z.number().int().positive().max(MAX), mime: z.string() })
const finish = z.object({ token: z.string(), path: z.string().max(300), docType: z.enum(DOC_UPLOAD_TYPES as unknown as [string, ...string[]]), docNumber: z.string().trim().max(100).optional(), expiryDate: date.optional(), note: z.string().trim().max(500).optional() })

export async function startPortalUpload(input: unknown): Promise<{ ok: true; path: string; uploadToken: string } | Fail> {
  const p = start.safeParse(input)
  if (!p.success) return fail("Choose a photo or PDF up to 10 MB.", "اختر صورة أو ملف PDF بحجم لا يتجاوز 10 ميجابايت.")
  const ext = MIME[p.data.mime]
  if (!ext) return fail("Only photos (JPG, PNG, HEIC) or PDF files are accepted.", "يقبل النظام الصور (JPG, PNG, HEIC) أو ملفات PDF فقط.")
  const link = await resolvePortalLink(p.data.token)
  if (!link) return EXPIRED
  const admin = createAdminClient()
  const since = new Date(Date.now() - 86400000).toISOString()
  const [pending, today] = await Promise.all([
    admin.from("driver_portal_submissions").select("id", { count: "exact", head: true }).eq("driver_id", link.driver_id).eq("status", "pending"),
    admin.from("driver_portal_submissions").select("id", { count: "exact", head: true }).eq("link_id", link.id).gte("created_at", since),
  ])
  if ((pending.count ?? 0) >= MAX_PENDING) return fail("You have too many documents waiting for review.", "لديك مستندات كثيرة بانتظار المراجعة.")
  if ((today.count ?? 0) >= MAX_PER_DAY) return fail("Daily upload limit reached. Try again tomorrow.", "تم بلوغ الحد اليومي للرفع. حاول غداً.")
  const path = `${link.tenant_id}/${link.driver_id}/${p.data.docType}-${randomUUID()}.${ext}`
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return fail("Upload could not start. Try again.", "تعذر بدء الرفع. حاول مجدداً.")
  return { ok: true, path, uploadToken: data.token }
}

export async function finishPortalUpload(input: unknown): Promise<{ ok: true } | Fail> {
  const p = finish.safeParse(input)
  if (!p.success) return fail("Check the details and try again.", "تحقق من البيانات وحاول مجدداً.")
  const link = await resolvePortalLink(p.data.token)
  if (!link) return EXPIRED
  const prefix = `${link.tenant_id}/${link.driver_id}/`
  const name = p.data.path.slice(prefix.length)
  if (!p.data.path.startsWith(prefix) || !/^[a-z_]+-[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf)$/.test(name) || !name.startsWith(`${p.data.docType}-`)) return fail("Invalid upload.", "ملف غير صالح.")
  const admin = createAdminClient()
  const { data: list } = await admin.storage.from(BUCKET).list(prefix.slice(0, -1), { search: name, limit: 1 })
  const obj = list?.find((o) => o.name === name)
  const size = Number((obj?.metadata as { size?: number } | undefined)?.size ?? 0)
  const mime = String((obj?.metadata as { mimetype?: string } | undefined)?.mimetype ?? "")
  if (!obj || size <= 0 || size > MAX || !MIME[mime]) return fail("The file did not upload correctly. Try again.", "لم يكتمل رفع الملف. حاول مجدداً.")
  const { data: dup } = await admin.from("driver_portal_submissions").select("id").eq("file_path", p.data.path).maybeSingle()
  if (dup) return { ok: true }
  const { data: row, error } = await admin.from("driver_portal_submissions").insert({
    tenant_id: link.tenant_id, driver_id: link.driver_id, link_id: link.id, doc_type: p.data.docType,
    doc_number: p.data.docNumber || null, expiry_date: p.data.expiryDate || null, file_path: p.data.path, mime_type: mime, file_size: size, driver_note: p.data.note || null,
  }).select("id").single()
  if (error || !row) return fail("Could not save. Try again.", "تعذر الحفظ. حاول مجدداً.")
  await admin.from("driver_portal_links").update({ last_used_at: new Date().toISOString() }).eq("id", link.id)
  await admin.from("audit_log").insert({ tenant_id: link.tenant_id, actor_id: null, module: "drivers", entity_type: "driver_portal_submission", entity_id: row.id, action: "portal_submission_created", new_values: { driver_id: link.driver_id, doc_type: p.data.docType } })
  return { ok: true }
}
