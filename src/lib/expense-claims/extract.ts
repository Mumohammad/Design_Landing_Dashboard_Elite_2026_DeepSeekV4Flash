import "server-only"
// Server-side receipt reading for Telegram and quick uploads. Order of trust:
//   1. ZATCA QR (seller, VAT no., time, total, VAT) — machine-readable;
//   2. UBL XML e-invoice fields (when the file is the XML itself);
//   3. PDF text layer parsed with the receipt heuristics.
// Everything returned is a SUGGESTION: fields are marked unverified until the
// submitter or reviewer confirms them. Nothing is sent anywhere.
import { parseReceiptText, type ReceiptSuggestion } from "./receipt-parse"
import { decodeZatcaQr, qrToSuggestion, readUblXml } from "./zatca-qr"
import { runReceiptProcess } from "./extraction-process"

export interface ExtractResult {
  fields: ReceiptSuggestion
  source: Array<"qr" | "xml" | "pdf_text">
  qrPhase2: boolean | null
  textChars: number
}

async function extractWithDeadline(bytes: Uint8Array, mime: string, ms: number): Promise<ExtractResult> {
  const res: ExtractResult = { fields: {}, source: [], qrPhase2: null, textChars: 0 }
  try {
    const parsed = await runReceiptProcess(bytes, mime, ms)
    if (parsed.status !== "complete" || !parsed.value) return res
    const { text, xml, qr } = parsed.value
    const ubl = xml ? readUblXml(xml) : null
    let textFields: ReceiptSuggestion = {}
    if (mime === "application/pdf") {
      res.textChars = text.replace(/\s/g, "").length
      if (res.textChars > 20) { textFields = parseReceiptText(text).fields; res.source.push("pdf_text") }
    } else if (mime === "application/xml" || mime === "text/xml") {
      textFields = ubl?.fields ?? {}
      if (Object.keys(textFields).length) res.source.push("xml")
    }
    const rawQr = qr ?? ubl?.qr
    const q = rawQr ? decodeZatcaQr(rawQr) : null
    if (q) { res.source.unshift("qr"); res.qrPhase2 = q.phase2 }
    // QR values win for the fields it carries; text/XML fill the rest.
    res.fields = { ...textFields, ...(q ? qrToSuggestion(q) : {}) }
    if (!res.fields.amount_before_vat && res.fields.total_amount && res.fields.vat_amount) {
      const n = Number(res.fields.total_amount) - Number(res.fields.vat_amount)
      if (n >= 0) res.fields.amount_before_vat = n.toFixed(2)
    }
  } catch (error) {
    if (error instanceof Error && error.message === "RECEIPT_PARSER_RETIREMENT_UNCONFIRMED") throw error
    // Unreadable/budget-limited receipts retain their original document and
    // yield no suggestions. No fallback executes a parser in this process.
  }
  return res
}

/** Best-effort suggestions from an isolated parser; original bytes are unchanged. */
export async function extractReceiptData(bytes: Uint8Array, mime: string): Promise<ExtractResult> {
  return extractWithDeadline(bytes, mime, 20_000)
}

/** Resolve only after the worker's process exit is observed, including timeout. */
export async function extractReceiptDataWithin(bytes: Uint8Array, mime: string, ms = 20_000): Promise<ExtractResult> {
  return extractWithDeadline(bytes, mime, ms)
}

/** Caption/typed values win over file values; everything stays unverified. */
export function claimPayload(typed: ReceiptSuggestion, ex: ExtractResult, caption?: string) {
  const fields: ReceiptSuggestion = { ...ex.fields, ...typed }
  return {
    fields,
    payload: {
      ...fields,
      unverified_fields: Object.keys(fields),
      ocr_suggestions: { caption: (caption ?? "").slice(0, 1000), parsed: typed, file: ex.fields, file_source: ex.source, qr_phase2: ex.qrPhase2 },
    },
  }
}

/** Short bilingual list of what was read, for the bot reply / quick-upload result. */
export function readSummary(f: Record<string, string | undefined>, source: ExtractResult["source"]): string {
  const rows: string[] = []
  if (f.supplier_name) rows.push(`• Supplier / المورد: ${f.supplier_name}`)
  if (f.supplier_vat_number) rows.push(`• VAT no. / الرقم الضريبي: ${f.supplier_vat_number}`)
  if (f.receipt_number) rows.push(`• Invoice no. / رقم الفاتورة: ${f.receipt_number}`)
  if (f.expense_date) rows.push(`• Date / التاريخ: ${f.expense_date}`)
  if (f.amount_before_vat) rows.push(`• Before VAT / قبل الضريبة: ${f.amount_before_vat}`)
  if (f.vat_amount) rows.push(`• VAT / الضريبة: ${f.vat_amount}${f.vat_rate ? ` (${f.vat_rate}%)` : ""}`)
  if (f.total_amount) rows.push(`• Total / الإجمالي: ${f.total_amount} ${f.currency ?? ""}`.trimEnd())
  if (!rows.length) return "\n\nNo details could be read from the file — please complete them in the dashboard.\nلم نتمكن من قراءة البيانات من الملف — أكملها من لوحة التحكم."
  const from = source.includes("qr") ? "ZATCA QR code / رمز QR الضريبي" : source.includes("xml") ? "e-invoice XML / ملف الفاتورة الإلكترونية" : source.includes("pdf_text") ? "PDF text / نص الملف" : "caption / الوصف"
  return `\n\nRead from ${from}:\n${rows.join("\n")}`
}
