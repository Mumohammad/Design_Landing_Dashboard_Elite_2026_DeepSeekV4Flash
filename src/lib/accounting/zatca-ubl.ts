// Financial Phase 15 — ZATCA adapter: UBL 2.1 e-invoice XML builder.
//
// Pure module (no I/O) — builds the UBL 2.1 invoice payload with ZATCA
// structure from data the engines ALREADY computed. Per ZATCA-BOUNDARY.md §3
// the adapter never recomputes amounts: it consumes the immutable invoice +
// line + tax payloads and transforms them into XML.
//
// Offline SDK format work. Complete synthetic fixtures pass the supplied SDK
// after SDK demonstration signing. Existing application callers do not supply
// all issuance/tax-profile fields, and application signing/network integration
// remains incomplete. Production cannot be enabled by configuration alone.
//
// UBL 2.1 namespaces (https://www.oasis-open.org/committees/ubl/):
//   Invoice     urn:oasis:names:specification:ubl:schema:xsd:Invoice-2
//   cac         urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2
//   cbc         urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2
//
// ZATCA-relevant field mapping (per the public Electronic Invoice XML
// Implementation Standard field requirements):
//   InvoiceTypeCode  388 = standard tax invoice, 381 = credit note, 383 = debit note
//   ProfileID        reporting:1.0; standard tax invoices use clearance,
//                    simplified tax invoices use reporting (transport route).
//   VAT category     S = standard rate, Z = zero-rated, E = exempt

import { buildTaxQrPayload, taxQrBase64, type TaxQrPayload } from "./invoice-qr"

export const ZATCA_CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:zatca:egs:en16931:2023"

export type ZatcaDocType = "invoice" | "credit_note" | "debit_note"

/** UBL InvoiceTypeCode per doc type (ZATCA XML implementation standard). */
export const INVOICE_TYPE_CODES: Record<ZatcaDocType, string> = {
  invoice: "388",
  credit_note: "381",
  debit_note: "383",
}

export interface ZatcaLine {
  item_name?: string | null
  line_no: number
  description: string
  quantity: number
  unit_price: number
  /** Line allowance already computed by the financial engine. */
  discount?: number
  /** Net amount of the line (already computed by the invoice engine). */
  amount: number
  vat_rate: number
  vat_amount: number
}

export interface ZatcaParty {
  name: string
  /** VAT registration number (15 digits when present). */
  vatNumber: string | null
  /** Commercial registration number. */
  crNumber?: string | null
  address?: string | null
  city?: string | null
  buildingNumber?: string | null
  district?: string | null
  postalCode?: string | null
  countryCode?: string | null
  additionalNumber?: string | null
  region?: string | null
}

export interface ZatcaInvoiceData {
  docType: ZatcaDocType
  invoiceNumber: string
  issueDate: string            // YYYY-MM-DD
  issueTime: string            // HH:mm:ss (24h)
  currency: string
  profileId?: "reporting:1.0"
  invoiceKind?: "standard" | "simplified"
  uuid?: string
  invoiceCounter?: number
  previousInvoiceHash?: string
  deliveryDate?: string
  referenceInvoiceNumber?: string
  noteReason?: string
  paymentMeansCode?: string
  /** Required separately for non-SAR invoices; never invent an exchange rate. */
  vatAmountSar?: number
  seller: ZatcaParty
  buyer: ZatcaParty
  lines: ZatcaLine[]
  subtotal: number
  discount: number
  vatAmount: number
  total: number
  /** Values for the standard 5-field tax QR (seller VAT no., timestamp,
   *  total, VAT amount) — the same payload the verification QR uses. */
  qr: TaxQrPayload
}

/** Escape a string for XML text/attribute content. */
export function escXml(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Money as a fixed 2dp string (the engine already rounds to the cent). */
function money(v: number): string {
  if (!Number.isFinite(v) || v < 0) throw new Error("Invalid ZATCA monetary amount")
  return v.toFixed(2)
}

/** UBL VAT category code from a rate: 0 → Z (zero-rated), else S (standard).
 * Exempt (E) is not modelled — every rate is a percentage. */
function vatCategory(rate: number): string {
  return rate === 0 ? "Z" : "S"
}

function partyXml(kind: "seller" | "buyer", p: ZatcaParty): string {
  const wrapper = kind === "seller" ? "AccountingSupplierParty" : "AccountingCustomerParty"
  const vat = p.vatNumber ? escXml(p.vatNumber) : ""
  const address = [
    p.address ? `<cbc:StreetName>${escXml(p.address)}</cbc:StreetName>` : "",
    p.buildingNumber ? `<cbc:BuildingNumber>${escXml(p.buildingNumber)}</cbc:BuildingNumber>` : "",
    p.additionalNumber ? `<cbc:PlotIdentification>${escXml(p.additionalNumber)}</cbc:PlotIdentification>` : "",
    p.district ? `<cbc:CitySubdivisionName>${escXml(p.district)}</cbc:CitySubdivisionName>` : "",
    p.city ? `<cbc:CityName>${escXml(p.city)}</cbc:CityName>` : "",
    p.postalCode ? `<cbc:PostalZone>${escXml(p.postalCode)}</cbc:PostalZone>` : "",
    p.region ? `<cbc:CountrySubentity>${escXml(p.region)}</cbc:CountrySubentity>` : "",
    p.countryCode ? `<cac:Country><cbc:IdentificationCode>${escXml(p.countryCode)}</cbc:IdentificationCode></cac:Country>` : "",
  ].join("")
  return [
    `    <cac:${wrapper}>`,
    `      <cac:Party>`,
    p.crNumber ? `        <cac:PartyIdentification><cbc:ID schemeID="CRN">${escXml(p.crNumber)}</cbc:ID></cac:PartyIdentification>` : "",
    `        <cac:PartyName><cbc:Name>${escXml(p.name)}</cbc:Name></cac:PartyName>`,
    p.address || p.city
      ? `        <cac:PostalAddress>${address}</cac:PostalAddress>`
      : "",
    vat
      ? `        <cac:PartyTaxScheme><cbc:CompanyID schemeID="VAT">${vat}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
      : "",
    `        <cac:PartyLegalEntity>`,
    `          <cbc:RegistrationName>${escXml(p.name)}</cbc:RegistrationName>`,
    `        </cac:PartyLegalEntity>`,
    `      </cac:Party>`,
    `    </cac:${wrapper}>`,
  ]
    .filter(Boolean)
    .join("\n")
}

function unitPrice(value: number): string {
  const text = String(value)
  if (!Number.isFinite(value) || value < 0 || value > 9999999999.99 || !/^\d+(?:\.\d{1,4})?$/.test(text)) throw new Error("Invalid unit price precision")
  const [whole, fraction = ""] = text.split(".")
  return whole + "." + fraction.padEnd(2, "0")
}
function lineXml(l: ZatcaLine, currency: string): string {
  const category = vatCategory(l.vat_rate)
  const discount = money(l.discount ?? 0)
  return [
    `      <cac:InvoiceLine>`,
    `        <cbc:ID>${l.line_no}</cbc:ID>`,
    `        <cbc:InvoicedQuantity unitCode="EA">${l.quantity}</cbc:InvoicedQuantity>`,
    `        <cbc:LineExtensionAmount currencyID="${currency}">${money(l.amount)}</cbc:LineExtensionAmount>`,
    Number(discount) > 0 ? `        <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Line discount</cbc:AllowanceChargeReason><cbc:Amount currencyID="${currency}">${discount}</cbc:Amount></cac:AllowanceCharge>` : "",
    `        <cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${money(l.vat_amount)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="${currency}">${money(l.amount + l.vat_amount)}</cbc:RoundingAmount></cac:TaxTotal>`,
    `        <cac:Item>`,
    l.item_name ? `          <cbc:Description>${escXml(l.description)}</cbc:Description>` : "",
    `          <cbc:Name>${escXml(l.item_name || l.description)}</cbc:Name>`,
    `          <cac:ClassifiedTaxCategory>`,
    `            <cbc:ID>${category}</cbc:ID>`,
    `            <cbc:Percent>${l.vat_rate}</cbc:Percent>`,
    `            <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`,
    `          </cac:ClassifiedTaxCategory>`,
    `        </cac:Item>`,
    `        <cac:Price><cbc:PriceAmount currencyID="${currency}">${unitPrice(l.unit_price)}</cbc:PriceAmount></cac:Price>`,
    `      </cac:InvoiceLine>`,
  ].join("\n")
}

/**
 * Build the UBL 2.1 invoice XML for a ZATCA transmission.
 * Amounts are passed in (never computed here) and rendered 2dp verbatim.
 */
export function buildZatcaUblInvoice(data: ZatcaInvoiceData): string {
  if (data.profileId && data.profileId !== "reporting:1.0") throw new Error("ZATCA ProfileID must be reporting:1.0; clearance is a transport route")
  if (!/^[A-Z]{3}$/.test(data.currency)) throw new Error("Invalid invoice currency")
  if (data.invoiceCounter !== undefined && (!Number.isSafeInteger(data.invoiceCounter) || data.invoiceCounter < 1)) throw new Error("Invalid invoice counter")
  if (!data.lines.length || data.lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.vat_rate) || line.vat_rate < 0)) throw new Error("Invalid invoice line")
  if (data.lines.some(line => line.item_name != null && (typeof line.item_name !== "string" || !line.item_name.trim() || line.item_name !== line.item_name.trim() || line.item_name.length > 200))) throw new Error("Invalid item name")
  const currency = escXml(data.currency || "SAR")
  const profileId = data.profileId ?? "reporting:1.0"
  const taxTotal = [
    `    <cac:TaxTotal>`,
    `      <cbc:TaxAmount currencyID="${currency}">${money(data.vatAmount)}</cbc:TaxAmount>`,
    // One TaxSubtotal per distinct rate present in the lines.
    ...distinctRates(data.lines).map((rate) => {
      const taxable = sumByRate(data.lines, rate)
      const vat = sumVatByRate(data.lines, rate)
      return [
        `      <cac:TaxSubtotal>`,
        `        <cbc:TaxableAmount currencyID="${currency}">${money(taxable)}</cbc:TaxableAmount>`,
        `        <cbc:TaxAmount currencyID="${currency}">${money(vat)}</cbc:TaxAmount>`,
        `        <cac:TaxCategory>`,
        `          <cbc:ID>${vatCategory(rate)}</cbc:ID>`,
        `          <cbc:Percent>${rate}</cbc:Percent>`,
        `          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`,
        `        </cac:TaxCategory>`,
        `      </cac:TaxSubtotal>`,
      ].join("\n")
    }),
    `    </cac:TaxTotal>`,
  ].join("\n")

  const legalTotal = [
    `    <cac:LegalMonetaryTotal>`,
    `      <cbc:LineExtensionAmount currencyID="${currency}">${money(data.subtotal)}</cbc:LineExtensionAmount>`,
    // The invoice engine's subtotal already includes line discounts. They are
    // not document-level allowances and must never be deducted a second time.
    `      <cbc:TaxExclusiveAmount currencyID="${currency}">${money(data.subtotal)}</cbc:TaxExclusiveAmount>`,
    `      <cbc:TaxInclusiveAmount currencyID="${currency}">${money(data.total)}</cbc:TaxInclusiveAmount>`,
    `      <cbc:PayableAmount currencyID="${currency}">${money(data.total)}</cbc:PayableAmount>`,
    `    </cac:LegalMonetaryTotal>`,
  ]
    .filter(Boolean)
    .join("\n")

  // Unvalidated five-field QR scaffold, embedded in an
  // AdditionalDocumentReference (mimeCode text/plain — the XML carriage form
  // for the QR). Reuses the exact payload the Phase 6 verification QR uses.
  const qrBase64 = taxQrBase64(buildTaxQrPayload(data.qr))
  const qrXml = [
    `    <cac:AdditionalDocumentReference>`,
    `      <cbc:ID>QR</cbc:ID>`,
    `      <cac:Attachment>`,
    `        <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrBase64}</cbc:EmbeddedDocumentBinaryObject>`,
    `      </cac:Attachment>`,
    `    </cac:AdditionalDocumentReference>`,
  ].join("\n")

  // UBL signature reference only. A bare ds:Signature at the Invoice root is
  // invalid UBL (confirmed with the supplied SDK). This is not a stamp: a
  // complete validated XAdES extension must be added by the signing layer.
  const signatureXml = [
    `  <cac:Signature>`,
    `    <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>`,
    `    <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>`,
    `    <cac:SignatoryParty>`,
    `      <cac:PartyIdentification><cbc:ID>${escXml(data.seller.vatNumber ?? "")}</cbc:ID></cac:PartyIdentification>`,
    `      <cac:PartyName><cbc:Name>${escXml(data.seller.name)}</cbc:Name></cac:PartyName>`,
    `    </cac:SignatoryParty>`,
    `    <cac:DigitalSignatureAttachment>`,
    `      <cac:ExternalReference><cbc:URI>#signature</cbc:URI></cac:ExternalReference>`,
    `    </cac:DigitalSignatureAttachment>`,
    `  </cac:Signature>`,
  ].join("\n")

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"`,
    `         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"`,
    `         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"`,
    `         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"`,
    `         xmlns:ds="http://www.w3.org/2000/09/xmldsig#">`,
    `  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>`,
    `  <cbc:CustomizationID>${escXml(ZATCA_CUSTOMIZATION_ID)}</cbc:CustomizationID>`,
    `  <cbc:ProfileID>${escXml(profileId)}</cbc:ProfileID>`,
    `  <cbc:ID>${escXml(data.invoiceNumber)}</cbc:ID>`,
    data.uuid ? `  <cbc:UUID>${escXml(data.uuid)}</cbc:UUID>` : "",
    `  <cbc:IssueDate>${escXml(data.issueDate)}</cbc:IssueDate>`,
    `  <cbc:IssueTime>${escXml(data.issueTime)}</cbc:IssueTime>`,
    `  <cbc:InvoiceTypeCode name="${data.invoiceKind === "simplified" ? "0200000" : "0100000"}">${INVOICE_TYPE_CODES[data.docType]}</cbc:InvoiceTypeCode>`,
    `  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>`,
    `  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>`,
    data.referenceInvoiceNumber ? `  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${escXml(data.referenceInvoiceNumber)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : "",
    data.invoiceCounter ? `  <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${data.invoiceCounter}</cbc:UUID></cac:AdditionalDocumentReference>` : "",
    data.previousInvoiceHash ? `  <cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escXml(data.previousInvoiceHash)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>` : "",
    qrXml,
    signatureXml,
    partyXml("seller", data.seller),
    partyXml("buyer", data.buyer),
    data.deliveryDate ? `  <cac:Delivery><cbc:ActualDeliveryDate>${escXml(data.deliveryDate)}</cbc:ActualDeliveryDate></cac:Delivery>` : "",
    data.paymentMeansCode ? `  <cac:PaymentMeans><cbc:PaymentMeansCode>${escXml(data.paymentMeansCode)}</cbc:PaymentMeansCode>${data.noteReason ? `<cbc:InstructionNote>${escXml(data.noteReason)}</cbc:InstructionNote>` : ""}</cac:PaymentMeans>` : "",
    currency === "SAR" || data.vatAmountSar !== undefined ? `  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${money(currency === "SAR" ? data.vatAmount : data.vatAmountSar!)}</cbc:TaxAmount></cac:TaxTotal>` : "",
    taxTotal,
    legalTotal,
    ...data.lines.map((line) => lineXml(line, currency)),
    `</Invoice>`,
  ].join("\n")
}

function distinctRates(lines: ZatcaLine[]): number[] {
  return [...new Set(lines.map((l) => l.vat_rate))].sort((a, b) => a - b)
}

function sumByRate(lines: ZatcaLine[], rate: number): number {
  return lines.filter((l) => l.vat_rate === rate).reduce((s, l) => s + l.amount, 0)
}

function sumVatByRate(lines: ZatcaLine[], rate: number): number {
  return lines.filter((l) => l.vat_rate === rate).reduce((s, l) => s + l.vat_amount, 0)
}
