import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), user: vi.fn(), rate: vi.fn(), from: vi.fn(), insert: vi.fn(),
  single: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), rpc: vi.fn(), client: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitAccounting: mocks.rate, rateLimitAccountingImport: vi.fn() }))
vi.mock("@/lib/logger", () => ({ moduleLogger: () => ({ info: vi.fn() }), logPerformance: vi.fn() }))
vi.mock("@/lib/webhooks/events", () => ({ emit: vi.fn() }))
vi.mock("@/lib/cache", () => ({ cacheGet: vi.fn(), cacheInvalidate: vi.fn(), CACHE_TTL: {} }))
import { createReceivable } from "./actions"

const id = "85000000-0000-4000-8000-000000000001"
const input = { request_id: "85000000-0000-4000-8000-000000000002", invoice_ref: "  AR-boundary  ", invoice_date: "2026-10-19", due_date: "2026-10-20", amount: 4.10, vat_rate: 15 }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: "user-a", authUserId: "auth-a", tenantId: "tenant-a" })
  mocks.rate.mockResolvedValue({ success: true })
  mocks.client.mockResolvedValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: { id, replayed: false }, error: null })
})

describe("manual receivable persistence", () => {
  it("uses the caller JWT and atomic RPC, leaving tenant, money and audit enforcement to the database", async () => {
    expect(await createReceivable(input)).toEqual({ success: true, id, replayed: false })
    expect(mocks.permission).toHaveBeenCalledWith("accounting", "create")
    expect(mocks.client).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith("create_manual_receivable_atomic", {
      p_request_id: input.request_id, p_receivable: {
        invoice_ref: "AR-boundary", invoice_date: input.invoice_date, due_date: input.due_date, amount: 4.1, vat_rate: 15,
      },
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith("/accounting")
  })

  it.each([
    [1000, 15, 1000], [33.33, 15, 33.33], [1.005, 0, 1.01], [0.01, 50, 0.01],
    [9_999_999_999.99, 0, 9_999_999_999.99],
  ])("submits normalized net amounts without client-supplied totals: %s at %s percent", async (amount, vat_rate, net) => {
    expect((await createReceivable({ ...input, amount, vat_rate })).success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("create_manual_receivable_atomic", expect.objectContaining({ p_receivable: {
      invoice_ref: "AR-boundary", invoice_date: input.invoice_date, due_date: input.due_date, amount: net, vat_rate,
    } }))
  })

  it.each([
    { amount: 0 }, { amount: 0.001 }, { amount: -1 }, { amount: Number.NaN }, { amount: Infinity },
    { vat_rate: Number.NaN }, { vat_rate: Infinity }, { vat_rate: -1 }, { vat_rate: 101 },
    { amount: 10_000_000_000 }, { amount: 9_999_999_999, vat_rate: 15 },
    { invoice_ref: " " }, { invoice_ref: "x".repeat(201) }, { request_id: "" }, { request_id: "invalid" }, { invoice_date: "" }, { invoice_date: "invalid" },
    { invoice_date: "2026-02-30" }, { due_date: "invalid" }, { due_date: "2026-10-18" }, { due_date: "2026-2-1" },
  ])("rejects invalid financial/date input before writes: %j", async invalid => {
    expect((await createReceivable({ ...input, ...invalid })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("requires permission, authentication and rate-limit approval before writes", async () => {
    mocks.permission.mockRejectedValue(new Error("Forbidden"))
    expect((await createReceivable(input)).success).toBe(false)
    mocks.permission.mockResolvedValue(undefined)
    mocks.user.mockResolvedValue(null)
    expect((await createReceivable(input)).success).toBe(false)
    mocks.user.mockResolvedValue({ id: "user-a", tenantId: "tenant-a" })
    mocks.rate.mockResolvedValue({ success: false })
    expect((await createReceivable(input)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { data: null, error: { message: "private SQL constraint detail" } },
    { data: null, error: null }, { data: { id: "bad", replayed: false }, error: null },
    { data: { id }, error: null },
  ])("does not confirm malformed/failed transactions or expose database details: %j", async response => {
    mocks.rpc.mockResolvedValue(response)
    const result = await createReceivable(input)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Retry with unchanged details/)
    expect(result.errorAr).toBeTruthy()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("returns a confirmed replay without a second application-level write", async () => {
    mocks.rpc.mockResolvedValue({ data: { id, replayed: true }, error: null })
    expect(await createReceivable(input)).toEqual({ success: true, id, replayed: true })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each(["AR_RETRY:", "AR_RETRY_UNAVAILABLE:"])("asks for review instead of confirming request conflicts: %s", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: code + " private database detail" } })
    const result = await createReceivable(input)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/review/i)
    expect(result.error).not.toContain("private")
    expect(result.errorAr).toBeTruthy()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("keeps uncertain transport failures retryable without leaking internal errors", async () => {
    mocks.rpc.mockRejectedValue(Error("private network detail"))
    expect(await createReceivable(input)).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining("Retry with unchanged details") }))
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
