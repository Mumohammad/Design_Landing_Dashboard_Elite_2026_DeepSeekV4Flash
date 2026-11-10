import "server-only"
// Server-side receipt reading for Telegram and quick uploads. Order of trust:
//   1. ZATCA QR (seller, VAT no., time, total, VAT) — machine-readable;
//   2. UBL XML e-invoice fields (when the file is the XML itself);
//   3. PDF text layer parsed with the receipt heuristics.
// Everything returned is a SUGGESTION: fields are marked unverified until the
// submitter or reviewer confirms them. Nothing is sent anywhere.
import jsQR from "jsqr"
import { parseReceiptText, type ReceiptSuggestion } from "./receipt-parse"
import { decodeZatcaQr, qrToSuggestion, readUblXml } from "./zatca-qr"

export interface ExtractResult {
  fields: ReceiptSuggestion
  source: Array<"qr" | "xml" | "pdf_text">
  qrPhase2: boolean | null
  textChars: number
}

const MAX_PAGES = 3

function qrFromRgba(data: Uint8ClampedArray, width: number, height: number): string | null {
  if (width < 21 || height < 21 || width * height > 25_000_000) return null
  const r = jsQR(data, width, height, { inversionAttempts: "attemptBoth" })
  return r?.data ?? null
}

function greyToRgba(g: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.length * 4)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) { out[j] = out[j + 1] = out[j + 2] = g[i]; out[j + 3] = 255 }
  return out
}

async function qrFromImageBytes(bytes: Uint8Array): Promise<string | null> {
  const sharp = (await import("sharp")).default
  for (const size of [1600, 1000, 2400]) {
    try {
      // Single-channel grey buffer expanded manually: guarantees the 4-channel layout jsQR expects.
      const { data, info } = await sharp(bytes, { failOn: "none", limitInputPixels: 60_000_000 })
        .rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: size <= 1600 })
        .greyscale().normalise().extractChannel(0).raw().toBuffer({ resolveWithObject: true })
      if (info.channels !== 1) continue
      const hit = qrFromRgba(greyToRgba(data), info.width, info.height)
      if (hit && decodeZatcaQr(hit)) return hit
    } catch { return null }
  }
  return null
}

const rgba = (img: { data: Uint8Array }) => new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength)

async function readPdf(bytes: Uint8Array): Promise<{ text: string; qr: string | null }> {
  const { getDocumentProxy, extractText, extractImages } = await import("unpdf")
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  try {
    const pages = Math.min(pdf.numPages, MAX_PAGES)
    const { text } = await extractText(pdf, { mergePages: false })
    const pageText = (Array.isArray(text) ? text : [text]).slice(0, pages).join("\n").replace(/\u0000/g, "").normalize("NFKC")
    let qr: string | null = null
    for (let p = 1; p <= pages && !qr; p++) {
      const images = await extractImages(pdf, p).catch(() => [])
      for (const img of images.slice(0, 12)) {
        if (img.width < 60 || img.height < 60 || Math.abs(img.width - img.height) > Math.max(img.width, img.height) * 0.35) continue
        qr = qrFromRgba(rgba(img), img.width, img.height)
        if (!qr) {
          // Small embedded QR bitmaps decode better when upscaled.
          const sharp = (await import("sharp")).default
          const up = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
            .resize({ width: Math.max(400, img.width * 3), kernel: "nearest" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).catch(() => null)
          if (up) qr = qrFromRgba(new Uint8ClampedArray(up.data.buffer, up.data.byteOffset, up.data.byteLength), up.info.width, up.info.height)
        }
        if (qr && decodeZatcaQr(qr)) break
        qr = null
      }
    }
    return { text: pageText.slice(0, 60_000), qr }
  } finally { await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {}) }
}

/** Never throws: an unreadable file simply yields no suggestions. */
export async function extractReceiptData(bytes: Uint8Array, mime: string): Promise<ExtractResult> {
  const res: ExtractResult = { fields: {}, source: [], qrPhase2: null, textChars: 0 }
  try {
    let qr: string | null = null
    let textFields: ReceiptSuggestion = {}
    if (mime === "application/pdf") {
      const r = await readPdf(bytes)
      res.textChars = r.text.replace(/\s/g, "").length
      if (res.textChars > 20) { textFields = parseReceiptText(r.text).fields; res.source.push("pdf_text") }
      qr = r.qr
    } else if (mime === "application/xml" || mime === "text/xml") {
      const r = readUblXml(new TextDecoder().decode(bytes))
      textFields = r.fields; qr = r.qr
      if (Object.keys(r.fields).length) res.source.push("xml")
    } else if (mime.startsWith("image/")) {
      qr = await qrFromImageBytes(bytes)
    }
    const q = qr ? decodeZatcaQr(qr) : null
    if (q) { res.source.unshift("qr"); res.qrPhase2 = q.phase2 }
    // QR values win for the fields it carries; text/XML fill the rest.
    res.fields = { ...textFields, ...(q ? qrToSuggestion(q) : {}) }
    if (!res.fields.amount_before_vat && res.fields.total_amount && res.fields.vat_amount) {
      const n = Number(res.fields.total_amount) - Number(res.fields.vat_amount)
      if (n >= 0) res.fields.amount_before_vat = n.toFixed(2)
    }
  } catch { /* best effort */ }
  return res
}

/** Extraction bounded in time so webhooks and uploads never hang on a hostile/huge file. */
export async function extractReceiptDataWithin(bytes: Uint8Array, mime: string, ms = 20_000): Promise<ExtractResult> {
  const empty: ExtractResult = { fields: {}, source: [], qrPhase2: null, textChars: 0 }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ExtractResult>((r) => { timer = setTimeout(() => r(empty), ms) })
  try { return await Promise.race([extractReceiptData(bytes, mime), timeout]) } finally { clearTimeout(timer) }
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
