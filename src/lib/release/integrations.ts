// These integrations require provider acceptance evidence before release.
// WPS and webhooks are code-controlled off. ZATCA is available only for an
// explicit, valid NON-PRODUCTION gateway (sandbox/simulation, see
// zatca-config.ts); production remains code-blocked regardless of flags.
import { zatcaNonProductionEnabled } from "@/lib/accounting/zatca-config"

export type Integration = "webhooks" | "wps" | "zatca"
export function integrationAvailable(integration: Integration): boolean {
  if (integration === "zatca") return zatcaNonProductionEnabled()
  return false
}
export const INTEGRATION_UNAVAILABLE = "This integration is unavailable pending provider validation."
