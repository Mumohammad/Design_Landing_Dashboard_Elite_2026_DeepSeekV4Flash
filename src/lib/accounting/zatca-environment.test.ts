import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ single: vi.fn(), from: vi.fn(), eq: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
import { tenantZatcaProductionOn, resolveTenantZatcaEnvironment } from "./zatca-environment"
type Admin = Parameters<typeof tenantZatcaProductionOn>[0]
const tenant = "11111111-2222-3333-4444-555555555555"
const query = { select: () => query, eq: m.eq, maybeSingle: m.single }
const admin = { from: m.from } as unknown as Admin
beforeEach(() => {
  vi.clearAllMocks()
  m.from.mockReturnValue(query); m.eq.mockReturnValue(query)
  m.single.mockResolvedValue({ data: { production_enabled: false }, error: null })
  vi.stubEnv("ZATCA_MODE", "simulation")
  vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation")
})
afterEach(() => vi.unstubAllEnvs())

describe("tenant environment routing", () => {
  it("uses an explicitly confirmed OFF preference scoped to the tenant", async () => {
    expect(await resolveTenantZatcaEnvironment(admin, tenant)).toBe("simulation")
    expect(m.from).toHaveBeenCalledWith("zatca_tenant_environment")
    expect(m.eq).toHaveBeenCalledWith("tenant_id", tenant)
  })
  it("treats only a successful missing preference as the default OFF", async () => {
    m.single.mockResolvedValue({ data: null, error: null })
    expect(await tenantZatcaProductionOn(admin, tenant)).toBe(false)
  })
  it.each([
    { data: null, error: { message: "unavailable" } },
    { data: { production_enabled: false }, error: { message: "permission" } },
    { data: {}, error: null },
    { data: { production_enabled: "false" }, error: null },
  ])("fails closed rather than selecting simulation when the preference is unverified", async response => {
    m.single.mockResolvedValue(response)
    await expect(resolveTenantZatcaEnvironment(admin, tenant)).rejects.toThrow("ZATCA environment could not be verified. Reload before continuing.")
  })
  it("does not silently downgrade an existing ON preference", async () => {
    m.single.mockResolvedValue({ data: { production_enabled: true }, error: null })
    await expect(resolveTenantZatcaEnvironment(admin, tenant)).rejects.toThrow("independent authority acceptance")
  })
  it("blocks a production deployment before reading tenant routing", async () => {
    vi.stubEnv("ZATCA_MODE", "production"); vi.stubEnv("ZATCA_PRODUCTION_ENABLED", "true")
    await expect(resolveTenantZatcaEnvironment(admin, tenant)).rejects.toThrow("independent authority acceptance")
    expect(m.from).not.toHaveBeenCalled()
  })
  it("validates the gateway instead of turning invalid configuration into offline success", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://attacker.example.test")
    await expect(resolveTenantZatcaEnvironment(admin, tenant)).rejects.toThrow("does not match")
    expect(m.from).not.toHaveBeenCalled()
  })
  it("keeps explicit offline mock mode offline without a database preference read", async () => {
    vi.stubEnv("ZATCA_MODE", "mock"); vi.stubEnv("ZATCA_API_BASE_URL", "")
    expect(await resolveTenantZatcaEnvironment(admin, tenant)).toBeNull()
    expect(m.from).not.toHaveBeenCalled()
  })
})
