import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ permission: vi.fn(), user: vi.fn(), rpc: vi.fn(),
  from: vi.fn(), revalidate: vi.fn(), audit: vi.fn(), dispatch: vi.fn(), admin: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/accounting/dispatcher", () => ({ runEventDispatcher: mocks.dispatch }))
import { recordPayment, voidPayment, createBankAccount, type RecordPaymentInput } from "./payments"

const input: RecordPaymentInput = { request_id: "80111111-1111-4111-8111-111111111111", direction: "in",
  payment_date: "2026-10-11", amount: 0.3, method: "cash", customer_id: "customer-a",
  allocations: [{ receivable_id: "ar-a", amount: 0.1 }, { receivable_id: "ar-b", amount: 0.2 }] }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ authUserId: "auth-a", tenantId: "tenant-a" })
  mocks.rpc.mockResolvedValue({ data: { id: "payment-a", status: "pending" }, error: null })
  mocks.dispatch.mockResolvedValue({ success: true })
  mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { status: "allocated" }, error: null }) })
})
describe("payment transactional actions", () => {
  it("rejects non-SAR bank accounts before service-side writes", async () => {
    expect((await createBankAccount({ bank_name: "Bank", account_name: "Account", iban: "SA-fixture", currency: "USD" })).success).toBe(false)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("uses a JWT-bound atomic save and exact allocation sum, without supplied tenant/actor", async () => {
    expect(await recordPayment(input)).toEqual({ success: true, id: "payment-a", postingStatus: "posted" })
    expect(mocks.rpc).toHaveBeenCalledWith("record_finance_payment_atomic", {
      p_request_id: input.request_id, p_payment: { direction: "in", payment_date: input.payment_date,
        amount: 0.3, method: "cash", customer_id: "customer-a", supplier_id: null, bank_account_id: null, reference: null },
      p_allocations: input.allocations.map((a) => ({ ...a, payable_id: null })),
    })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled() // Same database transaction now owns audit/outbox.
  })
  it("keeps the request ID unchanged for a replay", async () => {
    await recordPayment(input); await recordPayment(input)
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_request_id)).toEqual([input.request_id, input.request_id])
  })
  it("does not describe a voided replay as saved or awaiting posting", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "payment-a", status: "void", replayed: true }, error: null })
    expect(await recordPayment(input)).toMatchObject({ success: false, id: "payment-a" })
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("does not claim posting when the dispatcher lacks approval or posting fails", async () => {
    mocks.dispatch.mockResolvedValue({ success: false, error: "Forbidden" })
    mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { status: "pending" }, error: null }) })
    expect(await recordPayment(input)).toEqual({ success: true, id: "payment-a", postingStatus: "pending" })
  })
  it("never dispatches or reports success after transaction failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "injected event failure" } })
    expect((await recordPayment(input)).success).toBe(false)
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("requires a committed identifier", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect((await recordPayment(input)).success).toBe(false)
  })
  it.each([
    { request_id: "" }, { amount: 0 }, { amount: Number.NaN }, { amount: 0.31 },
    { allocations: [] }, { allocations: [{ receivable_id: "ar-a", amount: -0.3 }] },
    { allocations: [{ receivable_id: "ar-a", payable_id: "ap-a", amount: 0.3 }] },
    { allocations: [{ payable_id: "ap-a", amount: 0.3 }] }, { method: "transfer" as const },
  ])("rejects malformed/unbalanced input %j", async (invalid) => {
    expect((await recordPayment({ ...input, ...invalid })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("requires authentication and permission before any write", async () => {
    mocks.permission.mockRejectedValue(new Error("Forbidden"))
    expect((await recordPayment(input)).success).toBe(false)
    expect((await voidPayment({ id: "payment-a" })).success).toBe(false)
    mocks.permission.mockResolvedValue(undefined); mocks.user.mockResolvedValue(null)
    expect((await recordPayment(input)).success).toBe(false)
    expect((await voidPayment({ id: "payment-a" })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("voids through the guarded transaction and accepts an idempotent replay", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "payment-a", status: "void", replayed: true }, error: null })
    expect(await voidPayment({ id: "payment-a" })).toEqual({ success: true, id: "payment-a" })
    expect(mocks.permission).toHaveBeenCalledWith("accounting", "approve")
    expect(mocks.rpc).toHaveBeenCalledWith("void_finance_payment_atomic", { p_id: "payment-a" })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it("rejects failed/unconfirmed reversal without cache invalidation", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "journal failure" } })
    expect((await voidPayment({ id: "payment-a" })).success).toBe(false)
    mocks.rpc.mockResolvedValue({ data: { id: "payment-a", status: "allocated" }, error: null })
    expect((await voidPayment({ id: "payment-a" })).success).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
