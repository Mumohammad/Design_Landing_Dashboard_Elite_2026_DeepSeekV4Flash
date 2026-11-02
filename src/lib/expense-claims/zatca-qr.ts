// Reads the ZATCA e-invoice QR code printed on Saudi tax invoices.
// The payload is Base64 TLV (Security Features Standard §4.1):
//   1 seller name · 2 seller VAT number · 3 timestamp · 4 total incl. VAT · 5 VAT total
//   6–9 (Phase 2 only) invoice hash, signature, public key, CA signature.
// Pure: used by the Telegram/quick-upload extractor and unit tests. Reading the
// QR does not verify the Phase 2 signature or prove ZATCA reporting/clearance.
import type { ReceiptSuggestion } from "./receipt-parse"

export interface ZatcaQrData {
  sellerName: string
  vatNumber: string
  timestamp: string
  total: string
  vatTotal: string
  phase2: boolean
}

export function decodeZatcaQr(payload: string): ZatcaQrData | null {
  const text = payload.trim()
  if (!/^[A-Za-z0-9+/=\s]{20,4000}$/.test(text)) return null
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(text.replace(/\s/g, "")), (c) => c.charCodeAt(0)) } catch { return null }
  const tags = new Map<number, Uint8Array>()
  for (let i = 0; i + 2 <= bytes.length;) {
    const tag = bytes[i], len = bytes[i + 1]
    if (tag < 1 || tag > 9 || i + 2 + len > bytes.length) return null
    tags.set(tag, bytes.subarray(i + 2, i + 2 + len))
    i += 2 + len
  }
  const dec = new TextDecoder("utf-8", { fatal: false })
  const s = (t: number) => (tags.has(t) ? dec.decode(tags.get(t)).trim() : "")
  const out: ZatcaQrData = { sellerName: s(1), vatNumber: s(2), timestamp: s(3), total: s(4), vatTotal: s(5), phase2: tags.has(6) }
  if (!out.sellerName || !/^\d{15}$/.test(out.vatNumber) || !/^\d+(\.\d+)?$/.test(out.total)) return null
  return out
}

/** Calendar date in Riyadh for the QR timestamp (offset-less times are Riyadh-local). */
function riyadhDate(ts: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/.exec(ts)
  if (!m) return undefined
  if (!m[4] || !m[8]) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return `${m[1]}-${m[2]}-${m[3]}`
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

const money = (v: string) => (Math.round(Number(v) * 100) / 100).toFixed(2)

export function qrToSuggestion(q: ZatcaQrData): ReceiptSuggestion {
  const f: ReceiptSuggestion = { supplier_name: q.sellerName.slice(0, 200), supplier_vat_number: q.vatNumber, currency: "SAR", total_amount: money(q.total) }
  if (/^\d+(\.\d+)?$/.test(q.vatTotal)) {
    f.vat_amount = money(q.vatTotal)
    const net = Number(q.total) - Number(q.vatTotal)
    if (net >= 0) f.amount_before_vat = money(String(net))
    if (net > 0) f.vat_rate = String(Math.round((Number(q.vatTotal) / net) * 100))
  }
  const date = riyadhDate(q.timestamp)
  if (date) f.expense_date = date
  return f
}

/** Minimal UBL 2.1 reader for ZATCA XML invoices (regex only; DOCTYPE/ENTITY already rejected by file-check). */
export function readUblXml(xml: string): { fields: ReceiptSuggestion; qr: string | null } {
  const pick = (re: RegExp) => re.exec(xml)?.[1]?.trim()
  const supplier = /<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/.exec(xml)?.[1] ?? ""
  const f: ReceiptSuggestion = {}
  const id = pick(/<cbc:ID>([^<]{1,60})<\/cbc:ID>/); if (id) f.receipt_number = id
  const date = pick(/<cbc:IssueDate>(\d{4}-\d{2}-\d{2})<\/cbc:IssueDate>/); if (date) f.expense_date = date
  const name = /<cbc:RegistrationName>([^<]{1,200})<\/cbc:RegistrationName>/.exec(supplier)?.[1]; if (name) f.supplier_name = name.trim()
  const vat = /<cac:PartyTaxScheme>[\s\S]*?<cbc:CompanyID>(\d{15})<\/cbc:CompanyID>/.exec(supplier)?.[1]; if (vat) f.supplier_vat_number = vat
  const cur = pick(/<cbc:DocumentCurrencyCode>([A-Z]{3})<\/cbc:DocumentCurrencyCode>/); if (cur) f.currency = cur
  const net = pick(/<cbc:TaxExclusiveAmount[^>]*>([\d.]+)<\/cbc:TaxExclusiveAmount>/); if (net) f.amount_before_vat = Number(net).toFixed(2)
  const total = pick(/<cbc:TaxInclusiveAmount[^>]*>([\d.]+)<\/cbc:TaxInclusiveAmount>/) ?? pick(/<cbc:PayableAmount[^>]*>([\d.]+)<\/cbc:PayableAmount>/); if (total) f.total_amount = Number(total).toFixed(2)
  const vatAmt = pick(/<cac:TaxTotal>\s*<cbc:TaxAmount[^>]*>([\d.]+)<\/cbc:TaxAmount>/); if (vatAmt) f.vat_amount = Number(vatAmt).toFixed(2)
  const rate = pick(/<cac:TaxCategory>[\s\S]*?<cbc:Percent>([\d.]+)<\/cbc:Percent>/); if (rate) f.vat_rate = String(Number(rate))
  const qr = pick(/<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([A-Za-z0-9+/=\s]+)<\/cbc:EmbeddedDocumentBinaryObject>/) ?? null
  return { fields: f, qr }
}
