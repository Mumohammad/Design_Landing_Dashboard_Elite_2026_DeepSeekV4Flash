import { beforeEach, describe, expect, it, vi } from "vitest"

const mock = vi.hoisted(() => ({
  from: vi.fn(), permission: vi.fn(), audit: vi.fn(), emit: vi.fn(),
}))
vi.mock("@/lib/release/integrations", () => ({ integrationAvailable: () => true, INTEGRATION_UNAVAILABLE: "unavailable" }))
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mock.permission, getCurrentUser: async () => ({ id: "actor", authUserId: "user", tenantId: "tenant" }),
}))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mock.audit }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitPayroll: async () => ({ success: true }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mock.from }) }))
vi.mock("@/lib/webhooks/events", () => ({ emit: mock.emit }))
vi.mock("./calculate", () => ({ calculateDriverPayroll: vi.fn() }))
vi.mock("./deduction-rollback", () => ({ cancelPayrollPeriod: vi.fn() }))
import { generateWpsFile } from "./actions"

const records = Array.from({ length: 1003 }, (_, index) => ({
  id: String(index).padStart(4, "0"), net_payroll: 10.01, base_amount: 12.01, total_deductions: 2,
  working_days_actual: 20, paid_at: "2026-08-31", driver: {
    iqama_number: String(1000000000 + index), full_name_ar: "سائق", iban: "SA0310000000000000000000", housing_allowance: 0,
  },
}))

function setupReads(failFrom?: number, rows = records) {
  const pages: number[][] = []
  const readPage = (from: number, to: number) => {
    pages.push([from, to])
    if (from === failFrom) return { data: null, count: null, error: { message: "read failed" } }
    return { data: rows.slice(from, to + 1), count: rows.length, error: null }
  }
  const periodQueries: ReturnType<typeof periodQuery>[] = []
  function periodQuery() {
    return {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: readPage,
      then: (resolve: (result: ReturnType<typeof readPage>) => void) => resolve(readPage(0, 999)),
    }
  }
  mock.from.mockImplementation(table => {
    if (table === "driver_payroll_periods") {
      const query = periodQuery()
      periodQueries.push(query)
      return query
    }
    if (table !== "system_settings") throw new Error("Unexpected table")
    return {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      is: async () => ({ data: [{ key: "company.mol_reference", value: "synthetic" }, { key: "company.wps_iban", value: "SA0310000000000000000000" }], error: null }),
    }
  })
  return { pages, periodQueries }
}

beforeEach(() => { vi.resetAllMocks() })

describe("WPS export period reads with a synthetic enabled gate", () => {
  it("exports every approved or paid row with a reconciled count and net amount", async () => {
    const { pages, periodQueries } = setupReads()
    const result = await generateWpsFile(2026, 8)
    expect(result.success).toBe(true)
    const lines = result.content!.split("\n")
    expect(lines[0]).toBe("H|synthetic|202608|001003|10040.03|01")
    expect(lines[lines.length - 1]).toBe("T|1003")
    expect(lines.slice(1, -1).map(line => line.split("|")[1])).toEqual(records.map(r => r.driver.iqama_number))
    expect(pages).toEqual([[0, 499], [500, 999], [1000, 1499]])
    for (const query of periodQueries) {
      expect(query.eq.mock.calls).toEqual(expect.arrayContaining([["tenant_id", "tenant"], ["period_year", 2026], ["period_month", 8]]))
      expect(query.in).toHaveBeenCalledWith("status", ["approved", "paid"])
      expect(query.is).toHaveBeenCalledWith("deleted_at", null)
      expect(query.order).toHaveBeenCalledWith("id", { ascending: true })
      expect(query.select).toHaveBeenCalledWith(expect.stringContaining("id,"), { count: "exact" })
    }
    expect(mock.permission).toHaveBeenCalledWith("payroll", "export")
    expect(mock.audit).toHaveBeenCalledOnce()
  })

  it("returns no file, audit or event after a later page fails", async () => {
    const { pages } = setupReads(500)
    expect(await generateWpsFile(2026, 8)).toEqual({ success: false, error: expect.stringMatching(/incomplete|complete|partial/i) })
    expect(pages).toEqual([[0, 499], [500, 999]])
    expect(mock.from).not.toHaveBeenCalledWith("system_settings")
    expect(mock.audit).not.toHaveBeenCalled()
    expect(mock.emit).not.toHaveBeenCalled()
  })

  it("requires export permission before reading payroll", async () => {
    mock.permission.mockRejectedValue(new Error("Forbidden"))
    expect(await generateWpsFile(2026, 8)).toEqual({ success: false, error: "Forbidden" })
    expect(mock.from).not.toHaveBeenCalled()
  })

  it("withholds the whole file when a beneficiary is missing bank details", async () => {
    setupReads(undefined, [records[0], { ...records[1], driver: { ...records[1].driver, iban: "" } }])
    const result = await generateWpsFile(2026, 8)
    expect(result.success).toBe(false)
    expect(result.content).toBeUndefined()
    expect(mock.audit).not.toHaveBeenCalled()
    expect(mock.emit).not.toHaveBeenCalled()
  })

  it.each([
    { paid_at: "not-a-date" },
    { base_amount: Infinity },
    { driver: { ...records[1].driver, iqama_number: "123|456" } },
  ])("withholds the entire export on malformed payment data", async invalid => {
    setupReads(undefined, [records[0], { ...records[1], ...invalid }])
    const result = await generateWpsFile(2026, 8)
    expect(result).toEqual({ success: false, error: expect.any(String) })
    expect(mock.audit).not.toHaveBeenCalled()
    expect(mock.emit).not.toHaveBeenCalled()
  })
})
