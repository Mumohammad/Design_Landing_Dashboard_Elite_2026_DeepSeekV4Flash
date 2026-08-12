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
  id: string
  tenantId: string
  role: string
  status: string
}

type ProfileRow = {
  id: string
  tenant_id: string
  role: string
  status: string
}

type RoleRow = { id: string }

type RolePermissionRow = {
  permissions: { module: string; action: string } | null
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
    .select("id, tenant_id, role, status")
    .eq("auth_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle<ProfileRow>()

  if (error || !data) return null

  return {
    id: data.id,
    tenantId: data.tenant_id,
    role: data.role,
    status: data.status,
  }
})

/**
 * Fetch the set of `"module:action"` permission keys granted to the current
 * user's role. Cached per request so every `can()` call in a render reuses a
 * single role_permissions query (instead of one query per (module, action)).
 *
 * Returns an empty set for `general_manager` — the GM bypass short-circuits
 * before this is consulted, so the set is never read for GM.
 */
const getUserPermissionKeys = cache(async (): Promise<Set<string>> => {
  const profile = await getProfile()
  if (!profile || profile.role === "general_manager") return new Set()

  const supabase = await createClient()

  // Look up the tenant-scoped role row id. `users.role` is a denormalized
  // convenience column (schema plan 6.3); the authoritative grants live in
  // `role_permissions` keyed by `roles.id`.
  const { data: roleRow } = await supabase
    .from("roles")
    .select("id")
    .eq("name", profile.role)
    .eq("tenant_id", profile.tenantId)
    .is("deleted_at", null)
    .maybeSingle<RoleRow>()

  if (!roleRow) return new Set()

  // Fetch every permission granted to this role via the role_permissions join.
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permissions(module, action)")
    .eq("role_id", roleRow.id)

  if (error || !data) return new Set()

  const keys = new Set<string>()
  for (const row of data as unknown as RolePermissionRow[]) {
    if (row.permissions) {
      keys.add(`${row.permissions.module}:${row.permissions.action}`)
    }
  }
  return keys
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

    // general_manager bypasses all permission checks (auth plan 7.5).
    if (profile.role === "general_manager") return { allowed: true }

    const keys = await getUserPermissionKeys()
    if (keys.has(`${module}:${action}`)) {
      return { allowed: true }
    }
    return { allowed: false, reason: "forbidden" }
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
export const getCurrentUser = cache(async (): Promise<{
  id: string
  tenantId: string
  role: string
} | null> => {
  const profile = await getProfile()
  if (!profile) return null
  return {
    id: profile.id,
    tenantId: profile.tenantId,
    role: profile.role,
  }
})
