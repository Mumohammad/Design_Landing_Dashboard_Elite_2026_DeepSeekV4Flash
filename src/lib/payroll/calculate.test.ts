import { beforeEach, describe, expect, it, vi } from "vitest"
const { state } = vi.hoisted(() => ({ state: { failures: new Set<string>(), writes: [] as Record<string, unknown>[], filters: [] as unknown[][] } }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const defaults: Record<string, unknown> = {
    drivers: { id: "driver", tenant_id: "tenant", category: "freelancer", nationality_code: "SA" },
    driver_payroll_rules: { id: "rule", base_salary: 4000, working_days_target: 26 },
    attendance_periods: { status: "locked" },
    driver_attendance_summary: { working_days_actual: 26, days_absent_unexcused: 0 },
  }
  const response = () => ({ data: state.failures.has(table) ? null : defaults[table] ?? [], error: state.failures.has(table) ? { message: "database unavailable" } : null })
  const builder = {
    select: () => builder, eq: () => builder, is: () => builder,
    order: () => builder, limit: () => builder, gte: () => builder,
    lt: (...args: unknown[]) => { state.filters.push([table, ...args]); return builder },
    single: async () => response(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve),
    upsert: async (record: Record<string, unknown>) => { state.writes.push(record); return { error: null } },
  }
  return builder
} }) }))
import { calculateDriverPayroll } from "./calculate"
beforeEach(() => { state.failures.clear(); state.writes.length = 0; state.filters.length = 0 })
describe("payroll input integrity", () => {
  it.each(["driver_payroll_rules", "attendance_periods", "driver_attendance_summary", "monthly_driver_orders", "violation_deduction_ledger", "payroll_advances", "driver_cod_sessions"])("never persists a partial calculation when %s fails", async (table) => {
    state.failures.add(table)
    await expect(calculateDriverPayroll({ driverId: "driver", periodYear: 2026, periodMonth: 9 })).rejects.toThrow()
    expect(state.writes).toHaveLength(0)
  })
  it("uses an exclusive UTC month boundary for rules and COD and the real schema column", async () => {
    await calculateDriverPayroll({ driverId: "driver", periodYear: 2026, periodMonth: 12 })
    expect(state.filters).toContainEqual(["driver_payroll_rules", "effective_date", "2027-01-01"])
    expect(state.filters).toContainEqual(["driver_cod_sessions", "session_date", "2027-01-01"])
    expect(state.writes[0]).toHaveProperty("target_orders_monthly")
    expect(state.writes[0]).not.toHaveProperty("orders_target_monthly")
  })
  it("rejects an invalid period", async () => {
    await expect(calculateDriverPayroll({ driverId: "driver", periodYear: 2026, periodMonth: 13 })).rejects.toThrow("Invalid payroll period")
    expect(state.writes).toHaveLength(0)
  })
})
