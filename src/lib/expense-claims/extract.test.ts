import { beforeEach, describe, expect, it, vi } from "vitest"
const mocked = vi.hoisted(() => ({ process: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("./extraction-process", () => ({ runReceiptProcess: mocked.process }))
import { claimPayload, extractReceiptData, extractReceiptDataWithin } from "./extract"

const bytes = new Uint8Array([1, 2, 3])
const empty = { fields: {}, source: [], qrPhase2: null, textChars: 0 }
beforeEach(() => vi.clearAllMocks())

describe("receipt suggestion isolation boundary", () => {
  it.each(["invalid", "busy", "timeout", "memory_limit", "unavailable"])("returns no suggestions after %s without inline parser fallback", async status => {
    mocked.process.mockResolvedValue({ status, value: null, processExited: status === "timeout" })
    expect(await extractReceiptDataWithin(bytes, "application/pdf", 500)).toEqual(empty)
    expect(mocked.process).toHaveBeenCalledExactlyOnceWith(bytes, "application/pdf", 500)
  })

  it("keeps the default deadline and original data unchanged", async () => {
    mocked.process.mockResolvedValue({ status: "complete", value: { text: "", xml: null, qr: null }, processExited: true })
    expect(await extractReceiptData(bytes, "image/png")).toEqual(empty)
    expect(mocked.process).toHaveBeenCalledExactlyOnceWith(bytes, "image/png", 20000)
    expect([...bytes]).toEqual([1, 2, 3])
  })

  it("does not hide unconfirmed child retirement behind an apparent successful timeout", async () => {
    mocked.process.mockRejectedValue(Error("RECEIPT_PARSER_RETIREMENT_UNCONFIRMED"))
    await expect(extractReceiptDataWithin(bytes, "application/pdf")).rejects.toThrow("RECEIPT_PARSER_RETIREMENT_UNCONFIRMED")
  })

  it("turns ordinary parsing/spawn errors into optional empty suggestions", async () => {
    mocked.process.mockRejectedValue(Error("fabricated parser failure"))
    expect(await extractReceiptDataWithin(bytes, "application/pdf")).toEqual(empty)
  })

  it("maps bounded UBL fields while retaining their unverified status", async () => {
    const xml = '<Invoice><cbc:ID>SYNTH-101</cbc:ID><cbc:IssueDate>2026-09-01</cbc:IssueDate><cac:AccountingSupplierParty><cbc:RegistrationName>Synthetic vendor</cbc:RegistrationName><cac:PartyTaxScheme><cbc:CompanyID>300000000000003</cbc:CompanyID></cac:PartyTaxScheme></cac:AccountingSupplierParty><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cbc:TaxExclusiveAmount>100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>115.00</cbc:TaxInclusiveAmount><cac:TaxTotal><cbc:TaxAmount>15.00</cbc:TaxAmount></cac:TaxTotal></Invoice>'
    mocked.process.mockResolvedValue({ status: "complete", value: { text: "", xml, qr: null }, processExited: true })
    const result = await extractReceiptData(bytes, "application/xml")
    expect(result.source).toEqual(["xml"])
    expect(result.fields).toMatchObject({ supplier_name: "Synthetic vendor", receipt_number: "SYNTH-101", amount_before_vat: "100.00", total_amount: "115.00", vat_amount: "15.00" })
    const claim = claimPayload({ notes: "User supplied note" }, result)
    expect(claim.payload.unverified_fields).toEqual(expect.arrayContaining(["supplier_name", "receipt_number", "total_amount", "notes"]))
    expect(claim.payload).not.toHaveProperty("approved")
    expect(claim.payload).not.toHaveProperty("zatca_cleared")
  })

  it("uses QR fields as suggestions without treating a Phase 2-shaped QR as authority acceptance", async () => {
    const values = ["Synthetic seller", "300000000000003", "2026-09-01T12:00:00+03:00", "115.00", "15.00", "fabricated-hash"]
    const qr = Buffer.concat(values.map((value, i) => { const text = Buffer.from(value); return Buffer.concat([Buffer.from([i + 1, text.length]), text]) })).toString("base64")
    mocked.process.mockResolvedValue({ status: "complete", value: { text: "", xml: null, qr }, processExited: true })
    const result = await extractReceiptData(bytes, "image/png")
    expect(result.source).toEqual(["qr"])
    expect(result.qrPhase2).toBe(true)
    expect(result.fields.total_amount).toBe("115.00")
    const claim = claimPayload({ supplier_name: "Confirmed by submitter" }, result)
    expect(claim.fields.supplier_name).toBe("Confirmed by submitter")
    expect(claim.payload.unverified_fields).toContain("supplier_name")
    expect(claim.payload).not.toHaveProperty("zatca_cleared")
  })
})
