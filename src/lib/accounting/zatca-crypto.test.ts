// Financial Phase 18 — unit tests for the ZATCA cryptographic seam
// (key pair, invoice hash + PIH chain, ECDSA sign/verify, CSR builder).
// All data is synthetic — no real VAT/CR numbers (ZATCA-BOUNDARY §5).
import { describe, expect, it } from "vitest"
import {
  buildSigningInput,
  buildZatcaCsr,
  computeInvoiceHash,
  computePiH,
  genesisPiH,
  generateZatcaKeyPair,
  parseZatcaCsr,
  signZatcaPayload,
  verifyZatcaPayload,
  pemToBase64Body,
  zatcaCsrRequestPayload,
} from "./zatca-crypto"

const SAMPLE_XML = '<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>INV-2026-000001</cbc:ID></Invoice>'

describe("generateZatcaKeyPair", () => {
  it("produces a secp256k1 PEM key pair", () => {
    const kp = generateZatcaKeyPair()
    expect(kp.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----")
    expect(kp.publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----")
    expect(kp.privateKeyPem).not.toContain("RSA")
  })
})

describe("invoice hash + PIH chain", () => {
  it("computes a deterministic base64 SHA-256 of the XML", () => {
    const h1 = computeInvoiceHash(SAMPLE_XML)
    const h2 = computeInvoiceHash(SAMPLE_XML)
    expect(h1).toBe(h2)
    expect(h1).not.toBe("")
    expect(Buffer.from(h1, "base64").length).toBe(32) // SHA-256 = 32 bytes
  })

  it("hashes different XML to different digests", () => {
    expect(computeInvoiceHash(SAMPLE_XML)).not.toBe(computeInvoiceHash(SAMPLE_XML.replace("000001", "000002")))
    expect(computeInvoiceHash(SAMPLE_XML)).toBe(computeInvoiceHash(SAMPLE_XML + " \n"))
  })

  it("matches the supplied SDK's exact genesis PIH fixture", () => {
    const g = genesisPiH()
    expect(g).toBe("NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==")
  })

  it("references the previous invoice's digest without double hashing it", () => {
    const previous = computeInvoiceHash(SAMPLE_XML)
    expect(computePiH(previous)).toBe(previous)
    expect(() => computePiH("not a digest")).toThrow("Base64 SHA-256")
  })
})

describe("digital signature", () => {
  it("signs and verifies a signing input round trip with the matching key", () => {
    const kp = generateZatcaKeyPair()
    const input = buildSigningInput(computeInvoiceHash(SAMPLE_XML))
    const sig = signZatcaPayload(input, kp.privateKeyPem)
    expect(sig).not.toBe("")
    expect(verifyZatcaPayload(input, sig, kp.publicKeyPem)).toBe(true)
  })

  it("fails verification with a different key or tampered input", () => {
    const kp = generateZatcaKeyPair()
    const other = generateZatcaKeyPair()
    const input = buildSigningInput(computeInvoiceHash(SAMPLE_XML))
    const sig = signZatcaPayload(input, kp.privateKeyPem)
    expect(verifyZatcaPayload(input, sig, other.publicKeyPem)).toBe(false)
    expect(verifyZatcaPayload(Buffer.from("tampered"), sig, kp.publicKeyPem)).toBe(false)
  })

  it("uses the raw digest input observed in SDK 3.0.8, with no invented time concatenation", () => {
    const hash = computeInvoiceHash(SAMPLE_XML)
    expect(buildSigningInput(hash)).toEqual(Buffer.from(hash, "base64"))
    expect(buildSigningInput(hash)).toHaveLength(32)
    expect(() => buildSigningInput("not a digest")).toThrow("Base64 SHA-256")
  })
})

describe("CSR builder (onboarding)", () => {
  const csrInput = {
    country: "SA",
    organizationUnit: "Riyadh Branch",
    organization: "Contoso",
    commonName: "PREZATCA-Code-Signing",
    serialNumber: "1-TST|2-TST|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
    uid: "310122393500003",
    title: "1100",
    registeredAddress: "King Fahd Road",
    businessCategory: "Transportation",
  }

  it("builds a base64 CSR body without PEM armor", () => {
    const kp = generateZatcaKeyPair()
    const csr = buildZatcaCsr(csrInput, kp)
    expect(csr).not.toContain("-----")
    // Base64 body decodes to a DER sequence (0x30 header)
    const der = Buffer.from(csr, "base64")
    expect(der[0]).toBe(0x30)
  })

  it("embeds the ZATCA subject (C/OU/O/CN) and SAN dirName fields", () => {
    const kp = generateZatcaKeyPair()
    const csr = buildZatcaCsr(csrInput, kp)
    const parsed = parseZatcaCsr(csr)
    expect(parsed.subject.str).toContain("/C=SA")
    expect(parsed.subject.str).toContain("/OU=Riyadh Branch")
    expect(parsed.subject.str).toContain("/O=Contoso")
    expect(parsed.subject.str).toContain("/CN=PREZATCA-Code-Signing")

    const san = parsed.extreq?.find((e) => e.extname === "subjectAltName")
    const dn = san?.array?.[0]?.dn?.str ?? ""
    expect(dn).toContain("/SN=1-TST|2-TST|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f")
    expect(dn).toContain("/UID=310122393500003")
    expect(dn).toContain("/T=1100")
    expect(dn).toContain("/2.5.4.26=King Fahd Road") // registeredAddress
    expect(dn).toContain("/businessCategory=Transportation")
  })

  it("mirrors the official SDK extension set (template + SAN only; no basicConstraints/keyUsage)", () => {
    const kp = generateZatcaKeyPair()
    const csr = buildZatcaCsr(csrInput, kp)
    const parsed = parseZatcaCsr(csr)
    const names = (parsed.extreq ?? []).map((e) => e.extname)
    expect(names).toContain("subjectAltName")
    expect(names).not.toContain("basicConstraints")
    expect(names).not.toContain("keyUsage")
  })

  it("encodes the request payload as base64 of the PEM text (ZATCA /compliance contract)", () => {
    const kp = generateZatcaKeyPair()
    const csr = buildZatcaCsr(csrInput, kp)
    const pem = Buffer.from(zatcaCsrRequestPayload(csr), "base64").toString("utf8")
    expect(pem.startsWith("-----BEGIN CERTIFICATE REQUEST-----\n")).toBe(true)
    expect(pem.trim().endsWith("-----END CERTIFICATE REQUEST-----")).toBe(true)
    expect(pemToBase64Body(pem)).toBe(csr)
  })

  it("includes the mandatory ZATCA certificateTemplateName extension (OID 1.3.6.1.4.1.311.20.2)", () => {
    const kp = generateZatcaKeyPair()
    const csr = buildZatcaCsr(csrInput, kp)
    // DER-level check: the private-extension OID must be present in the
    // request (the sandbox rejects CSRs without it).
    const der = Buffer.from(csr, "base64")
    const derHex = der.toString("hex")
    expect(derHex).toContain("2b0601040182371402") // 1.3.6.1.4.1.311.20.2
  })

  it("defaults the certificateTemplate to the simulation template (PREZATCA)", () => {
    const kp = generateZatcaKeyPair()
    const derHex = Buffer.from(buildZatcaCsr(csrInput, kp), "base64").toString("hex")
    expect(derHex).toContain(Buffer.from("PREZATCA-Code-Signing").toString("hex"))
  })

  it("honours the per-environment certificateTemplate (sandbox → TSTZATCA, production → ZATCA)", () => {
    const kp = generateZatcaKeyPair()
    const sandbox = buildZatcaCsr({ ...csrInput, certificateTemplate: "TSTZATCA-Code-Signing" }, kp)
    const prod = buildZatcaCsr({ ...csrInput, certificateTemplate: "ZATCA-Code-Signing" }, kp)
    expect(Buffer.from(sandbox, "base64").toString("hex")).toContain(Buffer.from("TSTZATCA-Code-Signing").toString("hex"))
    expect(Buffer.from(prod, "base64").toString("hex")).toContain(Buffer.from("ZATCA-Code-Signing").toString("hex"))
  })
})

describe("pemToBase64Body", () => {
  it("strips PEM armor and headers", () => {
    const body = pemToBase64Body("-----BEGIN CERTIFICATE REQUEST-----\nYWJj\n-----END CERTIFICATE REQUEST-----\n")
    expect(body).toBe("YWJj")
  })
})
