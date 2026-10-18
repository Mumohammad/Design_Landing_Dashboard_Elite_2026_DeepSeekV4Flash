// Offline development mock. Real invoice submission is blocked independently
// of the application integration gate until the complete signer/API is tested.
import { moduleLogger } from "@/lib/logger"
import { getZatcaNetworkBase } from "./zatca-config"

export type ZatcaTransmissionStatus = "reported" | "cleared" | "rejected"

export interface ZatcaTransportResponse {
  uuid: string
  status: ZatcaTransmissionStatus
  receivedAt: string
  /** Mock envelope only; never authority acceptance. */
  raw: Record<string, unknown>
}

export interface ZatcaTransmitInput {
  xml: string
  /** Simplified: reporting. Standard: clearance. */
  pipeline: "reporting" | "clearance"
  docRef: string
  /** Reserved for the future validated, certificate-bound transport. */
  credentials?: {
    csidBase64: string
    secret: string
    privateKeyPem?: string | null
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

export async function transmitToZatca(input: ZatcaTransmitInput): Promise<ZatcaTransportResponse> {
  // Invalid gateway configuration must throw, never become simulated success.
  const base = getZatcaNetworkBase()
  if (base) {
    // The removed path silently returned unsigned XML without its placeholder,
    // posted XML instead of JSON and guessed acceptance from HTTP 2xx.
    throw new Error("ZATCA invoice submission is unavailable: certificate-bound XAdES signing and official API validation are incomplete.")
  }

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

/** Invalid/network configuration is never described as an offline mock. */
export function isSandboxTransport(): boolean {
  return (process.env.ZATCA_MODE ?? "mock") === "mock" && !process.env.ZATCA_API_BASE_URL
}

export const _sandboxUuid = sandboxUuid
