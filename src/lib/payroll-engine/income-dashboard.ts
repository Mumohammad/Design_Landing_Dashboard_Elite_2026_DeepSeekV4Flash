// Income vs Expenses aggregation — a pure port of the upstream
// /api/income-expenses/dashboard route (Payroll-Sys-2026 @ 1feaee25) so the
// screen, the Excel export and the tests share one calculation.
import { calculateExpensesFromList, calculateIncome, type ExpenseAllocation, type ExpenseInput, type IncomeCalc, type IncomeInput } from "./income-engine"

export const INCOME_NUMERIC_FIELDS = ["basicPayment", "distancePayment", "segmentPayment", "acceptancePenalty", "contactPenalty", "stackingDeduction", "declinedPenalty",
  "latePenalty", "noShowPenalty", "noShowSpecialPenalty", "dailyAcceptancePenalty", "missedDaysPenalty", "riderBalance"] as const

export interface IncomeRecordInput extends IncomeInput { id: string; riderId: string; driverName: string; companyName: string }

export interface DriverProfit {
  id: string; riderId: string; driverName: string; companyName: string
  record: IncomeRecordInput; income: IncomeCalc; expenses: ExpenseAllocation; netProfit: number
}

export interface IncomeDashboard {
  activeDriverCount: number
  driverResults: DriverProfit[]
  summary: { activeDrivers: number; totalIncome: number; totalExpenses: number; totalNetProfit: number; avgNetPerDriver: number; profitableCount: number; unprofitableCount: number }
  incomeByCompany: Array<{ name: string; income: number; expenses: number; net: number; driverCount: number }>
  expenseByCategory: Array<{ name: string; amount: number }>
  expenseAllocation: { per_driver: number; shared: number; assigned: number; total: number }
  /**
   * Reconciliation (added on top of upstream): what the allocation actually
   * charged versus what was entered. Shared costs are split by the active
   * driver count, so if that differs from the riders with income, part of the
   * shared cost is not carried by any rider row.
   */
  reconciliation: { sharedEntered: number; sharedAllocated: number; sharedUnallocated: number; assignedEntered: number; assignedAllocated: number; assignedUnmatched: number; perDriverCharged: number }
}

export function computeIncomeDashboard(records: readonly IncomeRecordInput[], expenses: readonly ExpenseInput[], activeDriverCount: number): IncomeDashboard {
  const list = expenses.map(e => ({ ...e }))
  const driverResults: DriverProfit[] = records.map(rec => {
    const income = calculateIncome(rec)
    const alloc = calculateExpensesFromList(list, rec.riderId, activeDriverCount)
    return { id: rec.id, riderId: rec.riderId, driverName: rec.driverName, companyName: rec.companyName, record: rec, income, expenses: alloc, netProfit: income.totalIncome - alloc.totalExpenses }
  })
  const totalIncome = driverResults.reduce((s, d) => s + d.income.totalIncome, 0)
  const totalExpenses = driverResults.reduce((s, d) => s + d.expenses.totalExpenses, 0)
  const totalNetProfit = driverResults.reduce((s, d) => s + d.netProfit, 0)
  const activeDrivers = driverResults.length

  const byCompany = new Map<string, { income: number; expenses: number; net: number; driverCount: number }>()
  for (const d of driverResults) {
    const e = byCompany.get(d.companyName) ?? { income: 0, expenses: 0, net: 0, driverCount: 0 }
    e.income += d.income.totalIncome; e.expenses += d.expenses.totalExpenses; e.net += d.netProfit; e.driverCount++
    byCompany.set(d.companyName, e)
  }
  const byCategory = new Map<string, number>()
  for (const e of list) byCategory.set(e.categoryName, (byCategory.get(e.categoryName) ?? 0) + e.amount)

  const sumType = (t: string) => list.filter(e => e.allocationType === t).reduce((s, e) => s + e.amount, 0)
  const perDriver = sumType("per_driver"), shared = sumType("shared"), assigned = sumType("assigned")
  const sharedAllocated = driverResults.reduce((s, d) => s + d.expenses.sharedTotal, 0)
  const assignedAllocated = driverResults.reduce((s, d) => s + d.expenses.assignedTotal, 0)

  return {
    activeDriverCount,
    driverResults,
    summary: {
      activeDrivers, totalIncome, totalExpenses, totalNetProfit,
      avgNetPerDriver: activeDrivers > 0 ? totalNetProfit / activeDrivers : 0,
      profitableCount: driverResults.filter(d => d.netProfit > 0).length,
      unprofitableCount: driverResults.filter(d => d.netProfit < 0).length,
    },
    incomeByCompany: [...byCompany.entries()].map(([name, v]) => ({ name, ...v })),
    expenseByCategory: [...byCategory.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    expenseAllocation: { per_driver: perDriver, shared, assigned, total: perDriver + shared + assigned },
    reconciliation: {
      sharedEntered: shared, sharedAllocated, sharedUnallocated: shared - sharedAllocated,
      assignedEntered: assigned, assignedAllocated, assignedUnmatched: assigned - assignedAllocated,
      perDriverCharged: driverResults.reduce((s, d) => s + d.expenses.perDriverTotal, 0),
    },
  }
}
