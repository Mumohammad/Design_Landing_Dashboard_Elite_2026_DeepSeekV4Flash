import "server-only"
import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { RECEIPT_BUCKET, type Bi } from "./constants"
import { safeFilename, sniffFile } from "./file-check"

export const ATTACHMENT_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf|xml)$/

export type RegisterResult = { ok: true; id: string; duplicateStatus: string } | { ok: false; message: Bi }

const GENERIC: Bi = { en: "The file could not be attached. Please try again.", ar: "تعذر إرفاق الملف. حاول مرة أخرى." }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DUPLICATE_STATUSES = new Set(["none", "possible", "not_duplicate", "duplicate"])
type AttachmentInput = {
  actor: string; tenantId: string; claimId: string; path: string; originalName: string; source: "web" | "telegram"; bytes?: Uint8Array
}

function registeredResult(value: unknown): RegisterResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  return typeof row.id === "string" && UUID.test(row.id) && typeof row.duplicate_status === "string" && DUPLICATE_STATUSES.has(row.duplicate_status)
    ? { ok: true, id: row.id, duplicateStatus: row.duplicate_status } : null
}

function definiteRejection(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : null
  return typeof code === "string" && code !== "23505" && /^(22|23|42|P0)[A-Z0-9]{3}$/.test(code)
}

/** A path alone cannot prove that an uncertain write was this registration. */
async function recoverRegistration(admin: ReturnType<typeof createAdminClient>, args: AttachmentInput, expected: Record<string, unknown>): Promise<RegisterResult | null> {
  try {
    const { data, error } = await admin.from("expense_claim_attachments")
      .select("id,tenant_id,claim_id,storage_path,uploaded_by,source,original_filename,sha256,size_bytes,mime_type,doc_kind")
      .eq("tenant_id", args.tenantId).eq("claim_id", args.claimId).eq("storage_path", args.path).eq("uploaded_by", args.actor).maybeSingle()
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return null
    const row = data as Record<string, unknown>
    if (Object.entries(expected).some(([key, value]) => row[key] !== value)) return null
    const claim = await admin.from("expense_claims").select("id,tenant_id,duplicate_status")
      .eq("id", args.claimId).eq("tenant_id", args.tenantId).maybeSingle()
    if (claim.error || claim.data?.id !== args.claimId || claim.data?.tenant_id !== args.tenantId) return null
    return registeredResult({ id: row.id, duplicate_status: claim.data.duplicate_status })
  } catch { return null }
}

/**
 * Validates stored receipt bytes by content and registers them on the claim.
 * Originals are retained even when registration fails: an error or empty read
 * does not prove that this attempt exclusively owns an unregistered object.
 */
export async function registerStoredAttachment(args: AttachmentInput): Promise<RegisterResult> {
  if (!ATTACHMENT_PATH.test(args.path) || !args.path.startsWith(`${args.tenantId}/${args.claimId}/`)) return { ok: false, message: GENERIC }
  const admin = createAdminClient()
  const bucket = admin.storage.from(RECEIPT_BUCKET)
  let bytes = args.bytes
  if (!bytes) {
    try {
      const { data, error } = await bucket.download(args.path)
      if (error || !data) return { ok: false, message: GENERIC }
      bytes = new Uint8Array(await data.arrayBuffer())
    } catch { return { ok: false, message: GENERIC } }
  }
  const sniff = sniffFile(bytes)
  if (!sniff.ok) return { ok: false, message: sniff.message }
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const filename = safeFilename(args.originalName, sniff.ext)
  const expected = { tenant_id: args.tenantId, claim_id: args.claimId, storage_path: args.path, uploaded_by: args.actor, source: args.source,
    original_filename: filename, sha256, size_bytes: bytes.byteLength, mime_type: sniff.mime, doc_kind: sniff.kind }
  let response
  try { response = await admin.rpc("expense_claim_attach", {
    p_actor: args.actor, p_claim_id: args.claimId, p_path: args.path, p_filename: filename,
    p_mime: sniff.mime, p_size: bytes.byteLength, p_sha256: sha256, p_kind: sniff.kind, p_source: args.source,
  }) } catch (error) {
    if (definiteRejection(error)) return { ok: false, message: GENERIC }
    return (await recoverRegistration(admin, args, expected)) ?? { ok: false, message: GENERIC }
  }
  const { data, error } = response
  if (!error) {
    const registered = registeredResult(data)
    if (registered) return registered
  }
  // Only an unknown outcome or a unique-path retry can be reconciled. A
  // definite authorization/workflow rejection must remain a rejection.
  if (!definiteRejection(error)) {
    const registered = await recoverRegistration(admin, args, expected)
    if (registered) return registered
  }
  if (error) {
    const code = /EXC0\d\d|AUTH007/.exec(error.message ?? "")?.[0]
    if (code === "EXC014") return { ok: false, message: { en: "Up to 10 attachments per claim.", ar: "الحد الأقصى 10 مرفقات لكل مطالبة." } }
    if (code === "EXC004") return { ok: false, message: { en: "Attachments cannot be added to this claim in its current status.", ar: "لا يمكن إضافة مرفقات لهذه المطالبة في حالتها الحالية." } }
    return { ok: false, message: GENERIC }
  }
  return { ok: false, message: GENERIC }
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
