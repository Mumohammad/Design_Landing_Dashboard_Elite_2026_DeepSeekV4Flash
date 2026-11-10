import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))
import { getFinancialKpis } from "./kpis"

const window = { start: "2026-10-01", end: "2026-10-21" }
const result = {
  revenue: "1201.10", revenuePrevious: "1500.21", invoicesCount: 1201,
  invoicesCountPrevious: 1050, pendingInvoicesAmount: "50.35", pendingInvoicesCount: 2,
  expenses: "200.55", expensesPrevious: "10.01", expensesCount: 1002, netResult: "1000.55",
}
const unavailable = { revenue: 0, revenuePrevious: 0, invoicesCount: 0, invoicesCountPrevious: 0,
  pendingInvoicesAmount: 0, pendingInvoicesCount: 0, expenses: 0, expensesPrevious: 0,
  expensesCount: 0, netResult: 0, available: false }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.client.mockResolvedValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: result, error: null })
})

describe("posted financial KPI service", () => {
  it("uses one caller-bound aggregate with inclusive dates, no tenant or capped header queries", async () => {
    expect(await getFinancialKpis(window)).toEqual({ ...result, revenue: 1201.10,
      revenuePrevious: 1500.21, pendingInvoicesAmount: 50.35, expenses: 200.55,
      expensesPrevious: 10.01, netResult: 1000.55, available: true })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_my_financial_kpis", { p_start: window.start, p_end: window.end })
  })
  it("keeps negative net income and negative expense reversals", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, revenue: "-10.25", expenses: "-2.50", netResult: "-7.75" }, error: null })
    expect(await getFinancialKpis(window)).toMatchObject({ revenue: -10.25, expenses: -2.50, netResult: -7.75, available: true })
  })
  it("distinguishes a genuine empty ledger from an unavailable ledger", async () => {
    mocks.rpc.mockResolvedValue({ data: Object.fromEntries(Object.entries(result).map(([key, value]) => [key, typeof value === "number" ? 0 : "0.00"])), error: null })
    expect(await getFinancialKpis(window)).toEqual({ ...unavailable, available: true })
  })
  it.each(["2026-02-30", "2026-13-01", "2026-00-01", "2026-10-1", "2026-10-01T00:00:00Z", "2026-10-01 ", "0000-01-01", "bad", null])("rejects invalid period start %s without a database request", async start => {
    expect(await getFinancialKpis({ ...window, start: start as string })).toEqual(unavailable)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it("rejects reversed windows", async () => {
    expect(await getFinancialKpis({ start: window.end, end: window.start })).toEqual(unavailable)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it("accepts a real leap day and a single inclusive day", async () => {
    await getFinancialKpis({ start: "2024-02-29", end: "2024-02-29" })
    expect(mocks.rpc).toHaveBeenCalledWith("read_my_financial_kpis", { p_start: "2024-02-29", p_end: "2024-02-29" })
  })
  it.each([null, [], {}, { ...result, netResult: "1000.56" }, { ...result, pendingInvoicesAmount: "-1.00" }, { ...result, pendingInvoicesAmount: "0.00" }, { ...result, pendingInvoicesCount: 0 }])("marks malformed or inconsistent aggregate unavailable", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect(await getFinancialKpis(window)).toEqual(unavailable)
  })
  it.each([null, false, 10, "NaN", "Infinity", "1e3", "1junk", "1.001", " 10", "01", "", "90071992547409.92", "90071992547409.91", "9".repeat(100)])("rejects inexact money %s", async revenue => {
    mocks.rpc.mockResolvedValue({ data: { ...result, revenue }, error: null })
    expect(await getFinancialKpis(window)).toEqual(unavailable)
  })
  it.each([-1, 0.5, "1", null, Number.MAX_SAFE_INTEGER + 1, Infinity])("rejects invalid counts %s", async invoicesCount => {
    mocks.rpc.mockResolvedValue({ data: { ...result, invoicesCount }, error: null })
    expect(await getFinancialKpis(window)).toEqual(unavailable)
  })
  it.each(["42501", "PGRST202", "57014"])("does not fall back to header estimates on RPC failure %s", async code => {
    mocks.rpc.mockResolvedValue({ data: result, error: { code, message: "private diagnostic" } })
    expect(await getFinancialKpis(window)).toEqual(unavailable)
  })
  it("handles transport and session failures without exposing private details", async () => {
    mocks.rpc.mockRejectedValue(new Error("private transport diagnostic"))
    expect(await getFinancialKpis(window)).toEqual(unavailable)
    mocks.client.mockRejectedValue(new Error("private session diagnostic"))
    expect(await getFinancialKpis(window)).toEqual(unavailable)
  })
  it("returns fresh unavailable values for each request", async () => {
    const first = await getFinancialKpis({ ...window, start: "invalid" })
    first.revenue = 99
    expect(await getFinancialKpis({ ...window, start: "invalid" })).toEqual(unavailable)
  })
})
