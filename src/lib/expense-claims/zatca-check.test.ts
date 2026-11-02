import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { hijriDate, isValidSaudiVatNumber, zatcaPurchaseCheck } from "./zatca-check"
import { buildExpenseWorkbook } from "./export-xlsx"
import type { ExpenseClaim } from "./constants"

const today = new Date("2026-11-02T00:00:00Z")
const base = { currency: "SAR", supplier_name: "Shell", supplier_vat_number: "300000000000003", receipt_number: "INV-1", expense_date: "2026-10-01", amount_before_vat: "100.00", vat_rate: "15", vat_amount: "15.00", total_amount: "115.00" }

describe("ZATCA purchase check", () => {
  it("validates Saudi VAT numbers (15 digits, starts and ends with 3, Arabic digits ok)", () => {
    expect(isValidSaudiVatNumber("300000000000003")).toBe(true)
    expect(isValidSaudiVatNumber("300 0000 0000 0003")).toBe(true)
    expect(isValidSaudiVatNumber("٣٠٠٠٠٠٠٠٠٠٠٠٠٠٣")).toBe(true)
    expect(isValidSaudiVatNumber("310000000000002")).toBe(false)
    expect(isValidSaudiVatNumber("30000000000003")).toBe(false)
  })
  it("a complete simplified invoice is ready and maps to box 7", () => {
    const z = zatcaPurchaseCheck(base, today)
    expect(z).toMatchObject({ invoiceType: "simplified", box: "box7", result: "ready", claimableVat: 15 })
  })
  it("SAR 1,000+ is a standard tax invoice and reminds about buyer details", () => {
    const z = zatcaPurchaseCheck({ ...base, amount_before_vat: "1000.00", vat_amount: "150.00", total_amount: "1150.00" }, today)
    expect(z.invoiceType).toBe("standard")
    expect(z.issues.some((i) => i.code === "buyer")).toBe(true)
  })
  it("VAT without a valid supplier VAT number is not claimable", () => {
    expect(zatcaPurchaseCheck({ ...base, supplier_vat_number: null }, today)).toMatchObject({ result: "not_claimable", box: "excluded", claimableVat: 0 })
    expect(zatcaPurchaseCheck({ ...base, supplier_vat_number: "123" }, today).result).toBe("not_claimable")
  })
  it("flags arithmetic, wrong rate, missing invoice no., future and >5y dates", () => {
    expect(zatcaPurchaseCheck({ ...base, total_amount: "120.00" }, today).issues.map((i) => i.code)).toContain("sum")
    expect(zatcaPurchaseCheck({ ...base, vat_amount: "10.00", total_amount: "110.00" }, today).issues.map((i) => i.code)).toContain("vat_calc")
    expect(zatcaPurchaseCheck({ ...base, vat_rate: "5" }, today).result).toBe("not_claimable")
    expect(zatcaPurchaseCheck({ ...base, receipt_number: null }, today).result).toBe("attention")
    expect(zatcaPurchaseCheck({ ...base, expense_date: "2026-12-30" }, today).issues.map((i) => i.code)).toContain("date_future")
    expect(zatcaPurchaseCheck({ ...base, expense_date: "2020-01-01" }, today).result).toBe("not_claimable")
  })
  it("foreign currency and no-VAT receipts are excluded", () => {
    expect(zatcaPurchaseCheck({ ...base, currency: "USD" }, today)).toMatchObject({ invoiceType: "foreign", box: "excluded" })
    expect(zatcaPurchaseCheck({ ...base, supplier_vat_number: null, vat_rate: null, vat_amount: null, amount_before_vat: null, total_amount: "20.00" }, today)).toMatchObject({ invoiceType: "no_vat_invoice", box: "excluded" })
  })
  it("zero-rated with VAT number maps to box 10/11", () => {
    expect(zatcaPurchaseCheck({ ...base, vat_rate: "0", vat_amount: "0", total_amount: "100.00" }, today).box).toBe("box10_11")
  })
  it("converts to Umm al-Qura Hijri", () => {
    expect(hijriDate("2026-11-02")).toMatch(/^1448\/05\/\d{2}$/)
  })
  it("export includes ZATCA register and VAT return sheets with box 7 totals", () => {
    const claim = { id: "c1", claim_no: "EXP-1", submitter_id: "u", department: null, submitted_at: null, category: "fuel", business_purpose: "Delivery", payment_method: "cash", project: null, cost_center: null, customer: null, notes: null,
      status: "approved", source: "web", ocr_suggestions: {}, unverified_fields: [], verified_by: null, verified_at: null, reviewer_id: null, reviewed_at: null, reviewer_comment: null, review_checklist: {},
      duplicate_status: "none", duplicate_of: [], duplicate_reasons: [], exported_at: null, reimbursed_at: null, reimbursement_ref: null, version: 1, created_at: "", updated_at: "", ...base } as unknown as ExpenseClaim
    const wb = buildExpenseWorkbook({ claims: [claim], attachments: [], names: {}, language: "en", amountLocale: "en-US", filters: [], exportedAt: today, exportedBy: "Admin" })
    expect(wb.SheetNames).toEqual(["Expenses", "Summary", "ZATCA purchases", "VAT return", "Attachments", "Export info"])
    const z = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["ZATCA purchases"], { header: 1 })
    expect(z[1]).toContain("300000000000003")
    const v = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["VAT return"], { header: 1 })
    expect(v[4]).toEqual([expect.stringContaining("Box 7"), 1, 100, 15])
  })
})
