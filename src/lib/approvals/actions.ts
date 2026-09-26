"use server"

// Server Actions for the Approvals module (Prompt E) — the unified decision
// inbox's write paths. One server action per decision type, each:
//   * requirePermission() gated (GM bypasses; ops/admin roles hold the
//     module:approve grants from 013_seed_defaults — expenses.approve /
//     attendance.approve / hr.approve),
//   * zod-validated (mandatory reason on reject, server + client parity),
//   * tenant-scoped via getCurrentUser(),
//   * idempotency-guarded: the atomic RPCs claim the row with a conditional
//     UPDATE (0 rows ⇒ already decided → surfaced gracefully, not a 500),
//   * transactional: the status write happens INSIDE the same RPC that
//     enforces the transition guard (063_expense_approval_race parity),
//   * audit-logged: every decision writes an audit_log row via
//     writeAuditLog() (the audit-trail module #51 contract).
//
// Expense approvals REUSE the existing FX-06 atomic RPC
// (approve_expense_atomic, 063) — the inbox adds the mandatory rejection
// reason + audit row around the existing transition, it does not replace it.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitExpenses } from "@/lib/auth/rate-limit"
import { emit } from "@/lib/webhooks/events"

export type DecisionActionResult = {
  success: boolean
  error?: string
  /** True when the item was already decided (stale queue state). */
  alreadyDecided?: boolean
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

const rejectReason = z.string().trim().min(5, "Reason must be at least 5 characters").max(500)

/* ──────────────────────────────────────────────────────────────────────── */
/* Expense decision — approve via FX-06 atomic RPC / reject = audit only    */
/* ──────────────────────────────────────────────────────────────────────── */

const expenseDecisionSchema = z.object({
  expenseId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: rejectReason,
  vat_rate: z.number().finite().min(0).max(100).optional(),
})

/**
 * Decide an expense from the inbox.
 *
 * approve → the pre-existing FX-06 atomic RPC (claims the row, creates the
 * payable, enqueues ExpenseApprovedEvent — one transaction). The reason is
 * recorded on the audit row.
 *
 * reject → a guarded conditional UPDATE flips nothing: `is_approved` stays
 * false and the rejection reason is audited; the expense is then archived
 * from the queue by the audit trail alone (expenses are never destroyed —
 * the row remains with is_approved = false and a rejecting audit entry, and
 * the queue's stale-state check keeps it out of future decisions).
 */
export async function decideExpense(input: unknown): Promise<DecisionActionResult> {
  try {
    await requirePermission("expenses", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = expenseDecisionSchema.parse(input)
    const { expenseId, decision, reason } = parsed

    const admin = createAdminClient()

    if (decision === "approved") {
      const rl = await rateLimitExpenses(currentUser.id)
      if (!rl.success) {
        return { success: false, error: "Rate limit exceeded. Try again later." }
      }

      // FX-06: one atomic RPC — claim, payable, event. EXP002 = already approved.
      const { data: rpcData, error: rpcErr } = await admin.rpc("approve_expense_atomic", {
        p_tenant_id: currentUser.tenantId,
        p_expense_id: expenseId,
        p_vat_rate: parsed.vat_rate ?? 15,
        p_vat_recoverability: null,
        p_actor: currentUser.authUserId,
      })
      if (rpcErr) {
        if (rpcErr.message.includes("EXP002")) {
          return { success: false, alreadyDecided: true, error: "Expense already approved." }
        }
        return { success: false, error: rpcErr.message }
      }
      const rpc = rpcData as { expense_ref?: string; total?: number } | null

      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.authUserId,
        module: "expenses",
        action: "expense_approved",
        entityType: "expense",
        entityId: expenseId,
        newValues: {
          from: "pending",
          to: "approved",
          reason,
          expense_ref: rpc?.expense_ref ?? null,
          total: rpc?.total ?? null,
          surface: "approvals_inbox",
        },
      })

      emit("expense.approved", currentUser.tenantId, {
        id: expenseId,
        amount: rpc?.total ?? 0,
        approvedBy: currentUser.id,
      })

      revalidatePath("/expenses")
      revalidatePath("/approvals")
      return { success: true }
    }

    // ── Reject: claim the pending row with a guarded conditional UPDATE ──
    // expenses has no rejected terminal state (is_approved is boolean), so
    // the queue drops the item by recording the decision on the audit trail
    // and stamping updated_by — the conditional predicate rejects a row that
    // was approved meanwhile (stale-state guard).
    const { data: claimed, error: claimErr } = await admin
      .from("expenses")
      .update({ updated_by: currentUser.authUserId, updated_at: new Date().toISOString() })
      .eq("id", expenseId)
      .eq("tenant_id", currentUser.tenantId)
      .eq("is_approved", false)
      .is("deleted_at", null)
      .select("id")
    if (claimErr) return { success: false, error: claimErr.message }
    if (!claimed || claimed.length === 0) {
      return { success: false, alreadyDecided: true, error: "Expense already approved." }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "expenses",
      action: "expense_rejected",
      entityType: "expense",
      entityId: expenseId,
      oldValues: { is_approved: false },
      newValues: { from: "pending", to: "rejected", reason, surface: "approvals_inbox" },
    })

    revalidatePath("/expenses")
    revalidatePath("/approvals")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Leave decision — one atomic RPC (20260926120000 §3)                      */
/* ──────────────────────────────────────────────────────────────────────── */

const leaveDecisionSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: rejectReason,
})

/**
 * Decide a driver leave request from the inbox. The whole transition is ONE
 * atomic RPC: conditional UPDATE claims the pending row (0 rows ⇒ LVE002
 * already decided), approved leave flips the driver to on_leave via
 * set_driver_status (the drivers-module contract), rejection persists the
 * mandatory reason in review_notes.
 */
export async function decideLeaveRequest(input: unknown): Promise<DecisionActionResult> {
  try {
    await requirePermission("attendance", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = leaveDecisionSchema.parse(input)
    const { requestId, decision, reason } = parsed

    const admin = createAdminClient()
    const { data: rpcData, error: rpcErr } = await admin.rpc("decide_leave_request_atomic", {
      p_tenant_id: currentUser.tenantId,
      p_request_id: requestId,
      p_decision: decision,
      p_reason: decision === "rejected" ? reason : null,
      p_reviewer: currentUser.authUserId,
    })
    if (rpcErr) {
      if (rpcErr.message.includes("LVE002")) {
        return { success: false, alreadyDecided: true, error: "Leave request already decided." }
      }
      return { success: false, error: rpcErr.message }
    }
    const rpc = rpcData as { driver_id?: string; days_requested?: number } | null

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "attendance",
      action: "leave_reviewed",
      entityType: "leave_request",
      entityId: requestId,
      newValues: {
        from: "pending",
        to: decision,
        reason,
        driver_id: rpc?.driver_id ?? null,
        days_requested: rpc?.days_requested ?? null,
        surface: "approvals_inbox",
      },
    })

    revalidatePath("/approvals")
    if (rpc?.driver_id) revalidatePath(`/drivers/${rpc.driver_id}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Application decision — one atomic RPC (20260926120000 §4)                */
/* ──────────────────────────────────────────────────────────────────────── */

const applicationDecisionSchema = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: rejectReason,
})

/**
 * Decide a driver application from the inbox. The atomic RPC claims a
 * pre-decision row (submitted/under_review; 0 rows ⇒ APP002 already decided)
 * and persists reviewed_by / reviewed_at / review_note (030 columns;
 * reviewed_by is the custom users.id per that migration's convention).
 */
export async function decideApplication(input: unknown): Promise<DecisionActionResult> {
  try {
    await requirePermission("hr", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = applicationDecisionSchema.parse(input)
    const { applicationId, decision, reason } = parsed

    const admin = createAdminClient()
    const { data: rpcData, error: rpcErr } = await admin.rpc("decide_application_atomic", {
      p_tenant_id: currentUser.tenantId,
      p_application_id: applicationId,
      p_decision: decision,
      p_note: reason,
      p_reviewer: currentUser.id,
    })
    if (rpcErr) {
      if (rpcErr.message.includes("APP002")) {
        return { success: false, alreadyDecided: true, error: "Application already decided." }
      }
      return { success: false, error: rpcErr.message }
    }
    const rpc = rpcData as { application_number?: string } | null

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "hr",
      action: "application_reviewed",
      entityType: "driver_application",
      entityId: applicationId,
      newValues: {
        from: "pending",
        to: decision,
        reason,
        application_number: rpc?.application_number ?? null,
        surface: "approvals_inbox",
      },
    })

    revalidatePath("/approvals")
    revalidatePath("/applications")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
