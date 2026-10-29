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
import {createClient} from "@/lib/supabase/server"
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
 * Requires users.read permission. Uses the caller-bound paged management
 * RPC so tenant, permission and MFA checks remain enforced in the database.
 *
 * Excludes sensitive fields: two_factor_secret, locked_until, failed_login_attempts,
 * last_login_ip, password_changed_at.
 */
export async function fetchUsersForSettings():Promise<SafeUserRow[]>{
 await requirePermission("users","read")
 const client=await createClient();const rows:SafeUserRow[]=[]
 for(let page=1;;page++){const{data,error}=await client.rpc("list_managed_users",{p_surface:"users",p_page:page,p_page_size:100});if(error||!data||!Array.isArray(data.users))throw new Error("Could not load users. Try again.");rows.push(...data.users);if(rows.length>=data.total)return rows;if(!data.users.length)throw new Error("Incomplete user roster")}
}

/**
 * Fetch security overview for the /security page.
 * Requires users.read permission. Returns security-relevant fields
 * (but NOT secret fields like two_factor_secret).
 *
 * failed_login_attempts is included here because it's needed for
 * the security dashboard display (lockout monitoring).
 */
export async function fetchSecurityOverview():Promise<SecurityUserRow[]>{
 await requirePermission("users","read")
 const client=await createClient();const rows:SecurityUserRow[]=[]
 for(let page=1;;page++){const{data,error}=await client.rpc("list_managed_users",{p_surface:"security",p_page:page,p_page_size:100});if(error||!data||!Array.isArray(data.users))throw new Error("Could not load users. Try again.");rows.push(...data.users);if(rows.length>=data.total)return rows;if(!data.users.length)throw new Error("Incomplete user roster")}
}

// ─── Audit Log ──────────────────────────────────────────────────────────

export type AuditLogRow = {
  id: string
  module: string
  entity_type: string | null
  action: string
  actor_id: string | null
  ip_address: string | null
  created_at: string
  new_values: Record<string, unknown> | null
}

/**
 * Fetch audit log entries for the /audit-log page.
 * Requires audit_log.read permission (or general_manager bypass).
 * Uses the caller-bound safe view, which enforces tenant, MFA, permission
 * and metadata privacy independently in the database.
 */
export async function fetchAuditLog(): Promise<AuditLogRow[]> {
  await requirePermission("audit_log", "read")

  const currentUser = await getCurrentUser()
  if (!currentUser) return []

  const caller = await createClient()
  const { data, error } = await caller
    .from("audit_log_safe")
    .select("id, module, entity_type, action, actor_id, ip_address, created_at, new_values")
    .eq("tenant_id", currentUser.tenantId)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) {
    console.error("[audit-log] safe audit read failed")
    throw new Error("Could not load audit history. Try again.")
  }

  return (data ?? []) as AuditLogRow[]
}

// ─── Roles ──────────────────────────────────────────────────────────────

export type RoleRow = {
  id: string
  name: string
  name_ar: string
  name_en: string
  description: string | null
  is_system_role: boolean
}

/**
 * Fetch roles for the /roles page.
 * Requires roles.read permission (or general_manager bypass).
 * Returns only non-deleted roles for the current tenant.
 */
export async function fetchRoles(): Promise<RoleRow[]> {
  await requirePermission("roles", "read")

  const currentUser = await getCurrentUser()
  if (!currentUser) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("roles")
    .select("id, name, name_ar, name_en, description, is_system_role")
    .eq("tenant_id", currentUser.tenantId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) {
    console.error("[roles] fetchRoles failed:", error)
    return []
  }

  return (data ?? []) as RoleRow[]
}

// ─── Security Account + Policies ────────────────────────────────────────

export type SecurityAccount = {
  full_name_ar: string | null
  full_name_en: string | null
  email: string
  two_factor_enabled: boolean
  must_change_password: boolean
  last_login_at: string | null
  password_changed_at: string | null
  is_locked: boolean
}

export type SecurityPolicy = {
  key: string
  value: string
}

export type SecurityPageData = {
  account: SecurityAccount | null
  policies: SecurityPolicy[]
}

/**
 * Fetch the current user's security account info and org security policies.
 * The current user can always read their own account (no special permission needed).
 * Organization security policies require settings.read permission.
 *
 * Returns only safe fields — never exposes two_factor_secret, locked_until,
 * failed_login_attempts, or last_login_ip to the browser.
 */
export async function fetchSecurityPageData(): Promise<SecurityPageData> {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { account: null, policies: [] }

  const admin = createAdminClient()

  // Fetch own account — safe fields only
  const { data: me } = await admin
    .from("users")
    .select(
      "full_name_ar, full_name_en, email, two_factor_enabled, must_change_password, last_login_at, password_changed_at, locked_until"
    )
    .eq("auth_user_id", currentUser.authUserId)
    .is("deleted_at", null)
    .maybeSingle<Record<string, unknown>>()

  let account: SecurityAccount | null = null
  if (me) {
    const lockedUntil = me.locked_until as string | null
    account = {
      full_name_ar: me.full_name_ar as string | null,
      full_name_en: me.full_name_en as string | null,
      email: me.email as string,
      two_factor_enabled: me.two_factor_enabled as boolean,
      must_change_password: me.must_change_password as boolean,
      last_login_at: me.last_login_at as string | null,
      password_changed_at: me.password_changed_at as string | null,
      is_locked: lockedUntil ? new Date(lockedUntil) > new Date() : false,
    }
  }

  // Fetch security policies — requires settings.read
  let policies: SecurityPolicy[] = []
  try {
    await requirePermission("settings", "read")
    const { data: policyRows } = await admin
      .from("system_settings")
      .select("key, value")
      .ilike("key", "security.%")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("key", { ascending: true })
    policies = (policyRows ?? []) as SecurityPolicy[]
  } catch {
    // Permission denied for settings — show account only, no policies
  }

  return { account, policies }
}
