// Vendored from duaa7226-collab/Payroll-Sys-2026 @ 1feaee25 (src/lib/income-expenses-engine.ts).
// Only the pure calculation functions are kept; database access lives in the
// tenant-scoped adapters. Parity is enforced by golden.test.ts.

export interface IncomeCalc {
  basicPayment: number
  distancePayment: number
  segmentPayment: number
  // All penalties treated as deductions (use absolute values)
  totalPenalties: number
  riderBalance: number // signed
  customFieldsTotal: number // net of custom add/deduct fields
  totalIncome: number
}

export interface ExpenseAllocation {
  perDriverTotal: number
  sharedTotal: number
  assignedTotal: number
  totalExpenses: number
  sharedBreakdown: Array<{ categoryName: string; totalAmount: number; perDriver: number }>
  perDriverBreakdown: Array<{ categoryName: string; amount: number }>
  assignedBreakdown: Array<{ categoryName: string; amount: number; riderId: string | null }>
}

export interface IncomeInput {
  basicPayment: number
  distancePayment: number
  segmentPayment: number
  acceptancePenalty: number
  contactPenalty: number
  stackingDeduction: number
  declinedPenalty: number
  latePenalty: number
  noShowPenalty: number
  noShowSpecialPenalty: number
  dailyAcceptancePenalty: number
  missedDaysPenalty: number
  riderBalance: number
  customFieldsJson?: string | null
}

export interface ExpenseInput {
  categoryName: string
  amount: number
  allocationType: string
  assignedRiderId?: string | null
}

// Calculate income from an IncomeRecord row
// Formula: Total income = basic_payment + distance_payment + segment_payment
//                       - ALL penalties (including stacking, rider_balance)
// Rider Balance is treated as a DEDUCTION (penalty), not a signed add.
export function calculateIncome(rec: IncomeInput): IncomeCalc {
  const totalPenalties =
    Math.abs(rec.acceptancePenalty) +
    Math.abs(rec.contactPenalty) +
    Math.abs(rec.stackingDeduction) +
    Math.abs(rec.declinedPenalty) +
    Math.abs(rec.latePenalty) +
    Math.abs(rec.noShowPenalty) +
    Math.abs(rec.noShowSpecialPenalty) +
    Math.abs(rec.dailyAcceptancePenalty) +
    Math.abs(rec.missedDaysPenalty) +
    Math.abs(rec.riderBalance)  // Rider Balance is a DEDUCTION, not income

  let customFieldsTotal = 0
  if (rec.customFieldsJson) {
    try {
      const fields = JSON.parse(rec.customFieldsJson) as Array<{ name: string; amount: number; type: 'add' | 'deduct' }>
      for (const f of fields) {
        if (f.type === 'deduct') customFieldsTotal -= Math.abs(f.amount)
        else customFieldsTotal += Math.abs(f.amount)
      }
    } catch {}
  }

  const totalIncome =
    rec.basicPayment +
    rec.distancePayment +
    rec.segmentPayment -
    totalPenalties +
    customFieldsTotal

  return {
    basicPayment: rec.basicPayment,
    distancePayment: rec.distancePayment,
    segmentPayment: rec.segmentPayment,
    totalPenalties,
    riderBalance: rec.riderBalance,
    customFieldsTotal,
    totalIncome,
  }
}

// Calculate expense allocation from a pre-fetched list (no DB query — for batch performance)
export function calculateExpensesFromList(
  expenses: ExpenseInput[],
  riderId: string,
  activeDriverCount: number
): ExpenseAllocation {
  const perDriverBreakdown: Array<{ categoryName: string; amount: number }> = []
  const sharedBreakdown: Array<{ categoryName: string; totalAmount: number; perDriver: number }> = []
  const assignedBreakdown: Array<{ categoryName: string; amount: number; riderId: string | null }> = []

  let perDriverTotal = 0
  let sharedTotal = 0
  let assignedTotal = 0

  const sharedByCategory = new Map<string, number>()
  for (const e of expenses) {
    if (e.allocationType === 'shared') {
      sharedByCategory.set(e.categoryName, (sharedByCategory.get(e.categoryName) ?? 0) + e.amount)
    }
  }

  for (const e of expenses) {
    if (e.allocationType === 'per_driver') {
      perDriverTotal += e.amount
      const existing = perDriverBreakdown.find(p => p.categoryName === e.categoryName)
      if (existing) existing.amount += e.amount
      else perDriverBreakdown.push({ categoryName: e.categoryName, amount: e.amount })
    } else if (e.allocationType === 'assigned') {
      if (e.assignedRiderId === riderId) {
        assignedTotal += e.amount
        assignedBreakdown.push({ categoryName: e.categoryName, amount: e.amount, riderId: e.assignedRiderId ?? null })
      }
    }
  }

  const safeDriverCount = activeDriverCount > 0 ? activeDriverCount : 1
  for (const [categoryName, totalAmount] of sharedByCategory.entries()) {
    const perDriver = totalAmount / safeDriverCount
    sharedTotal += perDriver
    sharedBreakdown.push({ categoryName, totalAmount, perDriver })
  }

  const totalExpenses = perDriverTotal + sharedTotal + assignedTotal

  return {
    perDriverTotal,
    sharedTotal,
    assignedTotal,
    totalExpenses,
    sharedBreakdown,
    perDriverBreakdown,
    assignedBreakdown,
  }
}

/**
 * Active driver count for a month — same priority as the original
 * getActiveDriverCount(): 1) confirmed monthly count (> 0), 2) distinct rider
 * IDs with income that month, 3) driver count of the latest payroll run.
 */
export function resolveActiveDriverCount(input: {
  confirmedCount?: number | null
  incomeRiderIds?: readonly string[]
  latestRunDriverCount?: number | null
}): number {
  if (input.confirmedCount && input.confirmedCount > 0) return input.confirmedCount
  const distinct = new Set(input.incomeRiderIds ?? [])
  if (distinct.size > 0) return distinct.size
  if (input.latestRunDriverCount && input.latestRunDriverCount > 0) return input.latestRunDriverCount
  return 0
}
