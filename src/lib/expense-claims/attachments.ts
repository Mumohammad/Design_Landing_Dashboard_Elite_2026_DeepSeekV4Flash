import "server-only"
import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { RECEIPT_BUCKET, type Bi } from "./constants"
import { safeFilename, sniffFile } from "./file-check"

export const ATTACHMENT_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf|xml)$/

export type RegisterResult = { ok: true; id: string; duplicateStatus: string } | { ok: false; message: Bi }

const GENERIC: Bi = { en: "The file could not be attached. Please try again.", ar: "تعذر إرفاق الملف. حاول مرة أخرى." }

/**
 * Validates stored receipt bytes by content and registers them on the claim.
 * The original object is never modified; rejected objects are deleted.
 */
export async function registerStoredAttachment(args: {
  actor: string; tenantId: string; claimId: string; path: string; originalName: string; source: "web" | "telegram"; bytes?: Uint8Array
}): Promise<RegisterResult> {
  const admin = createAdminClient()
  const bucket = admin.storage.from(RECEIPT_BUCKET)
  if (!ATTACHMENT_PATH.test(args.path) || !args.path.startsWith(`${args.tenantId}/${args.claimId}/`)) return { ok: false, message: GENERIC }
  let bytes = args.bytes
  if (!bytes) {
    const { data, error } = await bucket.download(args.path)
    if (error || !data) return { ok: false, message: GENERIC }
    bytes = new Uint8Array(await data.arrayBuffer())
  }
  const sniff = sniffFile(bytes)
  if (!sniff.ok) {
    await bucket.remove([args.path]).catch(() => undefined)
    return { ok: false, message: sniff.message }
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const { data, error } = await admin.rpc("expense_claim_attach", {
    p_actor: args.actor, p_claim_id: args.claimId, p_path: args.path, p_filename: safeFilename(args.originalName, sniff.ext),
    p_mime: sniff.mime, p_size: bytes.byteLength, p_sha256: sha256, p_kind: sniff.kind, p_source: args.source,
  })
  if (error) {
    await bucket.remove([args.path]).catch(() => undefined)
    const code = /EXC0\d\d|AUTH007/.exec(error.message ?? "")?.[0]
    if (code === "EXC014") return { ok: false, message: { en: "Up to 10 attachments per claim.", ar: "الحد الأقصى 10 مرفقات لكل مطالبة." } }
    if (code === "EXC004") return { ok: false, message: { en: "Attachments cannot be added to this claim in its current status.", ar: "لا يمكن إضافة مرفقات لهذه المطالبة في حالتها الحالية." } }
    return { ok: false, message: GENERIC }
  }
  const r = data as { id: string; duplicate_status: string }
  return { ok: true, id: r.id, duplicateStatus: r.duplicate_status }
}

/** Uploads server-received bytes (Telegram) and registers them. */
export async function uploadAndRegister(args: { actor: string; tenantId: string; claimId: string; bytes: Uint8Array; originalName: string; source: "web" | "telegram" }): Promise<RegisterResult> {
  const sniff = sniffFile(args.bytes)
  if (!sniff.ok) return { ok: false, message: sniff.message }
  const path = `${args.tenantId}/${args.claimId}/${crypto.randomUUID()}.${sniff.ext}`
  const admin = createAdminClient()
  const { error } = await admin.storage.from(RECEIPT_BUCKET).upload(path, args.bytes, { contentType: sniff.mime, upsert: false })
  if (error) return { ok: false, message: GENERIC }
  return registerStoredAttachment({ ...args, path })
}
