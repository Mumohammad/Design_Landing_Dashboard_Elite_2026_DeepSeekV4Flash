// ZATCA cryptographic primitives, not a complete XAdES signer.
// Invoice hashing uses the restricted, SDK-tested UBL canonicalization profile.
// A primitive ECDSA round trip is not an official stamp or authority acceptance.

import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto"
import { KJUR } from "jsrsasign"
import { canonicalizeZatcaInvoice } from "./zatca-canonical"

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
 * Base64 SHA-256 after ZATCA exclusions and restricted canonicalization.
 * Rejects unsupported XML; callers must preserve issuance bytes and metadata.
 */
export function computeInvoiceHash(xml: string): string {
  return createHash(ZATCA_HASH).update(canonicalizeZatcaInvoice(xml), "utf8").digest("base64")
}

/** Initial PIH matching the supplied ZATCA SDK's Data/PIH/pih.txt fixture. */
export function genesisPiH(): string {
  return Buffer.from(createHash(ZATCA_HASH).update("0", "utf8").digest("hex"), "utf8").toString("base64")
}

/**
 * The Previous Invoice Hash for an invoice that follows `prevInvoiceHash`.
 * Copy the previous canonical invoice digest, never hash that digest again.
 */
export function computePiH(prevInvoiceHash: string): string {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(prevInvoiceHash) || Buffer.from(prevInvoiceHash, "base64").toString("base64") !== prevInvoiceHash) {
    throw new Error("Previous invoice hash must be a Base64 SHA-256 digest")
  }
  return prevInvoiceHash
}

// ── Digital signature ───────────────────────────────────────────────────────

/**
 * Digest input observed in the supplied SDK 3.0.8 demonstration signature.
 * This is NOT a complete XMLDSig/XAdES construction: the published standard
 * also requires SignedInfo and SignedProperties. That discrepancy must be
 * resolved before an application signer can be connected to submissions.
 */
export function buildSigningInput(invoiceHashBase64: string): Buffer {
  return Buffer.from(computePiH(invoiceHashBase64), "base64")
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
  // Structure mirrors the official ZATCA SDK 3.4.8 `-csr` output, which the
  // developer-portal sandbox accepts (verified live 2026-10-28): subject
  // C (PrintableString), OU, O, CN (UTF8String); extension request with only
  // the certificate-template extension (UTF8String) and a dirName SAN holding
  // SN (2.5.4.4), UID (0.9.2342.19200300.100.1.1), title (2.5.4.12),
  // registeredAddress (2.5.4.26) and businessCategory (2.5.4.15), all UTF8.
  // basicConstraints/keyUsage and a SAN country made the sandbox answer
  // "Invalid Request".
  const utf8 = (type: string, value: string) => [{ type, value, ds: "utf8" }]
  const csrParam = {
    subject: {
      array: [
        [{ type: "C", value: input.country, ds: "prn" }],
        utf8("OU", input.organizationUnit),
        utf8("O", input.organization),
        utf8("CN", input.commonName),
      ],
    },
    sbjprvkey: keyPair.privateKeyPem,
    sbjpubkey: keyPair.publicKeyPem,
    sigalg: "SHA256withECDSA",
    extreq: [
      { extname: "1.3.6.1.4.1.311.20.2", extn: { utf8str: input.certificateTemplate ?? ZATCA_CERT_TEMPLATES.simulation } },
      {
        extname: "subjectAltName",
        array: [
          {
            dn: {
              array: [
                utf8("2.5.4.4", input.serialNumber),
                utf8("0.9.2342.19200300.100.1.1", input.uid),
                utf8("2.5.4.12", input.title),
                utf8("2.5.4.26", input.registeredAddress),
                utf8("2.5.4.15", input.businessCategory),
              ],
            },
          },
        ],
      },
    ],
  }
  const csrPem = KJUR.asn1.csr.CSRUtil.newCSRPEM(csrParam as unknown as Parameters<typeof KJUR.asn1.csr.CSRUtil.newCSRPEM>[0])

  // Return the Base64 DER body (PEM armor stripped). The HTTP request payload
  // is built from it by `zatcaCsrRequestPayload` (base64 of the PEM text).
  return pemToBase64Body(csrPem)
}

/**
 * Strip PEM armor (BEGIN/END lines) and return the raw Base64 body.
 * jsrsasign's CSR PEM is `-----BEGIN CERTIFICATE REQUEST-----` … — we only
 * want the Base64 payload for the API body.
 */
/**
 * The compliance API's `csr` field is Base64 of the PEM text (as produced by
 * the official SDK), not the bare DER Base64 body.
 */
export function zatcaCsrRequestPayload(derBase64: string): string {
  const pem = `-----BEGIN CERTIFICATE REQUEST-----\n${derBase64.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END CERTIFICATE REQUEST-----\n`
  return Buffer.from(pem, "utf8").toString("base64")
}

export function pemToBase64Body(pem: string): string {
  return pem
    .split(/\r?\n/)
    .map((l) => l.trim())
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
