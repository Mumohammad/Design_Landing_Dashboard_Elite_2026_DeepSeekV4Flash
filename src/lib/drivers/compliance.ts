// Shared types for the Phase A Saudi-2026 driver compliance engine.
// Client-safe: no server code is imported from here. OVERRIDABLE_REQUIREMENTS
// is a value export but contains plain string literals only.

export type ComplianceLevel =
  | "fully_compliant"
  | "compliant_warnings"
  | "pending_review"
  | "non_compliant"
  | "critical_block"
  | "suspended"

export interface ComplianceRequirement {
  key: string
  status:
    | "valid"
    | "expiring"
    | "expired"
    | "missing"
    | "pending_review"
    | "blocked"
    | "suspended"
    | "override_active"
    | "not_required"
  blocker?: boolean
  detail?: string | null
  override?: boolean
}

export interface ComplianceResultDetails {
  requirements?: ComplianceRequirement[]
  blockers?: number
  missing?: number
  pending?: number
  warnings?: number
  [key: string]: unknown
}

export interface ComplianceResult {
  id: string
  tenant_id: string
  driver_id: string
  level: ComplianceLevel
  score: number
  details: ComplianceResultDetails
  triggered_by: string | null
  run_at: string
}

// Requirements the engine upgrades to override_active when an authorized,
// unexpired, unrevoked row exists in driver_compliance_overrides
// (20260915120000_drivers_module_foundation.sql).
export const OVERRIDABLE_REQUIREMENTS = [
  "identity",
  "driving_license",
  "health_certificate",
  "home_delivery_permit",
  "ajeer_permit",
] as const

export type OverridableRequirement = (typeof OVERRIDABLE_REQUIREMENTS)[number]

export interface ComplianceOverride {
  id: string
  driver_id: string
  requirement: string
  reason: string
  attachment_url: string | null
  approved_by: string
  approved_at: string
  expires_at: string
  revoked_at: string | null
}
