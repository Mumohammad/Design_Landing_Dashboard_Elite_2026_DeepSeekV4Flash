import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseWorkbook } from "../excel-parser"
import { buildRuleSnapshot, computePayrollRun, type PayrollSources } from "../run"
import { payslipBreakdown } from "../payslip"
import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), source: vi.fn(), inputs: vi.fn(), attest: vi.fn(), rules: vi.fn(), sources: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock("./data", () => ({ engineContext: mocks.context, payrollSourceVersion: mocks.source, attestPayrollCalculation: mocks.attest, loadActiveRules: mocks.rules, loadSources: mocks.sources, loadDriversByRider: vi.fn(), saveReviewedPayroll: vi.fn(), failure: () => ({ success: false, error: "PAYENG_UNAVAILABLE" }) }))
vi.mock("./recalc", () => ({ loadDraftInputs: mocks.inputs, adapterExceptions: vi.fn(), recalculateDraftRun: vi.fn(), runPayload: vi.fn() }))
import { approvePayrollRun } from "./run-actions"
const runId = "30000000-0000-4000-8000-000000000001"
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ tenantId: "synthetic-tenant", userId: "synthetic-actor" })
  mocks.rpc.mockResolvedValue({ data: { run_id: runId, advanced: 1, settled: 2, replayed: true }, error: null })
})
describe("approval recovery after a dropped response", () => {
  it("recovers the committed receipt before reading changed installment inputs", async () => {
    expect(await approvePayrollRun({ runId, version: 1 })).toEqual({ success: true, data: { advanced: 1, settled: 2 } })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_my_platform_payroll_approval", { p_run_id: runId, p_expected_version: 1 })
    expect(mocks.source).not.toHaveBeenCalled()
    expect(mocks.inputs).not.toHaveBeenCalled()
    expect(mocks.attest).not.toHaveBeenCalled()
  })
  it("checks current authorization before returning an old receipt", async () => {
    mocks.context.mockRejectedValueOnce(Error("permission revoked"))
    expect((await approvePayrollRun({ runId, version: 1 })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([{ run_id: "other", advanced: 1, settled: 2, replayed: true }, { run_id: runId, advanced: "1", settled: 2, replayed: true }])("rejects a malformed or different-run recovery response", async data => {
    mocks.rpc.mockResolvedValueOnce({ data, error: null })
    expect((await approvePayrollRun({ runId, version: 1 })).success).toBe(false)
    expect(mocks.inputs).not.toHaveBeenCalled()
  })
  it("does not start another approval when recovery itself is unavailable", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "08006" } })
    expect((await approvePayrollRun({ runId, version: 1 })).success).toBe(false)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.source).not.toHaveBeenCalled()
  })
})

describe("real September workbook approval eligibility", () => {
  const workbook = parseWorkbook(readFileSync(join(__dirname, "../__fixtures__/sep-2026.xlsx")))
  const rules = buildRuleSnapshot({})
  const firstRider = [...workbook.drivers].sort((a, b) => a.riderId < b.riderId ? -1 : a.riderId > b.riderId ? 1 : 0)[0].riderId
  const eid = { id: "40000000-0000-4000-8000-000000000001", riderId: firstRider, title: "CI Eid bonus", titleAr: null, amount: 250, type: "bonus", category: "custom", status: "active" }
  function calculate(sources: PayrollSources) {
    return computePayrollRun({ rawDrivers: structuredClone(workbook.drivers), rules, ruleSetName: "Default payroll rules", payrollMonth: "September 2026", sources, advanceInstallments: true })
  }
  function configureDraft(sources: PayrollSources) {
    const computed = calculate(sources)
    mocks.rules.mockResolvedValue({ snapshot: rules, name: "Default payroll rules" })
    mocks.sources.mockResolvedValue(sources)
    mocks.source.mockResolvedValue(1)
    mocks.inputs.mockResolvedValue({ run: { id: runId, status: "draft", payroll_month: "September 2026" }, rows: computed.riders.map(({ raw, result }) => ({ rider_id: result.riderId, raw_input: raw, result: JSON.parse(JSON.stringify(result)) })) })
    mocks.rpc.mockReset().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { advanced: 0, settled: 2 }, error: null })
    return computed
  }
  it("rejects the golden fixture's unrecovered balance before attestations or settlement", async () => {
    const computed = configureDraft({ customBonuses: [], customDeductions: [], manualAdjustments: [eid], trafficViolations: [] })
    const blocked = computed.riders.filter(({ result }) => payslipBreakdown(result).capFloorAdjustment < -0.005)
    expect(blocked).toHaveLength(1)
    expect(blocked[0].result.riderId).not.toBe(firstRider)
    expect(await approvePayrollRun({ runId, version: 1 })).toEqual({ success: false, error: "PAYENG_UNRECOVERED" })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_my_platform_payroll_approval", { p_run_id: runId, p_expected_version: 1 })
    expect(mocks.attest).not.toHaveBeenCalled()
  })
  it("permits a recalculated synthetic recovery while preserving the approval receipt boundary", async () => {
    const before = calculate({ manualAdjustments: [eid] })
    const blocked = before.riders.find(({ result }) => payslipBreakdown(result).capFloorAdjustment < -0.005)!
    const recovery = { ...eid, id: "40000000-0000-4000-8000-000000000002", riderId: blocked.result.riderId, title: "CI recovery bonus", amount: Math.ceil((-payslipBreakdown(blocked.result).capFloorAdjustment + 0.01) * 100) / 100 }
    const computed = configureDraft({ customBonuses: [], customDeductions: [], manualAdjustments: [eid, recovery], trafficViolations: [] })
    expect(computed.riders).toHaveLength(17)
    expect(computed.riders.every(({ result }) => payslipBreakdown(result).capFloorAdjustment >= -0.005)).toBe(true)
    expect(await approvePayrollRun({ runId, version: 1 })).toEqual({ success: true, data: { advanced: 0, settled: 2 } })
    expect(mocks.attest).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "approve_my_platform_payroll", { p_run_id: runId, p_expected_version: 1, p_source_version: 1, p_changes: [{ table: "adjustment_status", id: eid.id }, { table: "adjustment_status", id: recovery.id }] })
  })
})
