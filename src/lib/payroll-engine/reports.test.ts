// Payslip, Excel export and Income-vs-Expenses aggregation must reconcile
// exactly with the engine output for every golden scenario.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { incomeExpensesSheets, payrollResultsSheets } from "./exports"
import { computeIncomeDashboard, type IncomeRecordInput } from "./income-dashboard"
import { calculateIncome } from "./income-engine"
import { toHalalas } from "./month"
import { payslipBreakdown } from "./payslip"
import type { DriverResultCalc } from "./salary-engine"

const FX = join(__dirname, "__fixtures__")
const golden = JSON.parse(readFileSync(join(FX, "golden.json"), "utf8")) as Record<string, { results: DriverResultCalc[]; incomeRows: Array<IncomeRecordInput & { totalIncome: number }> }>
const scenarios = JSON.parse(readFileSync(join(FX, "scenarios.json"), "utf8")) as Array<{ id: string; rules: Record<string, unknown>; expenses: Array<{ categoryName: string; amount: number; allocationType: string; assignedRiderId?: string | null }> }>
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6)

describe.each(scenarios)("reports reconcile — $id", sc => {
  const results = golden[sc.id].results
  const capped = ["deduction_cap", "salary_floor", "pen_max_allowed"].some(k => Number(sc.rules[k] ?? 0) > 0)

  it("payslip lines add up to the engine gross and net for every rider", () => {
    for (const r of results) {
      const p = payslipBreakdown(r)
      close(p.earnings.reduce((s, l) => s + l.amount, 0), r.grossSalaryBeforePenalties)
      close(p.gross - p.totalDeductions, r.finalNetSalary)
      close(p.deductions.reduce((s, l) => s + l.amount, 0), p.totalDeductions)
      // The reconstruction itself is exact: no unexplained gross residual.
      close(p.grossFloorAdjustment, 0)
      if (!capped) close(p.penaltyCapAdjustment, 0)
      // Without caps/floors the only residual is the hard zero floor (deductions larger than gross).
      if (!capped && r.finalNetSalary > 0) close(p.capFloorAdjustment, 0)
      if (r.finalNetSalary === 0) expect(p.capFloorAdjustment).toBeLessThanOrEqual(0)
    }
  })

  it("Excel results export totals equal the engine totals", () => {
    const sheets = payrollResultsSheets({ payrollMonth: "M", platformName: "P", ruleSetName: "R", status: "draft", fileName: "f.xlsx" }, results.map(result => ({ result, bank: null })))
    const det = sheets.find(s => s.name === "Driver Results")!
    const head = det.rows[0] as string[]
    const total = det.rows[det.rows.length - 1]
    const col = (h: string) => Number(total[head.indexOf(h)])
    close(col("Net salary"), results.reduce((s, r) => s + r.finalNetSalary, 0))
    close(col("Gross salary"), results.reduce((s, r) => s + r.grossSalaryBeforePenalties, 0))
    close(col("Gross salary") - col("Total deductions"), col("Net salary"))
    const summary = sheets.find(s => s.name === "Summary")!
    close(Number(summary.rows.find(r => r[0] === "Check: gross − deductions − net")![1]), 0)
    const bank = sheets.find(s => s.name === "Bank Transfer")!
    expect(bank.rows[bank.rows.length - 1][4]).toBe(toHalalas(results.reduce((s, r) => s + toHalalas(r.finalNetSalary), 0)))
  })

  it("income vs expenses: per-rider income matches the engine and totals reconcile", () => {
    const records = golden[sc.id].incomeRows.map((i, n) => ({ ...i, id: String(n), driverName: "", companyName: "HungerStation" }))
    for (const rec of golden[sc.id].incomeRows) close(calculateIncome(rec).totalIncome, rec.totalIncome)
    const dash = computeIncomeDashboard(records, sc.expenses, records.length)
    close(dash.summary.totalIncome, records.reduce((s, r) => s + r.totalIncome, 0))
    close(dash.summary.totalIncome - dash.summary.totalExpenses, dash.summary.totalNetProfit)
    // With the confirmed count equal to riders, shared costs are fully allocated.
    close(dash.reconciliation.sharedUnallocated, 0)
    const perDriver = sc.expenses.filter(e => e.allocationType === "per_driver").reduce((s, e) => s + e.amount, 0)
    close(dash.reconciliation.perDriverCharged, perDriver * records.length)
    const sheets = incomeExpensesSheets(dash, "2026-09")
    const det = sheets[1]; const tot = det.rows[det.rows.length - 1]
    close(Number(tot[(det.rows[0] as string[]).indexOf("Net profit")]), dash.summary.totalNetProfit)
  })
})

describe("income vs expenses allocation", () => {
  const rec = (riderId: string, basic: number): IncomeRecordInput => ({ id: riderId, riderId, driverName: riderId, companyName: "HS", basicPayment: basic, distancePayment: 0, segmentPayment: 0,
    acceptancePenalty: 0, contactPenalty: 0, stackingDeduction: 0, declinedPenalty: 0, latePenalty: 0, noShowPenalty: 0, noShowSpecialPenalty: 0, dailyAcceptancePenalty: 0, missedDaysPenalty: 0, riderBalance: -50 })
  it("splits shared costs by the active driver count and reports the unallocated remainder", () => {
    const dash = computeIncomeDashboard([rec("1", 3000), rec("2", 2000)], [
      { categoryName: "Rent", amount: 900, allocationType: "shared" },
      { categoryName: "Iqama", amount: 100, allocationType: "per_driver" },
      { categoryName: "Fuel", amount: 70, allocationType: "assigned", assignedRiderId: "2" },
      { categoryName: "Fuel", amount: 30, allocationType: "assigned", assignedRiderId: "9" },
    ], 3)
    expect(dash.driverResults.map(d => d.income.totalIncome)).toEqual([2950, 1950]) // rider balance is a deduction (abs)
    expect(dash.driverResults.map(d => d.expenses.totalExpenses)).toEqual([400, 470])
    expect(dash.summary.totalNetProfit).toBe(4900 - 870)
    expect(dash.reconciliation).toMatchObject({ sharedEntered: 900, sharedAllocated: 600, sharedUnallocated: 300, assignedEntered: 100, assignedAllocated: 70, assignedUnmatched: 30, perDriverCharged: 200 })
  })
})
