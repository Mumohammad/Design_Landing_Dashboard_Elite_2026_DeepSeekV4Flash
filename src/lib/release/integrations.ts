// These integrations require provider acceptance evidence before release.
// WPS and webhooks are code-controlled off. ZATCA is available for an
// explicit, valid gateway configuration (sandbox/simulation, or a
// production-capable deployment with ZATCA_PRODUCTION_ENABLED=true where each
// company still opts in per tenant — see zatca-config.ts).
import { zatcaGatewayEnabled } from "@/lib/accounting/zatca-config"

export type Integration = "webhooks" | "wps" | "zatca"
export function integrationAvailable(integration: Integration): boolean {
  if (integration === "zatca") return zatcaGatewayEnabled()
  return false
}
export const INTEGRATION_UNAVAILABLE = "This integration is unavailable pending provider validation."
