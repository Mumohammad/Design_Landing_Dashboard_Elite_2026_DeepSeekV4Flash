// Per-tenant ZATCA environment resolution (server only).
//
// Production remains blocked in this release. A stored production preference
// cannot silently route a tenant to simulation, and read failures cannot be
// mistaken for a confirmed OFF preference.
import { createAdminClient } from "@/lib/supabase/admin"
import { zatcaConfiguredEnvironment, getZatcaNetworkBase, ZATCA_PRODUCTION_BLOCKED, ZATCA_ENVIRONMENT_UNAVAILABLE, type ZatcaEnvironment } from "./zatca-config"

type Admin = ReturnType<typeof createAdminClient>

export async function tenantZatcaProductionOn(admin: Admin, tenantId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("zatca_tenant_environment")
    .select("production_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ production_enabled: boolean }>()
  if (error || (data != null && typeof data.production_enabled !== "boolean")) throw new Error(ZATCA_ENVIRONMENT_UNAVAILABLE)
  return data?.production_enabled === true
}

export async function resolveTenantZatcaEnvironment(admin: Admin, tenantId: string): Promise<ZatcaEnvironment | null> {
  // Validate configuration directly: availability helpers deliberately return
  // false for diagnostics, whereas routing must fail closed on invalid config.
  if (getZatcaNetworkBase() === null) return null
  const test = zatcaConfiguredEnvironment()
  if (!test) throw new Error(ZATCA_ENVIRONMENT_UNAVAILABLE)
  if (await tenantZatcaProductionOn(admin, tenantId)) throw new Error(ZATCA_PRODUCTION_BLOCKED)
  return test
}
