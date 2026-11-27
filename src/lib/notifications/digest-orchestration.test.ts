import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), collect: vi.fn(), send: vi.fn(), feed: vi.fn(), settings: { data: null as unknown, error: null as unknown } }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/reports/collect-rows", () => ({ collectRows: mocks.collect }))
vi.mock("@/lib/email/send", () => ({ sendEmail: mocks.send }))
vi.mock("./feed-loader", () => ({ loadTenantFeed: mocks.feed }))
vi.mock("./digest-email", () => ({ buildDigestEmail: () => ({ subject: "Synthetic", html: "<p>Synthetic</p>", text: "Synthetic" }) }))
import { runDigestForTenant } from "./digest"
import { DEFAULT_DIGEST_SETTINGS } from "./digest-schema"
const tenant = "20000000-0000-4000-8000-000000000001", id = "20000000-0000-4000-8000-000000000002", token = "20000000-0000-4000-8000-000000000003"
const admin = { from: mocks.from, rpc: mocks.rpc } as unknown as Parameters<typeof runDigestForTenant>[0]
let savedPayload: unknown
beforeEach(() => {
  vi.clearAllMocks()
  savedPayload = null
  mocks.settings = { data: null, error: null }
  mocks.from.mockImplementation(table => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => table === "notification_settings" ? mocks.settings : { data: { name_en: "Synthetic company" }, error: null } }
    return chain
  })
  mocks.collect.mockResolvedValue([{ id: token, email: "synthetic@example.test" }])
  mocks.feed.mockResolvedValue({ total: 1, items: [{ severity: "critical" }] })
  mocks.send.mockResolvedValue({ ok: true, id: "synthetic-provider-message" })
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "claim_notification_digest") return { data: { id, claim_token: token, payload: savedPayload }, error: null }
    if (name === "prepare_notification_digest") { savedPayload = args.p_payload; return { data: args.p_payload, error: null } }
    return { data: true, error: null }
  })
})
describe("scheduled digest failure and retry boundaries", () => {
  it("never sends or claims when saved settings cannot be read", async () => {
    mocks.settings.error = { message: "private database detail" }
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("failed")
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("does not replace invalid or disabled saved settings with enabled defaults", async () => {
    mocks.settings.data = { enabled: false }
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("failed")
    mocks.settings.data = { ...DEFAULT_DIGEST_SETTINGS, enabled: false }
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("not_due")
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("reports a claim outage as failure and a competing lease as not due", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "08006" } })
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("failed")
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("not_due")
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("does not send or claim no alerts when a required feed source fails", async () => {
    mocks.feed.mockRejectedValueOnce(Error("required source unavailable"))
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("failed")
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_notification_digest", expect.objectContaining({ p_patch: expect.objectContaining({ status: "failed" }) }))
  })
  it("requires confirmed payload persistence before sending", async () => {
    mocks.rpc.mockImplementation(async name => name === "claim_notification_digest" ? { data: { id, claim_token: token, payload: null }, error: null } : { data: null, error: { code: "08006" } })
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("failed")
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("replays the same persisted body and provider key after an unknown send", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, error: "timeout" })
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("failed")
    mocks.feed.mockResolvedValue({ total: 99, items: [] })
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("sent")
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect(mocks.feed).toHaveBeenCalledTimes(1)
  })
  it("does not resend retained content after delivery authorization changes", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, error: "timeout" })
    await runDigestForTenant(admin, tenant, "2026-11-01")
    mocks.collect.mockResolvedValue([{ id: token, email: "different@example.test" }])
    expect(await runDigestForTenant(admin, tenant, "2026-11-01")).toBe("failed")
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})
