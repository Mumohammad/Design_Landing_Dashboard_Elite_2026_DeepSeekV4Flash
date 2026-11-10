import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ permission: vi.fn(), user: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
import { runEventDispatcher } from "./dispatcher"
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ tenantId: "tenant-a" })
  mocks.rpc.mockResolvedValue({ data: [{ out_processed: 1, out_skipped: 0, out_failed: 0 }], error: null })
})
describe("caller-bound financial dispatcher action", () => {
  it("calls the tenant-derived RPC using the user session, not the global service queue", async () => {
    expect(await runEventDispatcher()).toEqual({ success: true, processed: 1, skipped: 0, failed: 0, lastError: null })
    expect(mocks.rpc).toHaveBeenCalledWith("dispatch_my_financial_events", { p_batch_size: 100 })
    expect(mocks.permission).toHaveBeenCalledWith("accounting", "approve")
  })
  it("reports database failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Posting unavailable" } })
    expect((await runEventDispatcher()).success).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("does not dispatch for forbidden or signed-out callers", async () => {
    mocks.permission.mockRejectedValue(new Error("Forbidden"))
    expect((await runEventDispatcher()).success).toBe(false)
    mocks.permission.mockResolvedValue(undefined); mocks.user.mockResolvedValue(null)
    expect((await runEventDispatcher()).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
