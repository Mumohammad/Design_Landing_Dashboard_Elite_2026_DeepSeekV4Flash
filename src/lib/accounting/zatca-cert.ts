// CSID certificate helpers shared by onboarding, submission and checks.
import { X509Certificate } from "node:crypto"
import { ZatcaSigningError } from "./zatca-signer"

/**
 * ZATCA's binarySecurityToken is Base64 of the certificate's Base64 text;
 * older/mock tokens may already be the DER Base64. Returns the DER Base64.
 */
export function certificateFromToken(token: string): string {
  const decoded = Buffer.from(token, "base64").toString("utf8").replace(/-----[^-]+-----|\s/g, "")
  for (const candidate of [decoded, token]) {
    try {
      new X509Certificate(Buffer.from(candidate, "base64"))
      return candidate
    } catch {
      /* try the next encoding */
    }
  }
  throw new ZatcaSigningError("CERTIFICATE")
}

/** Validity window of a CSID token as ISO timestamps, or null for mock tokens. */
export function certificateValidity(token: string): { validFrom: string; validTo: string } | null {
  try {
    const cert = new X509Certificate(Buffer.from(certificateFromToken(token), "base64"))
    return { validFrom: new Date(cert.validFrom).toISOString(), validTo: new Date(cert.validTo).toISOString() }
  } catch {
    return null
  }
}

/** Days until expiry (negative when expired), or null when unknown. */
export function daysUntil(isoDate: string | null | undefined, now = Date.now()): number | null {
  const t = isoDate ? Date.parse(isoDate) : NaN
  return Number.isFinite(t) ? Math.floor((t - now) / 86_400_000) : null
}
