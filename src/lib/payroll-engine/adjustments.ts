// Pure ports of the Payroll-Sys-2026 adjustment helpers @ 1feaee25
// (custom-bonus-helpers.ts, custom-deduction-helpers.ts,
// manual-adjustment-helpers.ts, traffic-helpers.ts). The original functions
// read Prisma; here the caller passes the tenant's rows. The arithmetic and
// filters are unchanged and covered by golden.test.ts.

export interface CustomBonusRecord {
  id: string
  name: string
  nameAr: string | null
  amount: number
  type: string
  status: string
  applyToAll: boolean
  targetRiderIds: string[]
}

export interface CustomDeductionRecord {
  id: string
  name: string
  nameAr: string | null
  amount: number
  status: string
  applyToAll: boolean
  targetRiderIds: string[]
  installmentEnabled: boolean
  installmentMonthlyAmount: number
  installmentTotalPaid: number
  installmentStatus: string
}

export interface ManualAdjustmentRecord {
  id: string
  riderId: string
  title: string
  titleAr: string | null
  amount: number
  type: string // 'bonus' | 'deduction'
  category: string
  status: string
}

export interface TrafficViolationRecord {
  id: string
  riderId: string
  violationType: string
  amount: number
  status: string
  installmentEnabled: boolean
  installmentMonthlyAmount: number
  installmentTotalPaid: number
  installmentStatus: string
}

export type CustomDeductionItem = CustomDeductionRecord & { monthlyDeduction: number }

export function activeCustomBonuses(rows: readonly CustomBonusRecord[]): CustomBonusRecord[] {
  return rows.filter(b => b.status === 'active')
}

export function getBonusesForRider(bonuses: readonly CustomBonusRecord[], riderId: string): CustomBonusRecord[] {
  return bonuses.filter(b => b.applyToAll || b.targetRiderIds.includes(riderId))
}

export function activeCustomDeductions(rows: readonly CustomDeductionRecord[]): CustomDeductionItem[] {
  // FIX (deviation from upstream): a finished installment plan (installmentStatus
  // 'completed') fell through to `d.amount` and re-deducted the FULL amount
  // every month. Completed plans now deduct nothing.
  return rows.filter(d => d.status === 'active' && !(d.installmentEnabled && d.installmentStatus !== 'active')).map(d => {
    const remaining = d.installmentEnabled ? Math.max(0, d.amount - d.installmentTotalPaid) : d.amount
    const monthlyDeduction = d.installmentEnabled && d.installmentStatus === 'active'
      ? Math.min(d.installmentMonthlyAmount, remaining)
      : d.amount
    return { ...d, monthlyDeduction }
  })
}

export function getDeductionsForRider(deductions: readonly CustomDeductionItem[], riderId: string): CustomDeductionItem[] {
  return deductions.filter(d => d.applyToAll || d.targetRiderIds.includes(riderId))
}

export interface ManualAdjustmentBreakdown {
  bonuses: Array<{ id: string; title: string; titleAr: string | null; amount: number; category: string }>
  deductions: Array<{ id: string; title: string; titleAr: string | null; amount: number; category: string }>
  bonusTotal: number
  deductionTotal: number
}

export function groupManualAdjustments(rows: readonly ManualAdjustmentRecord[], riderIds: readonly string[]): Map<string, ManualAdjustmentBreakdown> {
  const wanted = new Set(riderIds)
  const byRider = new Map<string, ManualAdjustmentBreakdown>()
  for (const a of rows) {
    if (!wanted.has(a.riderId) || a.status !== 'active') continue
    let breakdown = byRider.get(a.riderId)
    if (!breakdown) {
      breakdown = { bonuses: [], deductions: [], bonusTotal: 0, deductionTotal: 0 }
      byRider.set(a.riderId, breakdown)
    }
    if (a.type === 'bonus') {
      breakdown.bonuses.push({ id: a.id, title: a.title, titleAr: a.titleAr, amount: a.amount, category: a.category })
      breakdown.bonusTotal += a.amount
    } else {
      breakdown.deductions.push({ id: a.id, title: a.title, titleAr: a.titleAr, amount: a.amount, category: a.category })
      breakdown.deductionTotal += a.amount
    }
  }
  return byRider
}

export interface TrafficDeductionBreakdown {
  oneTimeTotal: number
  installmentMonthlyTotal: number
  total: number
  installments: Array<{
    id: string
    violationType: string
    originalAmount: number
    monthlyAmount: number
    totalPaid: number
    remainingBalance: number
    remainingMonths: number
  }>
}

export function groupTrafficDeductions(rows: readonly TrafficViolationRecord[], riderIds: readonly string[]): Map<string, TrafficDeductionBreakdown> {
  const wanted = new Set(riderIds)
  const byRider = new Map<string, TrafficDeductionBreakdown>()
  for (const v of rows) {
    if (!wanted.has(v.riderId) || v.status !== 'approved') continue
    // FIX (deviation from upstream): a completed installment fine fell into the
    // one-time branch and was deducted again in full every month.
    if (v.installmentEnabled && v.installmentStatus !== 'active') continue
    let breakdown = byRider.get(v.riderId)
    if (!breakdown) {
      breakdown = { oneTimeTotal: 0, installmentMonthlyTotal: 0, total: 0, installments: [] }
      byRider.set(v.riderId, breakdown)
    }
    if (v.installmentEnabled && v.installmentStatus === 'active') {
      const remaining = Math.max(0, v.amount - v.installmentTotalPaid)
      if (remaining > 0) {
        const monthlyDeduction = Math.min(v.installmentMonthlyAmount, remaining)
        breakdown.installmentMonthlyTotal += monthlyDeduction
        breakdown.installments.push({
          id: v.id, violationType: v.violationType, originalAmount: v.amount,
          monthlyAmount: monthlyDeduction, totalPaid: v.installmentTotalPaid,
          remainingBalance: remaining, remainingMonths: Math.ceil(remaining / monthlyDeduction),
        })
      }
    } else {
      breakdown.oneTimeTotal += v.amount
    }
  }
  for (const [, b] of byRider) { b.total = b.oneTimeTotal + b.installmentMonthlyTotal }
  return byRider
}

export interface InstallmentProgress { id: string; installmentTotalPaid: number; installmentStatus: string }

/** processCustomDeductionInstallments(): advances every active installment deduction by one month. */
export function advanceCustomDeductionInstallments(rows: readonly CustomDeductionRecord[]): InstallmentProgress[] {
  const changes: InstallmentProgress[] = []
  for (const d of rows) {
    if (!(d.installmentEnabled && d.installmentStatus === 'active' && d.status === 'active')) continue
    const remaining = Math.max(0, d.amount - d.installmentTotalPaid)
    if (remaining <= 0) { changes.push({ id: d.id, installmentTotalPaid: d.installmentTotalPaid, installmentStatus: 'completed' }); continue }
    const monthly = Math.min(d.installmentMonthlyAmount, remaining)
    const newTotalPaid = d.installmentTotalPaid + monthly
    changes.push({ id: d.id, installmentTotalPaid: newTotalPaid, installmentStatus: newTotalPaid >= d.amount ? 'completed' : 'active' })
  }
  return changes
}

/** processInstallmentDeductions(riderIds): advances active traffic installments of the payroll's riders. */
export function advanceTrafficInstallments(rows: readonly TrafficViolationRecord[], riderIds: readonly string[]): InstallmentProgress[] {
  const changes: InstallmentProgress[] = []
  for (const riderId of riderIds) {
    for (const v of rows) {
      if (!(v.riderId === riderId && v.installmentEnabled && v.installmentStatus === 'active' && v.status === 'approved')) continue
      const remaining = Math.max(0, v.amount - v.installmentTotalPaid)
      if (remaining <= 0) { changes.push({ id: v.id, installmentTotalPaid: v.installmentTotalPaid, installmentStatus: 'completed' }); continue }
      const monthlyDeduction = Math.min(v.installmentMonthlyAmount, remaining)
      const newTotalPaid = v.installmentTotalPaid + monthlyDeduction
      changes.push({ id: v.id, installmentTotalPaid: newTotalPaid, installmentStatus: newTotalPaid >= v.amount ? 'completed' : 'active' })
    }
  }
  return changes
}
