// Application-layer authorization service — the real `can()` replacement.
//
// Replaces the dead `src/lib/permissions/can.ts` stub (ADR-014) with a
// server-side authorization primitive backed by the RBAC tables defined in
// `docs/phase-2-schema-plan.md` section 6.6 (roles / permissions /
// role_permissions).
//
// Reference: docs/phase-2-auth-plan.md section 7 (Authorization service boundary).
//
// Server-side only. Imports `@/lib/supabase/server` which depends on
// `next/headers` — importing this module from a Client Component fails.

import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

/**
 * The set of actions every module permission can grant. Matches the
 * `permissions.action` catalog values from the schema plan.
 */
export type PermissionAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "export"
  | "print"
  | "manage"

export type PermissionCheck = {
  allowed: boolean
  reason?: string
}

/**
 * Thrown by `requirePermission()` when a permission check fails. Carries the
 * bilingual envelope so the global error handler can return it directly.
 * `code` is `AUTH007` (insufficient_role) per the v2.0 taxonomy.
 */
export class AuthorizationError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly messageAr: string
  readonly messageEn: string

  constructor(
    code: string,
    statusCode: number,
    messageAr: string,
    messageEn: string
  ) {
    super(messageEn)
    this.name = "AuthorizationError"
    this.code = code
    this.statusCode = statusCode
    this.messageAr = messageAr
    this.messageEn = messageEn
  }
}

type UserProfile = {
  /** Custom `users` row id (used for joins on the users table, e.g. reviewed_by). */
  id: string
  /** Supabase auth.users id — required by every created_by/updated_by/actor_id FK. */
  authUserId: string
  tenantId: string
  role: string
  status: string
  locked_until?: string | null
}

type ProfileRow = {
  locked_until?: string | null
  id: string
  auth_user_id: string
  tenant_id: string
  role: string
  status: string
}

/**
 * Fetch the signed-in user's profile row from the custom `users` table.
 *
 * Cached per request via React `cache()` so multiple `can()` / `getCurrentUser()`
 * calls in a single render issue ONE Postgres query.
 */
const getProfile = cache(async (): Promise<UserProfile | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from("users")
    .select("id, auth_user_id, tenant_id, role, status, locked_until")
    .eq("auth_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle<ProfileRow>()

  if (error || !data || data.status !== "active" || (data.locked_until && Date.parse(data.locked_until) > Date.now())) return null

  return {
    id: data.id,
    authUserId: data.auth_user_id,
    tenantId: data.tenant_id,
    role: data.role,
    status: data.status,
  }
})

/**
 * Server-side authorization check.
 *
 * @param module  one of the module keys (e.g. "drivers", "payroll", "users")
 * @param action  one of the {@link PermissionAction} values
 * @returns `{ allowed, reason }` — never throws on denial; throws only on
 *          infra errors.
 *
 * UI hiding is NOT authorization. Every Server Action / Route Handler MUST
 * call `can()` (or {@link requirePermission}) before proceeding. The
 * middleware route guard is a first-line filter only; RLS is the data boundary.
 *
 * Memoized per request via React `cache()` — identical `can(module, action)`
 * calls within a single render share one result.
 */
export const can = cache(
  async (
    module: string,
    action: PermissionAction
  ): Promise<PermissionCheck> => {
    const profile = await getProfile()
    if (!profile) return { allowed: false, reason: "no_session" }
    if (profile.status !== "active") return { allowed: false, reason: "inactive" }

    // Share the database permission, account-state and MFA boundary with RLS.
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("user_has_permission", { p_module: module, p_action: action })
    return { allowed: !error && data === true, reason: error || data !== true ? "insufficient_permission_or_assurance" : undefined }
  }
)

/**
 * Convenience wrapper that throws {@link AuthorizationError} on denial.
 *
 * Use in Server Actions / Route Handlers where denial should abort the request
 * with a 403:
 *
 *   await requirePermission("users", "manage")
 *
 * TODO: replace the per-request role_permissions query with a single
 * `check_permission(p_user_uuid, p_module, p_action)` Postgres function (RPC)
 * for better cold-path performance. See auth plan 7.2 / 7.4.
 */
export async function requirePermission(
  module: string,
  action: PermissionAction
): Promise<void> {
  const check = await can(module, action)
  if (!check.allowed) {
    throw new AuthorizationError(
      "AUTH007",
      403,
      "ليس لديك صلاحية للقيام بهذا الإجراء.",
      "You do not have permission to perform this action."
    )
  }
}

/**
 * Fetch the current user's id, tenant id, and role from the `users` table.
 *
 * Cached per request via React `cache()`. Returns `null` when there is no
 * signed-in session or no custom `users` row (the auth.users sync trigger
 * should have created one — see schema plan section 8).
 *
 * NOTE: this returns the role for display / routing hints only. Authorization
 * decisions MUST go through {@link can} / {@link requirePermission} — the
 * denormalized `users.role` column is a convenience, not the source of truth
 * for grants.
 */
export const getCurrentUserForMfa = cache(async (): Promise<{
  /** Custom `users` row id — only for joins on the users table (e.g. reviewed_by). */
  id: string
  /** Supabase auth.users id — use for created_by/updated_by/actor_id columns. */
  authUserId: string
  tenantId: string
  role: string
} | null> => {
  const profile = await getProfile()
  if (!profile) return null
  return {
    id: profile.id,
    authUserId: profile.authUserId,
    tenantId: profile.tenantId,
    role: profile.role,
  }
})

// Business actions must not gain service-role access before MFA step-up.
export const getCurrentUser = cache(async () => {
  const profile = await getCurrentUserForMfa()
  if (!profile) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("has_required_assurance")
  return !error && data === true ? profile : null
})
