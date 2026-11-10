import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ enabled: true, run: vi.fn(), tenants: [] as { tenant_id: string }[] }))
vi.mock("@/lib/release/integrations", () => ({ integrationAvailable: () => m.enabled, INTEGRATION_UNAVAILABLE: "Unavailable" }))
vi.mock("@/lib/accounting/zatca-adapter-core", () => ({ runZatcaForTenant: m.run }))
vi.mock("@/lib/logger", () => ({ moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q: Record<string, unknown> = {}
    for (const k of ["from", "select", "eq", "order"]) q[k] = () => q
    q.limit = async () => ({ data: m.tenants, error: null })
    return q
  },
}))
import { GET } from "./route"

const req = (auth?: string) => new Request("https://example.test/api/cron/zatca", { headers: auth ? { authorization: auth } : {} })

describe("GET /api/cron/zatca", () => {
  beforeEach(() => { vi.stubEnv("CRON_SECRET", "s3cret"); m.enabled = true; m.run.mockReset(); m.tenants = [{ tenant_id: "t1" }, { tenant_id: "t2" }] })
  afterEach(() => vi.unstubAllEnvs())

  it("fails closed without CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "")
    expect((await GET(req("Bearer s3cret"))).status).toBe(503)
  })
  it("rejects a wrong bearer", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401)
    expect(m.run).not.toHaveBeenCalled()
  })
  it("does nothing while the ZATCA gateway is not configured", async () => {
    m.enabled = false
    expect((await GET(req("Bearer s3cret"))).status).toBe(503)
    expect(m.run).not.toHaveBeenCalled()
  })
  it("runs every tenant with a registered operator and isolates failures", async () => {
    m.run.mockResolvedValueOnce({ success: true, processed: 2, failed: 1 }).mockRejectedValueOnce(new Error("boom"))
    const res = await GET(req("Bearer s3cret"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenants: 2, processed: 2, failed: 1, tenantsFailed: 1 })
    expect(m.run).toHaveBeenCalledWith("t1")
    expect(m.run).toHaveBeenCalledWith("t2")
  })
})
