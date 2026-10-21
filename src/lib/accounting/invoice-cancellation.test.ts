import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), client: vi.fn(), from: vi.fn(), admin: vi.fn(), permission: vi.fn(), user: vi.fn(), rate: vi.fn(),
  audit: vi.fn(), dispatch: vi.fn(), zatca: vi.fn(), cache: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.cache }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitAccounting: mocks.rate }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/accounting/dispatcher", () => ({ runEventDispatcher: mocks.dispatch }))
vi.mock("@/lib/accounting/zatca", () => ({ runZatcaAdapter: mocks.zatca }))
import { cancelInvoice } from "./invoices"
import { getErrorDefinition } from "@/lib/errors/error-codes"

const reviewed = {
  id: "82111111-1111-4111-8111-111111111111",
  expected_updated_at: "2026-10-21T00:00:00.123456+00:00",
  reason: "  Cancel the duplicate draft  ",
}
const receipt = { id: reviewed.id, operation: "cancel", replayed: false }

// Runtime validation remains necessary for direct, untyped Server Action calls.
function cancel(overrides: Record<string, unknown> = {}) {
  return cancelInvoice({ ...reviewed, ...overrides } as Parameters<typeof cancelInvoice>[0])
}

function expectPublicFailure(result: Awaited<ReturnType<typeof cancelInvoice>>) {
  expect(result).toMatchObject({ success: false, error: expect.any(String), errorAr: expect.any(String) })
  expect(JSON.stringify(result)).not.toContain("private diagnostic")
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: "staff", authUserId: "actor", tenantId: "tenant" })
  mocks.rate.mockResolvedValue({ success: true })
  mocks.client.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from })
  mocks.rpc.mockResolvedValue({ data: receipt, error: null })
})

afterEach(() => {
  // The authenticated SQL transaction owns the decision and its audit. No
  // successful or rejected call may fall back to the old partial-write chain.
  expect(mocks.admin).not.toHaveBeenCalled()
  expect(mocks.from).not.toHaveBeenCalled()
  expect(mocks.audit).not.toHaveBeenCalled()
  expect(mocks.dispatch).not.toHaveBeenCalled()
  expect(mocks.zatca).not.toHaveBeenCalled()
})

describe("unposted invoice cancellation transaction boundary", () => {
  it("sends the exact reviewed timestamp and trimmed reason through the session RPC", async () => {
    expect(await cancel()).toEqual({ success: true, replayed: false })
    expect(mocks.permission).toHaveBeenCalledWith("invoices", "update")
    expect(mocks.rate).toHaveBeenCalledWith("staff")
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_unposted_invoice_atomic", {
      p_invoice_id: reviewed.id,
      p_expected_updated_at: reviewed.expected_updated_at,
      p_reason: reviewed.reason.trim(),
    })
  })

  it("retries an uncertain transport outcome with the same reviewed decision", async () => {
    mocks.rpc.mockRejectedValueOnce(Error("private diagnostic: response lost after commit"))
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, replayed: true }, error: null })
    expectPublicFailure(await cancel())
    expect(await cancel()).toEqual({ success: true, replayed: true })
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0])
  })

  it("retains a confirmed cancellation through a cache refresh exception", async () => {
    mocks.cache.mockImplementation(() => { throw Error("private diagnostic: cache refresh") })
    expect(await cancel()).toEqual({ success: true, replayed: false })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each(["INV001", "INV002", "INV006", "INV015", "AUTH007"])("maps the %s SQL guard to the public bilingual taxonomy", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: `${code}: private diagnostic` } })
    const result = await cancel()
    const definition = getErrorDefinition(code)
    expect(result).toMatchObject({ success: false, error: definition.messageEn, errorAr: definition.messageAr })
    expect(JSON.stringify(result)).not.toContain("private diagnostic")
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it("explains that posted invoices require the reviewed reversal workflow", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "INV_CANCEL_POSTED: private diagnostic" } })
    const result = await cancel()
    expectPublicFailure(result)
    expect(result.error).toMatch(/credit|purchase.*reversal/i)
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it("requires review when financial effects already exist", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "INV_CANCEL_REVIEW: private diagnostic" } })
    const result = await cancel()
    expectPublicFailure(result)
    expect(result.error).toMatch(/review/i)
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it.each([
    "private diagnostic: unknown SQL error",
    "private diagnostic: INV015: code appears only in provider detail",
  ])("redacts unrecognized database diagnostics (%s)", async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } })
    expectPublicFailure(await cancel())
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it("rejects a receipt accompanied by an RPC error", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt, error: { message: "private diagnostic" } })
    expectPublicFailure(await cancel())
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it.each([
    ["missing receipt", null],
    ["wrong invoice", { id: "82222222-2222-4222-8222-222222222222" }],
    ["missing invoice", { id: undefined }],
    ["wrong operation", { operation: "issue" }],
    ["missing operation", { operation: undefined }],
    ["untyped replay flag", { replayed: "false" }],
    ["missing replay flag", { replayed: undefined }],
  ] as const)("requires a matching cancellation receipt: %s", async (_label, invalid) => {
    mocks.rpc.mockResolvedValue({ data: invalid === null ? null : { ...receipt, ...invalid }, error: null })
    expectPublicFailure(await cancel())
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it.each([
    ["missing invoice", { id: undefined }],
    ["invalid invoice", { id: "invalid" }],
    ["missing version", { expected_updated_at: undefined }],
    ["empty version", { expected_updated_at: "" }],
    ["invalid version", { expected_updated_at: "invalid" }],
    ["missing reason", { reason: undefined }],
    ["non-text reason", { reason: 12345 }],
    ["blank reason", { reason: " \n " }],
    ["short reason", { reason: "four" }],
    ["overlong reason", { reason: "r".repeat(501) }],
  ] as const)("rejects %s before committing", async (_label, invalid) => {
    expectPublicFailure(await cancel(invalid))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it.each(["permission", "missing user", "user lookup", "rate lookup", "rate exceeded", "session client"])("fails closed for %s failure", async (failure) => {
    if (failure === "permission") mocks.permission.mockRejectedValue(Error("private diagnostic"))
    if (failure === "missing user") mocks.user.mockResolvedValue(null)
    if (failure === "user lookup") mocks.user.mockRejectedValue(Error("private diagnostic"))
    if (failure === "rate lookup") mocks.rate.mockRejectedValue(Error("private diagnostic"))
    if (failure === "rate exceeded") mocks.rate.mockResolvedValue({ success: false })
    if (failure === "session client") mocks.client.mockRejectedValue(Error("private diagnostic"))
    expectPublicFailure(await cancel())
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.cache).not.toHaveBeenCalled()
  })
})
