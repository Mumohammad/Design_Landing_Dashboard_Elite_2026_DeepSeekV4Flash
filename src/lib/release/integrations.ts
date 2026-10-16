// These integrations require provider acceptance evidence before release.
// Deliberately code-controlled: environment variables cannot enable them.
export type Integration = "webhooks" | "wps" | "zatca"
export function integrationAvailable(_integration: Integration): boolean { return false }
export const INTEGRATION_UNAVAILABLE = "This integration is unavailable pending provider validation."
