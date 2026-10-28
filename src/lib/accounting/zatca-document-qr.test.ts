import { describe, expect, it } from "vitest"
import { extractZatcaQr, selectAuthorityQr } from "./zatca-document-qr"

const xml = (qr: string) =>
  `<Invoice><cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference></Invoice>`

const base = { environment: "sandbox", created_at: "2026-10-28T10:00:00Z" }

describe("authority QR selection for printed invoices", () => {
  it("extracts the Base64 TLV QR", () => {
    expect(extractZatcaQr(xml("AQVTZWxsZXI="))).toBe("AQVTZWxsZXI=")
    expect(extractZatcaQr("<Invoice/>")).toBeNull()
    expect(extractZatcaQr(null)).toBeNull()
  })

  it("prints the QR from ZATCA's cleared XML for standard invoices (never our pre-clearance copy)", () => {
    const qr = selectAuthorityQr([{ ...base, pipeline: "clearance", status: "cleared", signed_xml: xml("U0lHTkVE"), cleared_xml: xml("Q0xFQVJFRA==") }])
    expect(qr).toEqual({ qrBase64: "Q0xFQVJFRA==", kind: "cleared", environment: "sandbox" })
    expect(selectAuthorityQr([{ ...base, pipeline: "clearance", status: "cleared", signed_xml: xml("U0lHTkVE"), cleared_xml: null }])).toBeNull()
  })

  it("prints the EGS-stamped QR for reported simplified invoices", () => {
    const qr = selectAuthorityQr([{ ...base, environment: "simulation", pipeline: "reporting", status: "reported", signed_xml: xml("U1RBTVBFRA=="), cleared_xml: null }])
    expect(qr).toEqual({ qrBase64: "U1RBTVBFRA==", kind: "reported", environment: "simulation" })
  })

  it("ignores compliance checks, rejections and failures; picks the latest accepted attempt", () => {
    expect(selectAuthorityQr([
      { ...base, pipeline: "compliance", status: "cleared", signed_xml: xml("Q09NUA=="), cleared_xml: xml("Q09NUA==") },
      { ...base, pipeline: "reporting", status: "rejected", signed_xml: xml("UkVK"), cleared_xml: null },
    ])).toBeNull()
    const qr = selectAuthorityQr([
      { ...base, pipeline: "reporting", status: "reported", signed_xml: xml("T0xE"), cleared_xml: null, created_at: "2026-10-27T10:00:00Z" },
      { ...base, pipeline: "reporting", status: "reported", signed_xml: xml("TkVX"), cleared_xml: null, created_at: "2026-10-28T10:00:00Z" },
    ])
    expect(qr?.qrBase64).toBe("TkVX")
  })
})
