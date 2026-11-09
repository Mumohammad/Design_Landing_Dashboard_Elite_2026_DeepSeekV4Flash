import { describe, expect, it, vi } from "vitest"
import { extractZatcaQr, loadAuthorityQr, selectAuthorityQr } from "./zatca-document-qr"

const xml = (qr: string) =>
  `<Invoice><cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference></Invoice>`

const base = { environment: "sandbox", created_at: "2026-10-28T10:00:00Z" }

function evidenceDatabase(first: { data: unknown; error: unknown }, second = { data: [] as unknown[], error: null as unknown }) {
  const issuance = { select: vi.fn().mockReturnThis(), eq: vi.fn() }
  issuance.eq.mockImplementation((field: string) => field === "source_id" ? Promise.resolve(first) : issuance)
  const attempts = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(second) }
  return { from: vi.fn((table: string) => table === "zatca_document_issuances" ? issuance : attempts), issuance, attempts }
}

describe("authority QR selection for printed invoices", () => {
  it("uses the internal QR only after confirming that no issuance exists", async () => {
    const db = evidenceDatabase({ data: [], error: null })
    await expect(loadAuthorityQr(db, "tenant-a", "invoice-a")).resolves.toBeNull()
    expect(db.issuance.eq).toHaveBeenCalledWith("tenant_id", "tenant-a")
    expect(db.issuance.eq).toHaveBeenCalledWith("source_id", "invoice-a")
    expect(db.from).toHaveBeenCalledTimes(1)
  })

  it.each([
    { data: null, error: { message: "private database detail" } },
    { data: null, error: null },
  ])("does not substitute an internal QR when issuance lookup is unavailable", async result => {
    await expect(loadAuthorityQr(evidenceDatabase(result), "tenant-a", "invoice-a"))
      .rejects.toThrow("Unable to verify retained ZATCA issuance evidence.")
  })

  it("fails closed on submission lookup failure or incomplete accepted evidence", async () => {
    const first = { data: [{ id: "issuance-a" }], error: null }
    const unavailable = evidenceDatabase(first, { data: [], error: { message: "private database detail" } })
    await expect(loadAuthorityQr(unavailable, "tenant-a", "invoice-a"))
      .rejects.toThrow("Unable to verify retained ZATCA submission evidence.")
    const incomplete = evidenceDatabase(first, { data: [{ ...base, pipeline: "clearance", status: "cleared", signed_xml: xml("U0lHTkVE"), cleared_xml: null }], error: null })
    await expect(loadAuthorityQr(incomplete, "tenant-a", "invoice-a"))
      .rejects.toThrow("Retained ZATCA QR evidence is incomplete.")
    expect(incomplete.attempts.in).toHaveBeenCalledWith("pipeline", ["clearance", "reporting"])
  })

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
