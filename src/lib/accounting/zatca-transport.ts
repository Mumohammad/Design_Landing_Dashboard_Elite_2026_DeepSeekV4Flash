// ZATCA invoice transport.
//
// * mock (default): offline development envelope, never authority acceptance.
// * sandbox / simulation: the official Fatoora gateway, only for documents
//   stamped by zatca-signer.ts and only with CSID credentials. The JSON
//   envelope is { invoiceHash, uuid, invoice: Base64(signed XML) } with
//   Basic auth base64(binarySecurityToken:secret) and Accept-Version: V2.
//   Status comes from the body (reportingStatus / clearanceStatus), never
//   from the HTTP code alone.
// * production: blocked in zatca-config.ts.
import { moduleLogger } from "@/lib/logger"
import { getZatcaNetworkBase } from "./zatca-config"

export type ZatcaTransmissionStatus = "reported" | "cleared" | "rejected"
export type ZatcaPipeline = "reporting" | "clearance" | "compliance"

export interface ZatcaValidationMessage {
  type?: string
  code?: string
  category?: string
  message?: string
  status?: string
}

export interface ZatcaTransportResponse {
  uuid: string
  status: ZatcaTransmissionStatus
  receivedAt: string
  /** Sanitised authority response (validation results and statuses only). */
  raw: Record<string, unknown>
  /** Base64 cleared invoice returned by the clearance API. */
  clearedInvoice?: string
}

export interface ZatcaTransmitInput {
  /** Signed XML (network) or unsigned development XML (mock only). */
  xml: string
  /** Simplified: reporting. Standard: clearance. Onboarding: compliance. */
  pipeline: ZatcaPipeline
  docRef: string
  /** Required by the gateway: the stamped invoice hash and document UUID. */
  invoiceHash?: string
  uuid?: string
  credentials?: {
    csidBase64: string
    secret: string
    privateKeyPem?: string | null
  }
  /** Test seam; defaults to 30 seconds. */
  timeoutMs?: number
}

export class ZatcaTransportError extends Error {
  constructor(readonly code: "NOT_SIGNED" | "CREDENTIALS" | "NETWORK" | "UNAUTHORIZED" | "SERVER" | "PROTOCOL" | "INPUT", readonly httpStatus?: number) {
    super(`ZATCA submission failed: ${code}${httpStatus ? ` (HTTP ${httpStatus})` : ""}`)
  }
}

/** Stable development identifier, not an authority UUID or real idempotency key. */
function sandboxUuid(docRef: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < docRef.length; i++) {
    h ^= docRef.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return "00000000-0000-4000-8000-" + (h >>> 0).toString(16).padStart(12, "0")
}

const PATHS: Record<ZatcaPipeline, string> = {
  reporting: "/invoices/reporting/single",
  clearance: "/invoices/clearance/single",
  compliance: "/compliance/invoices",
}

function messages(value: unknown): ZatcaValidationMessage[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).map((m) => {
    const r = (m ?? {}) as Record<string, unknown>
    const pick = (k: string) => (typeof r[k] === "string" ? String(r[k]).slice(0, 500) : undefined)
    return { type: pick("type"), code: pick("code"), category: pick("category"), message: pick("message"), status: pick("status") }
  })
}

/** Keeps only non-sensitive fields of the gateway body. */
export function sanitizeZatcaResponse(body: Record<string, unknown>): Record<string, unknown> {
  const v = (body.validationResults ?? {}) as Record<string, unknown>
  return {
    sandbox: false,
    validationResults: {
      status: typeof v.status === "string" ? v.status : "UNKNOWN",
      infoMessages: messages(v.infoMessages),
      warningMessages: messages(v.warningMessages),
      errorMessages: messages(v.errorMessages),
    },
    reportingStatus: typeof body.reportingStatus === "string" ? body.reportingStatus : null,
    clearanceStatus: typeof body.clearanceStatus === "string" ? body.clearanceStatus : null,
    qrSellertStatus: typeof body.qrSellertStatus === "string" ? body.qrSellertStatus : null,
    qrBuyertStatus: typeof body.qrBuyertStatus === "string" ? body.qrBuyertStatus : null,
  }
}

/** Maps the authority body to our status. Unknown shapes are rejections. */
export function zatcaStatusFromBody(pipeline: ZatcaPipeline, body: Record<string, unknown>): ZatcaTransmissionStatus {
  const validation = ((body.validationResults ?? {}) as Record<string, unknown>).status
  if (validation === "ERROR") return "rejected"
  if (pipeline === "reporting") return body.reportingStatus === "REPORTED" ? "reported" : "rejected"
  if (pipeline === "clearance") return body.clearanceStatus === "CLEARED" ? "cleared" : "rejected"
  // Compliance checks echo whichever status applies to the document kind.
  if (body.clearanceStatus === "CLEARED") return "cleared"
  if (body.reportingStatus === "REPORTED") return "reported"
  return "rejected"
}

export async function transmitToZatca(input: ZatcaTransmitInput): Promise<ZatcaTransportResponse> {
  // Invalid gateway configuration must throw, never become simulated success.
  const base = getZatcaNetworkBase()
  if (!base) {
    if (input.pipeline === "compliance") throw new ZatcaTransportError("INPUT")
    const log = moduleLogger("zatca")
    log.debug({ pipeline: input.pipeline }, "ZATCA offline mock — no authority submission")
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

  // Only a stamped document with its hash and UUID may leave the server.
  if (!input.xml.includes("<ext:UBLExtensions") || !input.xml.includes("<ds:SignatureValue>") ||
      !/^[A-Za-z0-9+/]{43}=$/.test(input.invoiceHash ?? "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.uuid ?? "")) {
    throw new ZatcaTransportError("NOT_SIGNED")
  }
  const credentials = input.credentials
  if (!credentials?.csidBase64 || !credentials.secret) throw new ZatcaTransportError("CREDENTIALS")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000)
  let response: Response
  try {
    response = await fetch(`${base}${PATHS[input.pipeline]}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "en",
        "Accept-Version": "V2",
        Authorization: `Basic ${Buffer.from(`${credentials.csidBase64}:${credentials.secret}`, "utf8").toString("base64")}`,
        ...(input.pipeline === "compliance" ? {} : { "Clearance-Status": input.pipeline === "clearance" ? "1" : "0" }),
      },
      body: JSON.stringify({
        invoiceHash: input.invoiceHash,
        uuid: input.uuid,
        invoice: Buffer.from(input.xml, "utf8").toString("base64"),
      }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    })
  } catch {
    throw new ZatcaTransportError("NETWORK")
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 401 || response.status === 403) throw new ZatcaTransportError("UNAUTHORIZED", response.status)
  if (response.status >= 500 || response.status === 429) throw new ZatcaTransportError("SERVER", response.status)
  let body: Record<string, unknown>
  try {
    const parsed = (await response.json()) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
    body = parsed as Record<string, unknown>
  } catch {
    // Never echo the body: it may contain invoice or credential data.
    throw new ZatcaTransportError("PROTOCOL", response.status)
  }
  // 200 = accepted, 202 = accepted with warnings, 400 = rejected,
  // 409 = already submitted (status in body). Anything else is a protocol fault.
  if (![200, 202, 400, 409].includes(response.status)) throw new ZatcaTransportError("PROTOCOL", response.status)

  const status = zatcaStatusFromBody(input.pipeline, body)
  const cleared = typeof body.clearedInvoice === "string" && /^[A-Za-z0-9+/=]+$/.test(body.clearedInvoice) ? body.clearedInvoice : undefined
  return {
    uuid: input.uuid!,
    status,
    receivedAt: new Date().toISOString(),
    raw: { ...sanitizeZatcaResponse(body), pipeline: input.pipeline, httpStatus: response.status },
    ...(status === "cleared" && cleared ? { clearedInvoice: cleared } : {}),
  }
}

/** Invalid/network configuration is never described as an offline mock. */
export function isSandboxTransport(): boolean {
  return (process.env.ZATCA_MODE ?? "mock") === "mock" && !process.env.ZATCA_API_BASE_URL
}

export const _sandboxUuid = sandboxUuid
