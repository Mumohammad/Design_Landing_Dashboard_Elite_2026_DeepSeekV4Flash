// Server-side network boundary shared by onboarding and invoice transport.
// An old API URL/credential pair must never silently enable production.
//
// Production remains code-blocked pending independent authority acceptance.
// Neither an operator flag nor a stored tenant preference opens that gateway.

export type ZatcaEnvironment = "sandbox" | "simulation" | "production"

export const ZATCA_PRODUCTION_BLOCKED = "ZATCA production remains blocked pending independent authority acceptance of XML, signing and simulation evidence."
export const ZATCA_ENVIRONMENT_UNAVAILABLE = "ZATCA environment could not be verified. Reload before continuing."

const GATEWAY_HOST = "gw-fatoora.zatca.gov.sa"
export const ZATCA_GATEWAY_PATHS: Record<ZatcaEnvironment, string> = {
  sandbox: "/e-invoicing/developer-portal",
  simulation: "/e-invoicing/simulation",
  production: "/e-invoicing/core",
}

function deploymentMode(): string {
  return process.env.ZATCA_MODE ?? "mock"
}

function checkedUrl(raw: string, expectedPath: string, message: string): void {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error("Invalid ZATCA gateway URL.") }
  if (url.protocol !== "https:" || url.hostname !== GATEWAY_HOST ||
      url.port || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, "") !== expectedPath) {
    throw new Error(message)
  }
}

/**
 * Official gateway base for `environment` (default: the deployment's test
 * environment), or null in offline mock mode. Throws on any invalid or
 * mismatched configuration — never falls back to a simulated success.
 */
export function getZatcaNetworkBase(environment?: ZatcaEnvironment): string | null {
  const mode = deploymentMode()
  const raw = process.env.ZATCA_API_BASE_URL
  if (environment === "production" && mode !== "production") throw new Error(ZATCA_PRODUCTION_BLOCKED)
  if (mode === "mock") {
    if (raw) throw new Error("ZATCA_API_BASE_URL requires explicit ZATCA_MODE=sandbox, simulation or production.")
    return null
  }
  if (mode === "production") {
    if (process.env.ZATCA_PRODUCTION_ENABLED !== "true") {
      throw new Error("ZATCA production submission is disabled (ZATCA_PRODUCTION_ENABLED is not true).")
    }
    throw new Error(ZATCA_PRODUCTION_BLOCKED)
  }
  if (mode !== "sandbox" && mode !== "simulation") throw new Error("Invalid ZATCA_MODE.")
  if (environment && environment !== mode) {
    throw new Error(environment === "production"
      ? "ZATCA production is not enabled in this deployment."
      : "ZATCA gateway URL does not match the selected non-production environment.")
  }
  if (!raw) throw new Error("ZATCA sandbox/simulation mode requires an official gateway URL.")
  checkedUrl(raw, ZATCA_GATEWAY_PATHS[mode], "ZATCA gateway URL does not match the selected non-production environment.")
  return `https://${GATEWAY_HOST}${ZATCA_GATEWAY_PATHS[mode]}`
}

/** True only for a valid non-production gateway in this release. */
export function zatcaGatewayEnabled(): boolean {
  try {
    return getZatcaNetworkBase() !== null
  } catch {
    return false
  }
}

/** @deprecated name kept for callers; true for a valid test gateway. */
export const zatcaNonProductionEnabled = zatcaGatewayEnabled

/** Production is unavailable until a separate reviewed implementation opens it. */
export function zatcaProductionAvailable(): boolean {
  return false
}

/**
 * The deployment's test environment. Invalid/blocked configuration is reported
 * as unavailable here; routing uses getZatcaNetworkBase directly and throws.
 */
export function zatcaConfiguredEnvironment(): "sandbox" | "simulation" | null {
  if (!zatcaGatewayEnabled()) return null
  return deploymentMode() === "sandbox" ? "sandbox" : "simulation"
}

/** Environments a tenant may onboard in this deployment. */
export function zatcaOnboardableEnvironments(productionOn: boolean): ZatcaEnvironment[] {
  const test = zatcaConfiguredEnvironment()
  if (!test) return []
  return zatcaProductionAvailable() && productionOn ? [test, "production"] : [test]
}

/** Exact acknowledgement the administrator confirms when switching production ON. */
export const ZATCA_PRODUCTION_ACK = "I confirm the company is registered with ZATCA, its integration wave is due, and invoices issued from now on are live tax documents."
