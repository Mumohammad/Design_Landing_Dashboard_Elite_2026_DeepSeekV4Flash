// ZATCA production-prep — onboarding transport (Financial Phase 18).
//
// Implements the two-step CSID onboarding flow documented by Microsoft's
// official Dynamics 365 integration guide:
//
//   1. Compliance CSID (CCSID):  POST {base}/compliance with { csr } +
//      headers OTP + Accept-Version: V2  →  { binarySecurityToken, secret,
//      requestID }. The CSID cert (base64) + secret are stored for later.
//   2. Production CSID (PCSID):  POST {base}/production/csids with
//      { compliance_request_id } + Authorization: Basic base64(csid:secret)
//      →  { binarySecurityToken, secret }.
//
// Like the transmission transport, this is config-gated: without
// ZATCA_API_BASE_URL it returns a sandbox mock so the seam is exercisable
// offline. NEVER points at the live ZATCA environment without real
// credentials (ZATCA-BOUNDARY.md §1/§5).
//
// Auth model (documented by the Qoyod sandbox guide + Fatoora community):
// the compliance step authenticates with the OTP header ONLY; the
// production-CSID step uses Basic auth built from the compliance CSID
// certificate + secret; the reporting/clearance APIs (zatca-transport.ts)
// use Basic auth from the PRODUCTION CSID certificate + secret. No Bearer
// API key anywhere.
//
// No ZATCA compliance is claimed (ZATCA-BOUNDARY.md §5).

export type CsidKind = "compliance" | "production"

export interface ComplianceCsidResponse {
  /** Base64 X.509 CSID certificate (binarySecurityToken). */
  csidBase64: string
  /** CSID secret — used with the cert for Basic auth + production requests. */
  secret: string
  /** Request ID — required for the production-CSID step. */
  requestId: string
  sandbox: boolean
}

export interface ProductionCsidResponse {
  /** Base64 X.509 production CSID certificate. */
  csidBase64: string
  /** Production CSID secret. */
  secret: string
  sandbox: boolean
}

function isOnboardingConfigured(): boolean {
  return Boolean(process.env.ZATCA_API_BASE_URL)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

/**
 * Step 1 — request the Compliance CSID (CCSID).
 * Real path (env-configured): POST {base}/compliance with the CSR body and
 * the OTP header from the Fatoora portal. Sandbox: deterministic mock.
 */
export async function requestComplianceCsid(input: {
  csr: string
  otp: string
}): Promise<ComplianceCsidResponse> {
  const base = process.env.ZATCA_API_BASE_URL?.replace(/\/$/, "")

  if (base && isOnboardingConfigured()) {
    const res = await fetch(`${base}/compliance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Version": "V2",
        OTP: input.otp,
      },
      body: JSON.stringify({ csr: input.csr }),
    })
    if (!res.ok) {
      throw new Error(`ZATCA onboarding error ${res.status}: ${await res.text()}`)
    }
    const raw = (await res.json()) as Record<string, unknown>
    const csidBase64 = String(raw.binarySecurityToken ?? "")
    const secret = String(raw.secret ?? "")
    const requestId = String(raw.requestID ?? "")
    if (!csidBase64 || !secret || !requestId) {
      throw new Error("ZATCA onboarding error: response missing binarySecurityToken/secret/requestID")
    }
    return { csidBase64, secret, requestId, sandbox: false }
  }

  // ── Sandbox mock ──────────────────────────────────────────────────────
  // Deterministic per CSR so onboarding retries are stable offline.
  let h = 0x811c9dc5
  for (let i = 0; i < input.csr.length; i++) {
    h ^= input.csr.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const digest = (h >>> 0).toString(16).padStart(8, "0")
  return {
    csidBase64: Buffer.from(`-----BEGIN CERTIFICATE-----\nMOCK-CSID-${digest}\n-----END CERTIFICATE-----`).toString("base64"),
    secret: `mock-secret-${digest}`,
    requestId: `mock-request-${digest}`,
    sandbox: true,
  }
}

/**
 * Step 2 — request the Production CSID (PCSID).
 * Real path: POST {base}/production/csids with { compliance_request_id } and
 * Basic auth from the compliance CSID cert + secret. Sandbox: deterministic.
 */
export async function requestProductionCsid(input: {
  complianceRequestId: string
  csidBase64: string
  csidSecret: string
}): Promise<ProductionCsidResponse> {
  const base = process.env.ZATCA_API_BASE_URL?.replace(/\/$/, "")

  if (base && isOnboardingConfigured()) {
    const auth = Buffer.from(`${input.csidBase64}:${input.csidSecret}`).toString("base64")
    const res = await fetch(`${base}/production/csids`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Version": "V2",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ compliance_request_id: input.complianceRequestId }),
    })
    if (!res.ok) {
      throw new Error(`ZATCA onboarding error ${res.status}: ${await res.text()}`)
    }
    const raw = (await res.json()) as Record<string, unknown>
    const csidBase64 = String(raw.binarySecurityToken ?? "")
    const secret = String(raw.secret ?? "")
    if (!csidBase64 || !secret) {
      throw new Error("ZATCA onboarding error: response missing binarySecurityToken/secret")
    }
    return { csidBase64, secret, sandbox: false }
  }

  let h = 0x811c9dc5
  for (let i = 0; i < input.complianceRequestId.length; i++) {
    h ^= input.complianceRequestId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const digest = (h >>> 0).toString(16).padStart(8, "0")
  return {
    csidBase64: Buffer.from(`-----BEGIN CERTIFICATE-----\nMOCK-PCSID-${digest}\n-----END CERTIFICATE-----`).toString("base64"),
    secret: `mock-secret-${digest}`,
    sandbox: true,
  }
}

export { errorMessage }
