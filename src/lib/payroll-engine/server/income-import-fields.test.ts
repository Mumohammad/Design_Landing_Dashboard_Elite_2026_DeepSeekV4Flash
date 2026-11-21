import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), context: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: vi.fn() }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitImports: async () => ({ success: true }) }))
vi.mock("./data", async importOriginal => ({
  ...await importOriginal<typeof import("./data")>(),
  engineContext: mocks.context,
  loadDriversByRider: async () => new Map(),
}))

import { importIncomeRows } from "./income-actions"

const fieldId = "50b62415-bd57-48dd-a47c-9562a32acb73"
const field = { field_id: fieldId, name: "Distance adjustment", type: "add", amount: 17 }
const input = (customField: Record<string, unknown>) => ({
  requestId: "baee70b0-7009-425a-95a5-cb501ce98f80", month: "2192-01", companyName: "Synthetic",
  rows: [{ riderId: "R1", basicPayment: 100, customFields: [customField] }],
})

beforeEach(() => {
  vi.clearAllMocks()
  const query = {
    select: () => query, eq: () => query, order: () => query,
    range: async () => ({ data: [], count: 0, error: null }),
  }
  mocks.context.mockResolvedValue({ tenantId: "synthetic-tenant", userId: "synthetic-actor", admin: { from: () => query } })
  mocks.rpc.mockResolvedValue({ data: { imported: 1, updated: 0, replayed: false }, error: null })
})

describe("custom income field import boundary", () => {
  it("preserves the definition ID so the database can reject stale or foreign mappings", async () => {
    const result = await importIncomeRows(input(field))
    expect(result.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("import_my_platform_income", expect.objectContaining({
      p_rows: [expect.objectContaining({ custom_fields: [field] })],
    }))
    if (result.success) expect(result.data.totalIncome).toBe(117)
  })

  it("rejects malformed definition IDs before attempting a write", async () => {
    expect((await importIncomeRows(input({ ...field, field_id: "not-a-uuid" }))).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("retains compatibility with historical mappings without a definition ID", async () => {
    const historical = { name: field.name, type: "deduct", amount: 17 }
    expect((await importIncomeRows(input(historical))).success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("import_my_platform_income", expect.objectContaining({
      p_rows: [expect.objectContaining({ custom_fields: [historical] })],
    }))
  })

  it.each(["not a number", "1,2", true])("reports invalid custom amount %j and saves no rows", async (amount) => {
    const payload = input({ ...field, amount })
    const preview = await importIncomeRows({ ...payload, preview: true })
    expect(preview).toMatchObject({ success: true, data: { errors: [expect.stringContaining("Distance adjustment")] } })
    expect((await importIncomeRows(payload)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("includes formatted adjustment amounts in preview totals and saved rows", async () => {
    const payload = input({ ...field, amount: "1,234.50" })
    expect(await importIncomeRows({ ...payload, preview: true })).toMatchObject({
      success: true, data: { totalIncome: 1334.5, errors: [] },
    })
    expect((await importIncomeRows(payload)).success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("import_my_platform_income", expect.objectContaining({
      p_rows: [expect.objectContaining({ custom_fields: [{ ...field, amount: 1234.5 }] })],
    }))
  })

  it.each([null, "", "   ", 0])("treats a blank or zero custom cell %j as no adjustment", async (amount) => {
    expect(await importIncomeRows(input({ ...field, amount }))).toMatchObject({ success: true, data: { totalIncome: 100 } })
    expect(mocks.rpc).toHaveBeenCalledWith("import_my_platform_income", expect.objectContaining({
      p_rows: [expect.objectContaining({ custom_fields: null })],
    }))
  })

  it("rejects a sheet with more mapped custom fields than the import supports", async () => {
    const payload = input(field)
    payload.rows[0].customFields = Array.from({ length: 51 }, () => field)
    const preview = await importIncomeRows({ ...payload, preview: true })
    expect(preview).toMatchObject({ success: true, data: { errors: [expect.stringContaining("50 mapped income fields")] } })
    expect((await importIncomeRows(payload)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("reports a populated row with no rider ID and blocks the whole import", async () => {
    const payload = input(field)
    payload.rows.push({ riderId: "", basicPayment: 200, customFields: [] })
    expect(await importIncomeRows({ ...payload, preview: true })).toMatchObject({
      success: true, data: { errors: ["Row 2: missing rider_id"] },
    })
    expect((await importIncomeRows(payload)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
