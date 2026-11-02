import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { claimErrorMessage, type ClaimAttachment, type ExpenseClaim } from "./constants"
import { breakdown, buildDashboard, filterClaims, formatMoney } from "./dashboard"
import { buildExpenseWorkbook, exportFilename, label, riyadhTimestamp, writeExpenseWorkbook } from "./export-xlsx"
import { precheckFile, safeFilename, sha256Hex, sniffFile } from "./file-check"
import { normalizeCategory, parseCaption, parseReceiptText } from "./receipt-parse"

const enc = (s: string) => new TextEncoder().encode(s)
const bytes = (...b: number[]) => new Uint8Array(b)

function claim(p: Partial<ExpenseClaim>): ExpenseClaim {
  return {
    id: "c1", claim_no: "EXP-2611-AAAAAA", submitter_id: "u1", department: null, expense_date: "2026-11-01", submitted_at: null,
    supplier_name: null, supplier_vat_number: null, receipt_number: null, category: null, business_purpose: null, currency: "SAR",
    amount_before_vat: null, vat_rate: null, vat_amount: null, total_amount: null, payment_method: null, project: null, cost_center: null,
    customer: null, notes: null, status: "draft", source: "web", ocr_suggestions: {}, unverified_fields: [], verified_by: null, verified_at: null,
    reviewer_id: null, reviewed_at: null, reviewer_comment: null, review_checklist: {}, duplicate_status: "none", duplicate_of: [],
    duplicate_reasons: [], exported_at: null, reimbursed_at: null, reimbursement_ref: null, version: 1, created_at: "2026-11-01T08:00:00Z",
    updated_at: "2026-11-01T08:00:00Z", ...p,
  }
}

describe("sniffFile", () => {
  it("accepts receipt photos by magic bytes", () => {
    expect(sniffFile(bytes(0xff, 0xd8, 0xff, 0xe0, 1, 2))).toMatchObject({ ok: true, mime: "image/jpeg", kind: "photo" })
    expect(sniffFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toMatchObject({ ok: true, mime: "image/png" })
    expect(sniffFile(enc("RIFF\0\0\0\0WEBPVP8 "))).toMatchObject({ ok: true, mime: "image/webp" })
    expect(sniffFile(enc("\0\0\0\x18ftypheic\0\0\0\0"))).toMatchObject({ ok: true, mime: "image/heic" })
  })
  it("classifies CamScanner PDFs as scanned and blocks active content", () => {
    expect(sniffFile(enc("%PDF-1.7\n/Producer (CamScanner)\n/Subtype /Image\n%%EOF"))).toMatchObject({ ok: true, mime: "application/pdf", kind: "scanned_pdf" })
    expect(sniffFile(enc("%PDF-1.4\n/Font /F1\n%%EOF"))).toMatchObject({ ok: true, kind: "digital_pdf" })
    expect(sniffFile(enc("%PDF-1.4\n/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"))).toMatchObject({ ok: false, reason: "active_content" })
    expect(sniffFile(enc("%PDF-1.4\n/A << /S /Launch /F (cmd.exe) >>"))).toMatchObject({ ok: false, reason: "active_content" })
    expect(sniffFile(enc("%PDF-1.4\n/Names << /EmbeddedFiles 3 0 R >>"))).toMatchObject({ ok: false, reason: "active_content" })
    expect(sniffFile(enc("%PDF-1.4\n/JSON-ish /JSX"))).toMatchObject({ ok: true })
  })
  it("accepts only safe UBL invoice XML", () => {
    const ubl = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID>1</cbc:ID></Invoice>`
    expect(sniffFile(enc(ubl))).toMatchObject({ ok: true, mime: "application/xml", kind: "structured_einvoice" })
    expect(sniffFile(enc(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><Invoice/>`))).toMatchObject({ ok: false, reason: "unsafe_xml" })
    expect(sniffFile(enc(`<?xml version="1.0"?><note>hi</note>`))).toMatchObject({ ok: false, reason: "not_einvoice" })
  })
  it("rejects HTML, SVG, executables, empty and oversized files", () => {
    expect(sniffFile(enc("<html><script>alert(1)</script></html>"))).toMatchObject({ ok: false, reason: "unsupported" })
    expect(sniffFile(enc(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`))).toMatchObject({ ok: false })
    expect(sniffFile(enc("MZ\x90\0"))).toMatchObject({ ok: false, reason: "unsupported" })
    expect(sniffFile(new Uint8Array())).toMatchObject({ ok: false, reason: "empty" })
    expect(sniffFile(bytes(0xff, 0xd8, 0xff), 11 * 1024 * 1024)).toMatchObject({ ok: false, reason: "too_large" })
  })
  it("sanitises filenames and pre-checks client files", async () => {
    expect(safeFilename("../../etc/passwd", "pdf")).toBe("passwd.pdf")
    expect(safeFilename("IMG_1.JPEG", "jpg")).toBe("IMG_1.JPEG")
    expect(safeFilename("scan.exe", "pdf")).toBe("scan.pdf")
    expect(safeFilename("invoice\u202Egpj.exe", "jpg")).toBe("invoicegpj.jpg")
    expect(safeFilename("", "png")).toBe("receipt.png")
    expect(precheckFile({ size: 10, name: "a.exe", type: "application/x-msdownload" })?.en).toMatch(/Only JPG/)
    expect(precheckFile({ size: 10, name: "scan.pdf", type: "application/pdf" })).toBeNull()
    expect(await sha256Hex(enc("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
})

describe("receipt OCR parsing", () => {
  it("extracts suggestions from an English/Arabic simplified tax invoice", () => {
    const text = `Al Nahdi Pharmacy\nSimplified Tax Invoice فاتورة ضريبية مبسطة\nVAT No: 300123456700003\nInvoice No: INV-55821\nDate: 2026/10/28 14:22\nSubtotal 100.00\nVAT 15% 15.00\nTotal 115.00 SAR\nPaid: CASH`
    const r = parseReceiptText(text, "2026-11-02")
    expect(r.fields).toMatchObject({ supplier_name: "Al Nahdi Pharmacy", supplier_vat_number: "300123456700003", receipt_number: "INV-55821", expense_date: "2026-10-28",
      amount_before_vat: "100.00", vat_amount: "15.00", vat_rate: "15", total_amount: "115.00", currency: "SAR", payment_method: "cash" })
    expect(r.amountsConsistent).toBe(true)
  })
  it("handles Arabic-Indic digits and derives the subtotal", () => {
    const r = parseReceiptText("محطة الدريس\nالإجمالي ٥٧٫٥٠ ر.س\nضريبة القيمة المضافة ٧٫٥٠", "2026-11-02")
    expect(r.fields.total_amount).toBe("57.50")
    expect(r.fields.vat_amount).toBe("7.50")
    expect(r.fields.amount_before_vat).toBe("50.00")
    expect(r.fields.currency).toBe("SAR")
  })
  it("ignores future dates and returns nothing for blank text", () => {
    expect(parseReceiptText("Date 2030-01-01\nTotal 10", "2026-11-02").fields.expense_date).toBeUndefined()
    expect(parseReceiptText("", "2026-11-02")).toEqual({ fields: {}, amountsConsistent: null })
  })
})

describe("Telegram caption parsing", () => {
  it("reads key/value captions in English and Arabic", () => {
    expect(parseCaption("total 115 vat 15 supplier Shell Station category fuel purpose delivery run Riyadh date 2026-11-01 receipt R-77"))
      .toEqual({ total_amount: "115.00", vat_amount: "15.00", amount_before_vat: "100.00", supplier_name: "Shell Station", category: "fuel",
        business_purpose: "delivery run Riyadh", expense_date: "2026-11-01", receipt_number: "R-77" })
    expect(parseCaption("المبلغ ٥٠ الفئة وقود الغرض توصيل")).toMatchObject({ total_amount: "50.00", category: "fuel", business_purpose: "توصيل" })
  })
  it("treats a bare amount as the total and free text as the purpose", () => {
    expect(parseCaption("45.5 SAR")).toEqual({ total_amount: "45.50", currency: "SAR" })
    expect(parseCaption("lunch with client")).toEqual({ business_purpose: "lunch with client" })
    expect(parseCaption("")).toEqual({})
  })
  it("normalises categories against the allowed list", () => {
    expect(normalizeCategory("Petrol")).toBe("fuel")
    expect(normalizeCategory("وجبات")).toBe("meals")
    expect(normalizeCategory("fuel", ["meals"])).toBeUndefined()
  })
})

describe("dashboard", () => {
  const claims = [
    claim({ id: "a", status: "approved", total_amount: "115", vat_amount: "15", amount_before_vat: "100", category: "fuel", department: "Ops", verified_at: "2026-11-02T00:00:00Z" }),
    claim({ id: "b", status: "submitted", total_amount: 50, vat_amount: 5, category: "meals", unverified_fields: ["total_amount"], duplicate_status: "possible" }),
    claim({ id: "c", status: "reimbursed", currency: "USD", total_amount: 20, expense_date: "2026-10-05" }),
    claim({ id: "d", status: "needs_info", total_amount: 10, vat_amount: 1, amount_before_vat: 5 }),
    claim({ id: "e", status: "draft", total_amount: 999 }),
  ]
  it("groups per currency and never mixes currencies", () => {
    const d = buildDashboard(claims, { a: 1, c: 2 })
    expect(d.byCurrency.map((k) => k.currency)).toEqual(["SAR", "USD"])
    const sar = d.byCurrency[0]
    expect(sar.approved.total).toBe(115)
    expect(sar.pending.total).toBe(60)
    expect(sar.vatShownReviewed).toBe(15)
    expect(sar.vatShownUnverified).toBe(6)
    expect(d.byCurrency[1].reimbursed.total).toBe(20)
    expect(d.alerts.missingDocuments.sort()).toEqual(["b", "d"])
    expect(d.alerts.possibleDuplicates).toEqual(["b"])
    expect(d.alerts.amountsMismatch).toEqual(["d"])
    expect(d.alerts.unverifiedFields).toEqual(["b"])
    expect(d.counts.draft).toBe(1)
  })
  it("breaks down by month and filters", () => {
    expect(breakdown(claims, "month").map((g) => `${g.currency}:${g.key}:${g.money.total}`)).toEqual(["SAR:2026-11:1174", "USD:2026-10:20"])
    expect(filterClaims(claims, { status: ["approved", "reimbursed"], currency: ["SAR"] }).map((c) => c.id)).toEqual(["a"])
    expect(filterClaims(claims, { from: "2026-11-01", to: "2026-11-30" }).length).toBe(4)
    expect(filterClaims(claims, { q: "bob" }, { u1: "Bob" }).length).toBe(5)
    expect(formatMoney(1234.5, "SAR")).toMatch(/1,234\.50/)
  })
})

describe("Excel export", () => {
  const claims = [
    claim({ id: "a", claim_no: "EXP-1", status: "approved", total_amount: "115", vat_amount: "15", amount_before_vat: "100", category: "fuel", department: "Ops", reviewer_id: "u2", reviewed_at: "2026-11-02T09:30:00Z", verified_at: "2026-11-02T09:30:00Z" }),
    claim({ id: "b", claim_no: "EXP-2", status: "submitted", currency: "USD", total_amount: 20 }),
  ]
  const attachments: ClaimAttachment[] = [{ id: "x", claim_id: "a", original_filename: "receipt.pdf", mime_type: "application/pdf", size_bytes: 2048, sha256: "f".repeat(64), doc_kind: "scanned_pdf", source: "web", uploaded_at: "2026-11-01T10:00:00Z" }]
  const base = { claims, attachments, names: { u1: "Sara", u2: "Omar" }, amountLocale: "en-US" as const, filters: [[{ en: "Status", ar: "الحالة" }, "approved"]] as Array<[{ en: string; ar: string }, string]>, exportedAt: new Date("2026-11-02T08:15:00Z"), exportedBy: "Omar" }

  it("builds four sheets with a filterable expenses table and no links", () => {
    const wb = buildExpenseWorkbook({ ...base, language: "en" })
    expect(wb.SheetNames).toEqual(["Expenses", "Summary", "Attachments", "Export info"])
    const ws = wb.Sheets.Expenses
    expect(ws["!autofilter"]?.ref).toBe("A1:AF3")
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    expect(rows[0]).toMatchObject({ "Claim no.": "EXP-1", Submitter: "Sara", Reviewer: "Omar", "Reviewed at (Riyadh time)": "2026-11-02 12:30", "Attachment file names": "receipt.pdf", "Total amount": 115, Verification: "Reviewed by approver" })
    expect(rows[1]).toMatchObject({ Currency: "USD", Verification: "Unverified" })
    const json = JSON.stringify(wb)
    expect(json).not.toMatch(/https?:\/\//)
    expect(json).not.toMatch(/recoverable input VAT|input VAT recoverable/i)
  })
  it("summarises per currency without cross-currency totals", () => {
    const wb = buildExpenseWorkbook({ ...base, language: "en" })
    const sum = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1 })
    const totals = sum.filter((r) => typeof r[0] === "string" && (r[0] as string).startsWith("Total ("))
    expect(totals.map((r) => r[0])).toEqual(expect.arrayContaining(["Total (SAR)", "Total (USD)"]))
    expect(totals.every((r) => r[0] === `Total (${r[1]})`)).toBe(true)
    const info = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Export info"], { header: 1 })
    expect(info[1]).toEqual(["Exported at (Riyadh time)", "2026-11-02 11:15"])
    expect(info.flat().join(" ")).toMatch(/not ZATCA e-invoices/)
    expect(info.find((r) => r[0] === "Status")).toEqual(["Status", "approved"])
  })
  it("supports Arabic and bilingual labels", () => {
    const ar = buildExpenseWorkbook({ ...base, language: "ar", amountLocale: "ar-SA" })
    expect(ar.SheetNames[0]).toBe("المصروفات")
    expect(ar.Workbook?.Views?.[0]?.RTL).toBe(true)
    const both = buildExpenseWorkbook({ ...base, language: "both" })
    expect(both.SheetNames[0]).toBe("Expenses - المصروفات")
    expect(label({ en: "Status", ar: "الحالة" }, "both")).toBe("Status / الحالة")
    const bin = writeExpenseWorkbook({ ...base, language: "both" })
    expect(bin[0]).toBe(0x50) // PK zip
    expect(XLSX.read(bin, { type: "array" }).SheetNames).toHaveLength(4)
  })
  it("formats timestamps and filenames in Riyadh time", () => {
    expect(riyadhTimestamp("2026-11-01T22:30:00Z")).toBe("2026-11-02 01:30")
    expect(exportFilename(new Date("2026-11-02T08:15:00Z"))).toBe("expense-claims-202611021115.xlsx")
  })
})

it("maps RPC errors to friendly bilingual messages", () => {
  expect(claimErrorMessage(new Error("EXC007: you cannot review your own expense claim"))).toBe("You cannot review your own expense claim.")
  expect(claimErrorMessage({ message: "EXC008: x" }, "ar")).toMatch(/التكرار/)
  expect(claimErrorMessage("boom")).toMatch(/could not be completed/)
})
