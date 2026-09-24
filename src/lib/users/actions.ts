"use server"

// Server Actions for the Users module (Module 14) — status lifecycle +
// employee-code assignment. Creation of user accounts stays with the invite
// flow (src/lib/auth/invites.ts: auth.users + users + membership + role in
// one guarded path) — this module must not duplicate that orchestration.
//
// Authorization: requirePermission("users", "update") server-side; tenant
// scoping via getCurrentUser(); every mutation writes an audit_log row via
// writeAuditLog(). The DB-level self-escalation trigger (058) remains the
// hard boundary — this action additionally refuses self-edits early with a
// readable error instead of a 500 from the trigger.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { isStatusTransitionAllowed, type UserStatus } from "./user-utils"

export type UserActionResult = { success: boolean; error?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

const updateStatusSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["active", "inactive", "locked", "pending_invite", "terminated"]),
  reason: z.string().trim().min(5).max(500),
})

/**
 * Transition a user's account status with a mandatory reason. Guards:
 * no self-edit, no terminal-origin transitions, allowed-targets matrix from
 * user-utils. Writes an audit row and revalidates both surfaces.
 */
export async function updateUserStatus(input: unknown): Promise<UserActionResult> {
  try {
    await requirePermission("users", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = updateStatusSchema.parse(input)
    const { userId, status, reason } = parsed

    if (userId === currentUser.id) {
      return { success: false, error: "You cannot change your own account status." }
    }

    const admin = createAdminClient()
    const { data: existing, error: fetchError } = await admin
      .from("users")
      .select("id, status, role")
      .eq("id", userId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError) return { success: false, error: fetchError.message }
    if (!existing) return { success: false, error: "User not found." }

    const from = existing.status as UserStatus
    if (from === status) {
      return { success: false, error: `User is already ${status}.` }
    }
    if (!isStatusTransitionAllowed(from, status)) {
      return {
        success: false,
        error: `Transition ${from} → ${status} is not allowed.`,
      }
    }
    // Guard the same DB invariant early (058 AUTH005) with a readable error.
    if (existing.role === "general_manager" && status !== "active") {
      return {
        success: false,
        error: "Suspend or lock the account via Supabase Auth instead — GM accounts stay active here.",
      }
    }

    const { error } = await admin
      .from("users")
      .update({ status, updated_by: currentUser.authUserId })
      .eq("id", userId)
    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "users",
      action: "status_changed",
      entityType: "user",
      entityId: userId,
      newValues: { from, to: status, reason },
    })

    revalidatePath("/users")
    revalidatePath(`/users/${userId}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

const assignCodeSchema = z.object({
  userId: z.string().uuid(),
})

/**
 * Assign the next tenant employee code (EDU-NNNNNN) via the
 * next_employee_code() sequence helper (20260924120000). Idempotent-guard:
 * refuses when a code is already present — the sequence is never rewound.
 */
export async function assignEmployeeCode(input: unknown): Promise<UserActionResult> {
  try {
    await requirePermission("users", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = assignCodeSchema.parse(input)
    const { userId } = parsed

    const admin = createAdminClient()
    const { data: existing, error: fetchError } = await admin
      .from("users")
      .select("id, employee_code")
      .eq("id", userId)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (fetchError) return { success: false, error: fetchError.message }
    if (!existing) return { success: false, error: "User not found." }
    if (existing.employee_code) {
      return { success: false, error: `Code already assigned (${existing.employee_code}).` }
    }

    const { data: code, error: rpcError } = await admin.rpc("next_employee_code", {
      p_tenant_id: currentUser.tenantId,
    })
    if (rpcError) return { success: false, error: rpcError.message }
    if (typeof code !== "string" || !code.startsWith("EDU-")) {
      return { success: false, error: "Employee-code helper returned an unexpected value." }
    }

    const { error } = await admin
      .from("users")
      .update({ employee_code: code, updated_by: currentUser.authUserId })
      .eq("id", userId)
    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "users",
      action: "employee_code_assigned",
      entityType: "user",
      entityId: userId,
      newValues: { employee_code: code },
    })

    revalidatePath("/users")
    revalidatePath(`/users/${userId}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
