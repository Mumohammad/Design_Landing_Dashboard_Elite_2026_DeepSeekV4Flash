import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ lateError: false, changedCount: false, duplicateLink: false, calls: [] as { table: string; method: string; values: unknown[] }[], rpc: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock("@/lib/auth/authorization", () => ({ getCurrentUser: vi.fn(), requirePermission: vi.fn() }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: vi.fn() }))
import { failure, loadActiveRules, loadDriversByRider, loadSources, payrollSourceVersion, saveReviewedPayroll, type EngineContext } from "./data"
import { hasChangedBeneficiary, loadDraftInputs, runPayload } from "./recalc"
import { buildRuleSnapshot, computePayrollRun } from "../run"
import { parseWorkbook } from "../excel-parser"
import { readFileSync } from "node:fs"
import { join } from "node:path"
const tenant = "synthetic-tenant", runId = "synthetic-run"
const results = Array.from({ length: 1251 }, (_, n) => ({ id: "result-" + n, rider_id: "R" + n, raw_input: { riderId: "R" + n }, result: {}, bank: null }))
const items = Array.from({ length: 1251 }, (_, n) => ({ id: "bonus-" + n, kind: "bonus", name: "Synthetic", amount: 1, item_type: "fixed", status: "active", apply_to_all: false, target_rider_ids: ["R" + n] }))
function query(table: string) {
  const filters = new Map<string, unknown>()
  const chain = {
    select: (...values: unknown[]) => record("select", values),
    eq: (key: string, value: unknown) => { filters.set(key, value); return record("eq", [key, value]) },
    in: (...values: unknown[]) => record("in", values), is: (...values: unknown[]) => record("is", values), order: (...values: unknown[]) => record("order", values),
    single: async () => ({ data: { id: runId, status: "draft", version: 1, total_drivers: 1251 }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    range: async (from: number, to: number) => {
      record("range", [from, to])
      if (from >= 500 && mocks.lateError) return { data: null, error: { message: "private SQL detail" }, count: 1251 }
      const links = [{ id: "link-1", platform_driver_id: "same", drivers: { id: "keeta-driver", tenant_id: tenant, full_name_en: "Synthetic", full_name_ar: "", iban: "synthetic-keeta-iban", bank_name: "Synthetic" } }]
      const rows = table === "payroll_engine_results" ? results : table === "payroll_engine_items" ? items : table === "driver_platform_accounts" && filters.get("platform_code") === "keeta" ? mocks.duplicateLink ? [...links, { ...links[0], id: "link-2" }] : links : []
      return { data: rows.slice(from, to + 1), count: mocks.changedCount && from >= 500 ? rows.length + 1 : rows.length, error: null }
    },
  }
  function record(method: string, values: unknown[]) { mocks.calls.push({ table, method, values }); return chain }
  return chain
}
const ctx = { tenantId: tenant, userId: "synthetic-actor", admin: { from: query } } as unknown as EngineContext
beforeEach(() => { vi.clearAllMocks(); mocks.calls = []; mocks.lateError = false; mocks.changedCount = false; mocks.duplicateLink = false; mocks.rpc.mockResolvedValue({ data: 7, error: null }) })
describe("complete payroll source and beneficiary reads", () => {
  it("loads every stored input and source beyond the API's 1000-row cap", async () => {
    expect((await loadDraftInputs(ctx, runId)).rows).toHaveLength(1251)
    expect((await loadSources(ctx)).customBonuses).toHaveLength(1251)
  })
  it.each(["lateError", "changedCount"] as const)("rejects %s instead of recalculating a truncated payroll", async fault => {
    mocks[fault] = true
    await expect(loadDraftInputs(ctx, runId)).rejects.toThrow("Complete payroll inputs unavailable")
    await expect(loadSources(ctx)).rejects.toThrow()
  })
  it("selects the platform account rather than a different platform's primary rider id", async () => {
    const links = await loadDriversByRider(ctx, ["same"], "Keeta")
    expect(links.get("same")).toMatchObject({ id: "keeta-driver", iban: "synthetic-keeta-iban" })
    expect(mocks.calls).toContainEqual({ table: "driver_platform_accounts", method: "eq", values: ["platform_code", "keeta"] })
    expect(mocks.calls.some(call => call.table === "drivers")).toBe(false)
  })
  it("does not fall back to a primary bank account for an unrecognized platform", async () => {
    expect((await loadDriversByRider(ctx, ["same"], "Unmapped synthetic platform")).size).toBe(0)
    expect(mocks.calls).toHaveLength(0)
  })
  it("rejects ambiguous mappings", async () => {
    mocks.duplicateLink = true
    await expect(loadDriversByRider(ctx, ["same"], "Keeta")).rejects.toThrow("Ambiguous")
  })
  it("never assigns a shared workbook account to an unlinked rider", () => {
    const raw = parseWorkbook(readFileSync(join(__dirname, "../__fixtures__/may-2026.xlsx"))).drivers.slice(0, 1)
    const computed = computePayrollRun({ rawDrivers: raw, rules: buildRuleSnapshot({}), ruleSetName: "Synthetic", payrollMonth: "May 2026", sources: {}, advanceInstallments: false })
    expect(runPayload(computed, new Map(), {}, { beneficiaryName: "Company treasury", iban: "synthetic-shared", bankName: "Synthetic", source: "workbook" }, raw).results[0].bank).toBeNull()
  })
  it("requires a valid caller-bound source version", async () => {
    expect(await payrollSourceVersion()).toBe(7)
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "08006" } })
    await expect(payrollSourceVersion()).rejects.toThrow("could not be confirmed")
  })
  it("does not expose unknown database errors", () => {
    expect(failure({ message: "private SQL detail" }, "Unable to save")).toEqual({ success: false, error: "PAYENG_UNAVAILABLE" })
  })
  it("returns virtual defaults without persisting anything during a read", async () => {
    const rules = await loadActiveRules(ctx)
    expect(rules.id).toBeNull()
    expect(Object.keys(rules.values).length).toBeGreaterThan(0)
    expect(mocks.calls.every(call => ["select", "eq"].includes(call.method))).toBe(true)
  })
  it("requires server confirmation of the exact save payload before the caller can write", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const context = { ...ctx, admin: { rpc } } as unknown as EngineContext
    const args = { p_run: { month_key: "2192-01" }, p_results: [{}], p_exceptions: [], p_income: [], p_source_version: 7, p_run_id: runId, p_expected_version: 2 }
    await saveReviewedPayroll(context, args)
    expect(rpc).toHaveBeenCalledWith("attest_platform_payroll", expect.objectContaining({ p_tenant: tenant, p_actor: "synthetic-actor", p_payload: { run: args.p_run, results: args.p_results, exceptions: [], income: [], source: 7, run_id: runId, expected_version: 2 } }))
    mocks.rpc.mockClear()
    rpc.mockResolvedValue({ data: null, error: { code: "08006" } })
    await expect(saveReviewedPayroll(context, args)).rejects.toThrow("could not be confirmed")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("cannot reuse an earlier beneficiary's bank after platform ID reassignment", () => {
    const driver = { id: "new-driver", name: "Synthetic", iban: "new-iban", bankName: "Synthetic" }
    const links = new Map([["R1", driver]])
    expect(hasChangedBeneficiary([{ rider_id: "R1", driver_id: "old-driver", bank: { iban: "old-iban" } }], links)).toBe(true)
    expect(hasChangedBeneficiary([{ rider_id: "R1", driver_id: null, bank: { iban: "old-iban" } }], links)).toBe(true)
    expect(hasChangedBeneficiary([{ rider_id: "R1", driver_id: "old-driver", bank: null }], new Map())).toBe(true)
    expect(hasChangedBeneficiary([{ rider_id: "R1", driver_id: null, bank: null }], links)).toBe(false)
    expect(hasChangedBeneficiary([{ rider_id: "R1", driver_id: "new-driver", bank: { iban: "stored-for-this-person" } }], links)).toBe(false)
  })
})
