// Offline Phase 2 QR format primitive. No signing, certificate trust, authority
// acceptance or print-path integration is implied by encoding/decoding bytes.
// Tag assignments follow ZATCA Security Features v1.2, section 4.1. Encoding
// profiles are explicit offline experiments: the document says a 32-byte hash
// but SDKs emit 44-byte Base64 text; legacy 3.0.8 also differs in tags 7/8/9.
// Neither experiment is an approved production profile. Never auto-detect.
import { createPublicKey } from "node:crypto"

export type ZatcaQrKind = "standard" | "simplified"
export type ZatcaQrEncodingProfile = "binary-digest-signature" | "base64-text-digest-signature"
export type ZatcaQrTimeProfile = "utc" | "offsetless-plus03"

export interface ZatcaPhase2QrFields {
  kind: ZatcaQrKind
  /** Explicit interpretation; never infer a timezone from suffix-less text. */
  timeProfile: ZatcaQrTimeProfile
  sellerName: string
  sellerVatNumber: string
  timestamp: string
  /** Engine-computed amounts, kept as exact decimal text. No recomputation. */
  total: string
  vatAmount: string
  invoiceHashBase64: string
  signatureBase64: string
  publicKeySpkiDer: Uint8Array
  /** Required only for simplified invoices/notes. Public certificate data. */
  certificateSignatureDer?: Uint8Array
}

export class ZatcaQrFormatError extends Error {
  constructor(readonly code: "ENCODING" | "PROFILE" | "LENGTH" | "TAGS" | "TEXT" | "VAT" | "TIME" | "AMOUNT" | "HASH" | "SIGNATURE" | "PUBLIC_KEY" | "CERTIFICATE_SIGNATURE" | "ENVIRONMENT") {
    super(`Unsupported ZATCA Phase 2 QR format: ${code}`)
  }
}

function fail(code: ZatcaQrFormatError["code"]): never { throw new ZatcaQrFormatError(code) }

function base64(value: string, code: ZatcaQrFormatError["code"]): Buffer {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(code)
  const bytes = Buffer.from(value, "base64")
  if (bytes.toString("base64") !== value) fail(code)
  return bytes
}

// Strict DER ECDSA r/s sequence: minimal positive integers in the secp256k1
// scalar range. This is syntax validation, not signature verification.
function ecdsaDer(bytes: Uint8Array, code: "SIGNATURE" | "CERTIFICATE_SIGNATURE"): void {
  // The certificate issuer need not use the EGS's curve; accept minimally
  // encoded ECDSA integers up to 66 bytes for that public signature only.
  const maxIntegerLength = code === "SIGNATURE" ? 33 : 66
  if (bytes.length < 8 || bytes.length > (code === "SIGNATURE" ? 72 : 139) || bytes[0] !== 0x30) fail(code)
  let offset = 2
  if (bytes[1] === 0x81) {
    if (code === "SIGNATURE" || bytes[2] < 128 || bytes[2] !== bytes.length - 3) fail(code)
    offset = 3
  } else if (bytes[1] >= 128 || bytes[1] !== bytes.length - 2) fail(code)
  const order = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141")
  for (let i = 0; i < 2; i++) {
    if (bytes[offset++] !== 2) fail(code)
    const length = bytes[offset++]
    if (!length || length > maxIntegerLength || offset + length > bytes.length) fail(code)
    const integer = bytes.slice(offset, offset + length)
    if (integer[0] & 0x80 || (length > 1 && integer[0] === 0 && !(integer[1] & 0x80))) fail(code)
    const scalar = BigInt("0x" + Buffer.from(integer).toString("hex"))
    if (scalar === BigInt(0) || (code === "SIGNATURE" && scalar >= order)) fail(code)
    offset += length
  }
  if (offset !== bytes.length) fail(code)
}

function validateFields(p: ZatcaPhase2QrFields): void {
  if (p.kind !== "standard" && p.kind !== "simplified") fail("TAGS")
  const seller = Buffer.from(p.sellerName, "utf8")
  if (!p.sellerName.trim() || /[\u0000-\u001f\u007f]/.test(p.sellerName) || seller.toString("utf8") !== p.sellerName) fail("TEXT")
  if (!/^3\d{13}3$/.test(p.sellerVatNumber)) fail("VAT")
  if (p.timeProfile !== "utc" && p.timeProfile !== "offsetless-plus03") fail("TIME")
  const utc = p.timeProfile === "utc"
  if (!(utc ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/).test(p.timestamp)) fail("TIME")
  const time = Date.parse(utc ? p.timestamp : p.timestamp + "+03:00")
  const normalized = Number.isFinite(time) ? new Date(time + (utc ? 0 : 180 * 60_000)).toISOString().replace(".000Z", utc ? "Z" : "") : ""
  if (!Number.isFinite(time) || normalized !== p.timestamp) fail("TIME")
  if (![p.total, p.vatAmount].every((amount) => /^(?:0|[1-9]\d{0,12})\.\d{2}$/.test(amount))) fail("AMOUNT")
  if (base64(p.invoiceHashBase64, "HASH").length !== 32) fail("HASH")
  ecdsaDer(base64(p.signatureBase64, "SIGNATURE"), "SIGNATURE")
  try {
    const key = createPublicKey({ key: Buffer.from(p.publicKeySpkiDer), type: "spki", format: "der" })
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "secp256k1" ||
        !key.export({ type: "spki", format: "der" }).equals(Buffer.from(p.publicKeySpkiDer))) fail("PUBLIC_KEY")
  } catch { fail("PUBLIC_KEY") }
  if (p.kind === "simplified") {
    if (!p.certificateSignatureDer) fail("CERTIFICATE_SIGNATURE")
    ecdsaDer(p.certificateSignatureDer, "CERTIFICATE_SIGNATURE")
  } else if (p.certificateSignatureDer !== undefined) fail("TAGS")
}

function field(tag: number, value: string | Uint8Array): Buffer {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value)
  if (bytes.length < 1 || bytes.length > 255) fail("LENGTH")
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes])
}

/**
 * Candidate format only, deliberately restricted to non-production callers.
 * The future signer must bind these fields to retained XML and the genuine
 * certificate. This function accepts no key and confers no trusted status.
 */
export function buildZatcaPhase2QrCandidate(environment: "sandbox" | "simulation" | "production", profile: ZatcaQrEncodingProfile, p: ZatcaPhase2QrFields): string {
  if (environment !== "sandbox" && environment !== "simulation" && environment !== "production") fail("ENVIRONMENT")
  if (profile !== "binary-digest-signature" && profile !== "base64-text-digest-signature") fail("PROFILE")
  validateFields(p)
  const encoded = Buffer.concat([
    field(1, p.sellerName), field(2, p.sellerVatNumber), field(3, p.timestamp),
    field(4, p.total), field(5, p.vatAmount),
    field(6, profile === "binary-digest-signature" ? base64(p.invoiceHashBase64, "HASH") : p.invoiceHashBase64),
    field(7, profile === "binary-digest-signature" ? base64(p.signatureBase64, "SIGNATURE") : p.signatureBase64),
    field(8, p.publicKeySpkiDer),
    ...(p.kind === "simplified" ? [field(9, p.certificateSignatureDer!)] : []),
  ]).toString("base64")
  if (encoded.length > 700) fail("LENGTH")
  return encoded
}

/**
 * Strict tag-assignment/profile decoder. Rejects duplicate/reordered/missing tags,
 * malformed UTF-8/DER/Base64 and the legacy SDK demonstration tag mapping.
 * A successful decode is format evidence only, never authority evidence.
 */
export function decodeZatcaPhase2Qr(encoded: string, kind: ZatcaQrKind, profile: ZatcaQrEncodingProfile, timeProfile: ZatcaQrTimeProfile): ZatcaPhase2QrFields {
  if (profile !== "binary-digest-signature" && profile !== "base64-text-digest-signature") fail("PROFILE")
  if (encoded.length > 700) fail("LENGTH")
  const bytes = base64(encoded, "ENCODING")
  const values: Buffer[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) fail("LENGTH")
    const tag = bytes[offset++], length = bytes[offset++]
    if (tag !== values.length + 1 || tag > 9) fail("TAGS")
    if (!length || offset + length > bytes.length) fail("LENGTH")
    values.push(bytes.subarray(offset, offset + length))
    offset += length
  }
  if (values.length !== (kind === "simplified" ? 9 : kind === "standard" ? 8 : 0)) fail("TAGS")
  function text(index: number): string {
    const value = values[index].toString("utf8")
    if (!Buffer.from(value, "utf8").equals(values[index])) fail("TEXT")
    return value
  }
  const result: ZatcaPhase2QrFields = {
    kind, timeProfile, sellerName: text(0), sellerVatNumber: text(1), timestamp: text(2),
    total: text(3), vatAmount: text(4),
    invoiceHashBase64: profile === "binary-digest-signature" ? values[5].toString("base64") : text(5),
    signatureBase64: profile === "binary-digest-signature" ? values[6].toString("base64") : text(6),
    publicKeySpkiDer: Buffer.from(values[7]),
    ...(kind === "simplified" ? { certificateSignatureDer: Buffer.from(values[8]) } : {}),
  }
  validateFields(result)
  return result
}
