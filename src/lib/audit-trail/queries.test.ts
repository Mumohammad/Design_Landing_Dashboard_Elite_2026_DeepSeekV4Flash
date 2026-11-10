import { beforeEach, describe, expect, it, vi } from "vitest"

const ACTOR_A = "11111111-1111-4111-8111-111111111111"
const ACTOR_B = "22222222-2222-4222-8222-222222222222"
const ENTITY = "33333333-3333-4333-8333-333333333333"
const ID = "44444444-4444-4444-8444-444444444444"
const mocks = vi.hoisted(() => ({
  permission: vi.fn(async (_module: string, _action: string) => { void _module; void _action }),
  can: vi.fn(async (_module: string, _action: string) => { void _module; void _action; return { allowed: false } }),
  user: vi.fn(async (): Promise<{ tenantId: string } | null> => ({ tenantId: "caller-tenant" })),
  rpc: vi.fn(async (_name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => { void _name; void _args; return { data: [], error: null } }),
  admin: vi.fn(() => { throw Error("Privileged audit lookup is forbidden") }),
  directory: vi.fn(() => { throw Error("Actor directory enumeration is forbidden") }),
  client: vi.fn(),
}))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user, can: mocks.can }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))
import { exportAuditTrailPage, fetchAuditTrailPage } from "./queries"

const row = (id = ID, actor: string | null = ACTOR_A) => ({
  id, created_at: "2026-10-23T12:30:00Z", module: "expenses", action: "approved",
  entity_type: "expense", entity_id: ENTITY, actor_id: actor,
  ip_address: null, reason: null, old_values: null, new_values: { status: "approved", correction_version: 2 },
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue()
  mocks.can.mockResolvedValue({ allowed: false })
  mocks.user.mockResolvedValue({ tenantId: "caller-tenant" })
  mocks.rpc.mockResolvedValue({ data: [row()], error: null })
  mocks.client.mockResolvedValue({ rpc: mocks.rpc, from: mocks.directory })
})

describe("audit privacy and permission boundaries", () => {
  it("lets a custom read-only role inspect its page without exporting or enumerating the user directory", async () => {
    const result = await fetchAuditTrailPage()
    expect(result.canExport).toBe(false)
    expect(result.rows).toEqual([row()])
    expect(mocks.permission).toHaveBeenCalledWith("audit_log", "read")
    expect(mocks.can).toHaveBeenCalledWith("audit_log", "export")
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc.mock.calls[0][0]).toBe("fetch_audit_trail_page")
  })
  it("derives actor options and labels only from distinct auth actors in returned allowed rows", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [row(), row("55555555-5555-4555-8555-555555555555", ACTOR_B), row("66666666-6666-4666-8666-666666666666", ACTOR_A), row("77777777-7777-4777-8777-777777777777", null)], error: null })
    const result = await fetchAuditTrailPage()
    expect(result.actorOptions).toEqual([{ id: ACTOR_A, name: ACTOR_A }, { id: ACTOR_B, name: ACTOR_B }])
    expect(result.actorNames).toEqual({ [ACTOR_A]: ACTOR_A, [ACTOR_B]: ACTOR_B })
    expect(result.actorsConsented).toEqual({})
    expect(result.kpis).toEqual({ total: 4, distinctActors: 2, distinctEntities: 1 })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.directory).not.toHaveBeenCalled()
  })
  it("exposes no previously seen actors after a filtered page becomes empty", async () => {
    await fetchAuditTrailPage()
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await fetchAuditTrailPage({ actor: ACTOR_B })).toMatchObject({ rows: [], actorOptions: [], actorNames: {}, actorsConsented: {}, kpis: { total: 0, distinctActors: 0, distinctEntities: 0 } })
  })
  it("discards unexpected directory fields instead of exposing a name or email fallback", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...row(), email: "private@example.invalid", full_name_en: "Private User", actor_directory: ["not permitted"] }], error: null })
    const result = await fetchAuditTrailPage()
    expect(JSON.stringify(result)).not.toContain("private@example")
    expect(JSON.stringify(result)).not.toContain("Private User")
    expect(JSON.stringify(result)).not.toContain("not permitted")
  })
  it("does not turn export permission-check failure into read failure or export access", async () => {
    mocks.can.mockRejectedValueOnce(Error("Private provider diagnostic"))
    expect((await fetchAuditTrailPage()).canExport).toBe(false)
  })
  it("never returns a successful empty list for a missing verified user", async () => {
    mocks.user.mockResolvedValueOnce(null)
    await expect(fetchAuditTrailPage()).rejects.toThrow("Could not load the audit trail")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("enforces read authorization before any data query", async () => {
    mocks.permission.mockRejectedValueOnce(Error("Denied"))
    await expect(fetchAuditTrailPage()).rejects.toThrow("Denied")
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("rejects a read-only custom role that directly invokes the export server action", async () => {
    mocks.permission.mockImplementation(async (_module, action) => { if (action === "export") throw Error("Export denied") })
    await expect(exportAuditTrailPage()).rejects.toThrow("Export denied")
    expect(mocks.permission.mock.calls).toEqual([["audit_log", "export"]])
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("requires read permission as well as export permission on every export request", async () => {
    mocks.permission.mockImplementation(async (_module, action) => { if (action === "read") throw Error("Read denied") })
    await expect(exportAuditTrailPage()).rejects.toThrow("Read denied")
    expect(mocks.permission.mock.calls).toEqual([["audit_log", "export"], ["audit_log", "read"]])
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("rechecks permission after a previously permitted page was loaded", async () => {
    mocks.can.mockResolvedValueOnce({ allowed: true })
    expect((await fetchAuditTrailPage()).canExport).toBe(true)
    mocks.permission.mockImplementation(async (_module, action) => { if (action === "export") throw Error("Permission revoked") })
    await expect(exportAuditTrailPage()).rejects.toThrow("Permission revoked")
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it("uses caller identity, current server filters and the capped page for an authorized export", async () => {
    const filters = { actor: ACTOR_A, from: "2026-10-01", to: "2026-10-23", action: "approved", module: "expenses", entityType: "expense", entityId: ENTITY, tenantId: "forged", actorNames: { [ACTOR_A]: "forged" } }
    const result = await exportAuditTrailPage(filters, 999)
    expect(result.canExport).toBe(true)
    expect(result.pageSize).toBe(100)
    expect(result.actorNames).toEqual({ [ACTOR_A]: ACTOR_A })
    expect(mocks.rpc).toHaveBeenCalledWith("fetch_audit_trail_page", {
      p_tenant_id: "caller-tenant", p_from: "2026-10-01T00:00:00", p_to: "2026-10-23T23:59:59.999",
      p_actor_user_id: ACTOR_A, p_action: "approved", p_module: "expenses", p_entity_type: "expense", p_entity_id: ENTITY, p_limit: 100,
    })
    expect(mocks.can).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})

describe("safe audit read failures and page bounds", () => {
  it.each([{ actor: "invalid" }, { entityId: "invalid" }])("rejects an invalid identifier without silently broadening its filter", async filters => {
    await expect(exportAuditTrailPage(filters)).rejects.toThrow("Could not load the audit trail")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([[0, 1], [-1, 1], [1.9, 1], [1000, 100], [Number.NaN, 50], [Infinity, 50]])("bounds page size %s to %s", async (size, expected) => {
    const result = await fetchAuditTrailPage({ actor: "all", action: "all", module: "all", entityType: "all" }, size)
    expect(result.pageSize).toBe(expected)
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_limit: expected, p_actor_user_id: null, p_action: null, p_module: null, p_entity_type: null })
  })
  it.each([
    null, {}, [{ ...row(), actor_id: "not-an-auth-UUID" }], [{ ...row(), created_at: "invalid" }],
    [{ ...row(), new_values: [] }], [{ ...row(), old_values: "private" }], [{ ...row(), reason: { private: true } }], [row(), row()],
  ])("rejects malformed or duplicate row receipts", async data => {
    mocks.rpc.mockResolvedValueOnce({ data, error: null })
    await expect(fetchAuditTrailPage()).rejects.toThrow("Could not load the audit trail")
  })
  it("does not accept a server response above the requested page cap", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [row(), row("55555555-5555-4555-8555-555555555555")], error: null })
    await expect(fetchAuditTrailPage({}, 1)).rejects.toThrow("Could not load the audit trail")
  })
  it("surfaces RPC failure without exposing or logging raw audit diagnostics", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "private raw payload and email" } })
      await expect(fetchAuditTrailPage()).rejects.toThrow("Could not load the audit trail. Refresh and try again.")
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
  it("sanitizes transport failures from both client construction and the RPC", async () => {
    mocks.client.mockRejectedValueOnce(Error("Private connection diagnostic"))
    await expect(fetchAuditTrailPage()).rejects.toThrow("Could not load the audit trail. Refresh and try again.")
    mocks.rpc.mockRejectedValueOnce(Error("Private raw row"))
    await expect(exportAuditTrailPage()).rejects.toThrow("Could not load the audit trail. Refresh and try again.")
  })
})
