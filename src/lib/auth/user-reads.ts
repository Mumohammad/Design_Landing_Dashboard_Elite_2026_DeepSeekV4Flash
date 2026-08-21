"use server"

// Server actions for the security and users settings pages.
//
// After migration 058, authenticated users retain SELECT on the users table,
// but sensitive fields (two_factor_secret, locked_until, failed_login_attempts)
// should not be exposed to the browser client. These server actions provide
// a controlled read path that:
//   1. Verifies authorization (requirePermission)
//   2. Derives tenant from session (getCurrentUser)
//   3. Returns only safe fields
//   4. Never exposes secret/lock fields to the client

import { requirePermission, getCurrentUser } from "@/lib/auth/authorization"
import { createAdminClient } from "@/lib/supabase/admin"

export type SafeUserRow = {
  id: string
  employee_code: string | null
  full_name_ar: string | null
  full_name_en: string | null
  email: string
  role: string
  status: string
  two_factor_enabled: boolean
  must_change_password: boolean
  last_login_at: string | null
}

export type SecurityUserRow = {
  id: string
  email: string
  full_name_ar: string | null
  role: string
  status: string
  two_factor_enabled: boolean
  must_change_password: boolean
  failed_login_attempts: number
  last_login_at: string | null
}

/**
 * Fetch user list for the /settings/users page.
 * Requires users.read permission. Uses the admin client to bypass RLS
 * (since migration 058 removed authenticated write policies, the admin
 * client ensures consistent reads regardless of future RLS changes).
 *
 * Excludes sensitive fields: two_factor_secret, locked_until, failed_login_attempts,
 * last_login_ip, password_changed_at.
 */
export async function fetchUsersForSettings(): Promise<SafeUserRow[]> {
  await requirePermission("users", "read")

  const currentUser = await getCurrentUser()
  if (!currentUser) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select(
      "id, employee_code, full_name_ar, full_name_en, email, role, status, two_factor_enabled, must_change_password, last_login_at"
    )
    .eq("tenant_id", currentUser.tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) {
    console.error("[settings/users] fetchUsersForSettings failed:", error)
    return []
  }

  return (data ?? []) as SafeUserRow[]
}

/**
 * Fetch security overview for the /security page.
 * Requires users.read permission. Returns security-relevant fields
 * (but NOT secret fields like two_factor_secret).
 *
 * failed_login_attempts is included here because it's needed for
 * the security dashboard display (lockout monitoring).
 */
export async function fetchSecurityOverview(): Promise<SecurityUserRow[]> {
  await requirePermission("users", "read")

  const currentUser = await getCurrentUser()
  if (!currentUser) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select(
      "id, email, full_name_ar, role, status, two_factor_enabled, must_change_password, failed_login_attempts, last_login_at"
    )
    .eq("tenant_id", currentUser.tenantId)
    .is("deleted_at", null)
    .order("failed_login_attempts", { ascending: false })
    .limit(100)

  if (error) {
    console.error("[security] fetchSecurityOverview failed:", error)
    return []
  }

  return (data ?? []) as SecurityUserRow[]
}
