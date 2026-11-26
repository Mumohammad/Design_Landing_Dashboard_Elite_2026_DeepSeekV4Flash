import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  enabled: true,
  run: vi.fn(),
  rpc: vi.fn(),
  tenants: [] as { tenant_id: string; token: string; scan: unknown }[],
}))
vi.mock("@/lib/release/integrations", () => ({ integrationAvailable: () => m.enabled, INTEGRATION_UNAVAILABLE: "Unavailable" }))
vi.mock("@/lib/accounting/zatca-adapter-core", () => ({ runZatcaForTenant: m.run }))
vi.mock("@/lib/logger", () => ({ moduleLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: m.rpc }) }))
import { GET } from "./route"

const req = (auth?: string) => new Request("https://example.test/api/cron/zatca", { headers: auth ? { authorization: auth } : {} })

describe("GET /api/cron/zatca", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret")
    m.enabled = true
    m.run.mockReset()
    m.tenants = [{ tenant_id: "t1", token: "claim-1", scan: null }, { tenant_id: "t2", token: "claim-2", scan: null }]
    const queue = [...m.tenants]
    m.rpc.mockReset().mockImplementation(async (name: string) => ({
      data: name === "claim_zatca_scheduled_tenant" ? queue.shift() ?? null : true,
      error: null,
    }))
  })
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
    expect(m.run).toHaveBeenCalledWith("t1", undefined, expect.objectContaining({ scan: null, stopAt: expect.any(Number) }))
    expect(m.run).toHaveBeenCalledWith("t2", undefined, expect.objectContaining({ scan: null, stopAt: expect.any(Number) }))
    expect(m.rpc).toHaveBeenCalledWith("finish_zatca_scheduled_tenant", {
      p_tenant: "t2", p_token: "claim-2", p_progress: null,
    })
  })

  it("passes a saved scan into the turn and checkpoints it with the same claim token", async () => {
    const scan = { environment: "sandbox", through: "2026-11-01T00:00:00Z", cursor: { created_at: "2026-10-31T12:00:00Z", id: "event-1" } }
    m.tenants[0].scan = scan
    m.run.mockResolvedValueOnce({ success: true, scheduledProgress: { scan: null } })
      .mockResolvedValueOnce({ success: true })

    expect((await GET(req("Bearer s3cret"))).status).toBe(200)
    expect(m.run).toHaveBeenCalledWith("t1", undefined, expect.objectContaining({ scan }))
    expect(m.rpc).toHaveBeenCalledWith("finish_zatca_scheduled_tenant", {
      p_tenant: "t1", p_token: "claim-1", p_progress: { scan: null },
    })
  })

  it("reports a scheduler database error without running an unclaimed tenant", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "private scheduler failure" } })
    const res = await GET(req("Bearer s3cret"))

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: "Unable to checkpoint ZATCA retry scheduling" })
    expect(m.run).not.toHaveBeenCalled()
  })

  it("reports failed checkpoints so a lost database write is visible", async () => {
    m.run.mockResolvedValue({ success: true, processed: 2 })
    let available = true
    m.rpc.mockImplementation(async (name: string) => {
      if (name === "finish_zatca_scheduled_tenant") return { data: false, error: null }
      const data = available ? m.tenants[0] : null
      available = false
      return { data, error: null }
    })

    const res = await GET(req("Bearer s3cret"))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ tenants: 1, processed: 2, tenantsFailed: 0 })
  })

  it("bounds the invocation to 200 claimed tenants and four simultaneous turns", async () => {
    let claimCount = 0, active = 0, peakActive = 0
    m.rpc.mockImplementation(async (name: string) => {
      if (name === "finish_zatca_scheduled_tenant") return { data: true, error: null }
      const id = ++claimCount
      return { data: { tenant_id: `tenant-${id}`, token: `claim-${id}`, scan: null }, error: null }
    })
    m.run.mockImplementation(async () => {
      peakActive = Math.max(peakActive, ++active)
      await Promise.resolve()
      active--
      return { success: true }
    })

    const res = await GET(req("Bearer s3cret"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ tenants: 200 })
    expect(claimCount).toBe(200)
    expect(peakActive).toBe(4)
  })
})
