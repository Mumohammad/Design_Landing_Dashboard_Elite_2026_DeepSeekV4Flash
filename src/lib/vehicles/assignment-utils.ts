// Pure helpers for the vehicle-assignment wiring (Prompt F).
//
// No Supabase / React / next imports — importable from Client Components
// AND unit-testable per the drivers/users/approvals module precedent
// (vitest, node environment). The server actions live in assignments.ts
// ("use server"); these are the client-safe pieces both surfaces share.

export type VehicleAssignmentStatus = "active" | "ended"

/**
 * Terminal-state matrix for an assignment row (users-module guard idiom):
 * an active assignment may only be ended; an ended assignment is terminal —
 * history rows are immutable records, re-assignment inserts a NEW row.
 */
export const ALLOWED_ASSIGNMENT_TRANSITIONS: Record<
  VehicleAssignmentStatus,
  readonly VehicleAssignmentStatus[]
> = {
  active: ["ended"],
  ended: [],
}

export function isAssignmentTransitionAllowed(
  from: VehicleAssignmentStatus,
  to: VehicleAssignmentStatus
): boolean {
  return ALLOWED_ASSIGNMENT_TRANSITIONS[from].includes(to)
}

/** ISO date (yyyy-mm-dd) guard shared by the handover-odometer inputs. */
export function isIsoDate(value: string | null | undefined): boolean {
  if (!value) return true
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

export type VehicleDocsExpiry = {
  insurance_expiry: string | null
  registration_expiry: string | null
  inspection_expiry: string | null
}

export type DocsExpiryState = "expired" | "soon" | "ok" | "none"

/**
 * Classify the worst docs-expiry state for a vehicle (fleet-list chip):
 * expired < soon (≤30 days) < ok < none. Pure — unit-tested.
 */
export function worstDocsExpiryState(
  v: VehicleDocsExpiry,
  now = new Date(),
  soonDays = 30
): DocsExpiryState {
  const rank: Record<DocsExpiryState, number> = { expired: 0, soon: 1, ok: 2, none: 3 }
  let worst: DocsExpiryState = "none"
  for (const raw of [v.insurance_expiry, v.registration_expiry, v.inspection_expiry]) {
    if (!raw) continue
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) continue
    const diffDays = (d.getTime() - now.getTime()) / 86_400_000
    const state: DocsExpiryState = diffDays < 0 ? "expired" : diffDays <= soonDays ? "soon" : "ok"
    if (rank[state] < rank[worst]) worst = state
  }
  return worst
}
