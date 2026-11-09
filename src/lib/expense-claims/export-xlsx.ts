// "Export Expenses" workbook. Pure (no server imports) so it is unit-tested.
// Amounts are grouped per currency and never totalled across currencies.
// Receipt VAT is labelled "as shown on receipts". The ZATCA sheets apply the
// KSA tax-invoice data rules as a self-check; nothing here is filed with ZATCA.
import * as XLSX from "xlsx"
import {
  COUNTED_STATUSES, DOC_KIND_LABELS, DUPLICATE_REASON_LABELS, FIELD_LABELS, PAYMENT_LABELS, STATUS_LABELS, SUPPORTING_DOC_NOTICE,
  categoryLabel, num, type Bi, type ClaimAttachment, type ClaimSettings, type ExpenseClaim,
} from "./constants"
import { breakdown, type GroupKey } from "./dashboard"
import { riyadhTimestamp } from "./format"
import { BOX_LABELS, INVOICE_TYPE_LABELS, RESULT_LABELS, hijriDate, isValidSaudiVatNumber, normalizeVatNumber, zatcaPurchaseCheck, type ZatcaBox } from "./zatca-check"

export { riyadhTimestamp }

export type ExportLanguage = ClaimSettings["export_language"]

export interface ExportInput {
  claims: ExpenseClaim[]
  attachments: ClaimAttachment[]
  /** auth user id → display name */
  names: Record<string, string>
  language: ExportLanguage
  amountLocale: ClaimSettings["amount_locale"]
  /** Human-readable filters applied, e.g. [[{en:"Status",ar:"الحالة"}, "approved"]] */
  filters: Array<[Bi, string]>
  exportedAt: Date
  exportedBy: string
  companyName?: string
  markedExported?: boolean
}

export function label(b: Bi, lang: ExportLanguage): string {
  return lang === "en" ? b.en : lang === "ar" ? b.ar : b.en === b.ar ? b.en : `${b.en} / ${b.ar}`
}


/** Stable machine keys of the Expenses sheet columns (do not rename; integrations rely on them). */
export const EXPORT_COLUMNS = [
  "claim_no", "status", "submitter", "department", "expense_date", "submitted_at", "supplier_name", "supplier_vat_number", "receipt_number",
  "category", "business_purpose", "currency", "amount_before_vat", "vat_rate", "vat_amount", "total_amount", "payment_method",
  "project", "cost_center", "customer", "verification", "duplicate", "reviewer", "reviewed_at", "reviewer_comment",
  "exported_at", "reimbursed_at", "reimbursement_ref", "attachment_count", "attachments", "source", "notes",
] as const
type Col = (typeof EXPORT_COLUMNS)[number]

const EXTRA: Record<string, Bi> = {
  attachment_count: { en: "No. of attachments", ar: "عدد المرفقات" },
  attachments: { en: "Attachment file names", ar: "أسماء ملفات المرفقات" },
  vat_amount: { en: "VAT shown on receipt (unverified unless approved)", ar: "الضريبة الظاهرة في الإيصال (غير متحقق منها ما لم تُعتمد)" },
  submitted_at: { en: "Submitted at (Riyadh time)", ar: "تاريخ التقديم (بتوقيت الرياض)" },
  reviewed_at: { en: "Reviewed at (Riyadh time)", ar: "تاريخ المراجعة (بتوقيت الرياض)" },
  exported_at: { en: "Exported at (Riyadh time)", ar: "تاريخ التصدير (بتوقيت الرياض)" },
  reimbursed_at: { en: "Reimbursed at (Riyadh time)", ar: "تاريخ السداد (بتوقيت الرياض)" },
}
const colLabel = (c: Col): Bi => EXTRA[c] ?? (FIELD_LABELS as Record<string, Bi>)[c]

const SOURCE: Record<string, Bi> = { web: { en: "Web / mobile", ar: "الويب / الجوال" }, telegram: { en: "Telegram", ar: "تيليجرام" } }
const DUP: Record<ExpenseClaim["duplicate_status"], Bi> = {
  none: { en: "No match", ar: "لا يوجد تطابق" },
  possible: { en: "Possible duplicate (unresolved)", ar: "تكرار محتمل (لم يُحسم)" },
  not_duplicate: { en: "Reviewed: not a duplicate", ar: "تمت المراجعة: ليس مكرراً" },
  duplicate: { en: "Marked duplicate", ar: "مُعلَّم كمكرر" },
}
const VERIFIED: Bi = { en: "Reviewed by approver", ar: "تمت مراجعته من المعتمد" }
const UNVERIFIED: Bi = { en: "Unverified", ar: "غير متحقق منه" }

function amountFormat(locale: ExportInput["amountLocale"]): string {
  return locale === "ar-SA" ? "[$-2000401]#,##0.00" : "#,##0.00"
}

function setNumberFormat(ws: XLSX.WorkSheet, cols: number[], fromRow: number, fmt: string) {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1")
  for (let r = fromRow; r <= range.e.r; r++) for (const c of cols) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })]
    if (cell && cell.t === "n") cell.z = fmt
  }
}

function widths(rows: unknown[][], max = 48): XLSX.ColInfo[] {
  const n = Math.max(...rows.map((r) => r.length))
  return Array.from({ length: n }, (_, i) => ({ wch: Math.min(max, Math.max(8, ...rows.map((r) => String(r[i] ?? "").length + 2))) }))
}

export function buildExpenseWorkbook(input: ExportInput): XLSX.WorkBook {
  const L = (b: Bi) => label(b, input.language)
  const fmt = amountFormat(input.amountLocale)
  const byClaim = new Map<string, ClaimAttachment[]>()
  for (const a of input.attachments) byClaim.set(a.claim_id, [...(byClaim.get(a.claim_id) ?? []), a])
  const name = (id: string | null) => (id ? input.names[id] ?? id.slice(0, 8) : "")
  const claims = [...input.claims].sort((a, b) => (a.expense_date ?? "").localeCompare(b.expense_date ?? "") || a.claim_no.localeCompare(b.claim_no))

  // ── Expenses ──
  const header = EXPORT_COLUMNS.map((c) => L(colLabel(c)))
  const rows: unknown[][] = [header]
  for (const c of claims) {
    const files = byClaim.get(c.id) ?? []
    const value: Record<Col, unknown> = {
      claim_no: c.claim_no,
      status: L(STATUS_LABELS[c.status]),
      submitter: name(c.submitter_id),
      department: c.department ?? "",
      expense_date: c.expense_date ?? "",
      submitted_at: riyadhTimestamp(c.submitted_at),
      supplier_name: c.supplier_name ?? "",
      supplier_vat_number: c.supplier_vat_number ?? "",
      receipt_number: c.receipt_number ?? "",
      category: c.category ? L(categoryLabel(c.category)) : "",
      business_purpose: c.business_purpose ?? "",
      currency: c.currency,
      amount_before_vat: num(c.amount_before_vat) ?? "",
      vat_rate: num(c.vat_rate) ?? "",
      vat_amount: num(c.vat_amount) ?? "",
      total_amount: num(c.total_amount) ?? "",
      payment_method: c.payment_method ? L(PAYMENT_LABELS[c.payment_method]) : "",
      project: c.project ?? "",
      cost_center: c.cost_center ?? "",
      customer: c.customer ?? "",
      verification: L(c.verified_at ? VERIFIED : UNVERIFIED),
      duplicate: [L(DUP[c.duplicate_status]), ...c.duplicate_reasons.map((r) => (DUPLICATE_REASON_LABELS[r] ? L(DUPLICATE_REASON_LABELS[r]) : r))].join(" — "),
      reviewer: name(c.reviewer_id),
      reviewed_at: riyadhTimestamp(c.reviewed_at),
      reviewer_comment: c.reviewer_comment ?? "",
      exported_at: riyadhTimestamp(c.exported_at),
      reimbursed_at: riyadhTimestamp(c.reimbursed_at),
      reimbursement_ref: c.reimbursement_ref ?? "",
      attachment_count: files.length,
      attachments: files.map((f) => f.original_filename).join("; "),
      source: L(SOURCE[c.source] ?? SOURCE.web),
      notes: c.notes ?? "",
    }
    rows.push(EXPORT_COLUMNS.map((k) => value[k]))
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: EXPORT_COLUMNS.length - 1 } }) }
  ws["!cols"] = widths(rows)
  ws["!freeze"] = { xSplit: 1, ySplit: 1 }
  setNumberFormat(ws, ["amount_before_vat", "vat_amount", "total_amount"].map((k) => EXPORT_COLUMNS.indexOf(k as Col)), 1, fmt)

  // ── Summary (per currency; no cross-currency totals) ──
  const sum: unknown[][] = [
    [L({ en: "Expense claims summary — amounts are grouped per currency and never added across currencies.", ar: "ملخص مطالبات المصروفات — المبالغ مجمعة حسب العملة ولا تُجمع عبر العملات." })],
    [L({ en: "VAT columns show VAT as printed on receipts. It is unverified unless the claim was approved, and it is not a determination of recoverable or deductible VAT.", ar: "أعمدة الضريبة تعرض الضريبة كما هي مطبوعة في الإيصالات، وهي غير متحقق منها ما لم تُعتمد المطالبة، وليست تحديداً للضريبة القابلة للاسترداد أو الخصم." })],
  ]
  const amountCells: Array<[number, number]> = []
  const sections: Array<[GroupKey, Bi, (k: string) => string]> = [
    ["month", { en: "By month", ar: "حسب الشهر" }, (k) => k],
    ["category", { en: "By category", ar: "حسب الفئة" }, (k) => (k ? L(categoryLabel(k)) : L({ en: "Uncategorised", ar: "غير مصنف" }))],
    ["department", { en: "By department", ar: "حسب القسم" }, (k) => k || L({ en: "No department", ar: "بدون قسم" })],
    ["status", { en: "By status", ar: "حسب الحالة" }, (k) => L(STATUS_LABELS[k as ExpenseClaim["status"]] ?? { en: k, ar: k })],
  ]
  const sumHeader = (g: Bi) => [L(g), L(FIELD_LABELS.currency), L({ en: "Claims", ar: "عدد المطالبات" }), L(FIELD_LABELS.amount_before_vat), L({ en: "VAT shown on receipts", ar: "الضريبة الظاهرة في الإيصالات" }), L(FIELD_LABELS.total_amount)]
  for (const [by, title, keyLabel] of sections) {
    sum.push([], [L(title)], sumHeader(title))
    const groups = breakdown(claims, by)
    let lastCur = ""
    for (const g of groups) {
      if (lastCur && g.currency !== lastCur) sum.push([])
      lastCur = g.currency
      sum.push([keyLabel(g.key), g.currency, g.money.count, g.money.net, g.money.vat, g.money.total])
      amountCells.push([sum.length - 1, 3], [sum.length - 1, 4], [sum.length - 1, 5])
    }
    // Per-currency subtotal for the section.
    const perCur = new Map<string, { n: number; net: number; vat: number; total: number }>()
    for (const g of groups) {
      const t = perCur.get(g.currency) ?? { n: 0, net: 0, vat: 0, total: 0 }
      t.n += g.money.count; t.net += g.money.net; t.vat += g.money.vat; t.total += g.money.total
      perCur.set(g.currency, t)
    }
    for (const [cur, t] of perCur) {
      sum.push([`${L({ en: "Total", ar: "الإجمالي" })} (${cur})`, cur, t.n, Math.round(t.net * 100) / 100, Math.round(t.vat * 100) / 100, Math.round(t.total * 100) / 100])
      amountCells.push([sum.length - 1, 3], [sum.length - 1, 4], [sum.length - 1, 5])
    }
    if (!groups.length) sum.push([L({ en: "No claims", ar: "لا توجد مطالبات" })])
  }
  const ws2 = XLSX.utils.aoa_to_sheet(sum)
  for (const [r, c] of amountCells) { const cell = ws2[XLSX.utils.encode_cell({ r, c })]; if (cell?.t === "n") cell.z = fmt }
  ws2["!cols"] = [{ wch: 34 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 24 }, { wch: 18 }]

  // ── Attachments (file names only — no links) ──
  const att: unknown[][] = [[L(FIELD_LABELS.claim_no), L({ en: "File name", ar: "اسم الملف" }), L({ en: "Document type", ar: "نوع المستند" }), L({ en: "Size (KB)", ar: "الحجم (ك.ب)" }), "SHA-256", L({ en: "Uploaded at (Riyadh time)", ar: "تاريخ الرفع (بتوقيت الرياض)" }), L(FIELD_LABELS.source)]]
  const claimNo = new Map(claims.map((c) => [c.id, c.claim_no]))
  for (const a of [...input.attachments].filter((a) => claimNo.has(a.claim_id)).sort((x, y) => (claimNo.get(x.claim_id) ?? "").localeCompare(claimNo.get(y.claim_id) ?? "") || x.uploaded_at.localeCompare(y.uploaded_at))) {
    att.push([claimNo.get(a.claim_id), a.original_filename, L(DOC_KIND_LABELS[a.doc_kind]), Math.round(a.size_bytes / 102.4) / 10, a.sha256, riyadhTimestamp(a.uploaded_at), L(SOURCE[a.source] ?? SOURCE.web)])
  }
  const ws3 = XLSX.utils.aoa_to_sheet(att)
  ws3["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, att.length - 1), c: 6 } }) }
  ws3["!cols"] = widths(att, 66)

  // ── ZATCA purchase register (SAR tax-invoice fields per VAT Implementing Regulations Art. 53) ──
  const today = input.exportedAt
  const zHead: Bi[] = [
    FIELD_LABELS.claim_no, { en: "Claim status", ar: "حالة المطالبة" }, { en: "Invoice type", ar: "نوع الفاتورة" },
    { en: "Supplier name", ar: "اسم المورد" }, { en: "Supplier VAT registration no.", ar: "الرقم الضريبي للمورد" }, { en: "VAT no. format valid", ar: "صحة صيغة الرقم الضريبي" },
    { en: "Invoice serial no.", ar: "الرقم التسلسلي للفاتورة" }, { en: "Invoice date (Gregorian)", ar: "تاريخ الفاتورة (ميلادي)" }, { en: "Invoice date (Hijri)", ar: "تاريخ الفاتورة (هجري)" },
    { en: "Description", ar: "الوصف" }, { en: "Currency", ar: "العملة" }, { en: "Taxable amount (excl. VAT)", ar: "المبلغ الخاضع للضريبة (غير شامل الضريبة)" },
    { en: "VAT rate %", ar: "نسبة الضريبة %" }, { en: "VAT amount", ar: "مبلغ الضريبة" }, { en: "Total incl. VAT", ar: "الإجمالي شاملاً الضريبة" },
    { en: "VAT return box (purchases)", ar: "بند الإقرار الضريبي (المشتريات)" }, { en: "ZATCA check", ar: "نتيجة التحقق" },
    { en: "Input VAT claimable (after reviewer confirms original)", ar: "ضريبة مدخلات قابلة للخصم (بعد تأكيد المراجع للأصل)" }, { en: "Issues to fix", ar: "ملاحظات يجب معالجتها" },
  ]
  const zRows: unknown[][] = [zHead.map(L)]
  const yes = L({ en: "Yes", ar: "نعم" }), no = L({ en: "No", ar: "لا" })
  type Tot = { n: number; net: number; vat: number }
  const ret = new Map<ZatcaBox | "attention", Tot>()
  const add = (k: ZatcaBox | "attention", net: number, vat: number) => { const t = ret.get(k) ?? { n: 0, net: 0, vat: 0 }; t.n++; t.net += net; t.vat += vat; ret.set(k, t) }
  for (const c of claims) {
    const z = zatcaPurchaseCheck(c, today)
    const vatNo = normalizeVatNumber(c.supplier_vat_number)
    zRows.push([
      c.claim_no, L(STATUS_LABELS[c.status]), L(INVOICE_TYPE_LABELS[z.invoiceType]), c.supplier_name ?? "", vatNo,
      vatNo ? (isValidSaudiVatNumber(vatNo) ? yes : no) : "", c.receipt_number ?? "", c.expense_date ?? "", hijriDate(c.expense_date),
      [c.category ? L(categoryLabel(c.category)) : "", c.business_purpose ?? ""].filter(Boolean).join(" — "), c.currency,
      num(c.amount_before_vat) ?? "", num(c.vat_rate) ?? "", num(c.vat_amount) ?? "", num(c.total_amount) ?? "",
      L(BOX_LABELS[z.box]), L(RESULT_LABELS[z.result]), z.claimableVat, z.issues.map((i) => `${i.severity === "error" ? "✖" : "⚠"} ${L(i.text)}`).join("\n"),
    ])
    if (COUNTED_STATUSES.includes(c.status) && c.currency.toUpperCase() === "SAR") {
      const net = num(c.amount_before_vat) ?? num(c.total_amount) ?? 0, vat = num(c.vat_amount) ?? 0
      if (z.result === "attention") add("attention", net, vat)
      else add(z.box, net, z.box === "excluded" ? 0 : vat)
    }
  }
  const wsZ = XLSX.utils.aoa_to_sheet(zRows)
  wsZ["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, zRows.length - 1), c: zHead.length - 1 } }) }
  wsZ["!cols"] = widths(zRows, 60)
  wsZ["!freeze"] = { xSplit: 1, ySplit: 1 }
  setNumberFormat(wsZ, [11, 13, 14, 17], 1, fmt)

  const r2 = (n: number) => Math.round(n * 100) / 100
  const t = (k: ZatcaBox | "attention") => ret.get(k) ?? { n: 0, net: 0, vat: 0 }
  const vr: unknown[][] = [
    [L({ en: "VAT return – purchases (input VAT) from approved SAR expense claims", ar: "الإقرار الضريبي – المشتريات (ضريبة المدخلات) من مطالبات المصروفات المعتمدة بالريال" })],
    [L({ en: "Prepared from receipt data for the accountant. Confirm against original invoices before filing; this file is not submitted to ZATCA.", ar: "مُعد من بيانات الإيصالات للمحاسب. طابقه مع الفواتير الأصلية قبل التقديم؛ هذا الملف لا يُرسل إلى الهيئة." })],
    [],
    [L({ en: "VAT return line", ar: "بند الإقرار" }), L({ en: "Invoices", ar: "عدد الفواتير" }), L({ en: "Amount (SAR, excl. VAT)", ar: "المبلغ (ريال، غير شامل الضريبة)" }), L({ en: "VAT (SAR)", ar: "الضريبة (ريال)" })],
    [L(BOX_LABELS.box7), t("box7").n, r2(t("box7").net), r2(t("box7").vat)],
    [L({ en: "Box 8 – Imports subject to VAT paid at customs", ar: "البند 8 – الواردات الخاضعة للضريبة المدفوعة في الجمارك" }), 0, 0, 0],
    [L({ en: "Box 9 – Imports subject to VAT under reverse charge", ar: "البند 9 – الواردات الخاضعة للضريبة بآلية الاحتساب العكسي" }), 0, 0, 0],
    [L(BOX_LABELS.box10_11), t("box10_11").n, r2(t("box10_11").net), 0],
    [],
    [L({ en: "Not included above", ar: "غير مدرج أعلاه" })],
    [L({ en: "Needs attention (fix data before including)", ar: "تحتاج مراجعة (صحح البيانات قبل الإدراج)" }), t("attention").n, r2(t("attention").net), r2(t("attention").vat)],
    [L(BOX_LABELS.excluded), t("excluded").n, r2(t("excluded").net), 0],
    [],
    [L({ en: "Boxes 8 and 9 (imports) are not captured from expense receipts and are shown as zero.", ar: "البندان 8 و9 (الواردات) لا يُلتقطان من إيصالات المصروفات ويظهران صفراً." })],
    [L({ en: "Only claims with status Approved, Exported or Reimbursed in SAR are counted.", ar: "تُحتسب فقط المطالبات المعتمدة أو المُصدَّرة أو المسددة بالريال السعودي." })],
  ]
  const wsV = XLSX.utils.aoa_to_sheet(vr)
  for (let r = 4; r < vr.length; r++) for (const c of [2, 3]) { const cell = wsV[XLSX.utils.encode_cell({ r, c })]; if (cell?.t === "n") cell.z = fmt }
  wsV["!cols"] = [{ wch: 70 }, { wch: 14 }, { wch: 26 }, { wch: 18 }]

  // ── Export info ──
  const currencies = [...new Set(claims.map((c) => c.currency))].sort()
  const info: unknown[][] = [
    [L({ en: "Expense claims export", ar: "تصدير مطالبات المصروفات" }), input.companyName ?? ""],
    [L({ en: "Exported at (Riyadh time)", ar: "وقت التصدير (بتوقيت الرياض)" }), riyadhTimestamp(input.exportedAt)],
    [L({ en: "Exported at (UTC, ISO 8601)", ar: "وقت التصدير (UTC)" }), input.exportedAt.toISOString()],
    [L({ en: "Exported by", ar: "صدّره" }), input.exportedBy],
    [L({ en: "Claims in this file", ar: "عدد المطالبات في الملف" }), claims.length],
    [L({ en: "Currencies", ar: "العملات" }), currencies.join(", ") || "—"],
    [L({ en: "Approved claims marked as exported", ar: "تم تعليم المطالبات المعتمدة كمُصدَّرة" }), L(input.markedExported ? { en: "Yes", ar: "نعم" } : { en: "No", ar: "لا" })],
    [],
    [L({ en: "Filters applied", ar: "عوامل التصفية المطبقة" })],
    ...(input.filters.length ? input.filters.map(([k, v]) => [L(k), v]) : [[L({ en: "None (all claims visible to you)", ar: "لا يوجد (كل المطالبات المتاحة لك)" })]]),
    [],
    [L({ en: "Important", ar: "تنبيه مهم" })],
    [L(SUPPORTING_DOC_NOTICE)],
    [L({ en: "VAT amounts are as shown on receipts and are unverified unless the claim was approved by a reviewer. The ZATCA sheets apply the tax-invoice data rules (VAT Implementing Regulations Art. 49 and 53) to the captured data; confirm against the original invoices before filing. Nothing in this file is submitted to ZATCA.", ar: "مبالغ الضريبة كما تظهر في الإيصالات وهي غير متحقق منها ما لم يعتمد المراجع المطالبة. تطبق أوراق الهيئة قواعد بيانات الفاتورة الضريبية (المادتان 49 و53 من اللائحة التنفيذية لنظام ضريبة القيمة المضافة) على البيانات المدخلة؛ طابقها مع الفواتير الأصلية قبل التقديم. لا يُرسل أي شيء من هذا الملف إلى الهيئة." })],
    [L({ en: "Totals are per currency; amounts in different currencies are never added together.", ar: "الإجماليات حسب العملة، ولا تُجمع المبالغ بعملات مختلفة." })],
    [L({ en: "Attachments are listed by file name only; originals stay in the secure system.", ar: "المرفقات مدرجة بأسماء الملفات فقط، وتبقى الأصول في النظام الآمن." })],
    [],
    [L({ en: "Column keys (stable)", ar: "مفاتيح الأعمدة (ثابتة)" })],
    ...EXPORT_COLUMNS.map((k) => [k, L(colLabel(k))]),
  ]
  const ws4 = XLSX.utils.aoa_to_sheet(info)
  ws4["!cols"] = [{ wch: 44 }, { wch: 60 }]

  const wb = XLSX.utils.book_new()
  const names: Record<"exp" | "sum" | "att" | "info" | "z" | "vr", Bi> = {
    z: { en: "ZATCA purchases", ar: "مشتريات الهيئة" }, vr: { en: "VAT return", ar: "الإقرار الضريبي" },
    exp: { en: "Expenses", ar: "المصروفات" }, sum: { en: "Summary", ar: "الملخص" }, att: { en: "Attachments", ar: "المرفقات" }, info: { en: "Export info", ar: "معلومات التصدير" },
  }
  const sheetName = (b: Bi) => (input.language === "both" ? `${b.en} - ${b.ar}` : L(b)).slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName(names.exp))
  XLSX.utils.book_append_sheet(wb, ws2, sheetName(names.sum))
  XLSX.utils.book_append_sheet(wb, wsZ, sheetName(names.z))
  XLSX.utils.book_append_sheet(wb, wsV, sheetName(names.vr))
  XLSX.utils.book_append_sheet(wb, ws3, sheetName(names.att))
  XLSX.utils.book_append_sheet(wb, ws4, sheetName(names.info))
  if (input.language === "ar") wb.Workbook = { Views: [{ RTL: true }] }
  wb.Props = { Title: "Expense claims export", Company: input.companyName ?? "", CreatedDate: input.exportedAt }
  return wb
}

export function writeExpenseWorkbook(input: ExportInput): Uint8Array {
  return new Uint8Array(XLSX.write(buildExpenseWorkbook(input), { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer)
}

export function exportFilename(at: Date): string {
  return `expense-claims-${riyadhTimestamp(at).replace(/[: ]/g, "").replace(/-/g, "").slice(0, 12)}.xlsx`
}
