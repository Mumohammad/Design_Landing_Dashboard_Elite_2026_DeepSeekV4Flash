// Financial Phase 15 — ZATCA adapter: UBL 2.1 e-invoice XML builder.
//
// Pure module (no I/O) — builds the UBL 2.1 invoice payload with ZATCA
// structure from data the engines ALREADY computed. Per ZATCA-BOUNDARY.md §3
// the adapter never recomputes amounts: it consumes the immutable invoice +
// line + tax payloads and transforms them into XML.
//
// Sandbox-first: this produces a well-formed UBL 2.1 document carrying the
// documented mandatory field set (seller/buyer VAT numbers, issue date/time,
// invoice number, item description/quantity/unit price, VAT amount, total,
// QR). It is NOT a claim of ZATCA compliance, approval, or certification
// (ZATCA-BOUNDARY.md §1, §5). Cryptographically signing the document is a
// later, config-only step once production credentials/certs exist — the
// transport layer (zatca-transport.ts) is where that lands.
//
// UBL 2.1 namespaces (https://www.oasis-open.org/committees/ubl/):
//   Invoice     urn:oasis:names:specification:ubl:schema:xsd:Invoice-2
//   cac         urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2
//   cbc         urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2
//
// ZATCA-relevant field mapping (per the public Electronic Invoice XML
// Implementation Standard field requirements):
//   InvoiceTypeCode  388 = standard tax invoice, 381 = credit note, 383 = debit note
//   ProfileID        reporting:1.0 (compliance) / clearance:1.0 (simplified B2C)
//   VAT category     S = standard rate, Z = zero-rated, E = exempt

import { buildTaxQrPayload, type TaxQrPayload } from "./invoice-qr"

export const ZATCA_CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:zatca:egs:en16931:2023"

export type ZatcaDocType = "invoice" | "credit_note" | "debit_note"

/** UBL InvoiceTypeCode per doc type (ZATCA XML implementation standard). */
export const INVOICE_TYPE_CODES: Record<ZatcaDocType, string> = {
  invoice: "388",
  credit_note: "381",
  debit_note: "383",
}

export interface ZatcaLine {
  line_no: number
  description: string
  quantity: number
  unit_price: number
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
}

export interface ZatcaInvoiceData {
  docType: ZatcaDocType
  invoiceNumber: string
  issueDate: string            // YYYY-MM-DD
  issueTime: string            // HH:mm:ss (24h)
  currency: string
  profileId?: string           // reporting:1.0 | clearance:1.0
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
  return (Number.isFinite(v) ? v : 0).toFixed(2)
}

/** UBL VAT category code from a rate: 0 → Z (zero-rated), else S (standard).
 * Exempt (E) is not modelled — every rate is a percentage. */
function vatCategory(rate: number): string {
  return rate === 0 ? "Z" : "S"
}

function partyXml(kind: "seller" | "buyer", p: ZatcaParty): string {
  const wrapper = kind === "seller" ? "AccountingSupplierParty" : "AccountingCustomerParty"
  const vat = p.vatNumber ? escXml(p.vatNumber) : ""
  return [
    `    <cac:${wrapper}>`,
    `      <cac:Party>`,
    `        <cac:PartyName><cbc:Name>${escXml(p.name)}</cbc:Name></cac:PartyName>`,
    p.address || p.city
      ? `        <cac:PostalAddress>${p.address ? `<cbc:StreetName>${escXml(p.address)}</cbc:StreetName>` : ""}${p.city ? `<cbc:CityName>${escXml(p.city)}</cbc:CityName>` : ""}</cac:PostalAddress>`
      : "",
    vat
      ? `        <cac:PartyTaxScheme><cbc:CompanyID schemeID="VAT">${vat}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
      : "",
    `        <cac:PartyLegalEntity>`,
    `          <cbc:RegistrationName>${escXml(p.name)}</cbc:RegistrationName>`,
    p.crNumber ? `          <cbc:CompanyID schemeID="CRN">${escXml(p.crNumber)}</cbc:CompanyID>` : "",
    `        </cac:PartyLegalEntity>`,
    `      </cac:Party>`,
    `    </cac:${wrapper}>`,
  ]
    .filter(Boolean)
    .join("\n")
}

function lineXml(l: ZatcaLine): string {
  const category = vatCategory(l.vat_rate)
  return [
    `      <cac:InvoiceLine>`,
    `        <cbc:ID>${l.line_no}</cbc:ID>`,
    `        <cbc:InvoicedQuantity unitCode="EA">${l.quantity}</cbc:InvoicedQuantity>`,
    `        <cbc:LineExtensionAmount currencyID="SAR">${money(l.amount)}</cbc:LineExtensionAmount>`,
    `        <cac:Item>`,
    `          <cbc:Name>${escXml(l.description)}</cbc:Name>`,
    `          <cac:ClassifiedTaxCategory>`,
    `            <cbc:ID>${category}</cbc:ID>`,
    `            <cbc:Percent>${l.vat_rate}</cbc:Percent>`,
    `            <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`,
    `          </cac:ClassifiedTaxCategory>`,
    `        </cac:Item>`,
    `        <cac:Price><cbc:PriceAmount currencyID="SAR">${money(l.unit_price)}</cbc:PriceAmount></cac:Price>`,
    `      </cac:InvoiceLine>`,
  ].join("\n")
}

/**
 * Build the UBL 2.1 invoice XML for a ZATCA transmission.
 * Amounts are passed in (never computed here) and rendered 2dp verbatim.
 */
export function buildZatcaUblInvoice(data: ZatcaInvoiceData): string {
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
    data.discount > 0
      ? `      <cbc:AllowanceTotalAmount currencyID="${currency}">${money(data.discount)}</cbc:AllowanceTotalAmount>`
      : "",
    `      <cbc:TaxExclusiveAmount currencyID="${currency}">${money(data.subtotal - data.discount)}</cbc:TaxExclusiveAmount>`,
    `      <cbc:TaxInclusiveAmount currencyID="${currency}">${money(data.total)}</cbc:TaxInclusiveAmount>`,
    `      <cbc:PayableAmount currencyID="${currency}">${money(data.total)}</cbc:PayableAmount>`,
    `    </cac:LegalMonetaryTotal>`,
  ]
    .filter(Boolean)
    .join("\n")

  // ZATCA tax QR: base64 of the standard 5-field TLV payload, embedded in an
  // AdditionalDocumentReference (mimeCode text/plain — the XML carriage form
  // for the QR). Reuses the exact payload the Phase 6 verification QR uses.
  const qrBase64 = Buffer.from(buildTaxQrPayload(data.qr)).toString("base64")
  const qrXml = [
    `    <cac:AdditionalDocumentReference>`,
    `      <cbc:ID>QR</cbc:ID>`,
    `      <cac:Attachment>`,
    `        <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrBase64}</cbc:EmbeddedDocumentBinaryObject>`,
    `      </cac:Attachment>`,
    `    </cac:AdditionalDocumentReference>`,
  ].join("\n")

  // Digital-signature scaffolding (ZATCA-BOUNDARY §1 seam): the XAdES-B-B
  // signature block with an EMPTY `<ds:SignatureValue>` placeholder. The
  // transport (zatca-transport.ts signXmlIfConfigured) injects the ECDSA
  // signature here when a CSID private key is configured. The digest
  // placeholder mirrors the invoice-hash the transport computes.
  const signatureXml = [
    `  <cac:Signature>`,
    `    <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>`,
    `    <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>`,
    `    <cac:SignatoryParty>`,
    `      <cac:PartyIdentification><cbc:ID>${escXml(data.seller.vatNumber ?? "")}</cbc:ID></cac:PartyIdentification>`,
    `      <cac:PartyName><cbc:Name>${escXml(data.seller.name)}</cbc:Name></cac:PartyName>`,
    `    </cac:SignatoryParty>`,
    `    <cac:DigitalSignatureAttachment>`,
    `      <cac:ExternalReference><cbc:URI>#signature</cbc:URI></cac:ExternalReference>`,
    `    </cac:DigitalSignatureAttachment>`,
    `  </cac:Signature>`,
    `  <ds:Signature Id="signature">`,
    `    <ds:SignedInfo>`,
    `      <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>`,
    `      <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>`,
    `      <ds:Reference URI="">`,
    `        <ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></ds:Transforms>`,
    `        <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`,
    `        <ds:DigestValue></ds:DigestValue>`,
    `      </ds:Reference>`,
    `    </ds:SignedInfo>`,
    `    <ds:SignatureValue></ds:SignatureValue>`,
    `  </ds:Signature>`,
  ].join("\n")

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"`,
    `         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"`,
    `         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"`,
    `         xmlns:ds="http://www.w3.org/2000/09/xmldsig#">`,
    `  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>`,
    `  <cbc:CustomizationID>${escXml(ZATCA_CUSTOMIZATION_ID)}</cbc:CustomizationID>`,
    `  <cbc:ProfileID>${escXml(profileId)}</cbc:ProfileID>`,
    `  <cbc:ID>${escXml(data.invoiceNumber)}</cbc:ID>`,
    `  <cbc:IssueDate>${escXml(data.issueDate)}</cbc:IssueDate>`,
    `  <cbc:IssueTime>${escXml(data.issueTime)}</cbc:IssueTime>`,
    `  <cbc:InvoiceTypeCode>${INVOICE_TYPE_CODES[data.docType]}</cbc:InvoiceTypeCode>`,
    `  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>`,
    signatureXml,
    partyXml("seller", data.seller),
    partyXml("buyer", data.buyer),
    taxTotal,
    legalTotal,
    `  <cac:InvoiceLine>`,
    ...data.lines.map(lineXml),
    `  </cac:InvoiceLine>`,
    qrXml,
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
