// ZATCA purchase-invoice self-check for received receipts/invoices.
// Pure (client + server). Applies the KSA VAT Implementing Regulations
// tax-invoice content rules (Art. 53) and input-VAT deduction conditions
// (Art. 49) to the data captured on a claim, and maps each line to the
// purchases section of the VAT return (boxes 7/10/11). It is a data-quality
// aid for the reviewer and accountant — not an official ZATCA validation,
// not a VAT return, and it never submits anything to ZATCA.
import { num, type Bi, type ExpenseClaim } from "./constants"

export const STANDARD_VAT_RATE = 15
/** Art. 53(7): a simplified tax invoice is allowed only below SAR 1,000. */
export const SIMPLIFIED_LIMIT_SAR = 1000
/** Art. 49(7): input VAT may be deducted within five years of the invoice. */
const DEDUCTION_YEARS = 5
const TOL = 0.01

export const ZATCA_VAT_NUMBER_RE = /^3\d{13}3$/

export function normalizeVatNumber(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s-]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
}
export function isValidSaudiVatNumber(v: string | null | undefined): boolean {
  return ZATCA_VAT_NUMBER_RE.test(normalizeVatNumber(v))
}

export type ZatcaInvoiceType = "standard" | "simplified" | "foreign" | "no_vat_invoice"
export type ZatcaBox = "box7" | "box10_11" | "excluded"
export type ZatcaResult = "ready" | "attention" | "not_claimable"

export interface ZatcaIssue { code: string; severity: "error" | "warning"; text: Bi }
export interface ZatcaCheck {
  invoiceType: ZatcaInvoiceType
  box: ZatcaBox
  result: ZatcaResult
  issues: ZatcaIssue[]
  /** VAT that may be reported as input VAT once a reviewer confirms the original invoice. */
  claimableVat: number
}

export const INVOICE_TYPE_LABELS: Record<ZatcaInvoiceType, Bi> = {
  standard: { en: "Tax invoice (standard)", ar: "فاتورة ضريبية" },
  simplified: { en: "Simplified tax invoice", ar: "فاتورة ضريبية مبسطة" },
  foreign: { en: "Foreign / non-SAR invoice", ar: "فاتورة أجنبية / بغير الريال" },
  no_vat_invoice: { en: "Not a VAT invoice", ar: "ليست فاتورة ضريبية" },
}
export const BOX_LABELS: Record<ZatcaBox, Bi> = {
  box7: { en: "Box 7 – Standard rated domestic purchases (15%)", ar: "البند 7 – المشتريات المحلية الخاضعة للنسبة الأساسية (15%)" },
  box10_11: { en: "Box 10/11 – Zero-rated or exempt purchases (confirm which)", ar: "البند 10/11 – مشتريات خاضعة للصفر أو معفاة (حدد أيهما)" },
  excluded: { en: "Not reportable as input VAT", ar: "لا تُدرج كضريبة مدخلات" },
}
export const RESULT_LABELS: Record<ZatcaResult, Bi> = {
  ready: { en: "Meets ZATCA invoice data rules", ar: "مطابقة لبيانات الفاتورة حسب الهيئة" },
  attention: { en: "Needs attention", ar: "تحتاج مراجعة" },
  not_claimable: { en: "Input VAT not claimable", ar: "ضريبة المدخلات غير قابلة للخصم" },
}

const I = (code: string, severity: ZatcaIssue["severity"], en: string, ar: string): ZatcaIssue => ({ code, severity, text: { en, ar } })

type ClaimLike = Pick<ExpenseClaim, "currency" | "supplier_name" | "supplier_vat_number" | "receipt_number" | "expense_date" | "amount_before_vat" | "vat_rate" | "vat_amount" | "total_amount">

export function zatcaPurchaseCheck(c: ClaimLike, today: Date = new Date()): ZatcaCheck {
  const issues: ZatcaIssue[] = []
  const net = num(c.amount_before_vat), vat = num(c.vat_amount), total = num(c.total_amount), rate = num(c.vat_rate)
  const sar = (c.currency || "SAR").toUpperCase() === "SAR"
  const vatNo = normalizeVatNumber(c.supplier_vat_number)
  const hasVat = (vat ?? 0) > 0 || (rate ?? 0) > 0

  if (!sar) {
    issues.push(I("currency", "error", "Not in SAR: a KSA tax invoice must show the VAT amount in SAR. Foreign VAT cannot be claimed on the Saudi VAT return.", "ليست بالريال السعودي: يجب أن تظهر الضريبة في الفاتورة الضريبية بالريال، ولا يمكن خصم ضريبة أجنبية في الإقرار السعودي."))
    return { invoiceType: "foreign", box: "excluded", result: "not_claimable", issues, claimableVat: 0 }
  }

  // Art. 53 mandatory content.
  if (!c.supplier_name?.trim()) issues.push(I("supplier_name", "error", "Supplier name is missing.", "اسم المورد مفقود."))
  if (!vatNo) {
    if (hasVat) issues.push(I("vat_missing", "error", "VAT is charged but the supplier VAT registration number is missing — input VAT cannot be deducted without it.", "توجد ضريبة لكن رقم تسجيل المورد الضريبي مفقود — لا يمكن خصم ضريبة المدخلات بدونه."))
  } else if (!ZATCA_VAT_NUMBER_RE.test(vatNo)) {
    issues.push(I("vat_format", "error", "Supplier VAT number is invalid: it must be 15 digits starting and ending with 3.", "رقم المورد الضريبي غير صحيح: يجب أن يتكون من 15 رقماً يبدأ وينتهي بالرقم 3."))
  }
  if (!c.receipt_number?.trim()) issues.push(I("invoice_no", "error", "Invoice serial number is missing.", "الرقم التسلسلي للفاتورة مفقود."))
  if (!c.expense_date) issues.push(I("date", "error", "Invoice issue date is missing.", "تاريخ إصدار الفاتورة مفقود."))
  else {
    const d = new Date(`${c.expense_date}T00:00:00Z`)
    if (d.getTime() > today.getTime() + 86400000) issues.push(I("date_future", "error", "Invoice date is in the future.", "تاريخ الفاتورة في المستقبل."))
    const limit = new Date(today); limit.setUTCFullYear(limit.getUTCFullYear() - DEDUCTION_YEARS)
    if (d < limit) issues.push(I("date_old", "error", "Invoice is older than 5 years — input VAT can no longer be deducted.", "عمر الفاتورة أكثر من 5 سنوات — لم يعد بالإمكان خصم ضريبة المدخلات."))
  }
  if (total === null) issues.push(I("total", "error", "Total amount including VAT is missing.", "المبلغ الإجمالي شاملاً الضريبة مفقود."))
  if (hasVat && (net === null || vat === null)) issues.push(I("split", "error", "Taxable amount and VAT amount must both be shown separately.", "يجب إظهار المبلغ الخاضع للضريبة ومبلغ الضريبة كلٌّ على حدة."))

  // Arithmetic and rate.
  if (rate !== null && rate !== 0 && rate !== STANDARD_VAT_RATE) issues.push(I("rate", "error", `VAT rate ${rate}% is not a KSA rate (15% standard or 0%).`, `نسبة الضريبة ${rate}% ليست نسبة معتمدة في المملكة (15% أو 0%).`))
  if (net !== null && vat !== null && vat > 0) {
    const expected = Math.round(net * STANDARD_VAT_RATE) / 100
    if (Math.abs(expected - vat) > TOL + 1e-9) issues.push(I("vat_calc", "warning", `VAT should be 15% of the taxable amount (${expected.toFixed(2)}).`, `يجب أن تكون الضريبة 15% من المبلغ الخاضع (${expected.toFixed(2)}).`))
  }
  if (net !== null && vat !== null && total !== null && Math.abs(net + vat - total) > TOL + 1e-9) issues.push(I("sum", "error", "Taxable amount + VAT does not equal the total.", "المبلغ الخاضع + الضريبة لا يساوي الإجمالي."))

  const invoiceType: ZatcaInvoiceType = !hasVat && !vatNo ? "no_vat_invoice" : (total ?? 0) >= SIMPLIFIED_LIMIT_SAR ? "standard" : "simplified"
  if (invoiceType === "standard") issues.push(I("buyer", "warning", "Total is SAR 1,000 or more: confirm the original is a full tax invoice showing your company name and VAT number (a simplified invoice is not enough).", "الإجمالي 1,000 ريال أو أكثر: تأكد أن الأصل فاتورة ضريبية كاملة تظهر اسم منشأتك ورقمها الضريبي (الفاتورة المبسطة لا تكفي)."))
  if (hasVat) issues.push(I("qr", "warning", "Confirm the original invoice carries the ZATCA e-invoice QR code.", "تأكد أن الفاتورة الأصلية تحمل رمز الاستجابة السريعة للفوترة الإلكترونية."))

  const errors = issues.filter((i) => i.severity === "error")
  const blocking = errors.some((i) => ["vat_missing", "vat_format", "date_old", "rate"].includes(i.code))
  let box: ZatcaBox
  if (invoiceType === "no_vat_invoice") box = "excluded"
  else if (blocking) box = "excluded"
  else if ((vat ?? 0) > 0) box = "box7"
  else box = "box10_11"
  const result: ZatcaResult = invoiceType === "no_vat_invoice" || blocking ? "not_claimable" : errors.length ? "attention" : "ready"
  return { invoiceType, box, result, issues, claimableVat: box === "box7" && result === "ready" ? vat ?? 0 : 0 }
}

/** Gregorian date → Umm al-Qura Hijri (yyyy/mm/dd) for the ZATCA register. */
export function hijriDate(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).formatToParts(new Date(`${iso}T00:00:00Z`))
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
    return `${g("year").replace(/\D/g, "")}/${g("month")}/${g("day")}`
  } catch { return "" }
}
