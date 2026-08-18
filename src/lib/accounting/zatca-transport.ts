// Financial Phase 15 — ZATCA transport (pluggable).
//
// The adapter transforms finalized invoices into UBL 2.1 XML and hands the
// payload to this transport. Two modes:
//
//   SANDBOX (default, no env) — simulates a ZATCA response: a UUID and a
//   status (Reported for standard invoices, Cleared for simplified B2C).
//   Deterministic per document so tests and demos are stable.
//
//   PRODUCTION (config-only) — when ZATCA_API_BASE_URL + the production CSID
//   credentials (ZATCA_CSID_CERT + ZATCA_CSID_SECRET, returned by the
//   onboarding production-CSID step) are set, POSTs the payload to the ZATCA
//   reporting/clearance endpoint with **Basic auth** (certificate:secret —
//   the documented ZATCA reporting auth, confirmed by the Qoyod sandbox guide
//   and the Fatoora developer community; the reporting API does NOT use a
//   Bearer API key). When a signing private key (ZATCA_CSID_PRIVATE_KEY) is
//   also configured, the payload is cryptographically signed first
//   (zatca-crypto.ts) and the signature block is injected into the XML before
//   POST. This path is intentionally NOT exercised against the live API yet:
//   real ZATCA integration needs production credentials, onboarding
//   certificates, and sandbox validation of the signing seam
//   (ZATCA-BOUNDARY.md §1) — all future work. The seam exists so nothing in
//   the engines changes when it lands.
//
// No ZATCA compliance is claimed (ZATCA-BOUNDARY.md §5).

import { computeInvoiceHash, signZatcaPayload, buildSigningInput } from "./zatca-crypto"

export type ZatcaTransmissionStatus = "reported" | "cleared" | "rejected"

export interface ZatcaTransportResponse {
  /** ZATCA response UUID (mock uuid in sandbox mode). */
  uuid: string
  status: ZatcaTransmissionStatus
  /** ISO timestamp the response was received. */
  receivedAt: string
  /** Full raw response (mock envelope in sandbox mode). */
  raw: Record<string, unknown>
}

export interface ZatcaTransmitInput {
  /** UBL 2.1 payload built by zatca-ubl.ts. */
  xml: string
  /** Which ZATCA pipeline: reporting (standard/compliance) vs clearance. */
  pipeline: "reporting" | "clearance"
  /** Human document ref (invoice number etc.) — used for logging. */
  docRef: string
  /**
   * Optional explicit production-CSID credentials (from the DB store via
   * getZatcaCsidCredential). When provided, the transport uses them for the
   * Basic auth header REGARDLESS of env. When absent, it falls back to the
   * env vars (ZATCA_CSID_CERT / ZATCA_CSID_SECRET). This lets the adapter
   * authenticate with the tenant's stored CSID while keeping the env path
   * for simple/self-hosted setups.
   */
  credentials?: {
    csidBase64: string
    secret: string
    /** PKCS#8 PEM signing key bound to the CSID cert (per-tenant signing). */
    privateKeyPem?: string | null
  }
}

/**
 * If a CSID private key is configured (ZATCA_CSID_PRIVATE_KEY), sign the
 * payload and return the signed XML with the `ds:SignatureValue` injected;
 * otherwise return the payload unchanged (sandbox/demo mode).
 *
 * Signing-time seam: the transport uses the current UTC time so re-running
 * the adapter for the same doc yields a different (valid) signature per
 * signing time — matching the XAdES-B-B model. The exact injection point and
 * signing-input layout MUST be validated against the ZATCA sandbox before
 * production use (ZATCA-BOUNDARY.md §1).
 */
function signXmlIfConfigured(xml: string, privateKeyPem?: string | null): string {
  const key = privateKeyPem || process.env.ZATCA_CSID_PRIVATE_KEY
  if (!key) return xml

  const invoiceHash = computeInvoiceHash(xml)
  const signingTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  const input = buildSigningInput(invoiceHash, signingTime)
  const signatureBase64 = signZatcaPayload(input, key)

  // Inject the ECDSA signature into the UBL `cac:Signature` block.
  // The UBL builder emits a `<ds:SignatureValue></ds:SignatureValue>`
  // placeholder for exactly this purpose (see zatca-ubl.ts).
  return xml.includes("<ds:SignatureValue></ds:SignatureValue>")
    ? xml.replace("<ds:SignatureValue></ds:SignatureValue>", `<ds:SignatureValue>${signatureBase64}</ds:SignatureValue>`)
    : xml
}

const SANDBOX_UUID_PREFIX = "00000000-0000-4000-8000-"

function isProdConfigured(): boolean {
  // Production requires the gateway base URL AND the production CSID
  // credentials (certificate + secret) that onboarding returns. Partial
  // config keeps the transport in sandbox mode so a half-finished setup
  // cannot silently transmit.
  return Boolean(
    process.env.ZATCA_API_BASE_URL &&
      process.env.ZATCA_CSID_CERT &&
      process.env.ZATCA_CSID_SECRET
  )
}

/**
 * Resolve the effective production credentials: explicit (DB-backed) first,
 * env fallback second, null when neither is fully configured.
 */
function resolveCredentials(
  input: ZatcaTransmitInput
): { csidBase64: string; secret: string; privateKeyPem?: string | null } | null {
  if (input.credentials?.csidBase64 && input.credentials?.secret) {
    return input.credentials
  }
  if (process.env.ZATCA_CSID_CERT && process.env.ZATCA_CSID_SECRET) {
    return { csidBase64: process.env.ZATCA_CSID_CERT, secret: process.env.ZATCA_CSID_SECRET }
  }
  return null
}

/** Build a deterministic sandbox UUID from the doc ref (stable per document). */
function sandboxUuid(docRef: string): string {
  // FNV-1a 32-bit hash → 12 hex chars, stable across runs.
  let h = 0x811c9dc5
  for (let i = 0; i < docRef.length; i++) {
    h ^= docRef.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return SANDBOX_UUID_PREFIX + (h >>> 0).toString(16).padStart(12, "0")
}

/**
 * Transmit a UBL 2.1 payload to ZATCA.
 * Sandbox mode simulates the response; production mode (env-configured)
 * POSTs to the real API — currently documented but not exercised.
 */
export async function transmitToZatca(input: ZatcaTransmitInput): Promise<ZatcaTransportResponse> {
  // Explicit credentials (DB-backed) can activate production even without
  // env; otherwise env must be fully configured. Either way the gateway base
  // is required.
  const credentials = resolveCredentials(input)
  if (credentials && process.env.ZATCA_API_BASE_URL) {
    // ── PRODUCTION (config-only, not exercised against the live API) ─────
    const signedXml = signXmlIfConfigured(input.xml, credentials.privateKeyPem)
    const base = process.env.ZATCA_API_BASE_URL.replace(/\/$/, "")
    const endpoint = input.pipeline === "clearance"
      ? "/invoices/clearance/single"
      : "/invoices/reporting/single"
    // ZATCA reporting/clearance auth is Basic with the PRODUCTION CSID
    // certificate (binarySecurityToken) as username and the CSID secret as
    // password (Qoyod sandbox guide + Fatoora community: "the username will
    // be the binarysecuritytoken and the password will be the secret").
    const basicAuth = Buffer.from(`${credentials.csidBase64}:${credentials.secret}`).toString("base64")
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Authorization: `Basic ${basicAuth}`,
      },
      body: signedXml,
    })
    if (!res.ok) {
      throw new Error(`ZATCA transport error ${res.status}: ${await res.text()}`)
    }
    const raw: Record<string, unknown> = await res.json()
    const uuid = String(raw.uuid ?? raw.reportedInvoiceUuid ?? "")
    const status: ZatcaTransmissionStatus = input.pipeline === "clearance" ? "cleared" : "reported"
    return { uuid, status, receivedAt: new Date().toISOString(), raw }
  }

  // ── SANDBOX mock ───────────────────────────────────────────────────────
  // Standard invoices are "reported" (compliance); simplified B2C invoices
  // would be "cleared" — we don't model B2C yet, so pipeline is always
  // reporting from the app. A stable UUID per doc keeps replays identical.
  const status: ZatcaTransmissionStatus = input.pipeline === "clearance" ? "cleared" : "reported"
  return {
    uuid: sandboxUuid(input.docRef),
    status,
    receivedAt: new Date().toISOString(),
    raw: {
      sandbox: true,
      pipeline: input.pipeline,
      status,
      reportedInvoiceUuid: sandboxUuid(input.docRef),
      validationResults: { status: "PASSED", warnings: [] },
      message: "Sandbox ZATCA response — no real transmission occurred",
    },
  }
}

/** True when running against the sandbox mock (no ZATCA env configured). */
export function isSandboxTransport(): boolean {
  return !isProdConfigured()
}

/** Not needed for sandbox, but exported so callers can't guess UUIDs. */
export const _sandboxUuid = sandboxUuid
