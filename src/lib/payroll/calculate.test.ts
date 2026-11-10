import { beforeEach, describe, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mock.rpc }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("Privileged client must not calculate payroll") } }))
import { calculateDriverPayroll } from "./calculate"
const driverId = "a9500000-0000-4000-8000-000000000005"
const persisted = { id: "a9500000-0000-4000-8000-000000000008", base_amount: 2306.46, orders_bonus: 0, package_deduction: 0, orders_deduction: 0, orders_prorated_target: 257, orders_variance: -254, total_deductions: 12.34, net_payroll: 2294.12, minimum_floor_applied: false, below_minimum_wage: false, deduction_lines: [], calculation_steps: ["Atomic"], warnings: [], period: { driver_id: driverId, period_year: 2026, period_month: 2, status: "calculated" } }
beforeEach(() => { mock.rpc.mockReset(); mock.rpc.mockResolvedValue({ data: persisted, error: null }) })
describe("atomic payroll calculation boundary", () => {
  it("sends only identity and period; the database computes and persists amounts", async () => {
    const result = await calculateDriverPayroll({ driverId, periodYear: 2026, periodMonth: 2, baseSalary: 9999, tenantId: "forged" } as never)
    expect(mock.rpc).toHaveBeenCalledWith("calculate_payroll_atomic", { p_driver: driverId, p_year: 2026, p_month: 2 })
    expect(result).toEqual(persisted)
  })
  it.each([{ driverId: "invalid", periodYear: 2026, periodMonth: 2 }, { driverId, periodYear: 2026, periodMonth: 13 }, { driverId, periodYear: 2101, periodMonth: 2 }])("rejects invalid input before database work", async input => {
    await expect(calculateDriverPayroll(input)).rejects.toThrow("Invalid payroll")
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it.each(["PAY_INPUTS_UNREVIEWED", "PAY_RULE_INCOMPLETE", "PAY_PREPARATION_FORBIDDEN", "PAY_CALCULATION_HISTORY_IMMUTABLE"])("propagates an atomic rejection without privileged fallback: %s", async message => {
    mock.rpc.mockResolvedValue({ data: null, error: { message } })
    await expect(calculateDriverPayroll({ driverId, periodYear: 2026, periodMonth: 2 })).rejects.toThrow(message)
    expect(mock.rpc).toHaveBeenCalledTimes(1)
  })
  it.each([null, {}, { ...persisted, net_payroll: "2294.12" }, { ...persisted, period: { ...persisted.period, period_month: 3 } }])("fails closed on an incomplete or wrong-period response", async data => {
    mock.rpc.mockResolvedValue({ data, error: null })
    await expect(calculateDriverPayroll({ driverId, periodYear: 2026, periodMonth: 2 })).rejects.toThrow("invalid result")
  })
})
