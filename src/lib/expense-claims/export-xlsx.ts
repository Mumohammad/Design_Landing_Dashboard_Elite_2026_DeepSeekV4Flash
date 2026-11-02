// "Export Expenses" workbook. Pure (no server imports) so it is unit-tested.
// Amounts are grouped per currency and never totalled across currencies.
// Receipt VAT is labelled "as shown on receipts"; nothing here is a VAT
// recoverability determination, a ZATCA filing or an e-invoice.
import * as XLSX from "xlsx"
import {
  DOC_KIND_LABELS, DUPLICATE_REASON_LABELS, FIELD_LABELS, PAYMENT_LABELS, STATUS_LABELS, SUPPORTING_DOC_NOTICE,
  categoryLabel, num, type Bi, type ClaimAttachment, type ClaimSettings, type ExpenseClaim,
} from "./constants"
import { breakdown, type GroupKey } from "./dashboard"
import { riyadhTimestamp } from "./format"

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
    [L({ en: "VAT amounts are as shown on receipts and are unverified unless the claim was approved by a reviewer. This file is not a determination of recoverable or deductible VAT and is not a VAT return or ZATCA filing.", ar: "مبالغ الضريبة كما تظهر في الإيصالات وهي غير متحقق منها ما لم يعتمد المراجع المطالبة. هذا الملف ليس تحديداً للضريبة القابلة للاسترداد أو الخصم، وليس إقراراً ضريبياً أو تقديماً لهيئة الزكاة والضريبة والجمارك." })],
    [L({ en: "Totals are per currency; amounts in different currencies are never added together.", ar: "الإجماليات حسب العملة، ولا تُجمع المبالغ بعملات مختلفة." })],
    [L({ en: "Attachments are listed by file name only; originals stay in the secure system.", ar: "المرفقات مدرجة بأسماء الملفات فقط، وتبقى الأصول في النظام الآمن." })],
    [],
    [L({ en: "Column keys (stable)", ar: "مفاتيح الأعمدة (ثابتة)" })],
    ...EXPORT_COLUMNS.map((k) => [k, L(colLabel(k))]),
  ]
  const ws4 = XLSX.utils.aoa_to_sheet(info)
  ws4["!cols"] = [{ wch: 44 }, { wch: 60 }]

  const wb = XLSX.utils.book_new()
  const names: Record<"exp" | "sum" | "att" | "info", Bi> = {
    exp: { en: "Expenses", ar: "المصروفات" }, sum: { en: "Summary", ar: "الملخص" }, att: { en: "Attachments", ar: "المرفقات" }, info: { en: "Export info", ar: "معلومات التصدير" },
  }
  const sheetName = (b: Bi) => (input.language === "both" ? `${b.en} - ${b.ar}` : L(b)).slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName(names.exp))
  XLSX.utils.book_append_sheet(wb, ws2, sheetName(names.sum))
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

