import { beforeEach, describe, expect, it, vi } from "vitest"
import * as XLSX from "xlsx"

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
import { readIncomeWorkbook } from "../income-workbook"

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

describe("income workbook import", () => {
  it("preserves CSV rider IDs and rejects malformed amounts before saving any row", async () => {
    const bytes = new TextEncoder().encode('riderId,basicPayment\n00012,"1,234.50"\n00013,"1,2"')
    const [sheet] = readIncomeWorkbook(bytes, "income.csv")
    const payload = { ...input(field), rows: sheet.rows }
    expect(await importIncomeRows({ ...payload, preview: true })).toMatchObject({
      success: true, data: {
        errors: [expect.stringContaining("rider 00013")],
        rows: [{ riderId: "00012", totalIncome: 1234.5 }, { riderId: "00013" }],
      },
    })
    expect((await importIncomeRows(payload)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("saves the exact rider ID, Arabic name and signed decimal amounts from a UTF-8 CSV", async () => {
    const [sheet] = readIncomeWorkbook(new TextEncoder().encode('riderId,driverName,basicPayment,riderBalance\n00012,سامي,"1,234.50",-12.50'), "income.CSV")
    const payload = { ...input(field), rows: sheet.rows }
    expect(await importIncomeRows(payload)).toMatchObject({ success: true, data: { totalIncome: 1222 } })
    expect(mocks.rpc).toHaveBeenCalledWith("import_my_platform_income", expect.objectContaining({
      p_rows: [expect.objectContaining({ rider_id: "00012", driver_name: "سامي", basic_payment: 1234.5, rider_balance: -12.5 })],
    }))
  })

  it("keeps a zero-padded Excel identifier and the stored numeric payment precision", () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([["riderId", "basicPayment"], [12, 1234.5678]])
    sheet.A2.z = "00000"
    sheet.B2.z = "#,##0.00"
    XLSX.utils.book_append_sheet(workbook, sheet, "Income")
    const [imported] = readIncomeWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "income.xlsx")
    expect(imported.rows).toEqual([{ riderId: "00012", basicPayment: 1234.5678 }])
  })

  it.each([{ value: "12,34" }, { value: ["1200"] }, { value: "0x10" }])("rejects non-decimal basic payment $value", async ({ value }) => {
    const payload = { ...input(field), rows: [{ riderId: "R1", basicPayment: value }] }
    expect(await importIncomeRows({ ...payload, preview: true })).toMatchObject({
      success: true, data: { errors: [expect.stringContaining("basicPayment")] },
    })
    expect((await importIncomeRows(payload)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
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
