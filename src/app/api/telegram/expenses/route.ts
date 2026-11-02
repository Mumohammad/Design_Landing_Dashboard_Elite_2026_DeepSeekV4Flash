// Telegram webhook for the expense receipt bot.
// - Authenticated by Telegram's X-Telegram-Bot-Api-Secret-Token header.
// - Only private chats from Telegram accounts linked with a one-time code
//   are accepted; anything else is rejected without storing files.
// - Receipts become SUBMITTED (pending review) claims; caption details are
//   stored as unverified suggestions. Nothing is approved automatically and
//   nothing is sent to ZATCA.
import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { rateLimit } from "@/lib/auth/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { uploadAndRegister } from "@/lib/expense-claims/attachments"
import { MAX_ATTACHMENT_BYTES } from "@/lib/expense-claims/constants"
import { sniffFile } from "@/lib/expense-claims/file-check"
import { bareLinkCode, parseCaption } from "@/lib/expense-claims/receipt-parse"
import { zatcaPurchaseCheck } from "@/lib/expense-claims/zatca-check"
import { downloadTelegramFile, sendMessage } from "@/lib/expense-claims/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

type TgUser = { id: number; username?: string }
type TgMessage = {
  message_id: number
  from?: TgUser
  chat: { id: number; type: string }
  text?: string
  caption?: string
  media_group_id?: string
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
}

const ok = () => NextResponse.json({ ok: true })

function secretMatches(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
  if (expected.length < 24 || !header) return false
  const a = Buffer.from(header), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const T = {
  help: "Send a photo or PDF of a receipt (CamScanner PDFs are fine). Add a caption like:\ntotal 115 vat 15 supplier Shell vatno 300000000000003 invoice INV-123 date 2026-11-02 category fuel purpose delivery run\n\nأرسل صورة أو ملف PDF للإيصال، ويمكنك إضافة وصف مثل:\nالمبلغ 115 ضريبة 15 المورد شل ضريبي 300000000000003 الفاتورة INV-123 الفئة وقود الغرض توصيل\n\nZATCA: for VAT to be claimable the receipt needs the supplier VAT number, invoice number and date. / لخصم الضريبة يلزم الرقم الضريبي للمورد ورقم الفاتورة وتاريخها.\n\nReceipts are supporting documents for internal review only — they are not e-invoices and are not sent to ZATCA.",
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
  if (!process.env.TELEGRAM_BOT_TOKEN) return ok()
  const update = (await req.json().catch(() => null)) as { message?: TgMessage } | null
  const msg = update?.message
  if (!msg?.from || !msg.chat) return ok()
  if (msg.chat.type !== "private") { if (msg.photo || msg.document) await sendMessage(msg.chat.id, T.groupOnly); return ok() }
  try { await handle(msg, msg.from) } catch { await sendMessage(msg.chat.id, T.failed) }
  return ok()
}

async function handle(msg: TgMessage, from: TgUser) {
  const chat = msg.chat.id
  const rl = await rateLimit(`tg-expense:${from.id}`, 20, "minute").catch(() => ({ success: false }))
  if (!rl.success) { await sendMessage(chat, T.slow); return }
  const admin = createAdminClient()
  const text = msg.text?.trim() ?? ""

  const cmd = /^\/(start|link)(?:@\w+)?(?:\s+([A-Za-z0-9 -]{6,30}))?$/i.exec(text)
  const code = cmd ? (cmd[2] ?? "").replace(/[\s-]/g, "") : bareLinkCode(text)
  if (cmd || code) {
    if (!code) { await sendMessage(chat, `${T.help}\n\n${T.notLinked}`); return }
    const { data } = await admin.rpc("expense_telegram_consume_link", { p_code: code, p_tg_user: from.id, p_chat: chat, p_username: from.username ?? null })
    await sendMessage(chat, (data as { ok?: boolean } | null)?.ok ? `${T.linked}\n\n${T.help}` : T.badCode)
    return
  }
  if (/^\/help/i.test(text)) { await sendMessage(chat, T.help); return }
  if (/^\/unlink/i.test(text)) {
    const { data: rows } = await admin.from("expense_telegram_links").update({ revoked_at: new Date().toISOString() })
      .eq("telegram_user_id", from.id).is("revoked_at", null).select("tenant_id,user_id")
    for (const r of rows ?? []) await admin.from("audit_log").insert({ tenant_id: r.tenant_id, actor_id: r.user_id, module: "expense_claims", entity_type: "expense_telegram_links", entity_id: r.user_id, action: "expense_telegram_unlinked" })
    await sendMessage(chat, T.unlinked)
    return
  }

  const file = msg.document
    ? { id: msg.document.file_id, size: msg.document.file_size ?? 0, name: msg.document.file_name ?? "telegram-document" }
    : msg.photo?.length
      ? (() => { const p = [...msg.photo!].sort((a, b) => b.width * b.height - a.width * a.height)[0]; return { id: p.file_id, size: p.file_size ?? 0, name: `telegram-photo-${new Date().toISOString().slice(0, 10)}.jpg` } })()
      : null
  if (!file) { if (text) await sendMessage(chat, T.help); return }

  // Identify before touching the file: unidentified senders are rejected.
  const { data: who } = await admin.rpc("expense_telegram_identity", { p_tg_user: from.id, p_chat: chat })
  const id = who as { ok: boolean; user_id?: string; tenant_id?: string } | null
  if (!id?.ok || !id.user_id || !id.tenant_id) { await sendMessage(chat, T.notLinked); return }
  if (file.size > MAX_ATTACHMENT_BYTES) { await sendMessage(chat, T.tooLarge); return }

  const bytes = await downloadTelegramFile(file.id, MAX_ATTACHMENT_BYTES)
  if (!bytes) { await sendMessage(chat, T.tooLarge); return }
  const sniff = sniffFile(bytes)
  if (!sniff.ok) { await sendMessage(chat, `${sniff.message.en}\n${sniff.message.ar}`); return }

  const { data: settings } = await admin.from("expense_claim_settings").select("categories").eq("tenant_id", id.tenant_id).maybeSingle()
  const fields = parseCaption(msg.caption, Array.isArray(settings?.categories) ? (settings!.categories as string[]) : undefined)
  const payload = { ...fields, unverified_fields: Object.keys(fields), ocr_suggestions: { caption: (msg.caption ?? "").slice(0, 1000), parsed: fields } }
  const { data: created, error } = await admin.rpc("expense_telegram_claim", { p_user: id.user_id, p_fields: msg.media_group_id && !msg.caption ? {} : payload, p_media_group: msg.media_group_id ?? null })
  if (error || !created) { await sendMessage(chat, T.failed); return }
  const claim = created as { id: string; claim_no: string; existing: boolean }
  const res = await uploadAndRegister({ actor: id.user_id, tenantId: id.tenant_id, claimId: claim.id, bytes, originalName: file.name, source: "telegram" })
  if (!res.ok) { await sendMessage(chat, `${res.message.en}\n${res.message.ar}`); return }
  if (claim.existing) return // album: one confirmation per claim
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
  const dup = res.duplicateStatus === "possible" ? "\n⚠️ Possible duplicate — a reviewer will check it. / تكرار محتمل — سيتحقق منه المراجع." : ""
  const f = fields as Record<string, string | undefined>
  const z = zatcaPurchaseCheck({ currency: f.currency ?? "SAR", supplier_name: f.supplier_name ?? null, supplier_vat_number: f.supplier_vat_number ?? null, receipt_number: f.receipt_number ?? null, expense_date: f.expense_date ?? null, amount_before_vat: f.amount_before_vat ?? null, vat_rate: f.vat_rate ?? null, vat_amount: f.vat_amount ?? null, total_amount: f.total_amount ?? null })
  const zErr = z.issues.filter((i) => i.severity === "error").slice(0, 4)
  const zatca = zErr.length ? `\n\nZATCA invoice check — please add in the dashboard / التحقق حسب متطلبات الهيئة — أكمل في لوحة التحكم:\n${zErr.map((i) => `• ${i.text.en}\n  ${i.text.ar}`).join("\n")}` : ""
  await sendMessage(chat, `🧾 Receipt received — claim ${claim.claim_no} is pending review. Details from your caption are unverified until reviewed.\nتم استلام الإيصال — المطالبة ${claim.claim_no} بانتظار المراجعة. البيانات من الوصف غير متحقق منها حتى تتم المراجعة.${dup}${zatca}${base ? `\n${base}/expenses/claims/${claim.id}` : ""}`)
}
