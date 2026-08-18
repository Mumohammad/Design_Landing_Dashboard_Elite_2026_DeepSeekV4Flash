import { describe, expect, it } from "vitest"
import {
  buildZatcaUblInvoice,
  escXml,
  INVOICE_TYPE_CODES,
  ZATCA_CUSTOMIZATION_ID,
  type ZatcaInvoiceData,
} from "./zatca-ubl"

const base: ZatcaInvoiceData = {
  docType: "invoice",
  invoiceNumber: "INV-2026-000001",
  issueDate: "2026-01-15",
  issueTime: "10:30:00",
  currency: "SAR",
  seller: {
    name: "نخبة التطوير",
    vatNumber: "310122993400001",
    crNumber: "1010123456",
    address: "الرياض",
    city: "الرياض",
  },
  buyer: {
    name: "شركة الأمل",
    vatNumber: "311122993400001",
  },
  lines: [
    { line_no: 1, description: "خدمات استشارية", quantity: 1, unit_price: 100000, amount: 100000, vat_rate: 15, vat_amount: 15000 },
  ],
  subtotal: 100000,
  discount: 0,
  vatAmount: 15000,
  total: 115000,
  qr: {
    sellerName: "نخبة التطوير",
    sellerVatNumber: "310122993400001",
    timestamp: "2026-01-15T10:30:00Z",
    total: 115000,
    vatAmount: 15000,
  },
}

describe("escXml", () => {
  it("escapes the five XML-sensitive characters", () => {
    expect(escXml(`<a & "b" 'c' >`)).toBe("&lt;a &amp; &quot;b&quot; &apos;c&apos; &gt;")
  })

  it("handles null/undefined as empty string", () => {
    expect(escXml(null)).toBe("")
    expect(escXml(undefined)).toBe("")
  })
})

describe("buildZatcaUblInvoice", () => {
  it("emits the UBL 2.1 root with the standard namespaces", () => {
    const xml = buildZatcaUblInvoice(base)
    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')
    expect(xml).toContain('xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"')
    expect(xml).toContain('xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"')
    expect(xml).toContain("<cbc:UBLVersionID>2.1</cbc:UBLVersionID>")
    expect(xml).toContain(`<cbc:CustomizationID>${ZATCA_CUSTOMIZATION_ID}</cbc:CustomizationID>`)
  })

  it("carries the mandatory header fields (number, date, time, type, currency)", () => {
    const xml = buildZatcaUblInvoice(base)
    expect(xml).toContain("<cbc:ID>INV-2026-000001</cbc:ID>")
    expect(xml).toContain("<cbc:IssueDate>2026-01-15</cbc:IssueDate>")
    expect(xml).toContain("<cbc:IssueTime>10:30:00</cbc:IssueTime>")
    expect(xml).toContain(`<cbc:InvoiceTypeCode>${INVOICE_TYPE_CODES.invoice}</cbc:InvoiceTypeCode>`)
    expect(xml).toContain("<cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>")
    expect(xml).toContain("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>")
  })

  it("maps doc types to UBL invoice type codes (388/381/383)", () => {
    expect(INVOICE_TYPE_CODES.invoice).toBe("388")
    expect(INVOICE_TYPE_CODES.credit_note).toBe("381")
    expect(INVOICE_TYPE_CODES.debit_note).toBe("383")
    const credit = buildZatcaUblInvoice({ ...base, docType: "credit_note", invoiceNumber: "CN-2026-000101" })
    expect(credit).toContain(`<cbc:InvoiceTypeCode>${INVOICE_TYPE_CODES.credit_note}</cbc:InvoiceTypeCode>`)
    const debit = buildZatcaUblInvoice({ ...base, docType: "debit_note", invoiceNumber: "DN-2026-000101" })
    expect(debit).toContain(`<cbc:InvoiceTypeCode>${INVOICE_TYPE_CODES.debit_note}</cbc:InvoiceTypeCode>`)
  })

  it("renders seller + buyer parties with VAT numbers", () => {
    const xml = buildZatcaUblInvoice(base)
    expect(xml).toContain("<cac:AccountingSupplierParty>")
    expect(xml).toContain('<cbc:CompanyID schemeID="VAT">310122993400001</cbc:CompanyID>')
    expect(xml).toContain('<cbc:CompanyID schemeID="CRN">1010123456</cbc:CompanyID>')
    expect(xml).toContain("<cac:AccountingCustomerParty>")
    expect(xml).toContain('<cbc:CompanyID schemeID="VAT">311122993400001</cbc:CompanyID>')
  })

  it("omits the buyer VAT scheme when the buyer has no tax number", () => {
    const xml = buildZatcaUblInvoice({ ...base, buyer: { name: "عميل نقدي", vatNumber: null } })
    expect(xml).toContain("عميل نقدي")
    // Only ONE VAT CompanyID remains (the seller's).
    expect(xml.match(/schemeID="VAT"/g)).toHaveLength(1)
  })

  it("renders lines with quantity, amounts, category S and percent", () => {
    const xml = buildZatcaUblInvoice(base)
    expect(xml).toContain("<cbc:ID>1</cbc:ID>")
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity>')
    expect(xml).toContain("<cbc:LineExtensionAmount currencyID=\"SAR\">100000.00</cbc:LineExtensionAmount>")
    expect(xml).toContain("<cbc:ID>S</cbc:ID>")
    expect(xml).toContain("<cbc:Percent>15</cbc:Percent>")
    expect(xml).toContain("<cbc:PriceAmount currencyID=\"SAR\">100000.00</cbc:PriceAmount>")
  })

  it("uses category Z for zero-rated lines", () => {
    const xml = buildZatcaUblInvoice({
      ...base,
      lines: [{ line_no: 1, description: "تصدير", quantity: 1, unit_price: 500, amount: 500, vat_rate: 0, vat_amount: 0 }],
      vatAmount: 0,
      total: 500,
    })
    expect(xml).toContain("<cbc:ID>Z</cbc:ID>")
    expect(xml).toContain("<cbc:Percent>0</cbc:Percent>")
    expect(xml).not.toContain("<cbc:ID>S</cbc:ID>")
  })

  it("renders amounts exactly 2dp from the engine values (never recomputed)", () => {
    const xml = buildZatcaUblInvoice(base)
    expect(xml).toContain("<cbc:TaxAmount currencyID=\"SAR\">15000.00</cbc:TaxAmount>")
    expect(xml).toContain("<cbc:TaxableAmount currencyID=\"SAR\">100000.00</cbc:TaxableAmount>")
    expect(xml).toContain("<cbc:TaxExclusiveAmount currencyID=\"SAR\">100000.00</cbc:TaxExclusiveAmount>")
    expect(xml).toContain("<cbc:TaxInclusiveAmount currencyID=\"SAR\">115000.00</cbc:TaxInclusiveAmount>")
    expect(xml).toContain("<cbc:PayableAmount currencyID=\"SAR\">115000.00</cbc:PayableAmount>")
  })

  it("splits TaxSubtotal per distinct rate", () => {
    const xml = buildZatcaUblInvoice({
      ...base,
      lines: [
        { line_no: 1, description: "أ", quantity: 1, unit_price: 1000, amount: 1000, vat_rate: 15, vat_amount: 150 },
        { line_no: 2, description: "ب", quantity: 1, unit_price: 500, amount: 500, vat_rate: 0, vat_amount: 0 },
      ],
      subtotal: 1500,
      vatAmount: 150,
      total: 1650,
    })
    expect(xml.match(/<cac:TaxSubtotal>/g)).toHaveLength(2)
  })

  it("embeds the tax QR as base64 TLV in an AdditionalDocumentReference", () => {
    const xml = buildZatcaUblInvoice(base)
    expect(xml).toContain("<cbc:ID>QR</cbc:ID>")
    expect(xml).toContain('<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">')
    const m = /<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">([^<]+)<\/cbc:EmbeddedDocumentBinaryObject>/.exec(xml)
    expect(m).not.toBeNull()
    // Base64 of the 5-field TLV — decodes and starts with tag 1 (seller name).
    const decoded = Buffer.from(m![1], "base64").toString("latin1")
    expect(decoded.charCodeAt(0)).toBe(1)
  })

  it("escapes user content (XSS): raw script tags absent, escaped form present", () => {
    const xml = buildZatcaUblInvoice({
      ...base,
      lines: [
        { line_no: 1, description: `<script>alert(1)</script> & "quoted"`, quantity: 1, unit_price: 10, amount: 10, vat_rate: 15, vat_amount: 1.5 },
      ],
      subtotal: 10,
      vatAmount: 1.5,
      total: 11.5,
    })
    expect(xml).not.toContain("<script>")
    expect(xml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(xml).toContain("&amp; &quot;quoted&quot;")
  })

  it("includes the discount allowance only when discount > 0", () => {
    const withDiscount = buildZatcaUblInvoice({ ...base, discount: 500, subtotal: 99500, total: 114500 })
    expect(withDiscount).toContain("<cbc:AllowanceTotalAmount currencyID=\"SAR\">500.00</cbc:AllowanceTotalAmount>")
    // TaxExclusiveAmount = subtotal − discount (99500 − 500).
    expect(withDiscount).toContain("<cbc:TaxExclusiveAmount currencyID=\"SAR\">99000.00</cbc:TaxExclusiveAmount>")
    expect(buildZatcaUblInvoice(base)).not.toContain("AllowanceTotalAmount")
  })

  it("honours the clearance profile when requested", () => {
    const xml = buildZatcaUblInvoice({ ...base, profileId: "clearance:1.0" })
    expect(xml).toContain("<cbc:ProfileID>clearance:1.0</cbc:ProfileID>")
  })
})
