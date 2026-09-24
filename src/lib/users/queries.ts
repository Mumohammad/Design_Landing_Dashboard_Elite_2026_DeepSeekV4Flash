"use server"

// Read queries for the Users module (Module 14) dashboard surfaces.
//
// Server-side only: migration 058 removed authenticated write breadth on the
// users table, so all reads flow through the service-role admin client after
// requirePermission() — the same pattern as src/lib/auth/user-reads.ts (which
// this module supersedes for the /users dashboard surface).
//
// The projection returns safe fields only: two_factor_secret, locked_until,
// failed_login_attempts and last_login_ip are never exposed to the browser.

import { requirePermission, getCurrentUser } from "@/lib/auth/authorization"
import { createAdminClient } from "@/lib/supabase/admin"
import type { UserStatus } from "./user-utils"

export type UserListItem = {
  id: string
  employee_code: string | null
  full_name_ar: string | null
  full_name_en: string | null
  email: string
  phone: string | null
  role: string
  status: UserStatus
  two_factor_enabled: boolean
  invited_at: string | null
  last_login_at: string | null
  created_at: string
}

export type UsersPageData = {
  users: UserListItem[]
  kpis: {
    total: number
    active: number
    pendingInvite: number
    lockedOrTerminated: number
    twoFactorEnabled: number
    saudiSharePct: number | null
  }
}

function toListItem(row: Record<string, unknown>): UserListItem {
  return {
    id: row.id as string,
    employee_code: (row.employee_code as string | null) ?? null,
    full_name_ar: (row.full_name_ar as string | null) ?? null,
    full_name_en: (row.full_name_en as string | null) ?? null,
    email: row.email as string,
    phone: (row.phone as string | null) ?? null,
    role: row.role as string,
    status: row.status as UserStatus,
    two_factor_enabled: (row.two_factor_enabled as boolean) ?? false,
    invited_at: (row.invited_at as string | null) ?? null,
    last_login_at: (row.last_login_at as string | null) ?? null,
    created_at: row.created_at as string,
  }
}

/**
 * Fetch the tenant's user roster + KPI counts for the /users dashboard page.
 * Requires `users.read`. Empty KPI shares stay null (never fabricated).
 */
export async function fetchUsersPageData(): Promise<UsersPageData> {
  await requirePermission("users", "read")

  const currentUser = await getCurrentUser()
  if (!currentUser) return { users: [], kpis: emptyKpis() }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select(
      "id, employee_code, full_name_ar, full_name_en, email, phone, role, status, two_factor_enabled, invited_at, last_login_at, created_at"
    )
    .eq("tenant_id", currentUser.tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) {
    console.error("[users] fetchUsersPageData failed:", error)
    return { users: [], kpis: emptyKpis() }
  }

  const users = ((data ?? []) as unknown as Record<string, unknown>[]).map(toListItem)

  const total = users.length
  const active = users.filter((u) => u.status === "active").length
  const pendingInvite = users.filter((u) => u.status === "pending_invite").length
  const lockedOrTerminated = users.filter(
    (u) => u.status === "locked" || u.status === "terminated"
  ).length
  const twoFactorEnabled = users.filter((u) => u.two_factor_enabled).length
  // Saudization KPI: Arabic-language profile share of the roster (live DB
  // fact — full_name_ar presence), same approach as the drivers KPI chips.
  const withArabicName = users.filter((u) => (u.full_name_ar ?? "").trim().length > 0).length

  return {
    users,
    kpis: {
      total,
      active,
      pendingInvite,
      lockedOrTerminated,
      twoFactorEnabled,
      saudiSharePct: total > 0 ? Math.round((withArabicName / total) * 100) : null,
    },
  }
}

function emptyKpis(): UsersPageData["kpis"] {
  return {
    total: 0,
    active: 0,
    pendingInvite: 0,
    lockedOrTerminated: 0,
    twoFactorEnabled: 0,
    saudiSharePct: null,
  }
}

export type UserDetail = {
  id: string
  auth_user_id: string
  employee_code: string | null
  full_name_ar: string | null
  full_name_en: string | null
  preferred_name: string | null
  email: string
  phone: string | null
  role: string
  status: UserStatus
  avatar_url: string | null
  two_factor_enabled: boolean
  must_change_password: boolean
  invited_at: string | null
  accepted_invite_at: string | null
  last_login_at: string | null
  created_at: string
  updated_at: string
  /** True when the LATEST `terms` consent row is accepted (PDPL gate). */
  pdplConsent: boolean | null
}

/**
 * Fetch one user (tenant-scoped) for the detail surface. Requires
 * `users.read`. The PDPL gate is evaluated server-side via the
 * has_user_pdpl_consent() definer helper (20260924120000); when the RPC is
 * unavailable the field is null and the UI masks defensively.
 */
export async function fetchUserDetail(userId: string): Promise<UserDetail | null> {
  await requirePermission("users", "read")

  const currentUser = await getCurrentUser()
  if (!currentUser) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select(
      "id, auth_user_id, employee_code, full_name_ar, full_name_en, preferred_name, email, phone, role, status, avatar_url, two_factor_enabled, must_change_password, invited_at, accepted_invite_at, last_login_at, created_at, updated_at"
    )
    .eq("id", userId)
    .eq("tenant_id", currentUser.tenantId)
    .is("deleted_at", null)
    .maybeSingle<Record<string, unknown>>()

  if (error) {
    console.error("[users] fetchUserDetail failed:", error)
    return null
  }
  if (!data) return null

  let pdplConsent: boolean | null = null
  try {
    const { data: consent } = await admin
      .rpc("has_user_pdpl_consent", { p_user_id: userId, p_consent_type: "terms" })
    pdplConsent = consent === true
  } catch {
    pdplConsent = null
  }

  return { ...(data as unknown as UserDetail), pdplConsent }
}
