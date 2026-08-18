// ZATCA production-prep — cryptographic primitives (Financial Phase 18).
//
// This module implements the ZATCA Phase 2 cryptographic seam with the
// documented algorithm from authoritative sources:
//
//   - Key algorithm:  ECDSA on curve **secp256k1** (Microsoft's official
//     onboarding script uses `openssl ecparam -name secp256k1`; the ZATCA
//     Developer-community simulator and the SallaApp SDK confirm secp256k1
//     is the mandatory stamp curve).
//   - Invoice hash:   SHA-256 of the canonicalized (C14N) UBL invoice XML,
//     Base64-encoded.
//   - PIH chaining:    every invoice embeds the Base64 SHA-256 hash of the
//     previous invoice; the genesis PIH is Base64(SHA-256("0")).
//   - Digital signature: ECDSA (secp256k1) over the signing input; the
//     documented input is the invoice hash + signing time; the result is
//     injected into the UBL as the `ds:SignatureValue` (XAdES-B-B).
//   - CSR (onboarding): subject C=SA/OU/O/CN + subjectAltName dirName with
//     SN (solution serial `1-..|2-..|3-..`), UID (VAT number), title (TSCZ
//     document-type code), registeredAddress, businessCategory.
//
// ⚠️ SEAM, NOT PRODUCTION-READY: nothing here is exercised against the live
// ZATCA API. Before any real transmission, this seam must be validated
// against the ZATCA sandbox and the official SDK (ZATCA-BOUNDARY.md §1/§5).
// The exact byte layout of the signature input and the XML canonicalization
// MUST be confirmed against the official ZATCA technical documents — the
// constructions below are the documented ones but are not yet verified
// end-to-end against ZATCA.
//
// No ZATCA compliance is claimed (ZATCA-BOUNDARY.md §5).

import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto"
import { KJUR } from "jsrsasign"

export const ZATCA_CURVE = "secp256k1" as const
export const ZATCA_HASH = "sha256" as const

// ── Key pair ────────────────────────────────────────────────────────────────

export interface ZatcaKeyPair {
  /** PKCS#8 PEM private key (secp256k1). */
  privateKeyPem: string
  /** SPKI PEM public key (secp256k1). */
  publicKeyPem: string
}

/**
 * Generate an ECDSA secp256k1 key pair for the ZATCA cryptographic stamp.
 * Pure Node crypto — no native deps.
 */
export function generateZatcaKeyPair(): ZatcaKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: ZATCA_CURVE,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  return { privateKeyPem: privateKey.toString(), publicKeyPem: publicKey.toString() }
}

// ── Invoice hash + PIH chain ────────────────────────────────────────────────

/**
 * Base64 SHA-256 hash of the (canonicalized) invoice XML — the "invoice hash"
 * embedded in the QR and the signature.
 *
 * NOTE: ZATCA hashes the C14N (canonical XML) form. The UBL builder in
 * zatca-ubl.ts emits deterministic, normalized XML, but the exact C14N
 * transformation must be validated against the official SDK before the hash
 * is used for a real transmission.
 */
export function computeInvoiceHash(xml: string): string {
  return createHash(ZATCA_HASH).update(xml, "utf8").digest("base64")
}

/** Base64 SHA-256 of the ASCII string "0" — the first invoice's PIH. */
export function genesisPiH(): string {
  return createHash(ZATCA_HASH).update("0", "utf8").digest("base64")
}

/**
 * The Previous Invoice Hash for an invoice that follows `prevInvoiceHash`.
 * The chain input is the previous invoice's Base64 hash string.
 */
export function computePiH(prevInvoiceHash: string): string {
  return createHash(ZATCA_HASH).update(prevInvoiceHash, "utf8").digest("base64")
}

// ── Digital signature ───────────────────────────────────────────────────────

/**
 * Build the signing input for a ZATCA digital signature.
 *
 * Documented construction: the signature covers the invoice hash combined
 * with the signing time (ISO 8601, e.g. `2026-08-15T10:30:00Z`).
 *
 * ⚠️ SEAM NOTE: the exact concatenation order / encoding is a detail that
 * MUST be verified against the official ZATCA security-standards document and
 * sandbox before production use — implementations differ in whether the hash
 * is Base64-decoded to raw bytes before concatenation and whether a second
 * SHA-256 pass is applied inside ECDSA. The construction here follows the
 * documented "hash + signing time → ECDSA-SHA256" model and is isolated in
 * one function so a spec correction touches only this line.
 */
export function buildSigningInput(invoiceHashBase64: string, signingTimeIso: string): Buffer {
  return Buffer.from(`${invoiceHashBase64}${signingTimeIso}`, "utf8")
}

/**
 * ECDSA (secp256k1 + SHA-256) signature over the signing input, Base64.
 * The private key is the one bound to the CSID certificate.
 */
export function signZatcaPayload(input: Buffer, privateKeyPem: string): string {
  return sign(ZATCA_HASH, input, privateKeyPem).toString("base64")
}

/**
 * Verify an ECDSA signature produced by signZatcaPayload — used by tests to
 * prove the round trip; ZATCA itself validates with the CSID public key.
 */
export function verifyZatcaPayload(input: Buffer, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return verify(ZATCA_HASH, input, createPublicKey(publicKeyPem), Buffer.from(signatureBase64, "base64"))
  } catch {
    return false
  }
}

// ── CSR (onboarding) ────────────────────────────────────────────────────────

export const ZATCA_CERT_TEMPLATES = {
  /** Developer Sandbox — fake CSID, structure testing only. */
  sandbox: "TSTZATCA-Code-Signing",
  /** Simulation (Fatoora pre-production) — real onboarding flow with a portal OTP. */
  simulation: "PREZATCA-Code-Signing",
  /** Production — live tax documents. */
  production: "ZATCA-Code-Signing",
} as const

export type ZatcaEnvironment = keyof typeof ZATCA_CERT_TEMPLATES

export interface ZatcaCsrInput {
  /** ISO country code — ZATCA requires "SA". */
  country: string
  /** Organization unit / branch. */
  organizationUnit: string
  /** Organization / taxpayer name. */
  organization: string
  /**
   * Common name — the solution-unit name. In the ZATCA sandbox use
   * "PREZATCA-Code-Signing"; production uses the EGS name.
   */
  commonName: string
  /** Solution serial number, e.g. `1-TST|2-TST|3-<uuid>`. */
  serialNumber: string
  /** 15-digit VAT registration number (starts and ends with 3). */
  uid: string
  /** 4-char TSCZ document-type code, e.g. "1100" (standard + simplified). */
  title: string
  /** Branch/registered address. */
  registeredAddress: string
  /** Industry / business category. */
  businessCategory: string
  /**
   * ZATCA code-signing template for the target environment. Each environment
   * requires its own template name in the CSR's certificateTemplateName
   * extension (confirmed live against the sandbox + Fatoora community):
   * sandbox → TSTZATCA-Code-Signing, simulation → PREZATCA-Code-Signing,
   * production → ZATCA-Code-Signing. Defaults to the simulation template
   * (the pre-production default).
   */
  certificateTemplate?: string
}

/**
 * Build a PKCS#10 certificate-signing request matching the ZATCA subject
 * structure (Microsoft's official onboarding script csr_config.txt):
 * subject C/OU/O/CN + subjectAltName dirName with SN, UID, title,
 * registeredAddress, businessCategory, plus basicConstraints + keyUsage.
 *
 * Uses jsrsasign (pure JS, secp256k1 capable). Returns the Base64 CSR string
 * ready to POST in the compliance request body.
 */
export function buildZatcaCsr(input: ZatcaCsrInput, keyPair: ZatcaKeyPair): string {
  // jsrsasign maps the well-known X.500 names itself; the two ZATCA-specific
  // OIDs (registeredAddress 2.5.4.26, businessCategory 2.5.4.15) are passed
  // as explicit OIDs because jsrsasign has no friendly name for them.
  // The @types/jsrsasign `newCSRPEM` param type predates the `extreq`
  // shape (it only models `ext.subjectAltName.dns`); the runtime supports the
  // extname/array form we use for ZATCA. Cast through a minimal structural
  // type so the extension request (basicConstraints/keyUsage/subjectAltName
  // with the dirName SAN) is passed through exactly.
  const csrParam = {
    subject: {
      C: input.country,
      OU: input.organizationUnit,
      O: input.organization,
      CN: input.commonName,
    },
    sbjprvkey: keyPair.privateKeyPem,
    sbjpubkey: keyPair.publicKeyPem,
    sigalg: "SHA256withECDSA",
    extreq: [
      { extname: "basicConstraints", cA: false },
      { extname: "keyUsage", critical: true, names: ["digitalSignature", "nonRepudiation", "keyEncipherment"] },
      {
        extname: "subjectAltName",
        array: [
          {
            dn: {
              C: input.country,
              SN: input.serialNumber,
              UID: input.uid,
              title: input.title,
              "2.5.4.26": input.registeredAddress,
              "2.5.4.15": input.businessCategory,
            },
          },
        ],
      },
      // ZATCA's mandatory code-signing certificate template — the sandbox and
      // simulation reject CSRs without it (Microsoft onboarding guide's
      // `certificateTemplateName: ASN1:PRINTABLESTRING:PREZATCA-Code-Signing`;
      // confirmed live: the sandbox returned "Invalid Request" before this
      // extension was added). Emitted as a private extension with the
      // Microsoft certificate-template OID 1.3.6.1.4.1.311.20.2. The template
      // VALUE is environment-specific (TSTZATCA/PREZATCA/ZATCA) — see
      // ZATCA_CERT_TEMPLATES.
      { extname: "1.3.6.1.4.1.311.20.2", extn: { prnstr: input.certificateTemplate ?? ZATCA_CERT_TEMPLATES.simulation } },
    ],
  }
  const csrPem = KJUR.asn1.csr.CSRUtil.newCSRPEM(csrParam as Parameters<typeof KJUR.asn1.csr.CSRUtil.newCSRPEM>[0])

  // Return the Base64 DER body (the request payload ZATCA expects) — the PEM
  // armor + headers stripped.
  return pemToBase64Body(csrPem)
}

/**
 * Strip PEM armor (BEGIN/END lines) and return the raw Base64 body.
 * jsrsasign's CSR PEM is `-----BEGIN CERTIFICATE REQUEST-----` … — we only
 * want the Base64 payload for the API body.
 */
export function pemToBase64Body(pem: string): string {
  return pem
    .split("\n")
    .filter((l) => l && !l.startsWith("-----"))
    .join("")
    .trim()
}

export interface ParsedZatcaCsr {
  subject: { str: string }
  extreq?: { extname: string; array?: { dn?: { str: string } }[] }[]
}

/** Decode a CSR back to its param structure — used by tests to assert subject/SAN. */
export function parseZatcaCsr(csrBase64: string): ParsedZatcaCsr {
  const pem = `-----BEGIN CERTIFICATE REQUEST-----\n${csrBase64}\n-----END CERTIFICATE REQUEST-----`
  return KJUR.asn1.csr.CSRUtil.getParam(pem) as unknown as ParsedZatcaCsr
}
