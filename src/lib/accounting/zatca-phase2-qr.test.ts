import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto"
import { describe, expect, it } from "vitest"
import { buildZatcaPhase2QrCandidate, decodeZatcaPhase2Qr, type ZatcaPhase2QrFields } from "./zatca-phase2-qr"

// Ephemeral synthetic material. No stored key, tenant certificate or secrets.
const key = generateKeyPairSync("ec", { namedCurve: "secp256k1" })
const digest = createHash("sha256").update("synthetic invoice").digest()
const signature = sign("sha256", digest, key.privateKey)
const fields: ZatcaPhase2QrFields = {
  kind: "simplified", timeProfile: "utc", sellerName: "شركة تجريبية 🚚", sellerVatNumber: "399999999900003",
  timestamp: "2026-10-19T09:30:00Z", total: "115.00", vatAmount: "15.00",
  invoiceHashBase64: digest.toString("base64"), signatureBase64: signature.toString("base64"),
  publicKeySpkiDer: key.publicKey.export({ type: "spki", format: "der" }),
  // Format fixture only: this synthetic signature is not a CA signature.
  certificateSignatureDer: sign("sha256", Buffer.from("synthetic certificate"), key.privateKey),
}

function bytes(p = fields) { return Buffer.from(buildZatcaPhase2QrCandidate("sandbox", "base64-text-digest-signature", p), "base64") }
function split(b: Buffer): Buffer[] {
  const result = []
  for (let offset = 0; offset < b.length;) {
    const length = b[offset + 1] + 2
    result.push(b.subarray(offset, offset + length)); offset += length
  }
  return result
}
function reject(b: Buffer, error: string | RegExp, kind = fields.kind) {
  expect(() => decodeZatcaPhase2Qr(b.toString("base64"), kind, "base64-text-digest-signature", "utc")).toThrow(error)
}

describe("offline Phase 2 QR tag assignments and explicit encoding profiles", () => {
  it("encodes textual hash/signature and binary SPKI/certificate signature in tags 6–9", () => {
    const parts = split(bytes())
    expect(parts.map((p) => p[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(parts[0][1]).toBe(Buffer.byteLength(fields.sellerName, "utf8"))
    expect(parts[5].subarray(2).toString("utf8")).toBe(fields.invoiceHashBase64)
    expect(parts[6].subarray(2).toString("utf8")).toBe(fields.signatureBase64)
    expect(parts[7].subarray(2)).toEqual(fields.publicKeySpkiDer)
    expect(parts[8].subarray(2)).toEqual(fields.certificateSignatureDer)
    expect(decodeZatcaPhase2Qr(bytes().toString("base64"), "simplified", "base64-text-digest-signature", "utc")).toEqual(fields)
  })

  it("uses eight tags for standard invoices/notes and nine for simplified documents", () => {
    const standard = { ...fields, kind: "standard" as const }
    delete standard.certificateSignatureDer
    const encoded = buildZatcaPhase2QrCandidate("simulation", "base64-text-digest-signature", standard)
    expect(split(Buffer.from(encoded, "base64"))).toHaveLength(8)
    expect(decodeZatcaPhase2Qr(encoded, "standard", "base64-text-digest-signature", "utc")).toEqual(standard)
    expect(() => decodeZatcaPhase2Qr(encoded, "simplified", "base64-text-digest-signature", "utc")).toThrow("TAGS")
    expect(() => buildZatcaPhase2QrCandidate("sandbox", "base64-text-digest-signature", { ...fields, kind: "standard" })).toThrow("TAGS")
    expect(() => buildZatcaPhase2QrCandidate("sandbox", "base64-text-digest-signature", { ...fields, certificateSignatureDer: undefined })).toThrow("CERTIFICATE_SIGNATURE")
  })

  it("cannot be used as a production QR builder by bypassing TypeScript", () => {
    expect(() => buildZatcaPhase2QrCandidate("production" as "sandbox", "base64-text-digest-signature", fields)).toThrow("ENVIRONMENT")
    expect(() => buildZatcaPhase2QrCandidate(undefined as unknown as "sandbox", "base64-text-digest-signature", fields)).toThrow("ENVIRONMENT")
  })

  it("supports an explicitly selected raw-hash experiment, without silently detecting encodings", () => {
    const encoded = buildZatcaPhase2QrCandidate("sandbox", "binary-digest-signature", fields)
    const parts = split(Buffer.from(encoded, "base64"))
    expect(parts[5][1]).toBe(32)
    expect(parts[5].subarray(2)).toEqual(digest)
    expect(parts[6].subarray(2)).toEqual(signature)
    expect(decodeZatcaPhase2Qr(encoded, "simplified", "binary-digest-signature", "utc")).toEqual(fields)
    expect(() => decodeZatcaPhase2Qr(encoded, "simplified", "base64-text-digest-signature", "utc")).toThrow()
    expect(() => decodeZatcaPhase2Qr(bytes().toString("base64"), "simplified", "binary-digest-signature", "utc")).toThrow("HASH")
    expect(() => buildZatcaPhase2QrCandidate("sandbox", undefined as never, fields)).toThrow("PROFILE")
    expect(() => decodeZatcaPhase2Qr(encoded, "simplified", undefined as never, "utc")).toThrow("PROFILE")
  })

  it("accepts the issuer's ECDSA signature independently of the EGS curve", () => {
    const issuer = generateKeyPairSync("ec", { namedCurve: "secp521r1" })
    const certificateSignatureDer = sign("sha256", Buffer.from("synthetic certificate"), issuer.privateKey)
    const value = { ...fields, certificateSignatureDer }
    const encoded = buildZatcaPhase2QrCandidate("sandbox", "binary-digest-signature", value)
    expect(decodeZatcaPhase2Qr(encoded, "simplified", "binary-digest-signature", "utc").certificateSignatureDer).toEqual(certificateSignatureDer)
  })

  it("retains an explicitly selected offset-less UTC+03 convention without converting fields", () => {
    const value = { ...fields, timeProfile: "offsetless-plus03" as const, timestamp: "2026-10-18T12:30:00" }
    const encoded = buildZatcaPhase2QrCandidate("sandbox", "base64-text-digest-signature", value)
    expect(split(Buffer.from(encoded, "base64"))[2].subarray(2).toString("utf8")).toBe(value.timestamp)
    expect(decodeZatcaPhase2Qr(encoded, "simplified", "base64-text-digest-signature", "offsetless-plus03")).toEqual(value)
  })

  it("rejects missing or mismatched time conventions instead of inferring one", () => {
    const value = { ...fields, timeProfile: "offsetless-plus03" as const, timestamp: "2026-10-18T12:30:00" }
    const encoded = buildZatcaPhase2QrCandidate("sandbox", "base64-text-digest-signature", value)
    expect(() => decodeZatcaPhase2Qr(encoded, "simplified", "base64-text-digest-signature", "utc")).toThrow("TIME")
    expect(() => decodeZatcaPhase2Qr(bytes().toString("base64"), "simplified", "base64-text-digest-signature", "offsetless-plus03")).toThrow("TIME")
    expect(() => bytes({ ...fields, timeProfile: undefined as never })).toThrow("TIME")
    expect(() => decodeZatcaPhase2Qr(encoded, "simplified", "base64-text-digest-signature", undefined as never)).toThrow("TIME")
  })

  it("rejects invalid calendar dates, overflow and zone suffixes in the offset-less convention", () => {
    for (const timestamp of ["2026-02-30T12:30:00", "2026-10-18T24:30:00", "2026-10-18T12:30:00Z", "2026-10-18T12:30:00+03:00"]) {
      expect(() => bytes({ ...fields, timeProfile: "offsetless-plus03", timestamp })).toThrow("TIME")
    }
  })

  it("retains exact engine-provided amount text", () => {
    const value = { ...fields, total: "1000000000000.01", vatAmount: "0.00" }
    expect(decodeZatcaPhase2Qr(buildZatcaPhase2QrCandidate("sandbox", "base64-text-digest-signature", value), "simplified", "base64-text-digest-signature", "utc").total).toBe(value.total)
  })

  it.each(["NaN", "-1.00", "1e2", "1.005", "01.00", "1", "1.0"])("rejects non-canonical monetary text %s", (total) => {
    expect(() => bytes({ ...fields, total })).toThrow("AMOUNT")
  })

  it.each(["2026-02-30T09:30:00Z", "2026-10-19T25:00:00Z", "2026-10-19", "2026-10-19T09:30:00+03:00"])("rejects unsupported/invalid timestamps %s", (timestamp) => {
    expect(() => bytes({ ...fields, timestamp })).toThrow("TIME")
  })

  it("rejects invalid VAT format, empty/control/lone-surrogate seller names and byte overflow", () => {
    expect(() => bytes({ ...fields, sellerVatNumber: "123" })).toThrow("VAT")
    for (const sellerName of [" ", "Company\nInjected", "\ud800"]) expect(() => bytes({ ...fields, sellerName })).toThrow("TEXT")
    expect(() => bytes({ ...fields, sellerName: "ش".repeat(128) })).toThrow("LENGTH")
    expect(() => bytes({ ...fields, sellerName: "x".repeat(255) })).toThrow("LENGTH") // whole QR exceeds 700
  })

  it("rejects truncated, zero-length, reordered, duplicate and surplus TLV fields", () => {
    const b = bytes(), parts = split(b)
    reject(b.subarray(0, b.length - 1), "LENGTH")
    reject(Buffer.concat([b, Buffer.from([10])]), "LENGTH")
    reject(Buffer.concat([Buffer.from([1, 0]), ...parts.slice(1)]), "LENGTH")
    reject(Buffer.concat([parts[1], parts[0], ...parts.slice(2)]), "TAGS")
    reject(Buffer.concat([parts[0], ...parts]), "TAGS")
    reject(Buffer.concat([...parts, Buffer.from([10, 1, 1])]), "TAGS")
  })

  it("rejects invalid UTF-8, non-canonical Base64, raw binary hash/signature and extra padding", () => {
    const parts = split(bytes())
    reject(Buffer.concat([Buffer.from([1, 1, 0xff]), ...parts.slice(1)]), "TEXT")
    for (const encoded of [bytes().toString("base64") + "=", "!!!!", "", "AB=="]) {
      expect(() => decodeZatcaPhase2Qr(encoded, "simplified", "base64-text-digest-signature", "utc")).toThrow()
    }
    expect(() => bytes({ ...fields, invoiceHashBase64: digest.toString("base64") + "\n" })).toThrow("HASH")
    expect(() => bytes({ ...fields, invoiceHashBase64: Buffer.alloc(31).toString("base64") })).toThrow("HASH")
    reject(Buffer.concat([...parts.slice(0, 5), Buffer.from([6, 32]), digest, ...parts.slice(6)]), /TEXT|HASH/)
    reject(Buffer.concat([...parts.slice(0, 6), Buffer.from([7, signature.length]), signature, ...parts.slice(7)]), /TEXT|SIGNATURE/)
  })

  it.each([
    "3006020100020101", // zero scalar
    "3006020180020101", // negative scalar
    "300702020001020101", // unnecessary leading zero
    "300602010102010100", // trailing byte
    "3006020101020100", // zero second scalar
  ])("rejects malformed DER ECDSA integers %s", (hex) => {
    const value = Buffer.from(hex, "hex")
    expect(() => bytes({ ...fields, signatureBase64: value.toString("base64") })).toThrow("SIGNATURE")
    expect(() => bytes({ ...fields, certificateSignatureDer: value })).toThrow("CERTIFICATE_SIGNATURE")
  })

  it("rejects other curves, raw EC points and trailing DER bytes", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    for (const publicKeySpkiDer of [other.publicKey.export({ type: "spki", format: "der" }), Buffer.alloc(65), Buffer.concat([Buffer.from(fields.publicKeySpkiDer), Buffer.from([0])])]) {
      expect(() => bytes({ ...fields, publicKeySpkiDer })).toThrow("PUBLIC_KEY")
    }
    expect(createPublicKey({ key: Buffer.from(fields.publicKeySpkiDer), type: "spki", format: "der" }).asymmetricKeyType).toBe("ec")
  })

  it("does not accept the SDK 3.0.8 demonstration public-key/r/s mapping as a Phase 2 QR", () => {
    const parts = split(bytes())
    const legacy = Buffer.concat([...parts.slice(0, 6), Buffer.from([7, fields.publicKeySpkiDer.length]), fields.publicKeySpkiDer,
      Buffer.from([8, 32]), Buffer.alloc(32, 1), Buffer.from([9, 32]), Buffer.alloc(32, 2)])
    expect(() => decodeZatcaPhase2Qr(legacy.toString("base64"), "simplified", "base64-text-digest-signature", "utc")).toThrow()
  })

  it("never echoes a malformed payload in error messages", () => {
    expect(() => decodeZatcaPhase2Qr("PRIVATE-DATA-DO-NOT-ECHO", "standard", "base64-text-digest-signature", "utc")).toThrow("Unsupported ZATCA Phase 2 QR format: ENCODING")
  })
})
