import { describe, expect, it } from "vitest"
import { bareLinkCode, parseReceiptText } from "./receipt-parse"
import { decodeZatcaQr, qrToSuggestion, readUblXml } from "./zatca-qr"

function tlv(fields: string[]): string {
  const enc = new TextEncoder()
  const parts: number[] = []
  fields.forEach((v, i) => { const b = enc.encode(v); parts.push(i + 1, b.length, ...b) })
  return btoa(String.fromCharCode(...parts))
}

describe("ZATCA QR", () => {
  const qr = tlv(["شركة نخبة التطوير", "310122393500003", "2026-10-28T22:30:00Z", "1150.00", "150.00"])

  it("decodes Phase 1 TLV", () => {
    const d = decodeZatcaQr(qr)
    expect(d).toMatchObject({ sellerName: "شركة نخبة التطوير", vatNumber: "310122393500003", total: "1150.00", vatTotal: "150.00", phase2: false })
  })

  it("maps to suggestions with Riyadh calendar date", () => {
    const s = qrToSuggestion(decodeZatcaQr(qr)!)
    expect(s).toMatchObject({ currency: "SAR", total_amount: "1150.00", vat_amount: "150.00", amount_before_vat: "1000.00", vat_rate: "15", expense_date: "2026-10-29" })
  })

  it("flags Phase 2 when tag 6 is present", () => {
    expect(decodeZatcaQr(tlv(["A", "310122393500003", "2026-10-28T10:00:00", "115", "15", "hash"]))?.phase2).toBe(true)
  })

  it("rejects non-ZATCA payloads", () => {
    expect(decodeZatcaQr("https://example.com/receipt/123")).toBeNull()
    expect(decodeZatcaQr(tlv(["A", "12345", "2026-10-28", "115", "15"]))).toBeNull()
    expect(decodeZatcaQr("AAAAAAAAAAAAAAAAAAAAAAAA")).toBeNull()
  })
})

describe("UBL XML reader", () => {
  it("reads core fields", () => {
    const xml = `<Invoice><cbc:ID>INV-77</cbc:ID><cbc:IssueDate>2026-10-01</cbc:IssueDate><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
      <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">QUJD</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
      <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>310122393500003</cbc:CompanyID></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>Acme Co</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
      <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount></cac:TaxTotal>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent></cac:TaxCategory>
      <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="SAR">100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="SAR">115.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal></Invoice>`
    const r = readUblXml(xml)
    expect(r.fields).toMatchObject({ receipt_number: "INV-77", expense_date: "2026-10-01", supplier_name: "Acme Co", supplier_vat_number: "310122393500003", currency: "SAR", amount_before_vat: "100.00", total_amount: "115.00", vat_amount: "15.00", vat_rate: "15" })
    expect(r.qr).toBe("QUJD")
  })
})

describe("text helpers", () => {
  it("trims trailing separators from invoice numbers", () => {
    expect(parseReceiptText("Invoice No: INV-2026-00457-\nTotal 115.00", "2026-12-31").fields.receipt_number).toBe("INV-2026-00457")
  })
  it("bare link code", () => {
    expect(typeof bareLinkCode).toBe("function")
  })
})
