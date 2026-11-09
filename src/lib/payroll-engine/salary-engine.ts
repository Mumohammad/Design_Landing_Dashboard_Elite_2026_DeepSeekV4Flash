/* eslint-disable -- vendored upstream source kept byte-for-byte below the header */
// Vendored verbatim from duaa7226-collab/Payroll-Sys-2026 @ 1feaee25 (src/lib/salary-engine.ts).
// Do not edit the calculation logic here — parity is enforced by golden.test.ts.
// Salary Calculation Engine — uses ACTIVE rule set only, never hardcoded constants
import { getDefaultRuleMap } from './rules'

export interface RuleSnapshot {
  [key: string]: number | string | boolean | string[]
}

export interface RawDriverData {
  riderId: string
  name: string
  contractName: string
  vehicleType: string
  inactiveReason: string
  completedOrders: number
  uploadedBasicPayment: number
  uploadedCityPayment: number
  actualWorkingDays: number
  fullyWorkingDays: number
  workingHours: number
  totalMonthlyWorkingHours: number
  // Penalty values from workbook (RLVL/WR)
  penalties: Record<string, number>
  carDeduction: number
  tgaDeduction: number
  riderBalance: number
  // Segment payment (bonus from Excel)
  segmentPayment: number
  // Traffic violations
  trafficViolationsTotal: number
  // Custom bonuses (from Rules Control Center)
  customBonuses: Array<{ name: string; nameAr: string | null; amount: number }>
  // Custom deductions (from Rules Control Center) — installment-aware
  customDeductions: Array<{ name: string; nameAr: string | null; amount: number; monthlyDeduction?: number }>
  // Manual adjustments (Manual Adjustments module) — also on the payslip
  manualBonuses?: Array<{ title: string; titleAr: string | null; amount: number }>
  manualDeductions?: Array<{ title: string; titleAr: string | null; amount: number }>
}

export interface DriverResultCalc {
  riderId: string
  driverName: string
  contractName: string
  payrollMonth: string
  vehicleType: string
  inactiveReason: string
  // Source metrics
  completedOrders: number
  uploadedBasicPayment: number
  uploadedCityPayment: number
  actualWorkingDays: number
  fullyWorkingDays: number
  workingHours: number
  totalMonthlyWorkingHours: number
  // Applied rules snapshot
  activeRuleSetName: string
  salaryDivisorMode: string
  appliedBaseSalary: number
  appliedStdWorkingDays: number
  appliedMonthlyTarget: number
  appliedDailyTargetRate: number
  appliedSalaryPerOrder: number
  appliedBonusPerExtra: number
  appliedDeductionPerMissing: number
  trafficDeductionsEnabled: boolean
  // Calculated metrics
  dailyBaseRate: number
  adjustedBaseSalary: number
  adjustedTargetOrders: number
  selectedTargetThreshold: number
  baseSalaryEquivalent: number
  extraOrders: number
  missingOrders: number
  bonusAmount: number
  missingOrderDeduction: number
  // Segment payment (bonus)
  segmentPayment: number
  // Custom bonuses (from Rules Control Center)
  customBonuses: Array<{ name: string; nameAr: string | null; amount: number }>
  customBonusTotal: number
  // Custom deductions (from Rules Control Center)
  customDeductions: Array<{ name: string; nameAr: string | null; amount: number; monthlyDeduction?: number }>
  customDeductionTotal: number
  // Manual adjustments
  manualBonuses: Array<{ title: string; titleAr: string | null; amount: number }>
  manualBonusTotal: number
  manualDeductions: Array<{ title: string; titleAr: string | null; amount: number }>
  manualDeductionTotal: number
  // Penalties
  penalties: Record<string, number>
  totalOtherPenalties: number
  trafficViolationsDeduction: number
  grossSalaryBeforePenalties: number
  finalNetSalary: number
  varianceAmount: number
  variancePercentage: number
  varianceStatus: 'ok' | 'minor' | 'major' | 'review'
  reviewStatus: 'ok' | 'review' | 'flagged'
  exceptionFlag: boolean
  performanceBand: 'top' | 'high' | 'average' | 'low' | 'bottom'
}

function round(value: number, mode: string): number {
  switch (mode) {
    case 'floor': return Math.floor(value)
    case 'ceil': return Math.ceil(value)
    case 'round': return Math.round(value)
    case 'none':
    default: return value
  }
}

function n(v: number | string | boolean | string[] | undefined): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseFloat(v) || 0
  return 0
}
function b(v: number | string | boolean | string[] | undefined): boolean {
  return v === true || v === 'true'
}
function s(v: number | string | boolean | string[] | undefined): string {
  return typeof v === 'string' ? v : ''
}

export function calculateDriverSalary(
  raw: RawDriverData,
  rules: RuleSnapshot,
  ruleSetName: string,
  payrollMonth: string
): DriverResultCalc {
  // ====== Read rule values (with safe defaults) ======
  const monthlyBaseSalary = n(rules.monthly_base_salary ?? 2000)
  const stdWorkingDays = n(rules.standard_working_days ?? 30)
  const monthlyTargetOrders = n(rules.monthly_target_orders ?? 450)
  const salaryMode = s(rules.salary_mode ?? 'orders_based_mode') || 'orders_based_mode'
  const ordersPolicy = s(rules.orders_based_policy ?? 'linear_order_rate_policy') || 'linear_order_rate_policy'
  const bonusPerExtra = n(rules.bonus_per_extra_order ?? 10)
  const deductionPerMissing = n(rules.deduction_per_missing_order ?? 7)
  const useActualWorkingDaysForTarget = b(rules.use_actual_working_days_for_target ?? true)
  const useActualWorkingDays = b(rules.use_actual_working_days ?? true)
  const bonusActiveInOrdersMode = b(rules.bonus_active_in_orders_mode ?? true)
  const deductionActiveInOrdersMode = b(rules.deduction_active_in_orders_mode ?? true)
  const roundingMode = s(rules.rounding_mode ?? 'round') || 'round'
  const roundSalaryPerOrder = b(rules.round_salary_per_order ?? false)
  const salaryFloor = n(rules.salary_floor ?? 0)
  const deductionCap = n(rules.deduction_cap ?? 0)
  const penMaxAllowed = n(rules.pen_max_allowed ?? 0)
  const penReviewThreshold = n(rules.pen_review_threshold ?? 500)
  const varianceTolAmt = n(rules.variance_tolerance_amount ?? 50)
  const varianceTolPct = n(rules.variance_tolerance_pct ?? 5)
  const varianceMajor = n(rules.variance_major_threshold ?? 200)
  const useBasicPaymentControl = b(rules.use_uploaded_basic_payment_as_control ?? true)
  const trafficEnabled = b(rules.pen_traffic_violations_enabled ?? true)

  // Penalty toggle map
  const penToggles: Record<string, boolean> = {
    acceptance: b(rules.pen_acceptance_enabled ?? true),
    contact: b(rules.pen_contact_enabled ?? true),
    stacking: b(rules.pen_stacking_enabled ?? true),
    declined: b(rules.pen_declined_enabled ?? true),
    late: b(rules.pen_late_enabled ?? true),
    noshow: b(rules.pen_noshow_enabled ?? true),
    noshow_special: b(rules.pen_noshow_special_enabled ?? true),
    daily_acceptance: b(rules.pen_daily_acceptance_enabled ?? true),
    missed_days: b(rules.pen_missed_days_enabled ?? true),
    rider_balance: b(rules.pen_rider_balance_enabled ?? true),
    car_deduction: b(rules.pen_car_deduction_enabled ?? true),
    tga_deduction: b(rules.pen_tga_deduction_enabled ?? true),
  }

  // ====== Common base calculations ======
  const actualWorkingDays = useActualWorkingDays ? Math.max(raw.actualWorkingDays || 0, 0) : stdWorkingDays
  const dailyBaseRate = monthlyBaseSalary / stdWorkingDays
  const dailyTargetRate = monthlyTargetOrders / stdWorkingDays

  // Adjusted target (prorated by working days if enabled)
  const rawAdjustedTarget = useActualWorkingDaysForTarget
    ? dailyTargetRate * actualWorkingDays
    : monthlyTargetOrders
  const adjustedTargetOrders = round(rawAdjustedTarget, roundingMode)

  // Adjusted base salary (for days-prorated mode)
  const adjustedBaseSalary = dailyBaseRate * actualWorkingDays

  // Salary per order rate (orders-based mode)
  let salaryPerOrder = monthlyBaseSalary / monthlyTargetOrders
  if (roundSalaryPerOrder) salaryPerOrder = Math.round(salaryPerOrder * 100) / 100

  // Selected target threshold
  const selectedTargetThreshold = useActualWorkingDaysForTarget ? adjustedTargetOrders : monthlyTargetOrders

  // Base salary equivalent — TARGET × salary_per_order (not completed!)
  // This is the guaranteed base if the driver meets the prorated target.
  // Extra orders are rewarded via bonus; missing orders are deducted.
  const baseSalaryEquivalent = selectedTargetThreshold * salaryPerOrder

  // Extra / missing orders
  const extraOrders = Math.max(raw.completedOrders - selectedTargetThreshold, 0)
  const missingOrders = Math.max(selectedTargetThreshold - raw.completedOrders, 0)

  // Bonus / deduction
  const bonusAmount = (salaryMode === 'orders_based_mode' ? bonusActiveInOrdersMode : true)
    ? extraOrders * bonusPerExtra
    : 0
  const missingOrderDeduction = (salaryMode === 'orders_based_mode' ? deductionActiveInOrdersMode : true)
    ? missingOrders * deductionPerMissing
    : 0

  // ====== Segment payment — DEACTIVATED per user request ======
  // Previously: this was a bonus paid to riders based on segment/distance work.
  // Now: always 0 — segment payment feature is disabled.
  const segmentPayment = 0
  // (raw.segmentPayment is intentionally ignored)

  // ====== Custom bonuses (from Rules Control Center) ======
  const customBonuses = raw.customBonuses || []
  const customBonusTotal = customBonuses.reduce((a, b) => a + b.amount, 0)

  // ====== Custom deductions (from Rules Control Center — installment-aware) ======
  const customDeductions = raw.customDeductions || []
  // For installment deductions, use monthlyDeduction; for one-time, use full amount
  const customDeductionTotal = customDeductions.reduce((a, b) => a + (b.monthlyDeduction ?? b.amount), 0)

  // ====== Manual adjustments (bonuses add to gross, deductions reduce net) ======
  const manualBonuses = raw.manualBonuses || []
  const manualBonusTotal = manualBonuses.reduce((a, b) => a + b.amount, 0)
  const manualDeductions = raw.manualDeductions || []
  const manualDeductionTotal = manualDeductions.reduce((a, b) => a + b.amount, 0)

  // ====== Excel-matching calculation (Salary_Calculation sheet logic) ======
  // Excel formula:
  //   Earned Salary = MIN(Completed Orders, Rider Target Orders) × Base Order Rate
  //   Gross Salary Before Deductions = MAX(Earned Salary - Missing-Order Deduction, 0) + Extra-Order Bonus
  //
  // This means: the rider only earns on the orders they actually completed (capped at target).
  // Missing-order deduction then reduces that earned amount (floored at 0).

  // Orders counted at base rate = MIN(Completed, Target) — Excel: "Orders Counted at Base Rate"
  const ordersCountedAtBaseRate = Math.min(raw.completedOrders, selectedTargetThreshold)

  // Earned Salary = Orders Counted × Base Order Rate — Excel: "Earned Salary"
  const earnedSalary = ordersCountedAtBaseRate * salaryPerOrder

  // Gross Before Deductions = MAX(Earned Salary - Missing-Order Deduction, 0) + Bonus + Custom Bonuses
  let grossBeforePenalties = Math.max(earnedSalary - missingOrderDeduction, 0) + bonusAmount + customBonusTotal + manualBonusTotal

  // days_prorated_mode fallback (legacy — rarely used)
  if (salaryMode === 'days_prorated_mode') {
    if (raw.completedOrders >= selectedTargetThreshold) {
      grossBeforePenalties = adjustedBaseSalary + bonusAmount + segmentPayment + customBonusTotal + manualBonusTotal
    } else {
      grossBeforePenalties = Math.max(adjustedBaseSalary - missingOrderDeduction, 0) + segmentPayment + customBonusTotal + manualBonusTotal
    }
  }

  // ====== Penalties — only count per-rider deductions (matching Excel logic) ======
  // Excel Salary_Calculation sheet counts ONLY these as deductions:
  //   - rider_balance
  //   - stacking_deduction
  //   - missed_days_penalty
  //   - other_deductions (car deduction, TGA, custom)
  //
  // The other penalties (acceptance, contact, declined, late, noshow, noshow_special,
  // daily_acceptance) are ALREADY deducted from the source basic_payment by the
  // logistics provider — counting them again would double-count.
  //
  // We still expose them in the penalties map for audit/display, but they are
  // NOT added to totalOtherPenalties.
  function absIfEnabled(key: string, rawVal: number | undefined): number {
    if (!penToggles[key]) return 0
    if (rawVal === undefined || rawVal === null || isNaN(rawVal)) return 0
    return Math.abs(rawVal)
  }

  // All penalties parsed (for display/audit) — but only DEDUCTIBLE ones count
  const penalties: Record<string, number> = {
    acceptance: absIfEnabled('acceptance', raw.penalties.acceptance_rate_penalties),
    contact: absIfEnabled('contact', raw.penalties.contact_rate_penalties),
    stacking: absIfEnabled('stacking', raw.penalties.stacking_deduction),
    declined: absIfEnabled('declined', raw.penalties.declined_penalties_day_logic),
    late: absIfEnabled('late', raw.penalties.late_penalty),
    noshow: absIfEnabled('noshow', raw.penalties.no_show_penalty),
    noshow_special: absIfEnabled('noshow_special', raw.penalties.no_show_penalty_special_cities),
    daily_acceptance: absIfEnabled('daily_acceptance', raw.penalties.daily_acceptance_rate_penalty),
    missed_days: absIfEnabled('missed_days', raw.penalties.missed_days_penalty),
    rider_balance: absIfEnabled('rider_balance', raw.riderBalance),
    car_deduction: absIfEnabled('car_deduction', raw.carDeduction),
    tga_deduction: absIfEnabled('tga_deduction', raw.tgaDeduction),
    // Store distance + segment in penaltiesJson so the Income vs Expenses sync can read them
    distance: Math.abs(raw.penalties.distance_payment || 0),
    segment: Math.abs(raw.segmentPayment || 0),
  }

  // ====== Deductible penalties — ALL penalties reduce the rider's gross salary ======
  // Per user requirement: ALL penalties must be deducted, including declined, late, noshow, etc.
  // This ensures the salary reflects ALL deductions from the delivery company's data.
  const DEDUCTIBLE_PENALTIES = [
    'acceptance', 'contact', 'stacking', 'declined', 'late',
    'noshow', 'noshow_special', 'daily_acceptance', 'missed_days',
    'rider_balance', 'car_deduction', 'tga_deduction'
  ]
  let totalOtherPenalties = DEDUCTIBLE_PENALTIES.reduce((sum, key) => sum + (penalties[key] || 0), 0)
  // Apply max allowed penalty if set
  if (penMaxAllowed > 0 && totalOtherPenalties > penMaxAllowed) {
    totalOtherPenalties = penMaxAllowed
  }

  // Traffic violations
  const trafficViolationsDeduction = trafficEnabled ? (raw.trafficViolationsTotal || 0) : 0

  // ====== Final net salary ======
  let totalDeductions = totalOtherPenalties + trafficViolationsDeduction + customDeductionTotal + manualDeductionTotal
  if (deductionCap > 0 && totalDeductions > deductionCap) {
    totalDeductions = deductionCap
  }
  let finalNetSalary = grossBeforePenalties - totalDeductions
  if (finalNetSalary < salaryFloor) finalNetSalary = salaryFloor
  if (finalNetSalary < 0) finalNetSalary = 0 // Hard floor at 0

  // ====== Variance vs uploaded basic payment ======
  const controlAmount = useBasicPaymentControl ? raw.uploadedBasicPayment : 0
  const varianceAmount = finalNetSalary - controlAmount
  const variancePercentage = controlAmount > 0 ? (varianceAmount / controlAmount) * 100 : 0

  let varianceStatus: 'ok' | 'minor' | 'major' | 'review' = 'ok'
  if (Math.abs(varianceAmount) >= varianceMajor) varianceStatus = 'major'
  else if (
    Math.abs(varianceAmount) > varianceTolAmt ||
    Math.abs(variancePercentage) > varianceTolPct
  ) varianceStatus = 'minor'

  // Review status
  let reviewStatus: 'ok' | 'review' | 'flagged' = 'ok'
  if (totalOtherPenalties > penReviewThreshold) reviewStatus = 'review'
  if (varianceStatus === 'major') reviewStatus = 'flagged'
  if (finalNetSalary < 0) reviewStatus = 'flagged'

  const exceptionFlag = reviewStatus !== 'ok' || varianceStatus === 'major'

  // Performance band — based on completedOrders vs target
  const attainmentPct = selectedTargetThreshold > 0
    ? (raw.completedOrders / selectedTargetThreshold) * 100
    : 0
  let performanceBand: 'top' | 'high' | 'average' | 'low' | 'bottom' = 'average'
  if (attainmentPct >= 110) performanceBand = 'top'
  else if (attainmentPct >= 95) performanceBand = 'high'
  else if (attainmentPct >= 75) performanceBand = 'average'
  else if (attainmentPct >= 50) performanceBand = 'low'
  else performanceBand = 'bottom'

  return {
    riderId: raw.riderId,
    driverName: raw.name,
    contractName: raw.contractName,
    payrollMonth,
    vehicleType: raw.vehicleType,
    inactiveReason: raw.inactiveReason,
    completedOrders: raw.completedOrders,
    uploadedBasicPayment: raw.uploadedBasicPayment,
    uploadedCityPayment: raw.uploadedCityPayment,
    actualWorkingDays,
    fullyWorkingDays: raw.fullyWorkingDays,
    workingHours: raw.workingHours,
    totalMonthlyWorkingHours: raw.totalMonthlyWorkingHours,
    activeRuleSetName: ruleSetName,
    salaryDivisorMode: salaryMode,
    appliedBaseSalary: monthlyBaseSalary,
    appliedStdWorkingDays: stdWorkingDays,
    appliedMonthlyTarget: monthlyTargetOrders,
    appliedDailyTargetRate: dailyTargetRate,
    appliedSalaryPerOrder: salaryPerOrder,
    appliedBonusPerExtra: bonusPerExtra,
    appliedDeductionPerMissing: deductionPerMissing,
    trafficDeductionsEnabled: trafficEnabled,
    dailyBaseRate,
    adjustedBaseSalary,
    adjustedTargetOrders,
    selectedTargetThreshold,
    baseSalaryEquivalent,
    extraOrders,
    missingOrders,
    bonusAmount,
    missingOrderDeduction,
    segmentPayment,
    customBonuses,
    customBonusTotal,
    customDeductions,
    customDeductionTotal,
    manualBonuses,
    manualBonusTotal,
    manualDeductions,
    manualDeductionTotal,
    penalties,
    totalOtherPenalties,
    trafficViolationsDeduction,
    grossSalaryBeforePenalties: grossBeforePenalties,
    finalNetSalary,
    varianceAmount,
    variancePercentage,
    varianceStatus,
    reviewStatus,
    exceptionFlag,
    performanceBand,
  }
}

// Helper: build a default rule snapshot from defaults
export function defaultRuleSnapshot(): RuleSnapshot {
  return getDefaultRuleMap() as RuleSnapshot
}
