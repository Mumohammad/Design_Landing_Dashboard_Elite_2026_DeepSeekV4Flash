"use server"

// Payroll status-transition server action (Prompt F Part 2).
//
// The users-module guard idiom applied to driver_payroll_periods:
//   * requirePermission("payroll", "update") — the 013 matrix grants it to
//     payroll_officer / accountant / admin; GM bypasses.
//   * zod server/client parity; mandatory reason on the rejection family
//     (cancelled) — enforced here AND by the DB constraint (064 migration).
//   * transition guard against ALLOWED_PAYROLL_TRANSITIONS (payroll-utils),
//     with a race-safe conditional UPDATE claiming the row in its current
//     status (063 stale-state pattern: 0 rows ⇒ someone moved it first).
//   * tenant scoping via getCurrentUser() — the service-role client bypasses
//     RLS, so tenant_id is checked in every predicate explicitly.
//   * every mutation writes an audit_log row (audit-trail #51 contract) and
//     emits the payroll.approved webhook on approval.
//
// Approval from the inbox composes through the SAME action (approvals pattern
// — no parallel mechanism): a payroll decision is just this transition with
// surface=approvals_inbox in the audit row.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitPayroll } from "@/lib/auth/rate-limit"
import { emit } from "@/lib/webhooks/events"
import {
  isPayrollTransitionAllowed,
  transitionRequiresReason,
  type PayrollStatus,
} from "./payroll-utils"

export type PayrollActionResult = { success: boolean; error?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

const transitionSchema = z.object({
  periodId: z.string().uuid(),
  to: z.enum(["draft", "calculated", "in_review", "approved", "paid", "locked", "cancelled"]),
  reason: z.string().trim().max(500).optional().nullable(),
  surface: z.enum(["payroll", "approvals_inbox"]).default("payroll"),
})

/**
 * Transition one payroll period's status with the users-module guard idiom.
 *
 * Rejection-family transitions (cancelled) REQUIRE a reason (min 5 chars —
 * same bar as the approvals inbox). Terminal states (paid/locked/cancelled)
 * never originate a transition.
 */
export async function transitionPayrollStatus(input: unknown): Promise<PayrollActionResult> {
  try {
    await requirePermission("payroll", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitPayroll(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = transitionSchema.parse(input)
    const { periodId, to, surface } = parsed
    const reason = parsed.reason?.trim() ?? ""

    const admin = createAdminClient()

    // Load the current row tenant-scoped.
    const { data: existing, error: fetchError } = await admin
      .from("driver_payroll_periods")
      .select("id, status, period_year, period_month, driver_id, net_payroll, period_locked")
      .eq("id", periodId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError) return { success: false, error: fetchError.message }
    if (!existing) return { success: false, error: "Payroll period not found in your tenant." }

    const from = existing.status as PayrollStatus
    if (from === to) {
      return { success: false, error: `Payroll period is already ${to}.` }
    }
    if (!isPayrollTransitionAllowed(from, to)) {
      return { success: false, error: `Transition ${from} → ${to} is not allowed.` }
    }
    if (transitionRequiresReason(from, to) && reason.length < 5) {
      return { success: false, error: "A reason of at least 5 characters is required." }
    }
    if (existing.period_locked && to !== "locked") {
      return { success: false, error: "Period is locked — unlock it first." }
    }

    // Timestamp + actor columns per target state.
    const now = new Date().toISOString()
    const patch: Record<string, unknown> = {
      status: to,
      updated_by: currentUser.authUserId,
    }
    if (to === "approved") {
      patch.approved_at = now
      patch.approved_by = currentUser.authUserId
    }
    if (to === "paid") {
      patch.paid_at = now
      patch.paid_by = currentUser.authUserId
    }
    if (to === "cancelled") {
      patch.cancel_reason = reason
      patch.cancelled_by = currentUser.authUserId
      patch.cancelled_at = now
    }
    if (to === "locked") {
      patch.locked_at = now
      patch.locked_by = currentUser.authUserId
    }

    // Race-safe claim: the UPDATE only lands when the row is still in the
    // status we validated against (0 rows ⇒ a concurrent actor moved it).
    const { data: claimed, error: updateError } = await admin
      .from("driver_payroll_periods")
      .update(patch)
      .eq("id", periodId)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", from)
      .select("id")
    if (updateError) return { success: false, error: updateError.message }
    if (!claimed || claimed.length === 0) {
      return { success: false, error: `Payroll period moved meanwhile (no longer ${from}).` }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "payroll",
      action: "payroll_status_changed",
      entityType: "driver_payroll_period",
      entityId: periodId,
      oldValues: { status: from },
      newValues: { status: to, reason: reason || null, surface },
    })

    if (to === "approved") {
      emit("payroll.approved", currentUser.tenantId, {
        id: periodId,
        period: `${existing.period_year}-${String(existing.period_month).padStart(2, "0")}`,
        totalAmount: Number(existing.net_payroll ?? 0),
        approvedBy: currentUser.id,
      })
    }

    revalidatePath("/payroll")
    if (surface === "approvals_inbox") revalidatePath("/approvals")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
