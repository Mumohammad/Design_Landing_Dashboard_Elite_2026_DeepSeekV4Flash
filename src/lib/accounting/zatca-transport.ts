// ZATCA development transport. Offline mock is the default; real non-production
// networking requires an explicit mode and an allowlisted official gateway.
// Production is blocked while XML/signing/SDK validation remains incomplete.
// Standard tax invoices use clearance; simplified tax invoices use reporting.
// The current builder/adapter does not yet implement the full Phase 2 contract.
// Mock responses are NOT authority validation or evidence of compliance.

import { computeInvoiceHash, signZatcaPayload, buildSigningInput } from "./zatca-crypto"
import { moduleLogger } from "@/lib/logger"
import { getZatcaNetworkBase } from "./zatca-config"

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
  /** Simplified invoices: reporting. Standard tax invoices: clearance. */
  pipeline: "reporting" | "clearance"
  /** Human document ref (invoice number etc.) — used for logging. */
  docRef: string
  /**
   * Optional explicit environment-specific CSID credentials (from the DB store via
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
 * Unvalidated signing seam: the transport uses the current UTC time so re-running
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
 * Offline mode simulates a response. Non-production HTTP plumbing is available
 * for development, but does not establish the full official integration contract.
 */
/** Sleep helper for retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Determine if an HTTP status is transient (retryable).
 * 429 (rate limit), 502/503/504 (gateway) are retryable.
 * 400/401/403 are permanent failures — no retry.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504
}

/** Maximum number of transmission retries for transient errors. */
const MAX_RETRIES = 2

export async function transmitToZatca(input: ZatcaTransmitInput): Promise<ZatcaTransportResponse> {
  const log = moduleLogger("zatca")
  // A URL or stored credential never activates networking on its own.
  const base = getZatcaNetworkBase()
  const credentials = resolveCredentials(input)
  if (base && !credentials) throw new Error("ZATCA gateway credentials are missing; refusing simulated success.")
  if (credentials && base) {
    // Non-production gateway path (not yet SDK/sandbox validated).
    // ZATCA REQUIREMENT: every production transmission MUST be signed with
    // a valid CSID private key. Transmitting unsigned XML to the live API
    // would be rejected by ZATCA and could flag the tenant's CSID. Fail
    // closed — never silently post unsigned payloads.
    const signingKey = credentials.privateKeyPem || process.env.ZATCA_CSID_PRIVATE_KEY
    if (!signingKey) {
      const msg = "ZATCA production mode requires a signing private key (ZATCA_CSID_PRIVATE_KEY or per-tenant CSID key). Refusing to transmit unsigned XML."
      log.error({ docRef: input.docRef }, msg)
      throw new Error(msg)
    }
    const signedXml = signXmlIfConfigured(input.xml, credentials.privateKeyPem)
    const endpoint = input.pipeline === "clearance"
      ? "/invoices/clearance/single"
      : "/invoices/reporting/single"
    // Official security standard, section 5: certificate/secret Basic auth.
    const basicAuth = Buffer.from(`${credentials.csidBase64}:${credentials.secret}`).toString("base64")

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s…
        await sleep(1000 * Math.pow(2, attempt - 1))
      }

      try {
        const res = await fetch(`${base}${endpoint}`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          headers: {
            "Content-Type": "application/xml",
            Authorization: `Basic ${basicAuth}`,
          },
          body: signedXml,
        })

        if (res.ok) {
          const raw: Record<string, unknown> = await res.json()
          const uuid = String(raw.uuid ?? raw.reportedInvoiceUuid ?? "")
          const status: ZatcaTransmissionStatus = input.pipeline === "clearance" ? "cleared" : "reported"
          log.info({ uuid, status, pipeline: input.pipeline }, "ZATCA transmission succeeded")
          return { uuid, status, receivedAt: new Date().toISOString(), raw }
        }

        const errorBody = await res.text()
        // Never log/propagate a gateway body: it may echo a certificate,
        // credential, invoice PII or other sensitive request fields.
        void errorBody
        log.warn({ status: res.status, attempt: attempt + 1 }, "ZATCA transport error")
        lastError = new Error(`ZATCA transport error ${res.status}`)

        // Retry only on transient errors (429, 502, 503, 504)
        if (!isRetryableStatus(res.status)) {
          throw lastError
        }
      } catch (e) {
        // Network errors are always retryable
        if (e instanceof TypeError && attempt < MAX_RETRIES) {
          lastError = e as Error
          continue
        }
        throw e
      }
    }

    // All retries exhausted
    throw lastError ?? new Error("ZATCA transport: all retries exhausted")
  }

  // ── SANDBOX mock ───────────────────────────────────────────────────────
  // Offline responses exercise application plumbing only.
  log.debug({ pipeline: input.pipeline }, "ZATCA sandbox mode — mock response")
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
      validationResults: { status: "NOT_VALIDATED", warnings: [] },
      message: "Sandbox ZATCA response — no real transmission occurred",
    },
  }
}

/** True when running against the sandbox mock (no ZATCA env configured). */
export function isSandboxTransport(): boolean {
  return !process.env.ZATCA_API_BASE_URL
}

/** Not needed for sandbox, but exported so callers can't guess UUIDs. */
export const _sandboxUuid = sandboxUuid
