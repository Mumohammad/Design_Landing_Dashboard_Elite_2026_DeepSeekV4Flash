import { beforeEach, describe, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ configured: vi.fn(), send: vi.fn(), from: vi.fn(), fail: "", queries: [] as Array<{ table: string; select: string; range: number[] }>, rows: {} as Record<string, Array<Record<string, unknown>>> }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mock.from }) }))
vi.mock("@/lib/email/send", () => ({ emailConfigured: mock.configured, sendEmail: mock.send }))
import { runDriverExpiryReminders } from "./driver-reminders"
const id = (n: number) => `17300000-0000-4000-8000-${String(n).padStart(12, "0")}`
const tenant = id(1)
const driver = (n: number) => ({ id: id(n), tenant_id: tenant, full_name_ar: "Synthetic driver", full_name_en: null, personal_email: `driver-${n}@example.test`, work_email: null, iqama_expiry_date: "2026-11-03", license_expiry_date: null, passport_expiry_date: null })
beforeEach(() => {
  vi.resetAllMocks(); mock.fail = ""; mock.queries = []
  mock.configured.mockReturnValue(true); mock.send.mockResolvedValue({ ok: true })
  mock.rows = { drivers: [driver(11)], driver_documents: [], tenants: [{ id: tenant, name_ar: "Synthetic tenant", name_en: null }] }
  mock.from.mockImplementation((table: string) => {
    const entry = { table, select: "", range: [] as number[] }; mock.queries.push(entry)
    let ids: string[] | undefined
    const builder: Record<string, unknown> = {}
    for (const method of ["eq", "is", "not", "or", "order"]) builder[method] = vi.fn().mockReturnValue(builder)
    builder.select = vi.fn((columns: string, options: unknown) => { entry.select = columns; expect(options).toEqual({ count: "exact" }); return builder })
    builder.in = vi.fn((column: string, values: string[]) => { if (column === "id") ids = values; return builder })
    builder.range = vi.fn(async (first: number, last: number) => {
      entry.range = [first, last]
      const rows = ids ? mock.rows.drivers.filter(row => ids!.includes(String(row.id))) : mock.rows[table]
      if (mock.fail === table) return { data: null, count: null, error: { message: "Synthetic failure" } }
      return { data: rows.slice(first, last + 1), count: rows.length, error: null }
    })
    return builder
  })
})
describe("complete driver reminder reads", () => {
  it("uses the current doc_type field and complete counts before sending", async () => {
    mock.rows.driver_documents = [{ id: id(21), driver_id: id(11), tenant_id: tenant, doc_type: "health_certificate", expiry_date: "2026-11-03" }]
    expect(await runDriverExpiryReminders(new Date("2026-11-02T06:00:00Z"))).toEqual({ drivers: 1, sent: 1, failed: 0, skipped: false })
    expect(mock.queries.find(q => q.table === "driver_documents")?.select).toBe("id,driver_id,tenant_id,doc_type,expiry_date")
    expect(mock.send.mock.calls[0][0].html).toContain("Health certificate")
  })
  it.each(["drivers", "driver_documents", "tenants"])("sends nothing when %s is unavailable", async table => {
    mock.fail = table
    await expect(runDriverExpiryReminders()).rejects.toThrow()
    expect(mock.send).not.toHaveBeenCalled()
  })
  it("does not lose drivers beyond the API response cap", async () => {
    mock.rows.drivers = Array.from({ length: 1001 }, (_, n) => driver(n + 100))
    const result = await runDriverExpiryReminders(new Date("2026-11-02T06:00:00Z"))
    expect(result.sent).toBe(1001)
    expect(mock.queries.filter(q => q.table === "drivers").map(q => q.range[0])).toEqual([0, 500, 1000])
    expect(mock.send).toHaveBeenCalledTimes(1001)
  })
  it("validates every recipient before sending the first message", async () => {
    mock.rows.drivers.push({ ...driver(12), personal_email: "invalid" })
    await expect(runDriverExpiryReminders()).rejects.toThrow("recipient")
    expect(mock.send).not.toHaveBeenCalled()
  })
  it("never sends when email is unconfigured", async () => {
    mock.configured.mockReturnValue(false)
    expect((await runDriverExpiryReminders()).skipped).toBe(true)
    expect(mock.from).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled()
  })
})
