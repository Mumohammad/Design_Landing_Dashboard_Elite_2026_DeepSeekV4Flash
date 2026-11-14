"use server"
// Server actions for expense claims. Reads use the caller's RLS-scoped client;
// writes go through SECURITY DEFINER RPCs that enforce permission, ownership
// and workflow. Service-role access is limited to storage objects, display
// names and the attachment registration RPC (after a caller access check).
import { revalidatePath } from "next/cache"
import { can, getCurrentUser } from "@/lib/auth/authorization"
import { rateLimit } from "@/lib/auth/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { registerStoredAttachment } from "./attachments"
import {
  CLAIM_STATUSES, DEFAULT_SETTINGS, EDITABLE_FIELDS, FIELD_LABELS, RECEIPT_BUCKET, STATUS_LABELS, categoryLabel, claimErrorMessage,
  type Bi, type ClaimAttachment, type ClaimSettings, type ExpenseClaim,
} from "./constants"
import { filterClaims, type ClaimFilters } from "./dashboard"
import { readClaimDisplayNames, readCompleteAttachments, readCompleteClaims } from "./complete-reads"
import { normalizeVatNumber } from "./zatca-check"
import { exportFilename, writeExpenseWorkbook } from "./export-xlsx"
import { getBotUsername, telegramConfigured, tg, webhookUrl } from "./telegram"

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; errorAr: string }
const fail = (en: string, ar: string): { ok: false; error: string; errorAr: string } => ({ ok: false, error: en, errorAr: ar })
const failFrom = (err: unknown) => fail(claimErrorMessage(err, "en"), claimErrorMessage(err, "ar"))
const denied = () => fail("You do not have permission for this action.", "ليس لديك صلاحية لهذا الإجراء.")
const busy = () => fail("Too many requests. Wait a moment and try again.", "طلبات كثيرة. انتظر قليلاً وحاول مجدداً.")

export interface ExpenseAccess { userId: string; tenantId: string; create: boolean; read: boolean; approve: boolean; export: boolean; manage: boolean }

export async function getExpenseAccess(): Promise<ExpenseAccess | null> {
  const me = await getCurrentUser()
  if (!me) return null
  const [c, r, a, e, m] = await Promise.all((["create", "read", "approve", "export", "manage"] as const).map((x) => can("expense_claims", x)))
  return { userId: me.authUserId, tenantId: me.tenantId, create: c.allowed, read: r.allowed, approve: a.allowed, export: e.allowed, manage: m.allowed }
}

async function guard(key: string, limit = 60) {
  const me = await getCurrentUser()
  if (!me) return null
  const rl = await rateLimit(`expense-claims:${key}:${me.authUserId}`, limit, "minute").catch(() => ({ success: false }))
  return rl.success ? me : "busy"
}

function touch(id?: string) {
  try { revalidatePath("/expenses/claims"); if (id) revalidatePath(`/expenses/claims/${id}`) } catch { /* already committed */ }
}

export async function getClaimSettings(): Promise<ClaimSettings> {
  const me = await getCurrentUser()
  if (!me) throw Error("Expense settings are unavailable")
  const checks = await Promise.all((["create", "read", "manage"] as const).map(action => can("expense_claims", action)))
  if (!checks.some(check => check.allowed)) throw Error("Expense settings are unavailable")
  const supabase = await createClient()
  const { data, error } = await supabase.from("expense_claim_settings").select("*").eq("tenant_id", me.tenantId).maybeSingle()
  if (error) throw Error("Expense settings are unavailable")
  // An authorized, successful empty read means SQL's initial defaults apply.
  // Database writes initialize defaults transactionally when first required.
  return data ? { ...DEFAULT_SETTINGS, ...(data as Partial<ClaimSettings>) } : DEFAULT_SETTINGS
}

/** Names of actors in claims visible to this authorized caller, never a directory. */
export async function getTenantUserNames(): Promise<Record<string, string>> {
  const me = await getCurrentUser()
  if (!me) return {}
  const allowed = await Promise.all((["create", "read", "approve", "export", "manage"] as const).map(action => can("expense_claims", action)))
  if (!allowed.some(check => check.allowed)) return {}
  const claims = await readCompleteClaims(await createClient())
  const actors = claims.flatMap(claim => [claim.submitter_id, claim.reviewer_id, claim.verified_by]).filter((id): id is string => typeof id === "string")
  return readClaimDisplayNames(createAdminClient(), me.tenantId, [me.authUserId, ...actors])
}

function cleanFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of EDITABLE_FIELDS) if (k in input) {
    const v = input[k]
    out[k] = v === null || v === undefined ? "" : String(v).slice(0, 2000)
  }
  if (Array.isArray(input.unverified_fields)) out.unverified_fields = input.unverified_fields.filter((x) => typeof x === "string" && (EDITABLE_FIELDS as readonly string[]).includes(x)).slice(0, 30)
  if (input.ocr_suggestions && typeof input.ocr_suggestions === "object") {
    const s = JSON.stringify(input.ocr_suggestions)
    if (s.length <= 20000) out.ocr_suggestions = input.ocr_suggestions
  }
  for (const k of ["amount_before_vat", "vat_amount", "total_amount", "vat_rate"] as const) {
    if (typeof out[k] === "string" && out[k] !== "" && !/^\d{1,9}(\.\d{1,2})?$/.test(out[k] as string)) throw new Error("EXC001: invalid amount")
  }
  if (typeof out.expense_date === "string" && out.expense_date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(out.expense_date)) throw new Error("EXC001: invalid date")
  if (typeof out.currency === "string" && out.currency !== "" && !/^[A-Za-z]{3}$/.test(out.currency)) throw new Error("EXC001: invalid currency")
  if (typeof out.supplier_vat_number === "string") out.supplier_vat_number = normalizeVatNumber(out.supplier_vat_number)
  return out
}

export async function saveExpenseClaim(id: string | null, fields: Record<string, unknown>, expectedVersion?: number | null): Promise<ActionResult<{ id: string; claimNo: string; version: number; duplicateStatus: string }>> {
  const me = await guard("save", 60)
  if (!me) return denied()
  if (me === "busy") return busy()
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("expense_claim_save", { p_id: id, p_fields: cleanFields(fields), p_expected_version: expectedVersion ?? null })
    if (error) return failFrom(error)
    const r = data as { id: string; claim_no: string; version: number; duplicate_status: string }
    touch(r.id)
    return { ok: true, id: r.id, claimNo: r.claim_no, version: r.version, duplicateStatus: r.duplicate_status }
  } catch (e) { return failFrom(e) }
}

export type TransitionAction = "submit" | "approve" | "reject" | "request_info" | "reimburse"

export async function transitionExpenseClaim(id: string, action: TransitionAction, opts: { comment?: string; expectedVersion?: number; reference?: string } = {}): Promise<ActionResult<{ status: string; version: number }>> {
  if (!["submit", "approve", "reject", "request_info", "reimburse"].includes(action)) return denied()
  const me = await guard("transition", 60)
  if (!me) return denied()
  if (me === "busy") return busy()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("expense_claim_transition", {
    p_id: id, p_action: action, p_comment: opts.comment?.slice(0, 2000) ?? null, p_expected_version: opts.expectedVersion ?? null, p_reference: opts.reference?.slice(0, 120) ?? null,
  })
  if (error) return failFrom(error)
  touch(id)
  const r = data as { status: string; version: number }
  return { ok: true, status: r.status, version: r.version }
}

export async function saveClaimChecklist(id: string, checklist: Record<string, "yes" | "no" | "na">): Promise<ActionResult> {
  const me = await guard("checklist", 60)
  if (!me) return denied()
  if (me === "busy") return busy()
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(checklist).slice(0, 40)) if (/^[a-z0-9_]{1,40}$/.test(k) && ["yes", "no", "na"].includes(v)) clean[k] = v
  const { error } = await (await createClient()).rpc("expense_claim_save_checklist", { p_id: id, p_checklist: clean })
  if (error) return failFrom(error)
  touch(id)
  return { ok: true }
}

export async function resolveClaimDuplicate(id: string, resolution: "not_duplicate" | "duplicate", comment: string): Promise<ActionResult> {
  const me = await guard("duplicate", 30)
  if (!me) return denied()
  if (me === "busy") return busy()
  const { error } = await (await createClient()).rpc("expense_claim_resolve_duplicate", { p_id: id, p_resolution: resolution, p_comment: comment.slice(0, 2000) })
  if (error) return failFrom(error)
  touch(id)
  return { ok: true }
}

export async function deleteDraftClaim(id: string): Promise<ActionResult> {
  const me = await guard("delete", 30)
  if (!me) return denied()
  if (me === "busy") return busy()
  const { error } = await (await createClient()).rpc("expense_claim_delete_draft", { p_id: id })
  if (error) return failFrom(error)
  touch()
  return { ok: true }
}

/** Registers a receipt the browser uploaded to `tenant/claim/uuid.ext` after content validation. */
export async function registerClaimAttachment(claimId: string, path: string, originalName: string): Promise<ActionResult<{ id: string; duplicateStatus: string }>> {
  const me = await guard("attach", 40)
  if (!me) return denied()
  if (me === "busy") return busy()
  // The caller must be able to see the claim (RLS); the RPC re-checks ownership/status.
  const { data: visible } = await (await createClient()).from("expense_claims").select("id").eq("id", claimId).maybeSingle()
  if (!visible) return failFrom(new Error("EXC002"))
  const r = await registerStoredAttachment({ actor: me.authUserId, tenantId: me.tenantId, claimId, path, originalName, source: "web" })
  if (!r.ok) return fail(r.message.en, r.message.ar)
  touch(claimId)
  return { ok: true, id: r.id, duplicateStatus: r.duplicateStatus }
}

/** Short-lived download link for an original receipt (served as a download, never inline). */
export async function getAttachmentDownloadUrl(attachmentId: string): Promise<ActionResult<{ url: string }>> {
  const me = await guard("download", 120)
  if (!me) return denied()
  if (me === "busy") return busy()
  const { data } = await (await createClient()).from("expense_claim_attachments").select("storage_path,original_filename").eq("id", attachmentId).maybeSingle()
  if (!data) return denied()
  const { data: signed, error } = await createAdminClient().storage.from(RECEIPT_BUCKET).createSignedUrl(data.storage_path, 60, { download: data.original_filename })
  if (error || !signed) return fail("The file is not available right now.", "الملف غير متاح حالياً.")
  return { ok: true, url: signed.signedUrl }
}

async function readAllClaims(): Promise<ExpenseClaim[]> {
  return readCompleteClaims(await createClient())
}

async function readAttachments(ids: string[]): Promise<ClaimAttachment[]> {
  return readCompleteAttachments(await createClient(), ids)
}

function sanitizeFilters(f: ClaimFilters): ClaimFilters {
  const list = (v: unknown, max = 50) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, max) : null)
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  return {
    from: date(f.from), to: date(f.to), q: typeof f.q === "string" ? f.q.slice(0, 100) : null,
    status: (list(f.status) ?? []).filter((s) => (CLAIM_STATUSES as readonly string[]).includes(s)) as ClaimFilters["status"],
    category: list(f.category), department: list(f.department), submitter: list(f.submitter, 500), currency: list(f.currency),
  }
}

export async function exportExpenseClaims(rawFilters: ClaimFilters, markExported: boolean): Promise<ActionResult<{ filename: string; base64: string; rows: number; marked: number }>> {
  const me = await guard("export", 10)
  if (!me) return denied()
  if (me === "busy") return busy()
  if (!(await can("expense_claims", "export")).allowed) return denied()
  try {
    const filters = sanitizeFilters(rawFilters)
    const [all, names, settings] = await Promise.all([readAllClaims(), getTenantUserNames(), getClaimSettings()])
    const claims = filterClaims(all, filters, names)
    if (claims.length === 0) return fail("No claims match the current filters.", "لا توجد مطالبات مطابقة لعوامل التصفية الحالية.")
    const attachments = await readAttachments(claims.map((c) => c.id))
    const desc: Array<[Bi, string]> = []
    if (filters.from || filters.to) desc.push([{ en: "Expense date", ar: "تاريخ المصروف" }, `${filters.from ?? "…"} → ${filters.to ?? "…"}`])
    const lang = settings.export_language
    const pick = (b: Bi) => (lang === "ar" ? b.ar : b.en)
    if (filters.status?.length) desc.push([FIELD_LABELS.status, filters.status.map((s) => pick(STATUS_LABELS[s])).join(", ")])
    if (filters.category?.length) desc.push([FIELD_LABELS.category, filters.category.map((c) => pick(categoryLabel(c))).join(", ")])
    if (filters.department?.length) desc.push([FIELD_LABELS.department, filters.department.join(", ")])
    if (filters.submitter?.length) desc.push([FIELD_LABELS.submitter, filters.submitter.map((s) => names[s] ?? s).join(", ")])
    if (filters.currency?.length) desc.push([FIELD_LABELS.currency, filters.currency.join(", ")])
    if (filters.q) desc.push([{ en: "Search", ar: "بحث" }, filters.q])
    const exportedAt = new Date()
    const { data: tenant } = await createAdminClient().from("tenants").select("name").eq("id", me.tenantId).maybeSingle()
    const { data: marked, error } = await (await createClient()).rpc("expense_claims_record_export", {
      p_ids: claims.map((c) => c.id), p_mark_exported: markExported, p_filters: { ...filters, mark_exported: markExported },
    })
    if (error) return failFrom(error)
    // Reflect the new "exported" status in the file when requested.
    const rows = markExported ? claims.map((c) => (c.status === "approved" ? { ...c, status: "exported" as const, exported_at: exportedAt.toISOString() } : c)) : claims
    const bytes = writeExpenseWorkbook({
      claims: rows, attachments, names, language: lang, amountLocale: settings.amount_locale, filters: desc, exportedAt,
      exportedBy: names[me.authUserId] ?? me.authUserId, companyName: (tenant as { name?: string } | null)?.name ?? undefined, markedExported: markExported,
    })
    touch()
    return { ok: true, filename: exportFilename(exportedAt), base64: Buffer.from(bytes).toString("base64"), rows: claims.length, marked: Number(marked ?? 0) }
  } catch (e) { return failFrom(e) }
}

export async function saveClaimSettings(input: Partial<ClaimSettings> & { confirm_checklist?: boolean; confirmation_note?: string }): Promise<ActionResult> {
  const me = await guard("settings", 20)
  if (!me) return denied()
  if (me === "busy") return busy()
  const p: Record<string, unknown> = {}
  if (input.export_language && ["en", "ar", "both"].includes(input.export_language)) p.export_language = input.export_language
  if (input.amount_locale && ["en-US", "ar-SA"].includes(input.amount_locale)) p.amount_locale = input.amount_locale
  if (input.default_currency && /^[A-Za-z]{3}$/.test(input.default_currency)) p.default_currency = input.default_currency.toUpperCase()
  if (typeof input.allow_self_approval === "boolean") p.allow_self_approval = input.allow_self_approval
  if (typeof input.telegram_enabled === "boolean") p.telegram_enabled = input.telegram_enabled
  if (Array.isArray(input.categories)) {
    const cats = [...new Set(input.categories.map((c) => String(c).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)).filter(Boolean))].slice(0, 60)
    if (!cats.length) return fail("Keep at least one category.", "يجب إبقاء فئة واحدة على الأقل.")
    p.categories = cats
  }
  if (Array.isArray(input.checklist)) {
    const items = input.checklist.slice(0, 40).map((i, n) => ({
      key: (String(i.key || `item_${n + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40)) || `item_${n + 1}`,
      en: String(i.en ?? "").trim().slice(0, 200), ar: String(i.ar ?? "").trim().slice(0, 200), enabled: i.enabled !== false,
    })).filter((i) => i.en || i.ar)
    if (new Set(items.map((i) => i.key)).size !== items.length) return fail("Checklist keys must be unique.", "يجب أن تكون مفاتيح القائمة فريدة.")
    p.checklist = items
  }
  if (input.confirm_checklist === true) {
    if (!input.confirmation_note?.trim()) return fail("Add a confirmation note (name / role of the person who reviewed the rules).", "أضف ملاحظة التأكيد (اسم ودور من راجع القواعد).")
    p.confirm_checklist = true
    p.confirmation_note = input.confirmation_note.slice(0, 1000)
  }
  const { error } = await (await createClient()).rpc("expense_claim_settings_save", { p_settings: p })
  if (error) return failFrom(error)
  try { revalidatePath("/expenses/claims/settings") } catch { /* ignore */ }
  return { ok: true }
}

// ── Telegram ──
export interface TelegramStatus {
  configured: { token: boolean; secret: boolean; url: boolean }
  enabled: boolean
  botUsername: string | null
  myLink: { username: string | null; linkedAt: string } | null
}

export async function getTelegramStatus(): Promise<TelegramStatus | null> {
  const me = await getCurrentUser()
  if (!me) return null
  const supabase = await createClient()
  const [settings, link] = await Promise.all([
    getClaimSettings(),
    supabase.from("expense_telegram_links").select("telegram_username,linked_at").eq("user_id", me.authUserId).is("revoked_at", null).maybeSingle(),
  ])
  const cfg = telegramConfigured()
  return {
    configured: { ...cfg, url: Boolean(webhookUrl()) },
    enabled: settings.telegram_enabled,
    botUsername: cfg.token ? await getBotUsername() : null,
    myLink: link.data ? { username: link.data.telegram_username, linkedAt: link.data.linked_at } : null,
  }
}

export async function createTelegramLinkCode(): Promise<ActionResult<{ code: string; expiresAt: string; deepLink: string | null; botUsername: string | null }>> {
  const me = await guard("tg-code", 5)
  if (!me) return denied()
  if (me === "busy") return busy()
  if (!telegramConfigured().token) return fail("The Telegram bot is not configured on the server yet.", "لم يتم إعداد بوت تيليجرام على الخادم بعد.")
  const { data, error } = await (await createClient()).rpc("expense_telegram_create_link_code")
  if (error) return failFrom(error)
  const r = data as { code: string; expires_at: string }
  const bot = await getBotUsername()
  return { ok: true, code: r.code, expiresAt: r.expires_at, botUsername: bot, deepLink: bot ? `https://t.me/${bot}?start=${encodeURIComponent(r.code)}` : null }
}

export async function unlinkTelegram(userId?: string): Promise<ActionResult> {
  const me = await guard("tg-unlink", 10)
  if (!me) return denied()
  if (me === "busy") return busy()
  const { error } = await (await createClient()).rpc("expense_telegram_unlink", { p_user: userId ?? null })
  if (error) return failFrom(error)
  return { ok: true }
}

export async function listTelegramLinks(): Promise<Array<{ userId: string; name: string; username: string | null; linkedAt: string }>> {
  if (!(await can("expense_claims", "manage")).allowed) return []
  const [{ data }, names] = await Promise.all([
    (await createClient()).from("expense_telegram_links").select("user_id,telegram_username,linked_at").is("revoked_at", null).order("linked_at", { ascending: false }).limit(500),
    getTenantUserNames(),
  ])
  return (data ?? []).map((l) => ({ userId: l.user_id, name: names[l.user_id] ?? "—", username: l.telegram_username, linkedAt: l.linked_at }))
}

export async function getTelegramWebhookInfo(): Promise<ActionResult<{ expectedUrl: string | null; registered: boolean; pending: number; lastError: string | null }>> {
  if (!(await can("expense_claims", "manage")).allowed) return denied()
  if (!telegramConfigured().token) return fail("TELEGRAM_BOT_TOKEN is not set on the server.", "لم يتم ضبط TELEGRAM_BOT_TOKEN على الخادم.")
  try {
    const info = await tg<{ url?: string; pending_update_count?: number; last_error_message?: string }>("getWebhookInfo")
    const expected = webhookUrl()
    return { ok: true, expectedUrl: expected, registered: Boolean(expected && info.url === expected), pending: info.pending_update_count ?? 0, lastError: info.last_error_message?.slice(0, 200) ?? null }
  } catch { return fail("Could not reach Telegram.", "تعذر الاتصال بتيليجرام.") }
}

export async function registerTelegramWebhook(): Promise<ActionResult> {
  const me = await guard("tg-webhook", 5)
  if (!me) return denied()
  if (me === "busy") return busy()
  if (!(await can("expense_claims", "manage")).allowed) return denied()
  const cfg = telegramConfigured(), url = webhookUrl()
  if (!cfg.token || !cfg.secret || !url) return fail("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (24+ chars) and NEXT_PUBLIC_APP_URL (https) on the server first.", "اضبط TELEGRAM_BOT_TOKEN وTELEGRAM_WEBHOOK_SECRET (24 حرفاً أو أكثر) وNEXT_PUBLIC_APP_URL (https) على الخادم أولاً.")
  try {
    await tg("setWebhook", { url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], max_connections: 10 })
    await tg("setMyCommands", { commands: [
      { command: "start", description: "Link your account with a one-time code" },
      { command: "help", description: "How to send receipts" },
      { command: "unlink", description: "Disconnect this Telegram account" },
    ] }).catch(() => undefined)
    await createAdminClient().from("audit_log").insert({ tenant_id: me.tenantId, actor_id: me.authUserId, module: "expense_claims", entity_type: "telegram_webhook", action: "expense_telegram_webhook_registered", new_values: { url } })
    return { ok: true }
  } catch { return fail("Telegram rejected the webhook registration. Check the bot token.", "رفض تيليجرام تسجيل الـ webhook. تحقق من رمز البوت.") }
}

/**
 * Quick upload: reads the claim's uploaded receipt on the server (ZATCA QR, e-invoice XML,
 * PDF text) and fills EMPTY fields only, marked unverified. Only the submitter's own draft
 * or needs-info claim is touched (expense_claim_save re-checks ownership and status).
 */
export async function autofillClaimFromReceipt(claimId: string): Promise<ActionResult<{ version: number; fields: Record<string, string>; source: string[]; summary: string }>> {
  const me = await guard("autofill", 20)
  if (!me) return denied()
  if (me === "busy") return busy()
  try {
    const supabase = await createClient()
    const { data: c } = await supabase.from("expense_claims").select("*").eq("id", claimId).maybeSingle()
    if (!c || c.submitter_id !== me.authUserId || !["draft", "needs_info"].includes(c.status)) return failFrom(new Error("EXC002"))
    const { data: atts } = await supabase.from("expense_claim_attachments").select("storage_path,mime_type").eq("claim_id", claimId).order("uploaded_at", { ascending: true }).limit(5)
    const { extractReceiptDataWithin, readSummary } = await import("./extract")
    const admin = createAdminClient()
    let ex: Awaited<ReturnType<typeof extractReceiptDataWithin>> | null = null
    for (const a of atts ?? []) {
      const { data: blob } = await admin.storage.from(RECEIPT_BUCKET).download(a.storage_path)
      if (!blob) continue
      const r = await extractReceiptDataWithin(new Uint8Array(await blob.arrayBuffer()), a.mime_type, 20_000)
      if (Object.keys(r.fields).length && (!ex || Object.keys(r.fields).length > Object.keys(ex.fields).length)) ex = r
      if (ex?.source.includes("qr")) break
    }
    const found = (ex?.fields ?? {}) as Record<string, string>
    const row = c as Record<string, unknown>
    const fill: Record<string, string> = {}
    for (const [k, v] of Object.entries(found)) if (v && (row[k] === null || row[k] === "" || (k === "currency" && row[k] === "SAR"))) fill[k] = v
    let version = c.version as number
    if (Object.keys(fill).length) {
      const prevUnverified = Array.isArray(c.unverified_fields) ? (c.unverified_fields as string[]) : []
      const saved = await saveExpenseClaim(claimId, {
        ...fill,
        unverified_fields: Array.from(new Set([...prevUnverified, ...Object.keys(fill)])),
        ocr_suggestions: { ...(typeof c.ocr_suggestions === "object" && c.ocr_suggestions ? c.ocr_suggestions : {}), file: found, file_source: ex?.source ?? [], qr_phase2: ex?.qrPhase2 ?? null },
      }, version)
      if (!saved.ok) return saved
      version = saved.version
    }
    return { ok: true, version, fields: fill, source: ex?.source ?? [], summary: readSummary(found, ex?.source ?? []).trim() }
  } catch (e) { return failFrom(e) }
}
