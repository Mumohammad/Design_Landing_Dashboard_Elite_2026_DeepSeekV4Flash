import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { runZatcaDryRunBatch, type DryRunDocument } from "./zatca-dry-run-core"
import { decodeZatcaPhase2Qr } from "./zatca-phase2-qr"

const seller = { name: "EliteDev Logistics", vatNumber: "399999999900003", crNumber: "1010010000", address: "Olaya Street", buildingNumber: "1234", additionalNumber: "5678", district: "Olaya", city: "Riyadh", postalCode: "12345", region: "Riyadh", countryCode: "SA" }
const buyerB2B = { name: "Buyer Co", vatNumber: "399999999800003", address: "King Fahd Road", buildingNumber: "1111", additionalNumber: "2222", district: "Olaya", city: "Riyadh", postalCode: "12345", region: "Riyadh", countryCode: "SA" }
const buyerB2C = { name: "Walk-in", vatNumber: null, countryCode: "SA" }
const line = { line_no: 1, description: "Delivery", quantity: 2, unit_price: 50, discount: 0, amount: 100, vat_rate: 15, vat_amount: 15 }
const doc = (over: Partial<DryRunDocument> = {}): DryRunDocument => ({
  sourceId: "s1", docType: "invoice", docRef: "INV-1", issueDate: "2026-11-01", finalizedAt: "2026-11-01T07:15:00Z", currency: "SAR",
  subtotal: 100, discount: 0, vatAmount: 15, total: 115, lines: [line], buyer: buyerB2C, ...over,
})

vi.mock("server-only", () => ({}))
afterEach(() => vi.restoreAllMocks())

describe("ZATCA offline dry run", () => {
  it("rehearses simplified + standard documents end to end without any network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const r = runZatcaDryRunBatch({ seller, documents: [doc(), doc({ sourceId: "s2", docRef: "INV-2", buyer: buyerB2B })] })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(r.networkCalls).toBe(0)
    expect(r.certificate).toBe("local-test")
    expect(r.documents.map((d) => [d.kind, d.pipeline, d.counter])).toEqual([["simplified", "reporting", 1], ["standard", "clearance", 2]])
    for (const d of r.documents) expect(d.checks.filter((c) => !c.pass)).toEqual([])
    expect(r.passed).toBe(true)
    // PIH chain: document 2 embeds document 1's hash.
    expect(r.documents[1].signedXml).toContain(r.documents[0].invoiceHash!)
    // Signed XML carries the rehearsal certificate, never a real CSID.
    expect(r.documents[0].signedXml).toContain("<ds:X509IssuerName>CN=DRY-RUN-LOCAL-TEST-CA")
    const qrB64 = /<cbc:ID>QR<\/cbc:ID>[\s\S]*?mimeCode="text\/plain">([^<]+)</.exec(r.documents[0].signedXml!)![1]
    expect(decodeZatcaPhase2Qr(qrB64, "simplified", "base64-text-digest-signature", "offsetless-plus03")).toMatchObject({ total: "115.00", vatAmount: "15.00", timestamp: "2026-11-01T10:15:00" })
  })

  it("continues from the ledger position without advancing it", () => {
    const r = runZatcaDryRunBatch({ seller, documents: [doc()], chainStart: { counter: 41, previousHash: "PREVHASH==" } })
    expect(r.documents[0].counter).toBe(42)
    expect(r.documents[0].signedXml).toContain("PREVHASH==")
  })

  it("flags data problems that ZATCA would reject", () => {
    const r = runZatcaDryRunBatch({ seller: { ...seller, vatNumber: "123", district: null }, documents: [
      doc({ total: 120 }),
      doc({ sourceId: "s2", docRef: "INV-2", buyer: { ...buyerB2B, buildingNumber: null } }),
      doc({ sourceId: "s3", docRef: "CN-1", docType: "credit_note" }),
      doc({ sourceId: "s4", docRef: "INV-4", lines: [{ ...line, vat_amount: 10 }], vatAmount: 10, total: 110 }),
    ] })
    const failed = (i: number) => r.documents[i].checks.filter((c) => !c.pass).map((c) => c.id)
    expect(r.passed).toBe(false)
    expect(failed(0)).toEqual(expect.arrayContaining(["seller_vat", "seller_address", "totals"]))
    expect(failed(1)).toContain("buyer_standard")
    expect(failed(2)).toContain("note_reference")
    expect(failed(3)).toContain("line_vat")
  })

  it("never imports the transport, submission, onboarding, ledger or credential modules", () => {
    for (const f of ["zatca-dry-run-core.ts", "zatca-dry-run.ts"]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8")
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
      const banned = ["zatca-transport", "zatca-submission", "zatca-submission-core", "zatca-onboarding", "zatca-issuance", "zatca-credentials", "zatca-csid", "zatca-compliance-checks", "zatca-adapter-core", "zatca"]
      expect(imports.filter((i) => banned.some((b) => i === `./${b}` || i.endsWith(`/accounting/${b}`)))).toEqual([])
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/)
      expect(src).not.toMatch(/\bfetch\(/)
    }
  })
})
