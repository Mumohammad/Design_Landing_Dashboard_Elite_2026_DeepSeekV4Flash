import { beforeEach, describe, expect, it, vi } from "vitest"

type QueryProbe = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  range: ReturnType<typeof vi.fn>
}

const f = vi.hoisted(() => ({
  permission: vi.fn(), user: vi.fn(), limit: vi.fn(), client: vi.fn(), from: vi.fn(),
  rows: [] as Record<string, unknown>[], builders: [] as QueryProbe[],
  mode: "success" as "success" | "late-error" | "count-change" | "empty-tail" | "too-large",
}))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: f.permission, getCurrentUser: f.user }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitOrders: f.limit }))
vi.mock("@/lib/supabase/server", () => ({ createClient: f.client }))

import { listPlatformPayments } from "./payment-queries"

const uuid = (index: number) => `17200000-0000-4000-8000-${String(index).padStart(12, "0")}`
const failure = { success: false, error: "Could not load platform payments. Try again." }

beforeEach(() => {
  vi.clearAllMocks()
  f.mode = "success"
  f.builders = []
  f.rows = Array.from({ length: 1251 }, (_, index) => ({
    id: uuid(index + 1), platform_id: uuid(50000 + Math.floor(index / 36)),
    period_year: 2024 + Math.floor((index % 36) / 12), period_month: index % 12 + 1,
    expected_amount: 11.5, received_amount: 10.35, outstanding_amount: 1.15,
    payment_status: "partial", payment_date: "2026-10-31", payment_ref: `REF-${index}`,
    platform: { name_ar: "منصة الاختبار", name_en: "Test platform", code: "FIXTURE" },
    notes: "Private fixture note must not enter the list projection",
  }))
  f.permission.mockResolvedValue(undefined)
  f.user.mockResolvedValue({ id: "app-user", tenantId: "tenant-a" })
  f.limit.mockResolvedValue({ success: true })
  f.from.mockImplementation(() => {
    const query: QueryProbe = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn(async (from: number, to: number) => {
        if (f.mode === "late-error" && from >= 1000) {
          return { data: null, error: { message: "Private database detail" }, count: f.rows.length }
        }
        return {
          data: f.mode === "empty-tail" && from >= 1000 ? [] : f.rows.slice(from, to + 1),
          error: null,
          count: f.mode === "too-large" ? 100001 : f.rows.length + (f.mode === "count-change" && from > 0 ? 1 : 0),
        }
      }),
    }
    f.builders.push(query)
    return query
  })
  f.client.mockResolvedValue({ from: f.from })
})

describe("complete platform payment reconciliation reads", () => {
  it("includes records beyond both the old 100-row limit and the API 1000-row cap", async () => {
    const result = await listPlatformPayments()
    if (!result.success) throw new Error("Expected the complete synthetic ledger")
    expect(result.rows).toHaveLength(1251)
    expect(result.rows[result.rows.length - 1]?.payment_ref).toBe("REF-1250")
    expect(result.rows[0]).not.toHaveProperty("notes")
    expect(f.permission).toHaveBeenCalledWith("platforms", "read")
    expect(f.limit).toHaveBeenCalledWith("app-user")
    expect(f.builders.map(query => query.range.mock.calls[0])).toEqual([[0, 499], [500, 999], [1000, 1499]])
    for (const query of f.builders) {
      expect(query.select).toHaveBeenCalledWith(expect.any(String), { count: "exact" })
      expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant-a")
      expect(query.is).toHaveBeenCalledWith("deleted_at", null)
      expect(query.order.mock.calls).toEqual([
        ["period_year", { ascending: false }], ["period_month", { ascending: false }], ["id", { ascending: true }],
      ])
    }
  })

  it.each(["late-error", "count-change", "empty-tail", "too-large"] as const)("does not return partial success for %s", async mode => {
    f.mode = mode
    expect(await listPlatformPayments()).toEqual(failure)
  })

  it("rejects duplicated or malformed records instead of rendering misleading totals or links", async () => {
    f.rows[500] = { ...f.rows[0] }
    expect(await listPlatformPayments()).toEqual(failure)
    f.rows = [{ ...f.rows[0], id: "unsafe-link" }]
    expect(await listPlatformPayments()).toEqual(failure)
    f.rows = [{ ...f.rows[0], id: uuid(1), expected_amount: NaN }]
    expect(await listPlatformPayments()).toEqual(failure)
  })

  it("distinguishes a confirmed empty ledger from an unavailable read", async () => {
    f.rows = []
    expect(await listPlatformPayments()).toEqual({ success: true, rows: [] })
  })

  it("denies unauthenticated, unauthorized and rate-limited callers before reading data", async () => {
    f.permission.mockRejectedValueOnce(new Error("Denied"))
    expect(await listPlatformPayments()).toEqual(failure)
    f.user.mockResolvedValueOnce(null)
    expect(await listPlatformPayments()).toEqual(failure)
    f.limit.mockResolvedValueOnce({ success: false })
    expect(await listPlatformPayments()).toEqual({ success: false, error: "Too many attempts. Wait before retrying." })
    expect(f.client).not.toHaveBeenCalled()
    expect(f.from).not.toHaveBeenCalled()
  })
})
