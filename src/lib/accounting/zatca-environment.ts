// Per-tenant ZATCA environment resolution (server only).
//
// Effective environment for a tenant:
//   production — the deployment is production-capable (zatca-config.ts) AND
//                the tenant's administrator switched production ON.
//   otherwise  — the deployment's test environment (sandbox/simulation),
//                or null when no gateway is configured (offline mock).
import { createAdminClient } from "@/lib/supabase/admin"
import { zatcaConfiguredEnvironment, zatcaProductionAvailable, type ZatcaEnvironment } from "./zatca-config"

type Admin = ReturnType<typeof createAdminClient>

export async function tenantZatcaProductionOn(admin: Admin, tenantId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("zatca_tenant_environment")
    .select("production_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ production_enabled: boolean }>()
  if (error) return false
  return data?.production_enabled === true
}

export async function resolveTenantZatcaEnvironment(admin: Admin, tenantId: string): Promise<ZatcaEnvironment | null> {
  const test = zatcaConfiguredEnvironment()
  if (!test) return null
  if (zatcaProductionAvailable() && await tenantZatcaProductionOn(admin, tenantId)) return "production"
  return test
}
