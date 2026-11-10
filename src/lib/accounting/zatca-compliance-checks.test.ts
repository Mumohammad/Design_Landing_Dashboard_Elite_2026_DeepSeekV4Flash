import { describe, expect, it, vi, beforeEach } from "vitest"
import { KEYUTIL, KJUR } from "jsrsasign"
import { generateZatcaKeyPair, computeInvoiceHash, genesisPiH } from "./zatca-crypto"

vi.mock("server-only", () => ({}))
const { transmit } = vi.hoisted(() => ({ transmit: vi.fn() }))
vi.mock("./zatca-transport", async (orig) => {
  const actual = await orig<typeof import("./zatca-transport")>()
  return { ...actual, transmitToZatca: transmit }
})
import { ZatcaTransportError } from "./zatca-transport"
import { complianceCheckMatrix, runZatcaComplianceChecks } from "./zatca-compliance-checks"

function syntheticCredential() {
  const kp = generateZatcaKeyPair()
  const cert = new KJUR.asn1.x509.Certificate({
    version: 3, serial: { int: 77 }, issuer: { str: "/CN=SYNTHETIC-CA" }, subject: { str: "/C=SA/O=Synthetic/CN=EGS-1" },
    notbefore: "20260101000000Z", notafter: "20300101000000Z", sbjpubkey: KEYUTIL.getKey(kp.publicKeyPem),
    sigalg: "SHA256withECDSA", cakey: KEYUTIL.getKey(kp.privateKeyPem),
  } as unknown as ConstructorParameters<typeof KJUR.asn1.x509.Certificate>[0])
  return { kp, certificateBase64: cert.getPEM().replace(/-----[^-]+-----|\s/g, "") }
}

const seller = { name: "Synthetic seller", vatNumber: "399999999900003", crNumber: "1010010000", address: "Synthetic Street", buildingNumber: "1234", additionalNumber: "5678", district: "Olaya", city: "Riyadh", postalCode: "12345", region: "Riyadh", countryCode: "SA" }

function run() {
  const { kp, certificateBase64 } = syntheticCredential()
  return runZatcaComplianceChecks({
    seller, environment: "sandbox", certificateBase64, privateKeyPem: kp.privateKeyPem,
    credentials: { csidBase64: "token", secret: "secret" }, now: new Date("2026-10-28T09:00:00Z"),
  })
}

describe("ZATCA compliance checks", () => {
  beforeEach(() => { transmit.mockReset() })

  it("covers standard and simplified invoice, credit and debit notes", () => {
    expect(complianceCheckMatrix()).toHaveLength(6)
    expect(new Set(complianceCheckMatrix().map((m) => `${m.kind}:${m.docType}`)).size).toBe(6)
  })

  it("submits six signed documents on a private ICV/PIH chain and passes when all clear/report", async () => {
    const calls: { xml: string; pipeline: string }[] = []
    transmit.mockImplementation(async (input: { xml: string; pipeline: string }) => {
      calls.push(input)
      const standard = input.xml.includes('name="0100000"')
      return { status: standard ? "cleared" : "reported", raw: { validationResults: { warningMessages: [], errorMessages: [] } } }
    })
    const summary = await run()
    expect(calls).toHaveLength(6)
    expect(calls.every((c) => c.pipeline === "compliance")).toBe(true)
    // Chain: the first document starts from genesis; each next PIH is the previous hash.
    expect(calls[0].xml).toContain(genesisPiH())
    for (let i = 1; i < calls.length; i++) expect(calls[i].xml).toContain(computeInvoiceHash(calls[i - 1].xml))
    calls.forEach((c, i) => expect(c.xml).toContain(`<cbc:ID>CMP-${i + 1}</cbc:ID>`))
    expect(summary.passed).toBe(true)
  })

  it("fails when any document is rejected or the transport errors", async () => {
    let n = 0
    transmit.mockImplementation(async () => {
      n++
      if (n === 2) throw new ZatcaTransportError("UNAUTHORIZED", 401)
      if (n === 4) return { status: "rejected", raw: { validationResults: { errorMessages: [{ code: "BR-KSA-01" }] } } }
      return { status: n <= 3 ? "cleared" : "reported", raw: {} }
    })
    const summary = await run()
    expect(summary.passed).toBe(false)
    expect(summary.results[1]).toMatchObject({ status: "failed", errors: [{ code: "UNAUTHORIZED" }] })
    expect(summary.results[3]).toMatchObject({ status: "rejected", errors: [{ code: "BR-KSA-01" }] })
  })
})
