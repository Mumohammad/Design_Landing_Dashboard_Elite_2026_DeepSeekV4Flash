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
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { UserStatus } from "./user-utils"

export type UserListItem = {
  version: number
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
  total: number
  page: number
  pageSize: number
  isOwner: boolean
  kpis: {
    total: number
    active: number
    pendingInvite: number
    lockedOrTerminated: number
    twoFactorEnabled: number
    saudiSharePct: number | null
  }
}



/**
 * Fetch the tenant's user roster + KPI counts for the /users dashboard page.
 * Requires `users.read`. Empty KPI shares stay null (never fabricated).
 */
export async function fetchUsersPageData(options:{page?:number;search?:string;status?:string;role?:string;pageSize?:number}={}):Promise<UsersPageData>{
 await requirePermission("users","read")
 if(!await getCurrentUser())throw new Error("Not authenticated.")
 const client=await createClient()
 const{data,error}=await client.rpc("list_managed_users",{p_surface:"users",p_search:options.search??"",p_status:options.status??"all",p_role:options.role??"all",p_page:options.page??1,p_page_size:options.pageSize??25})
 if(error||!data||!Array.isArray(data.users))throw new Error("Could not load users. Try again.")
 return data as UsersPageData
}



export type UserDetail = {
  version: number
  isOwner: boolean
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
      "id, version, auth_user_id, employee_code, full_name_ar, full_name_en, preferred_name, email, phone, role, status, avatar_url, two_factor_enabled, must_change_password, invited_at, accepted_invite_at, last_login_at, created_at, updated_at"
    )
    .eq("id", userId)
    .eq("tenant_id", currentUser.tenantId)
    .is("deleted_at", null)
    .maybeSingle<Record<string, unknown>>()

  if (error) {
    throw new Error("Could not load the user profile. Try again.")
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

  return { ...(data as unknown as UserDetail),phone:pdplConsent===true?data.phone as string|null:null, pdplConsent,isOwner:currentUser.role==="general_manager" }
}
