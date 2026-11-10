import "server-only"

import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/auth/authorization"

/** Branding shown in the dashboard chrome (sidebar header + account menu). */
export type WorkspaceBranding = {
  companyNameAr: string
  companyNameEn: string
  logoUrl: string | null
  userName: string
  userEmail: string
  userAvatar: string | null
}

/**
 * The signed-in user's own company name/logo and identity. Reads only the
 * caller's tenant row and user row (scoped by the session profile). Returns
 * null before MFA step-up or when unauthenticated — the chrome then falls
 * back to neutral labels instead of another company's details.
 */
export const getWorkspaceBranding = cache(async (): Promise<WorkspaceBranding | null> => {
  try {
    const me = await getCurrentUser()
    if (!me) return null
    const admin = createAdminClient()
    const [tenantRes, userRes] = await Promise.all([
      admin.from("tenants").select("name_ar,name_en,logo_url").eq("id", me.tenantId).maybeSingle(),
      admin
        .from("users")
        .select("full_name_ar,full_name_en,preferred_name,email,avatar_url")
        .eq("id", me.id)
        .eq("tenant_id", me.tenantId)
        .maybeSingle(),
    ])
    const tenant = tenantRes.data
    const user = userRes.data
    if (!tenant) return null
    const logoUrl = safeImageUrl(tenant.logo_url)
    return {
      companyNameAr: tenant.name_ar || tenant.name_en || "",
      companyNameEn: tenant.name_en || tenant.name_ar || "",
      logoUrl,
      userName: user?.preferred_name || user?.full_name_ar || user?.full_name_en || user?.email || "",
      userEmail: user?.email ?? "",
      userAvatar: safeImageUrl(user?.avatar_url),
    }
  } catch {
    return null
  }
})

/** https URLs, or the configured Supabase origin (local stack is http). */
function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null
  try {
    const url = new URL(value)
    if (url.protocol === "https:") return url.toString()
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (supabase && url.origin === new URL(supabase).origin) return url.toString()
  } catch {
    return null
  }
  return null
}
