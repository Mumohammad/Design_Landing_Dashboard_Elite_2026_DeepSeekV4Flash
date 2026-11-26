// Telegram webhook for the expense receipt bot.
// - Authenticated by Telegram's X-Telegram-Bot-Api-Secret-Token header.
// - Only private chats from Telegram accounts linked with a one-time code
//   are accepted; anything else is rejected without storing files.
// - Receipts become SUBMITTED (pending review) claims; caption details are
//   stored as unverified suggestions. Nothing is approved automatically and
//   nothing is sent to ZATCA.
import { createHash, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { rateLimit } from "@/lib/auth/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { ATTACHMENT_PATH } from "@/lib/expense-claims/attachments"
import { MAX_ATTACHMENT_BYTES, RECEIPT_BUCKET } from "@/lib/expense-claims/constants"
import { safeFilename, sniffFile } from "@/lib/expense-claims/file-check"
import { bareLinkCode, parseCaption } from "@/lib/expense-claims/receipt-parse"
import { claimPayload, extractReceiptDataWithin, readSummary } from "@/lib/expense-claims/extract"
import { zatcaPurchaseCheck } from "@/lib/expense-claims/zatca-check"
import { downloadTelegramFile, sendMessage } from "@/lib/expense-claims/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

type TgUser = { id: number; username?: string }
type TgMessage = {
  message_id: number
  date: number
  from?: TgUser
  chat: { id: number; type: string }
  text?: string
  caption?: string
  media_group_id?: string
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
}

const ok = () => NextResponse.json({ ok: true })
const retry = (status = 503) => NextResponse.json({ ok: false }, { status, headers: { "Retry-After": "60" } })
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex")

type ReceiptReservation = { receipt_id: string; path: string; claim_id: string; completed: boolean }
type ReceiptResult = { claim_id: string; claim_no: string; created: boolean; duplicate_status: string }

function secretMatches(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
  if (expected.length < 24 || !header) return false
  const a = Buffer.from(header), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const T = {
  help: "Send a photo or PDF of a receipt (CamScanner PDFs are fine). Add a caption like:\ntotal 115 vat 15 supplier \"Shell Station\" vatno 300000000000003 invoice INV-123 date 2026-11-02 category fuel purpose delivery run\n\nأرسل صورة أو ملف PDF للإيصال، ويمكنك إضافة وصف مثل:\nالمبلغ 115 ضريبة 15 المورد \"محطة شل\" ضريبي 300000000000003 الفاتورة INV-123 الفئة وقود الغرض توصيل\n\nZATCA: for VAT to be claimable the receipt needs the supplier VAT number, invoice number and date. / لخصم الضريبة يلزم الرقم الضريبي للمورد ورقم الفاتورة وتاريخها.\n\nReceipts are supporting documents for internal review only — they are not e-invoices and are not sent to ZATCA.",
  notLinked: "This Telegram account is not linked to a company user, so the file was not accepted. Open Expenses → Link Telegram in the dashboard, generate a one-time code and send it here.\n\nحساب تيليجرام هذا غير مربوط بمستخدم في الشركة، لذلك لم يُقبل الملف. افتح المصروفات ← ربط تيليجرام في لوحة التحكم، وأنشئ رمزاً لمرة واحدة وأرسله هنا.",
  linked: "✅ Linked. You can now send receipt photos or PDFs here.\n✅ تم الربط. يمكنك الآن إرسال صور الإيصالات أو ملفات PDF هنا.",
  badCode: "That code is invalid or expired. Create a new one in the dashboard (codes last 10 minutes and work once).\nالرمز غير صالح أو منتهي. أنشئ رمزاً جديداً من لوحة التحكم (صالح 10 دقائق ولمرة واحدة).",
  unlinked: "This Telegram account has been unlinked.\nتم إلغاء ربط حساب تيليجرام هذا.",
  tooLarge: "Files must be 10 MB or smaller.\nيجب ألا يتجاوز حجم الملف 10 ميجابايت.",
  slow: "Too many messages. Please wait a minute.\nرسائل كثيرة، انتظر دقيقة من فضلك.",
  failed: "The receipt could not be saved. Please try again or upload it in the dashboard.\nتعذر حفظ الإيصال. حاول مرة أخرى أو ارفعه من لوحة التحكم.",
  groupOnly: "For privacy, receipts are accepted only in a private chat with the bot.\nللخصوصية، تُقبل الإيصالات فقط في محادثة خاصة مع البوت.",
}

export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"))) return new NextResponse("unauthorized", { status: 401 })
  const botId = Number(/^([1-9]\d*):[A-Za-z0-9_-]{20,}$/.exec(process.env.TELEGRAM_BOT_TOKEN ?? "")?.[1])
  if (!Number.isSafeInteger(botId)) return retry()
  const update = (await req.json().catch(() => null)) as { update_id: number; message?: TgMessage } | null
  const msg = update?.message
  if (!msg?.from || !msg.chat) return ok()
  if (msg.chat.type !== "private") { if (msg.photo || msg.document) await sendMessage(msg.chat.id, T.groupOnly); return ok() }
  const updateId = update?.update_id
  if (updateId === undefined || !Number.isSafeInteger(updateId) || updateId < 0 ||
    !Number.isSafeInteger(msg.message_id) || msg.message_id <= 0 ||
    !Number.isSafeInteger(msg.from.id) || !Number.isSafeInteger(msg.chat.id)) return ok()
  try { return (await handle(botId, updateId, msg, msg.from)) ?? ok() }
  catch {
    if (msg.document || msg.photo?.length) return retry()
    await sendMessage(msg.chat.id, T.failed)
    return ok()
  }
}

async function handle(botId: number, updateId: number, msg: TgMessage, from: TgUser) {
  const chat = msg.chat.id
  const rl = await rateLimit(`tg-expense:${from.id}`, 20, "minute")
  if (!rl.success) {
    if (msg.document || msg.photo?.length) return retry(429)
    await sendMessage(chat, T.slow)
    return
  }
  const admin = createAdminClient()
  const text = msg.text?.trim() ?? ""

  const cmd = /^\/(start|link)(?:@\w+)?(?:\s+([A-Za-z0-9 -]{6,30}))?$/i.exec(text)
  const code = cmd ? (cmd[2] ?? "").replace(/[\s-]/g, "") : bareLinkCode(text)
  if (cmd || code) {
    if (!code) { await sendMessage(chat, `${T.help}\n\n${T.notLinked}`); return }
    const { data, error } = await admin.rpc("expense_telegram_consume_link", { p_code: code, p_tg_user: from.id, p_chat: chat, p_username: from.username ?? null })
    if (error) { await sendMessage(chat, T.failed); return }
    await sendMessage(chat, (data as { ok?: boolean } | null)?.ok ? `${T.linked}\n\n${T.help}` : T.badCode)
    return
  }
  if (/^\/help/i.test(text)) { await sendMessage(chat, T.help); return }
  if (/^\/unlink/i.test(text)) {
    const { data: rows, error } = await admin.from("expense_telegram_links").update({ revoked_at: new Date().toISOString() })
      .eq("telegram_user_id", from.id).is("revoked_at", null).select("tenant_id,user_id")
    if (error) { await sendMessage(chat, T.failed); return }
    for (const r of rows ?? []) await admin.from("audit_log").insert({ tenant_id: r.tenant_id, actor_id: r.user_id, module: "expense_claims", entity_type: "expense_telegram_links", entity_id: r.user_id, action: "expense_telegram_unlinked" })
    await sendMessage(chat, T.unlinked)
    return
  }

  const file = msg.document
    ? { id: msg.document.file_id, size: msg.document.file_size ?? 0, name: msg.document.file_name ?? "telegram-document" }
    : msg.photo?.length
      ? (() => { const p = [...msg.photo!].sort((a, b) => b.width * b.height - a.width * a.height)[0]; return { id: p.file_id, size: p.file_size ?? 0, name: `telegram-photo-${msg.message_id}.jpg` } })()
      : null
  if (!file) { if (text) await sendMessage(chat, T.help); return }

  // Identify before touching the file: unidentified senders are rejected.
  const { data: who, error: identityError } = await admin.rpc("expense_telegram_identity", { p_tg_user: from.id, p_chat: chat })
  if (identityError) return retry()
  const id = who as { ok: boolean; user_id?: string; tenant_id?: string; currency?: string; link_id?: string } | null
  if (!id?.ok || !id.user_id || !id.tenant_id) { await sendMessage(chat, T.notLinked); return }
  if (!id.link_id) return retry()
  if (!Number.isSafeInteger(msg.date) || msg.date <= 0) return
  if (file.size > MAX_ATTACHMENT_BYTES) { await sendMessage(chat, T.tooLarge); return }

  const bytes = await downloadTelegramFile(file.id, MAX_ATTACHMENT_BYTES)
  if (!bytes) { await sendMessage(chat, T.tooLarge); return }
  const sniff = sniffFile(bytes)
  if (!sniff.ok) { await sendMessage(chat, `${sniff.message.en}\n${sniff.message.ar}`); return }

  const sha256 = digest(bytes)
  const filename = safeFilename(file.name, sniff.ext)
  const album = msg.media_group_id ?? null
  const { data: reserved, error: reserveError } = await admin.rpc("expense_telegram_reserve_receipt", {
    p_bot_id: botId, p_update_id: updateId, p_sender_id: from.id, p_chat_id: chat, p_message_id: msg.message_id,
    p_message_date: msg.date, p_link_id: id.link_id, p_media_group: album,
    p_fingerprint: digest(JSON.stringify([file.id, msg.caption ?? null, album, msg.date])),
    p_file: { filename, mime: sniff.mime, kind: sniff.kind, size: bytes.byteLength, sha256 },
  })
  if (reserveError?.message.includes("TG_RECEIPT_DENIED")) { await sendMessage(chat, T.notLinked); return }
  if (reserveError?.message.includes("TG_RECEIPT_CONFLICT")) { await sendMessage(chat, T.failed); return }
  if (reserveError || !reserved) return retry()
  const reservation = reserved as ReceiptReservation
  if (reservation.completed) return
  if (!ATTACHMENT_PATH.test(reservation.path) || !reservation.path.startsWith(`${id.tenant_id}/${reservation.claim_id}/`)) return retry()

  const bucket = admin.storage.from(RECEIPT_BUCKET)
  const upload = await bucket.upload(reservation.path, bytes, { contentType: sniff.mime, upsert: false })
  if (upload.error) {
    // The request may have failed after Storage accepted the object, or
    // another delivery may already have uploaded it. Verify exact bytes.
    const stored = await bucket.download(reservation.path)
    if (stored.error || !stored.data || stored.data.size !== bytes.byteLength ||
      digest(new Uint8Array(await stored.data.arrayBuffer())) !== sha256) return retry()
  }
  const { data: settings, error: settingsError } = await admin.from("expense_claim_settings").select("categories").eq("tenant_id", id.tenant_id).maybeSingle()
  if (settingsError) return retry()
  const typed = parseCaption(msg.caption, Array.isArray(settings?.categories) ? (settings.categories as string[]) : undefined)
  // Album pages without a caption attach to the existing claim and must not overwrite it.
  const albumPage = !!msg.media_group_id && !msg.caption
  const ex = albumPage ? { fields: {}, source: [], qrPhase2: null, textChars: 0 } : await extractReceiptDataWithin(bytes, sniff.mime, 25_000)
  const { fields, payload } = claimPayload(typed, ex, msg.caption)
  const { data: finished, error: finishError } = await admin.rpc("expense_telegram_finish_receipt", {
    p_receipt_id: reservation.receipt_id, p_fields: albumPage ? {} : payload,
  })
  if (finishError?.message.includes("TG_RECEIPT_DENIED")) { await sendMessage(chat, T.notLinked); return }
  if (finishError && /TG_RECEIPT_CONFLICT|EXC004|EXC014/.test(finishError.message)) { await sendMessage(chat, T.failed); return }
  if (finishError || !finished) return retry()
  const claim = finished as ReceiptResult
  if (!claim.created) return // album or replay: one confirmation per claim
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
  const dup = claim.duplicate_status === "possible" ? "\n⚠️ Possible duplicate — a reviewer will check it. / تكرار محتمل — سيتحقق منه المراجع." : ""
  const f = fields as Record<string, string | undefined>
  const summary = albumPage ? "" : readSummary(f, ex.source)
  const z = zatcaPurchaseCheck({ currency: f.currency ?? id.currency ?? "SAR", supplier_name: f.supplier_name ?? null, supplier_vat_number: f.supplier_vat_number ?? null, receipt_number: f.receipt_number ?? null, expense_date: f.expense_date ?? null, amount_before_vat: f.amount_before_vat ?? null, vat_rate: f.vat_rate ?? null, vat_amount: f.vat_amount ?? null, total_amount: f.total_amount ?? null })
  const zErr = albumPage ? [] : z.issues.filter((i) => i.severity === "error").slice(0, 4)
  const zatca = zErr.length ? `\n\nZATCA invoice check — please add in the dashboard / التحقق حسب متطلبات الهيئة — أكمل في لوحة التحكم:\n${zErr.map((i) => `• ${i.text.en}\n  ${i.text.ar}`).join("\n")}` : ""
  await sendMessage(chat, `🧾 Receipt received — claim ${claim.claim_no} is pending review. Details are unverified until reviewed.\nتم استلام الإيصال — المطالبة ${claim.claim_no} بانتظار المراجعة. البيانات غير متحقق منها حتى تتم المراجعة.${summary}${dup}${zatca}${base ? `\n${base}/expenses/claims/${claim.claim_id}` : ""}`)
}
