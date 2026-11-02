// Suggestion extractors for receipts. Everything returned here is a
// SUGGESTION: the UI labels it "unverified" until the submitter confirms
// it and a reviewer approves the claim.
import { findDates, westernize } from "@/lib/ocr/extract"
import { CATEGORY_LABELS, PAYMENT_METHODS, type PaymentMethod } from "./constants"

export interface ReceiptSuggestion {
  supplier_name?: string
  supplier_vat_number?: string
  receipt_number?: string
  expense_date?: string
  currency?: string
  amount_before_vat?: string
  vat_rate?: string
  vat_amount?: string
  total_amount?: string
  payment_method?: PaymentMethod
  category?: string
  business_purpose?: string
  department?: string
  project?: string
  notes?: string
}

/** Suggested keys + whether the amounts add up (subtotal + VAT = total). */
export interface ParsedReceipt { fields: ReceiptSuggestion; amountsConsistent: boolean | null }

const AMOUNT = /(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g
const money = (s: string) => Number(s.replace(/[,\s]/g, ""))
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

function lastAmount(line: string): number | null {
  const cleaned = line.replace(/\b\d{1,2}(?:\.\d+)?\s*%/g, " ")
  const all = [...cleaned.matchAll(AMOUNT)].map((m) => money(m[1])).filter((n) => Number.isFinite(n) && n < 100_000_000)
  return all.length ? all[all.length - 1] : null
}

const SUBTOTAL = /(sub\s*-?\s*total|total\s*(before|excl\.?|excluding)\s*(vat|tax)|amount\s*(before|excl\.?)\s*(vat|tax)|taxable\s*amount|net\s*amount|المجموع\s*الفرعي|الإجمالي\s*قبل\s*الضريبة|المبلغ\s*قبل\s*الضريبة|الاجمالي\s*قبل\s*الضريبة|المبلغ\s*الخاضع)/i
const VAT = /(\bvat\b|\btax\b|value\s*added|ضريبة|الضريبة|القيمة\s*المضافة)/i
const TOTAL = /(grand\s*total|total\s*(amount|due|incl\.?|including|with)?|amount\s*due|net\s*payable|\btotal\b|الإجمالي|الاجمالي|المجموع|المبلغ\s*الإجمالي|الإجمالي\s*شامل)/i

export function detectCurrency(text: string): string | undefined {
  if (/\b(SAR|SR)\b|ر\.?\s?س|ريال/i.test(text)) return "SAR"
  if (/\bAED\b|درهم/i.test(text)) return "AED"
  if (/\bUSD\b|US\$|\$/.test(text)) return "USD"
  if (/\bEUR\b|€/.test(text)) return "EUR"
  if (/\bGBP\b|£/.test(text)) return "GBP"
  if (/\b(BHD|KWD|QAR|OMR|EGP|JOD)\b/.test(text)) return /\b(BHD|KWD|QAR|OMR|EGP|JOD)\b/.exec(text)![1]
  return undefined
}

export function parseReceiptText(raw: string, today = new Date().toISOString().slice(0, 10)): ParsedReceipt {
  const text = westernize(raw ?? "").replace(/\u066B/g, ".").replace(/\u066C/g, ",").replace(/\r/g, "")
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const f: ReceiptSuggestion = {}

  const vatNo = /\b3\d{13}3\b/.exec(text.replace(/(\d)\s(?=\d)/g, "$1"))
  if (vatNo) f.supplier_vat_number = vatNo[0]

  const rnRe = /(?:\b(?:invoice|receipt|bill|inv|order|txn|transaction)\b\.?|رقم\s*الفاتورة|فاتورة\s*رقم|رقم\s*الإيصال|رقم\s*الايصال)\s*(?:\b(?:no|number|num)\b\.?|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,29})/gi
  const rn = [...text.matchAll(rnRe)].map((m) => m[1]).find((v) => /\d/.test(v) && !/^\d{15}$/.test(v))
  if (rn) f.receipt_number = rn

  const dates = findDates(text).filter((d) => d.iso <= today)
  if (dates.length) f.expense_date = dates[0].iso

  f.currency = detectCurrency(text)

  let subtotal: number | null = null, vat: number | null = null, total: number | null = null
  for (const line of lines) {
    const amt = lastAmount(line)
    if (amt === null) continue
    if (SUBTOTAL.test(line)) { subtotal ??= amt; continue }
    if (VAT.test(line) && !/(incl|including|شامل)/i.test(line) && !/\b3\d{13}3\b/.test(line.replace(/\s/g, ""))) { vat ??= amt; continue }
    if (TOTAL.test(line)) total = Math.max(total ?? 0, amt)
  }
  const rate = /(?:vat|tax|ضريبة|الضريبة)[^\n%]{0,20}?(\d{1,2}(?:\.\d+)?)\s*%|(\d{1,2}(?:\.\d+)?)\s*%\s*(?:vat|tax|ضريبة)/i.exec(text)
  if (rate) f.vat_rate = String(Number(rate[1] ?? rate[2]))

  if (total === null && subtotal !== null && vat !== null) total = subtotal + vat
  if (subtotal === null && total !== null && vat !== null && total >= vat) subtotal = total - vat
  if (total !== null) f.total_amount = fmt(total)
  if (vat !== null) f.vat_amount = fmt(vat)
  if (subtotal !== null) f.amount_before_vat = fmt(subtotal)
  const amountsConsistent = total !== null && vat !== null && subtotal !== null ? Math.abs(subtotal + vat - total) <= 0.05 : null

  if (/\bcash\b|نقد/i.test(text)) f.payment_method = "cash"
  else if (/bank\s*transfer|تحويل\s*بنكي/i.test(text)) f.payment_method = "bank_transfer"

  const supplier = lines.slice(0, 6).find((l) => /[A-Za-z\u0600-\u06FF]{3}/.test(l) && l.length <= 60
    && !/(tax\s*invoice|simplified|invoice|receipt|فاتورة|إيصال|ايصال|vat|ضريب|date|تاريخ|tel|phone|هاتف|www\.|http|cr\s*no|س\.ت)/i.test(l))
  if (supplier) f.supplier_name = supplier.replace(/\s{2,}/g, " ")

  return { fields: f, amountsConsistent }
}

// ── Telegram caption: "total 115 vat 15 supplier Shell category fuel purpose delivery" ──
const CAPTION_KEYS: Array<[keyof ReceiptSuggestion, RegExp]> = [
  ["amount_before_vat", /^(subtotal|before|net|قبل)$/i],
  ["vat_amount", /^(vat|tax|ضريبة|الضريبة)$/i],
  ["total_amount", /^(total|amount|المبلغ|الاجمالي|الإجمالي|اجمالي|إجمالي)$/i],
  ["supplier_name", /^(supplier|merchant|vendor|shop|المورد|مورد|المتجر)$/i],
  ["category", /^(category|cat|الفئة|فئة|التصنيف)$/i],
  ["business_purpose", /^(purpose|for|reason|الغرض|غرض|السبب)$/i],
  ["expense_date", /^(date|التاريخ|تاريخ)$/i],
  ["receipt_number", /^(receipt|invoice|no|ref|الإيصال|الفاتورة|رقم)$/i],
  ["currency", /^(currency|cur|العملة|عملة)$/i],
  ["department", /^(department|dept|القسم|قسم)$/i],
  ["project", /^(project|المشروع|مشروع)$/i],
  ["payment_method", /^(payment|paid|pay|الدفع)$/i],
  ["notes", /^(note|notes|ملاحظة|ملاحظات)$/i],
]

export function normalizeCategory(v: string, allowed: string[] = Object.keys(CATEGORY_LABELS)): string | undefined {
  const s = v.trim().toLowerCase()
  if (!s) return undefined
  for (const key of allowed) {
    const l = CATEGORY_LABELS[key]
    if (s === key || s === key.replace(/_/g, " ") || (l && (s === l.en.toLowerCase() || s === l.ar))) return key
  }
  const hints: Array<[string, RegExp]> = [
    ["fuel", /fuel|petrol|gas|بنزين|وقود|محروقات/i], ["meals", /meal|food|lunch|dinner|restaurant|coffee|وجب|طعام|غداء|عشاء|مطعم/i],
    ["transport", /taxi|uber|careem|transport|flight|train|مواصلات|تاكسي|نقل|طيران/i], ["accommodation", /hotel|accommodation|فندق|سكن/i],
    ["vehicle_maintenance", /maint|repair|tyre|tire|oil|صيانة|اصلاح|إصلاح|زيت/i], ["parking_tolls", /park|toll|موقف|مواقف/i],
    ["office_supplies", /office|stationery|مكتب|قرطاسية/i], ["telecom", /mobile|sim|internet|telecom|جوال|اتصالات|انترنت/i],
    ["government_fees", /gov|fee|absher|muqeem|رسوم|حكوم/i],
  ]
  const hit = hints.find(([k, re]) => allowed.includes(k) && re.test(s))
  return hit?.[0]
}

function normalizePayment(v: string): PaymentMethod | undefined {
  const s = v.trim().toLowerCase().replace(/\s+/g, "_")
  if ((PAYMENT_METHODS as readonly string[]).includes(s)) return s as PaymentMethod
  if (/cash|نقد/.test(s)) return "cash"
  if (/company|corporate|الشركة/.test(s)) return "company_card"
  if (/personal|mada|visa|master|card|مدى|بطاقة/.test(s)) return "personal_card"
  if (/transfer|bank|تحويل/.test(s)) return "bank_transfer"
  if (/petty|عهدة/.test(s)) return "petty_cash"
  return undefined
}

function normalizeDate(v: string): string | undefined {
  const t = westernize(v).trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  const hits = findDates(iso ? `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}` : t)
  return hits[0]?.iso
}

/** Parses a free-text Telegram caption into suggested (unverified) fields. */
export function parseCaption(caption: string | null | undefined, categories?: string[]): ReceiptSuggestion {
  const text = westernize(String(caption ?? "")).replace(/\u066B/g, ".").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000)
  const out: ReceiptSuggestion = {}
  if (!text) return out
  const tokens = text.split(" ")
  let current: keyof ReceiptSuggestion | null = null
  const buf: Partial<Record<keyof ReceiptSuggestion, string[]>> = {}
  const loose: string[] = []
  for (const tok of tokens) {
    const bare = tok.replace(/[:=]$/, "")
    const key = CAPTION_KEYS.find(([, re]) => re.test(bare))?.[0]
    if (key && (tok.endsWith(":") || tok.endsWith("=") || !current || buf[current]?.length)) { current = key; buf[key] ??= []; continue }
    if (current) buf[current]!.push(tok)
    else loose.push(tok)
  }
  const amountKeys: Array<keyof ReceiptSuggestion> = ["amount_before_vat", "vat_amount", "total_amount"]
  for (const [k, words] of Object.entries(buf) as Array<[keyof ReceiptSuggestion, string[]]>) {
    const v = words.join(" ").trim()
    if (!v) continue
    if (amountKeys.includes(k)) {
      const m = /(\d+(?:[.,]\d{1,2})?)/.exec(v)
      if (m) (out as Record<string, string>)[k] = fmt(Number(m[1].replace(",", ".")))
      const cur = detectCurrency(v); if (cur && !out.currency) out.currency = cur
    } else if (k === "expense_date") { const d = normalizeDate(v); if (d) out.expense_date = d }
    else if (k === "category") { const c = normalizeCategory(v, categories); if (c) out.category = c; else out.notes = [out.notes, v].filter(Boolean).join(" ") }
    else if (k === "payment_method") { const p = normalizePayment(v); if (p) out.payment_method = p }
    else if (k === "currency") { const c = v.toUpperCase().slice(0, 3); if (/^[A-Z]{3}$/.test(c)) out.currency = c }
    else (out as Record<string, string>)[k] = v.slice(0, k === "business_purpose" || k === "notes" ? 1000 : 200)
  }
  const rest = loose.join(" ").trim()
  if (rest) {
    const onlyAmount = /^(\d+(?:[.,]\d{1,2})?)\s*([A-Za-z]{3}|ر\.?س|ريال)?$/.exec(rest)
    if (onlyAmount && !out.total_amount) {
      out.total_amount = fmt(Number(onlyAmount[1].replace(",", ".")))
      const cur = detectCurrency(rest); if (cur) out.currency ??= cur
    } else if (!out.business_purpose) out.business_purpose = rest.slice(0, 1000)
  }
  if (out.total_amount && out.vat_amount && !out.amount_before_vat && Number(out.total_amount) >= Number(out.vat_amount)) {
    out.amount_before_vat = fmt(Number(out.total_amount) - Number(out.vat_amount))
  }
  return out
}
