// Server-side network boundary shared by onboarding and invoice transport.
// An old API URL/credential pair must never silently enable production.
//
// Deployment modes (ZATCA_MODE):
//   mock        — offline, nothing leaves the server (default).
//   sandbox     — developer portal only (ZATCA_API_BASE_URL must match).
//   simulation  — Fatoora simulation only (ZATCA_API_BASE_URL must match).
//   production  — production-CAPABLE deployment. Requires the explicit
//                 operator flag ZATCA_PRODUCTION_ENABLED=true. Every tenant
//                 still starts on the simulation gateway; a tenant reaches the
//                 core (production) gateway only after its own administrator
//                 switches production ON (zatca_tenant_environment) and
//                 onboards a production EGS unit with a real Fatoora OTP.

export type ZatcaEnvironment = "sandbox" | "simulation" | "production"

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
  if (mode === "mock") {
    if (raw) throw new Error("ZATCA_API_BASE_URL requires explicit ZATCA_MODE=sandbox, simulation or production.")
    return null
  }
  if (mode === "production") {
    if (process.env.ZATCA_PRODUCTION_ENABLED !== "true") {
      throw new Error("ZATCA production submission is disabled (ZATCA_PRODUCTION_ENABLED is not true).")
    }
    if (raw) checkedUrl(raw, ZATCA_GATEWAY_PATHS.production, "ZATCA gateway URL does not match the production (core) gateway.")
    const env = environment ?? "simulation"
    return `https://${GATEWAY_HOST}${ZATCA_GATEWAY_PATHS[env]}`
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

/** True for any valid gateway configuration (test or production-capable). */
export function zatcaGatewayEnabled(): boolean {
  try {
    return getZatcaNetworkBase() !== null
  } catch {
    return false
  }
}

/** @deprecated name kept for callers; true for any valid gateway deployment. */
export const zatcaNonProductionEnabled = zatcaGatewayEnabled

/** True when this deployment may let tenants switch to the production gateway. */
export function zatcaProductionAvailable(): boolean {
  return deploymentMode() === "production" && zatcaGatewayEnabled()
}

/**
 * The deployment's TEST environment (where every tenant starts and where
 * tenants with production OFF keep working). Null when no gateway is enabled.
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
