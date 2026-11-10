"use server"

// Permission-gated, tenant-scoped decisions with validated reasons.
// Positive expense decisions share the Expenses action: approval, payable,
// accounting event and approval audit commit in one database transaction.
// Other decision types below retain their existing transition/audit paths.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
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

const rejectReason = z.string().trim().min(5, "Reason must be at least 5 characters").max(500)

/* ──────────────────────────────────────────────────────────────────────── */
/* Expense decisions — guarded transactions with their decision audits    */
/* ──────────────────────────────────────────────────────────────────────── */

const expenseDecisionSchema = z.object({
  expenseId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
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
        id: expenseId, expectedVersion: parsed.expectedVersion, vat_rate: parsed.vat_rate, approvalReason: reason, surface: "approvals_inbox",
      })
      try { revalidatePath("/approvals") } catch { /* The caller refreshes the confirmed decision. */ }
      return { success: result.success, error: result.error, errorAr: result.errorAr,
        alreadyDecided: result.alreadyApproved || result.alreadyDecided, postingPending: result.postingPending }
    }

    const limit = await rateLimitExpenses(currentUser.id)
    if (!limit.success) return { success: false, error: "Rate limit exceeded. Try again later.", errorAr: "تجاوزت عدد المحاولات المسموح. حاول لاحقاً." }
    const caller = await createClient()
    const { data, error } = await caller.rpc("decide_expense_reviewed_atomic", {
      p_id: expenseId, p_expected_version: parsed.expectedVersion, p_decision: "rejected",p_vat_rate:null,p_recoverability:null,p_reason:reason,p_surface:"approvals_inbox",
    })
    if (error) {
      if (error.message.startsWith("EXP_EDIT_STALE")) return {success:false,error:"This expense changed. Reload and review it before deciding.",errorAr:"تغير المصروف. أعد تحميله وراجعه قبل اتخاذ القرار."}
      if (/^(EXP002|EXP_REJECTED|EXP_CANCELLED):/.test(error.message)) return { success: false, alreadyDecided: true,
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

export async function decideLeaveRequest(input: unknown): Promise<DecisionActionResult> {
 const parsed=z.object({requestId:z.uuid(),expectedVersion:z.number().int().positive(),decision:z.enum(["approved","rejected"]),reason:rejectReason}).safeParse(input)
 if(!parsed.success)return{success:false,error:"Check the request, reviewed version and reason.",errorAr:"تحقق من الطلب والنسخة التي تمت مراجعتها والسبب."}
 const {mutateDriverLeave}=await import("@/lib/drivers/leave-actions")
 return mutateDriverLeave({action:parsed.data.decision,requestId:parsed.data.requestId,expectedVersion:parsed.data.expectedVersion,reason:parsed.data.reason,surface:"approvals_inbox"})
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Application decision — one atomic RPC (20260926120000 §4)                */
/* ──────────────────────────────────────────────────────────────────────── */

export async function decideApplication(input: unknown): Promise<DecisionActionResult> {
 const parsed=z.object({applicationId:z.uuid(),expectedVersion:z.number().int().positive(),decision:z.enum(["approved","rejected"]),reason:rejectReason}).safeParse(input)
 if(!parsed.success)return{success:false,error:"Check the application, reviewed version and reason.",errorAr:"تحقق من الطلب والنسخة التي تمت مراجعتها والسبب."}
 const {mutateApplicationReview}=await import("@/lib/applications/review-actions")
 return mutateApplicationReview({applicationId:parsed.data.applicationId,expectedVersion:parsed.data.expectedVersion,action:parsed.data.decision,reason:parsed.data.reason,surface:"approvals_inbox"})
}
