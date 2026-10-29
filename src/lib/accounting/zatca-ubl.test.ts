import { describe, expect, it } from "vitest"
import { DOMParser } from "@xmldom/xmldom"
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
    expect(xml).toContain(`<cbc:InvoiceTypeCode name="0100000">${INVOICE_TYPE_CODES.invoice}</cbc:InvoiceTypeCode>`)
    expect(xml).toContain("<cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>")
    expect(xml).toContain("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>")
  })

  it("maps doc types to UBL invoice type codes (388/381/383)", () => {
    expect(INVOICE_TYPE_CODES.invoice).toBe("388")
    expect(INVOICE_TYPE_CODES.credit_note).toBe("381")
    expect(INVOICE_TYPE_CODES.debit_note).toBe("383")
    const credit = buildZatcaUblInvoice({ ...base, docType: "credit_note", invoiceNumber: "CN-2026-000101" })
    expect(credit).toContain(`<cbc:InvoiceTypeCode name="0100000">${INVOICE_TYPE_CODES.credit_note}</cbc:InvoiceTypeCode>`)
    const debit = buildZatcaUblInvoice({ ...base, docType: "debit_note", invoiceNumber: "DN-2026-000101" })
    expect(debit).toContain(`<cbc:InvoiceTypeCode name="0100000">${INVOICE_TYPE_CODES.debit_note}</cbc:InvoiceTypeCode>`)
  })

  it("renders seller + buyer parties with VAT numbers", () => {
    const xml = buildZatcaUblInvoice(base)
    expect(xml).toContain("<cac:AccountingSupplierParty>")
    expect(xml).toContain('<cbc:CompanyID schemeID="VAT">310122993400001</cbc:CompanyID>')
    expect(xml).toContain('<cac:PartyIdentification><cbc:ID schemeID="CRN">1010123456</cbc:ID></cac:PartyIdentification>')
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

  it("does not deduct line discounts from the already-net subtotal again", () => {
    const withDiscount = buildZatcaUblInvoice({ ...base, discount: 500, subtotal: 99500, total: 114500 })
    expect(withDiscount).not.toContain("AllowanceTotalAmount")
    expect(withDiscount).toContain("<cbc:TaxExclusiveAmount currencyID=\"SAR\">99500.00</cbc:TaxExclusiveAmount>")
    expect(buildZatcaUblInvoice(base)).not.toContain("AllowanceTotalAmount")
  })

  it("preserves an explicit line discount as a line allowance before tax, without another header deduction", () => {
    const xml=buildZatcaUblInvoice({...base,lines:[{...base.lines[0],unit_price:100,discount:10,amount:90,vat_amount:13.5}],subtotal:90,discount:10,vatAmount:13.5,total:103.5})
    const doc=new DOMParser().parseFromString(xml,"application/xml")
    const line=doc.getElementsByTagNameNS("urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2","InvoiceLine").item(0)!
    const children=Array.from(line.childNodes).filter(node=>node.nodeType===1).map(node=>node.nodeName)
    expect(children.indexOf("cac:AllowanceCharge")).toBeLessThan(children.indexOf("cac:TaxTotal"))
    expect(xml).toContain('<cbc:Amount currencyID="SAR">10.00</cbc:Amount>')
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="SAR">90.00</cbc:TaxExclusiveAmount>')
    expect(xml).not.toContain("AllowanceTotalAmount")
  })

  it.each([-1,Number.NaN,Number.POSITIVE_INFINITY])("rejects invalid explicit line discount %s", discount=>{
    expect(()=>buildZatcaUblInvoice({...base,lines:[{...base.lines[0],discount}]})).toThrow("monetary amount")
  })

  it("keeps invoice lines as root siblings, never nested inside another line", () => {
    const xml = buildZatcaUblInvoice({...base,lines:[base.lines[0],{...base.lines[0],line_no:2}]})
    const doc = new DOMParser().parseFromString(xml,"application/xml")
    const lines = Array.from(doc.getElementsByTagNameNS("urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2","InvoiceLine"))
    expect(lines).toHaveLength(2)
    expect(lines.every((line) => line.parentNode === doc.documentElement)).toBe(true)
    expect(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#","Signature")).toHaveLength(0)
  })

  it("preserves explicit issuance identity and structured address without fabricating them", () => {
    const xml=buildZatcaUblInvoice({...base,uuid:"00000000-0000-4000-8000-000000000001",invoiceCounter:7,previousInvoiceHash:"hash",invoiceKind:"simplified",seller:{...base.seller,buildingNumber:"1234",postalCode:"12345",countryCode:"SA"}})
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>')
    expect(xml).toContain('<cbc:ID>ICV</cbc:ID><cbc:UUID>7</cbc:UUID>')
    expect(xml).toContain('<cbc:BuildingNumber>1234</cbc:BuildingNumber>')
    expect(buildZatcaUblInvoice(base)).not.toContain('<cbc:ID>ICV</cbc:ID>')
  })

  it("does not confuse the clearance route with the invoice ProfileID", () => {
    expect(()=>buildZatcaUblInvoice({ ...base, profileId: "clearance:1.0" as "reporting:1.0" })).toThrow("transport route")
  })

  it("preserves line currency and rejects invalid values instead of replacing them with zero", () => {
    const xml=buildZatcaUblInvoice({...base,currency:"USD",vatAmountSar:56250})
    expect(xml).toContain('<cbc:PriceAmount currencyID="USD">100000.00</cbc:PriceAmount>')
    expect(xml).toContain('<cbc:TaxAmount currencyID="SAR">56250.00</cbc:TaxAmount>')
    expect(()=>buildZatcaUblInvoice({...base,total:NaN})).toThrow("monetary amount")
    expect(()=>buildZatcaUblInvoice({...base,lines:[{...base.lines[0],quantity:Infinity}]})).toThrow("invoice line")
    expect(()=>buildZatcaUblInvoice({...base,invoiceCounter:1.5})).toThrow("invoice counter")
  })
})

describe("source-preserving item names and precise prices",()=>{
  it("retains separate source fields and all four unit-price decimals",()=>{
    const xml=buildZatcaUblInvoice({...base,lines:[{...base.lines[0],item_name:'Item & name',description:'Separate <description>',unit_price:72225.2082}]})
    expect(xml).toContain('<cbc:Description>Separate &lt;description&gt;</cbc:Description>')
    expect(xml).toContain('<cbc:Name>Item &amp; name</cbc:Name>')
    expect(xml).toContain('<cbc:PriceAmount currencyID="SAR">72225.2082</cbc:PriceAmount>')
    expect(xml.indexOf('<cbc:Description>Separate')).toBeLessThan(xml.indexOf('<cbc:Name>Item &amp; name'))
  })
  it("keeps the legacy description name mapping and two-decimal prices",()=>{
    const xml=buildZatcaUblInvoice(base)
    expect(xml).not.toContain('<cbc:Description>')
    expect(xml).toContain('<cbc:Name>خدمات استشارية</cbc:Name>')
    expect(xml).toContain('<cbc:PriceAmount currencyID="SAR">100000.00</cbc:PriceAmount>')
  })
  it.each([1.00001,-1,Infinity,1e10])("rejects price precision/range loss for %s",price=>{
    expect(()=>buildZatcaUblInvoice({...base,lines:[{...base.lines[0],unit_price:price}]})).toThrow('unit price')
  })
  it("rejects malformed source item names",()=>expect(()=>buildZatcaUblInvoice({...base,lines:[{...base.lines[0],item_name:'x'.repeat(201)}]})).toThrow('item name'))
})
