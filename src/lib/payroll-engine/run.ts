// Payroll run orchestration — mirrors POST /api/import of Payroll-Sys-2026 @ 1feaee25
// (calculation, totals, exceptions, Income-vs-Expenses rows, installment progress)
// without any database access. Parity is enforced by golden.test.ts.
import { calculateDriverSalary, type DriverResultCalc, type RawDriverData, type RuleSnapshot } from './salary-engine'
import { getDefaultRuleMap } from './rules'
import type { ParsedWorkbook } from './excel-parser'
import { calculateIncome, type IncomeCalc, type IncomeInput } from './income-engine'
import {
  activeCustomBonuses, activeCustomDeductions, advanceCustomDeductionInstallments, advanceTrafficInstallments,
  getBonusesForRider, getDeductionsForRider, groupManualAdjustments, groupTrafficDeductions,
  type CustomBonusRecord, type CustomDeductionRecord, type InstallmentProgress, type ManualAdjustmentRecord, type TrafficViolationRecord,
} from './adjustments'

export interface PayrollSources {
  customBonuses?: readonly CustomBonusRecord[]
  customDeductions?: readonly CustomDeductionRecord[]
  manualAdjustments?: readonly ManualAdjustmentRecord[]
  trafficViolations?: readonly TrafficViolationRecord[]
}

export interface PayrollException {
  code: string
  severity: 'info' | 'warning' | 'error'
  source: string
  rowRef: string | null
  message: string
  suggestedAction: string
}

export type IncomeRow = IncomeInput & { riderId: string; totalIncome: number; totalPenalties: number }

export interface ComputedRider { raw: RawDriverData; result: DriverResultCalc }

export interface ComputedRun {
  riders: ComputedRider[]
  totals: ReturnType<typeof sumTotals>
  exceptions: PayrollException[]
  incomeRows: IncomeRow[]
  installments: { customDeductions: InstallmentProgress[]; trafficViolations: InstallmentProgress[] }
}

/** Active rule snapshot = defaults overlaid with the tenant's stored values (getActiveRuleSnapshot). */
export function buildRuleSnapshot(values: Record<string, unknown> | null | undefined): RuleSnapshot {
  const snapshot = getDefaultRuleMap() as RuleSnapshot
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value === null || value === undefined) continue
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') snapshot[key] = value
    else if (Array.isArray(value)) snapshot[key] = value.map(String)
  }
  return snapshot
}

export function sumTotals(results: readonly DriverResultCalc[]) {
  let totalGross = 0
  let totalPenalties = 0
  let totalNet = 0
  let totalVariance = 0
  let totalTraffic = 0
  for (const result of results) {
    totalGross += result.grossSalaryBeforePenalties
    totalPenalties += result.totalOtherPenalties
    totalNet += result.finalNetSalary
    totalVariance += Math.abs(result.varianceAmount)
    totalTraffic += result.trafficViolationsDeduction
  }
  return { totalGross, totalPenalties, totalNet, totalVariance, totalTraffic }
}

/** Exceptions raised for a driver by the calculation (variance / review) — driverExceptionRows(). */
export function driverExceptionRows(result: DriverResultCalc): PayrollException[] {
  const rows: PayrollException[] = []
  if (result.varianceStatus === 'major') {
    rows.push({
      code: 'MAJOR_VARIANCE', severity: 'error', source: 'variance_check', rowRef: result.riderId,
      message: `${result.driverName}: variance SAR ${result.varianceAmount.toFixed(2)} (${result.variancePercentage.toFixed(2)}%) exceeds major threshold`,
      suggestedAction: 'Review calculation vs uploaded basic payment',
    })
  }
  if (result.reviewStatus === 'flagged') {
    rows.push({
      code: 'REVIEW_FLAGGED', severity: 'warning', source: 'review_check', rowRef: result.riderId,
      message: `${result.driverName}: flagged for review (penalties over threshold, deductions over salary, or major variance)`,
      suggestedAction: 'Manual review required before payslip generation',
    })
  }
  return rows
}

/** Income-vs-Expenses row derived from a payroll result (import auto-sync). */
export function incomeRowFromResult(result: DriverResultCalc): IncomeRow {
  const p = result.penalties
  const d: IncomeInput = {
    basicPayment: result.uploadedBasicPayment || 0,
    distancePayment: p.distance || 0,
    segmentPayment: p.segment || 0,
    acceptancePenalty: p.acceptance || 0,
    contactPenalty: p.contact || 0,
    stackingDeduction: p.stacking || 0,
    declinedPenalty: p.declined || 0,
    latePenalty: p.late || 0,
    noShowPenalty: p.noshow || 0,
    noShowSpecialPenalty: p.noshow_special || 0,
    dailyAcceptancePenalty: p.daily_acceptance || 0,
    missedDaysPenalty: p.missed_days || 0,
    riderBalance: p.rider_balance || 0,
    customFieldsJson: null,
  }
  const calc: IncomeCalc = calculateIncome(d)
  return { riderId: result.riderId, ...d, totalIncome: calc.totalIncome, totalPenalties: calc.totalPenalties }
}

/** Attach the tenant's bonuses / deductions / traffic to one rider, exactly like the import route. */
export function prepareRiderInput(raw: RawDriverData, sources: PayrollSources): RawDriverData {
  const riderIds = [raw.riderId]
  const traffic = groupTrafficDeductions(sources.trafficViolations ?? [], riderIds)
  const manual = groupManualAdjustments(sources.manualAdjustments ?? [], riderIds)
  const bonuses = activeCustomBonuses(sources.customBonuses ?? [])
  const deductions = activeCustomDeductions(sources.customDeductions ?? [])
  return {
    ...raw,
    trafficViolationsTotal: traffic.get(raw.riderId)?.total ?? 0,
    customBonuses: getBonusesForRider(bonuses, raw.riderId).map(b => ({ name: b.name, nameAr: b.nameAr, amount: b.amount })),
    customDeductions: getDeductionsForRider(deductions, raw.riderId).map(d => ({ name: d.name, nameAr: d.nameAr, amount: d.amount, monthlyDeduction: d.monthlyDeduction })),
    manualBonuses: (manual.get(raw.riderId)?.bonuses ?? []).map(b => ({ title: b.title, titleAr: b.titleAr, amount: b.amount })),
    manualDeductions: (manual.get(raw.riderId)?.deductions ?? []).map(d => ({ title: d.title, titleAr: d.titleAr, amount: d.amount })),
  }
}

/**
 * Calculate a payroll run. `rawDrivers` are parser output (or stored inputs
 * for a recalculation). Installment progress is only returned for the first
 * run of a month, as in the original (`advanceInstallments`).
 */
export function computePayrollRun(input: {
  rawDrivers: readonly RawDriverData[]
  parserWarnings?: readonly string[]
  rules: RuleSnapshot
  ruleSetName: string
  payrollMonth: string
  sources: PayrollSources
  advanceInstallments: boolean
}): ComputedRun {
  const riders = input.rawDrivers.map(source => {
    const raw = prepareRiderInput(source, input.sources)
    return { raw, result: calculateDriverSalary(raw, input.rules, input.ruleSetName, input.payrollMonth) }
  })
  const results = riders.map(r => r.result)
  const exceptions: PayrollException[] = [
    ...(input.parserWarnings ?? []).map(w => ({ code: 'IMPORT_WARNING', severity: 'warning' as const, source: 'parser', rowRef: null, message: w, suggestedAction: 'Review source workbook structure' })),
    ...results.flatMap(driverExceptionRows),
  ]
  const riderIds = results.map(r => r.riderId)
  return {
    riders,
    totals: sumTotals(results),
    exceptions,
    incomeRows: results.map(incomeRowFromResult),
    installments: input.advanceInstallments
      ? { customDeductions: advanceCustomDeductionInstallments(input.sources.customDeductions ?? []), trafficViolations: advanceTrafficInstallments(input.sources.trafficViolations ?? [], riderIds) }
      : { customDeductions: [], trafficViolations: [] },
  }
}

export type { ParsedWorkbook }
