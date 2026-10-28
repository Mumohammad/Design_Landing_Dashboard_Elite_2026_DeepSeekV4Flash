// Server-side network boundary shared by onboarding and invoice transport.
// An old API URL/credential pair must never silently enable production.
export function getZatcaNetworkBase(): string | null {
  const mode = process.env.ZATCA_MODE ?? "mock"
  const raw = process.env.ZATCA_API_BASE_URL
  if (mode === "mock") {
    if (raw) throw new Error("ZATCA_API_BASE_URL requires explicit ZATCA_MODE=sandbox or simulation. Production is disabled.")
    return null
  }
  if (mode === "production") {
    if (process.env.ZATCA_PRODUCTION_ENABLED !== "true") {
      throw new Error("ZATCA production submission is disabled.")
    }
    // This branch intentionally remains closed. Current XML/signing code has
    // not passed the official SDK and sandbox; an operator flag is necessary
    // but cannot override missing implementation/validation evidence.
    throw new Error("ZATCA production remains blocked: official XML, signing and sandbox validation are incomplete.")
  }
  if (mode !== "sandbox" && mode !== "simulation") throw new Error("Invalid ZATCA_MODE.")
  if (!raw) throw new Error("ZATCA sandbox/simulation mode requires an official gateway URL.")
  let url: URL
  try { url = new URL(raw) } catch { throw new Error("Invalid ZATCA gateway URL.") }
  const path = mode === "sandbox" ? "/e-invoicing/developer-portal" : "/e-invoicing/simulation"
  if (url.protocol !== "https:" || url.hostname !== "gw-fatoora.zatca.gov.sa" ||
      url.port || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, "") !== path) {
    throw new Error("ZATCA gateway URL does not match the selected non-production environment.")
  }
  return `${url.origin}${path}`
}

/**
 * True only for an explicit, valid NON-PRODUCTION gateway configuration
 * (ZATCA_MODE=sandbox|simulation plus the matching official URL). Production
 * stays code-blocked above; invalid configuration is treated as disabled.
 */
export function zatcaNonProductionEnabled(): boolean {
  try {
    return getZatcaNetworkBase() !== null
  } catch {
    return false
  }
}

export function zatcaConfiguredEnvironment(): "sandbox" | "simulation" | null {
  if (!zatcaNonProductionEnabled()) return null
  return process.env.ZATCA_MODE === "simulation" ? "simulation" : "sandbox"
}
