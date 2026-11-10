// Pure, client-safe logic for the maintenance module. Server actions (the
// "use server" sibling actions.ts) import from here; Client Components may
// import this file directly — it must never touch next/headers or the
// Supabase admin client.

import type { MaintenanceEventStatus } from "@/types/maintenance"

/** Allowed status transitions for a maintenance event. */
export const ALLOWED_EVENT_TRANSITIONS: Record<MaintenanceEventStatus, MaintenanceEventStatus[]> = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

/**
 * Terminal-state guard (matches the assignment-utils idiom): completed and
 * cancelled events are history and never transition again.
 */
export function isEventTransitionAllowed(
  from: MaintenanceEventStatus,
  to: MaintenanceEventStatus
): boolean {
  return ALLOWED_EVENT_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * The vehicle-status release semantics for completing/cancelling an event
 * that set the vehicle to `in_maintenance`. Composes the vehicles/assignments
 * module rule: the vehicle goes back to `assigned` only when a live driver
 * assignment still exists; otherwise `available`.
 *
 * The action resolves `hasCurrentAssignment` itself (vehicle_assignments
 * is_current = true, tenant-scoped) — this helper keeps that decision pure
 * and unit-testable.
 */
export type VehicleReleaseTarget = "assigned" | "available"

export function vehicleReleaseTarget(hasCurrentAssignment: boolean | null | undefined): VehicleReleaseTarget {
  return hasCurrentAssignment ? "assigned" : "available"
}

/** KPI bucket for a single event — pure so the UI can unit-test counts. */
export function eventKpiBucket(
  status: string,
  reportedAtIso: string | null | undefined,
  now: Date = new Date()
): "open" | "in_progress" | "completed_this_month" | "other" {
  if (status === "open") return "open"
  if (status === "in_progress") return "in_progress"
  if (status === "completed") {
    if (reportedAtIso) {
      const d = new Date(reportedAtIso)
      if (!Number.isNaN(d.getTime()) && d.getUTCMonth() === now.getUTCMonth() && d.getUTCFullYear() === now.getUTCFullYear()) {
        return "completed_this_month"
      }
    }
    return "other"
  }
  return "other"
}

/** yyyy-mm-dd for date inputs (ISO date, no time component). */
export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Sparkline-friendly series from odometer logs: ascending by recorded_at,
 * numeric readings only. Months/points without rows are ABSENT — never
 * zero-filled (the #55 rule).
 */
export function odometerSparkline(
  logs: { reading: number; recorded_at: string }[]
): number[] {
  return [...logs]
    .filter((l) => typeof l.reading === "number" && Number.isFinite(l.reading))
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
    .map((l) => l.reading)
}
