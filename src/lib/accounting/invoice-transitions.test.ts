import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), client: vi.fn(), admin: vi.fn(), from: vi.fn(), posting: vi.fn(),
  permission: vi.fn(), user: vi.fn(), rate: vi.fn(), audit: vi.fn(), dispatch: vi.fn(), zatca: vi.fn(), cache: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.cache }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitAccounting: mocks.rate }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/accounting/dispatcher", () => ({ runEventDispatcher: mocks.dispatch }))
vi.mock("@/lib/accounting/zatca", () => ({ runZatcaAdapter: mocks.zatca }))
import { finalizeInvoice, issueInvoice } from "./invoices"

const input = { id: "80111111-1111-4111-8111-111111111111", expected_updated_at: "2026-10-21T00:00:00.123456+00:00" }
const event = "80222222-2222-4222-8222-222222222222"
const receipt = { id: input.id, invoice_type: "sales", operation: "finalize", event_id: event, replayed: false }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: "staff", authUserId: "actor", tenantId: "tenant" })
  mocks.rate.mockResolvedValue({ success: true })
  mocks.client.mockResolvedValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: receipt, error: null })
  mocks.admin.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: mocks.posting })
  mocks.posting.mockResolvedValue({ data: { processing_status: "processed" }, error: null })
})

describe("invoice issue and approval transaction boundary", () => {
  it("uses the authenticated RPC with the exact reviewed timestamp, without supplied actor or tenant", async () => {
    expect(await finalizeInvoice(input)).toEqual({ success: true, replayed: false, postingPending: false })
    expect(mocks.rpc).toHaveBeenCalledWith("transition_my_invoice", {
      p_invoice_id: input.id, p_operation: "finalize", p_expected_updated_at: input.expected_updated_at,
    })
    expect(mocks.permission).toHaveBeenCalledWith("invoices", "approve")
    expect(mocks.from).toHaveBeenCalledWith("financial_events")
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("issues without dispatching, privileged writes or a second audit", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, operation: "issue", event_id: null }, error: null })
    expect(await issueInvoice(input)).toEqual({ success: true, replayed: false })
    expect(mocks.permission).toHaveBeenCalledWith("invoices", "update")
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("confirms a replay without creating another decision", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null })
    expect(await finalizeInvoice(input)).toMatchObject({ success: true, replayed: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it("does not transmit purchase invoices to the sales adapter", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, invoice_type: "purchase" }, error: null })
    expect((await finalizeInvoice(input)).success).toBe(true)
    expect(mocks.zatca).not.toHaveBeenCalled()
  })
  it.each(["pending", "failed", null])("discloses unconfirmed posting (%s) after successful approval", async (status) => {
    mocks.posting.mockResolvedValue({ data: status ? { processing_status: status } : null, error: null })
    expect(await finalizeInvoice(input)).toMatchObject({ success: true, postingPending: true })
  })
  it.each(["skipped_duplicate", "processed"])("confirms this invoice's persisted posting (%s)", async (status) => {
    mocks.dispatch.mockResolvedValue({ success: true, failed: 9 }) // Unrelated batch failures are not this document's result.
    mocks.posting.mockResolvedValue({ data: { processing_status: status }, error: null })
    expect(await finalizeInvoice(input)).toMatchObject({ success: true, postingPending: false })
  })
  it("retains the committed approval through dispatcher, adapter and cache exceptions", async () => {
    mocks.dispatch.mockRejectedValue(Error("private diagnostic"))
    mocks.zatca.mockRejectedValue(Error("private diagnostic"))
    mocks.cache.mockImplementation(() => { throw Error("cache failed") })
    expect(await finalizeInvoice(input)).toMatchObject({ success: true, postingPending: true })
  })
  it("does not treat a failed posting read as confirmed", async () => {
    mocks.posting.mockResolvedValue({ data: { processing_status: "processed" }, error: { message: "private" } })
    expect(await finalizeInvoice(input)).toMatchObject({ success: true, postingPending: true })
  })
  it("maps stale versions to public bilingual errors without provider details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "INV015: private database diagnostic" } })
    const result = await finalizeInvoice(input)
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Reload"), errorAr: expect.any(String) })
    expect(JSON.stringify(result)).not.toContain("private")
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it("redacts unknown transaction errors and never dispatches after failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "secret provider details" } })
    expect(JSON.stringify(await finalizeInvoice(input))).not.toContain("secret")
    expect((await finalizeInvoice(input)).success).toBe(false)
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.cache).not.toHaveBeenCalled()
  })
  it.each([null, { ...receipt, id: event }, { ...receipt, operation: "issue" }, { ...receipt, event_id: null },
    { ...receipt, invoice_type: "other" }, { ...receipt, replayed: "false" }])("requires a complete matching receipt (%j)", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect((await finalizeInvoice(input)).success).toBe(false)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it.each([{ id: "" }, { expected_updated_at: "" }, { expected_updated_at: "invalid" }])("rejects incomplete decision context (%j)", async (invalid) => {
    expect((await issueInvoice({ ...input, ...invalid })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("fails closed when authorization or rate limiting is unavailable", async () => {
    mocks.permission.mockRejectedValueOnce(Error("private"))
    expect((await finalizeInvoice(input)).success).toBe(false)
    mocks.rate.mockRejectedValueOnce(Error("private"))
    expect((await finalizeInvoice(input)).success).toBe(false)
    mocks.rate.mockResolvedValueOnce({ success: false })
    expect((await finalizeInvoice(input)).success).toBe(false)
    mocks.user.mockResolvedValueOnce(null)
    expect((await finalizeInvoice(input)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
