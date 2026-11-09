import type { SupabaseClient } from "@supabase/supabase-js"

type Profile = { tenantId: string; role: string }
/** Caller-bound grant snapshot, read on every request before any cache hit. */
export async function readDashboardAuthorizationScope(client: SupabaseClient, profile: Profile): Promise<string | null> {
  try {
    const { data, error } = await client.from("roles")
      .select("id,name,role_permissions(permission_id,permissions(module,action))")
      .eq("tenant_id", profile.tenantId).eq("name", profile.role).is("deleted_at", null)
      .limit(1000, { referencedTable: "role_permissions" }).maybeSingle()
    if (error || !data || data.name !== profile.role || typeof data.id !== "string" ||
        !Array.isArray(data.role_permissions) || data.role_permissions.length >= 1000) return null
    const grants: string[] = []
    for (const value of data.role_permissions as unknown[]) {
      if (!value || typeof value !== "object") return null
      const grant = value as Record<string, unknown>
      const permission = grant.permissions
      if (typeof grant.permission_id !== "string" || !permission || typeof permission !== "object" || Array.isArray(permission)) return null
      const entry = permission as Record<string, unknown>
      if (typeof entry.module !== "string" || typeof entry.action !== "string") return null
      grants.push(JSON.stringify([grant.permission_id, entry.module, entry.action]))
    }
    // Role alone is insufficient: changing grants without changing the role
    // must make every old permission-sensitive dashboard entry unreachable.
    return JSON.stringify([data.id, profile.role, grants.sort()])
  } catch { return null }
}
