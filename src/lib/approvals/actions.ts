"use server"

// Permission-gated, tenant-scoped decisions with validated reasons.
// Positive expense decisions share the Expenses action: approval, payable,
// accounting event and approval audit commit in one database transaction.
// Other decision types below retain their existing transition/audit paths.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { approveExpense } from "@/lib/expenses/actions"
import { rateLimitExpenses } from "@/lib/auth/rate-limit"

export type DecisionActionResult = {
  success: boolean
  error?: string
  /** True when the item was already decided (stale queue state). */
  alreadyDecided?: boolean
  errorAr?: string
  postingPending?: boolean
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

const rejectReason = z.string().trim().min(5, "Reason must be at least 5 characters").max(500)

/* ──────────────────────────────────────────────────────────────────────── */
/* Expense decisions — guarded transactions with their decision audits    */
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
 * approve → the shared expense action atomically retains the decision,
 * payable, event and audit reason, then reports verified posting status.
 *
 * reject → persist rejection metadata and reason/audit in one locked
 * transaction. The row remains available for review, leaves the pending
 * queue, and cannot subsequently be approved.
 */
export async function decideExpense(input: unknown): Promise<DecisionActionResult> {
  try {
    await requirePermission("expenses", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = expenseDecisionSchema.parse(input)
    const { expenseId, decision, reason } = parsed

    if (decision === "approved") {
      const result = await approveExpense({
        id: expenseId, vat_rate: parsed.vat_rate, approvalReason: reason, surface: "approvals_inbox",
      })
      try { revalidatePath("/approvals") } catch { /* The caller refreshes the confirmed decision. */ }
      return { success: result.success, error: result.error, errorAr: result.errorAr,
        alreadyDecided: result.alreadyApproved || result.alreadyDecided, postingPending: result.postingPending }
    }

    const limit = await rateLimitExpenses(currentUser.id)
    if (!limit.success) return { success: false, error: "Rate limit exceeded. Try again later.", errorAr: "تجاوزت عدد المحاولات المسموح. حاول لاحقاً." }
    const { data, error } = await createAdminClient().rpc("reject_expense_atomic", {
      p_tenant_id: currentUser.tenantId, p_expense_id: expenseId, p_reason: reason, p_actor: currentUser.authUserId,
    })
    if (error) {
      if (/^(EXP002|EXP_REJECTED):/.test(error.message)) return { success: false, alreadyDecided: true,
        error: "This expense was already decided. Review the refreshed list.", errorAr: "تم البت في المصروف مسبقاً. راجع القائمة بعد تحديثها." }
      if (error.message.startsWith("EXP_FINANCE_REVIEW:")) return { success: false,
        error: "This expense has financial evidence. Review it in Accounting before deciding.", errorAr: "لهذا المصروف سجلات مالية. راجعها في المحاسبة قبل اتخاذ القرار." }
      return { success: false, error: "Unable to confirm this rejection. Reload and review before retrying.", errorAr: "تعذر تأكيد الرفض. أعد تحميل القائمة وراجعها قبل المحاولة مجدداً." }
    }
    if (!data || data.expense_id !== expenseId || data.decision !== "rejected") return { success: false,
      error: "Unable to confirm this rejection. Reload and review before retrying.", errorAr: "تعذر تأكيد الرفض. أعد تحميل القائمة وراجعها قبل المحاولة مجدداً." }
    try { revalidatePath("/expenses"); revalidatePath("/approvals") } catch { /* The caller refreshes the committed decision. */ }
    return { success: true }
  } catch (e) {
    return { success: false,
      error: e instanceof z.ZodError ? "Check the expense, decision and reason (5 to 500 characters)." : "Unable to confirm the decision. Reload and review before retrying.",
      errorAr: e instanceof z.ZodError ? "تحقق من المصروف والقرار وسبب من 5 إلى 500 حرف." : "تعذر تأكيد القرار. أعد تحميل القائمة وراجعها قبل المحاولة مجدداً.",
    }
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
