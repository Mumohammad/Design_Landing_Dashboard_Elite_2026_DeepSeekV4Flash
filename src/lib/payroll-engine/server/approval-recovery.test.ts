import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), source: vi.fn(), inputs: vi.fn(), attest: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock("./data", () => ({ engineContext: mocks.context, payrollSourceVersion: mocks.source, attestPayrollCalculation: mocks.attest, loadActiveRules: vi.fn(), loadSources: vi.fn(), loadDriversByRider: vi.fn(), saveReviewedPayroll: vi.fn(), failure: () => ({ success: false, error: "PAYENG_UNAVAILABLE" }) }))
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
