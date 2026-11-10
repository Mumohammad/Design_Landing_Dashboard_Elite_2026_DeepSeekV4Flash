"use server"

// Caller-bound atomic payroll status transitions. Ledger application, cancellation
// rollback and audit are enforced by the database in the same transaction.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitPayroll } from "@/lib/auth/rate-limit"
import { emit } from "@/lib/webhooks/events"

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

export async function transitionPayrollStatus(input: unknown): Promise<PayrollActionResult> {
  try {
    const parsed = transitionSchema.parse(input)
    await requirePermission("payroll", parsed.to === "approved" || parsed.to === "paid" ? "approve" : "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitPayroll(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const { periodId, to, surface } = parsed
    const reason = parsed.reason?.trim() ?? ""

    const client = await createClient()
    const { data: existing, error } = await client.rpc("transition_payroll_status_atomic", {
      p_id:periodId,p_to:to,p_reason:reason || null,p_surface:surface,
    })
    if(error || !existing) return {success:false,error:error?.message ?? "Unable to transition payroll"}

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
