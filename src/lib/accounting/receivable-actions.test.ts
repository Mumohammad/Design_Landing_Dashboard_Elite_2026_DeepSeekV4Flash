import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), user: vi.fn(), rate: vi.fn(), from: vi.fn(), insert: vi.fn(),
  single: vi.fn(), audit: vi.fn(), revalidate: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitAccounting: mocks.rate, rateLimitAccountingImport: vi.fn() }))
vi.mock("@/lib/logger", () => ({ moduleLogger: () => ({ info: vi.fn() }), logPerformance: vi.fn() }))
vi.mock("@/lib/webhooks/events", () => ({ emit: vi.fn() }))
vi.mock("@/lib/cache", () => ({ cacheGet: vi.fn(), cacheInvalidate: vi.fn(), CACHE_TTL: {} }))
import { createReceivable } from "./actions"

const input = { invoice_ref: "  AR-boundary  ", invoice_date: "2026-10-19", due_date: "2026-10-20", amount: 4.10, vat_rate: 15 }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: "user-a", authUserId: "auth-a", tenantId: "tenant-a" })
  mocks.rate.mockResolvedValue({ success: true })
  mocks.from.mockReturnValue({ insert: mocks.insert })
  mocks.insert.mockReturnValue({ select: () => ({ single: mocks.single }) })
  mocks.single.mockResolvedValue({ data: { id: "ar-a" }, error: null })
})

describe("manual receivable persistence", () => {
  it("saves half-halalah VAT as 0.62 and total 4.72, scoped to the authenticated tenant", async () => {
    expect(await createReceivable(input)).toEqual({ success: true })
    expect(mocks.permission).toHaveBeenCalledWith("accounting", "create")
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: "tenant-a", invoice_ref: "AR-boundary", source_entity_type: "manual",
      amount: 4.10, vat_amount: 0.62, total_amount: 4.72, paid_amount: 0, status: "open",
    }))
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-a", actorId: "auth-a", entityId: "ar-a", action: "receivable_created",
      newValues: expect.objectContaining({ vat_amount: 0.62, total_amount: 4.72 }),
    }))
    expect(mocks.revalidate).toHaveBeenCalledWith("/accounting")
  })

  it.each([
    [1000, 15, 1000, 150, 1150],
    [33.33, 15, 33.33, 5, 38.33],
    [1.005, 0, 1.01, 0, 1.01],
    [0.01, 50, 0.01, 0.01, 0.02],
    [9_999_999_999.99, 0, 9_999_999_999.99, 0, 9_999_999_999.99],
  ])("persists exact decimal totals for amount %s at %s percent", async (amount, vat_rate, net, vat, total) => {
    expect((await createReceivable({ ...input, amount, vat_rate })).success).toBe(true)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ amount: net, vat_amount: vat, total_amount: total }))
  })

  it.each([
    { amount: 0 }, { amount: 0.001 }, { amount: -1 }, { amount: Number.NaN }, { amount: Infinity },
    { vat_rate: Number.NaN }, { vat_rate: Infinity }, { vat_rate: -1 }, { vat_rate: 101 },
    { amount: 10_000_000_000 }, { amount: 9_999_999_999, vat_rate: 15 },
    { invoice_ref: " " }, { invoice_date: "" }, { invoice_date: "invalid" },
    { invoice_date: "2026-02-30" }, { due_date: "invalid" }, { due_date: "2026-10-18" }, { due_date: "2026-2-1" },
  ])("rejects invalid financial/date input before writes: %j", async invalid => {
    expect((await createReceivable({ ...input, ...invalid })).success).toBe(false)
    expect(mocks.insert).not.toHaveBeenCalled()
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
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("does not audit or refresh a failed insert", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: "injected failure" } })
    expect((await createReceivable(input)).success).toBe(false)
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
