// src/lib/payroll/calculation-engine.ts
// v2.0 M4 CANONICAL payroll formula — the single source of truth.
// CRITICAL: Order targets are PRORATED to actual working days via Math.ceil.
// NEVER compare orders_achieved against the flat monthly target.
// This formula is shared between Module 1 (Drivers) and Module 4 (Payroll).

export type DriverCategory = "sponsored_type1" | "sponsored_type2" | "freelancer"

export interface PayrollRule {
  base_salary?: number
  target_orders?: number
  working_days_target?: number
  bonus_rate?: number
  deduction_rate?: number
  package_amount?: number
  threshold_orders?: number
  car_rent_deduction?: number
  bonus_cap?: number
  deduction_cap?: number
  minimum_net_floor?: number
}

export interface DeductionLine {
  source: string
  amount: number
  reason: string
  source_module: string
  source_reference?: string | null
  status: "approved" | "applied"
}

export interface PayrollCalculationInput {
  category: DriverCategory
  rule: PayrollRule
  orders_achieved: number
  working_days_actual: number
  deductions: DeductionLine[]
  absence_deduction?: number
  nationality_code?: string | null
}

export interface PayrollCalculationResult {
  base_amount: number
  orders_bonus: number
  package_deduction: number
  orders_deduction: number
  orders_prorated_target: number
  orders_variance: number
  deduction_lines: DeductionLine[]
  total_deductions: number
  net_payroll: number
  minimum_floor_applied: boolean
  calculation_steps: string[]
  warnings: string[]
  below_minimum_wage: boolean
}

const SAUDI_MINIMUM_WAGE = 4000 // SAR — review annually

export function calculateDriverPayrollFormula(
  input: PayrollCalculationInput
): PayrollCalculationResult {
  const { category, rule, orders_achieved, working_days_actual, deductions } = input
  const steps: string[] = []
  const warnings: string[] = []
  let base_amount = 0
  let orders_bonus = 0
  let package_deduction = 0
  let orders_deduction = 0

  // ── STEP 1: COMPUTE PRORATED ORDER TARGET ────────────────────────
  // v2.0 M4: Always prorate. Never use flat monthly target directly.
  // CEIL benefits the driver: partial days round up the target.
  const working_days_target = rule.working_days_target ?? 26
  const orders_target_monthly = rule.target_orders ?? 450

  const orders_prorated_target = Math.ceil(
    (orders_target_monthly / working_days_target) * working_days_actual
  )
  steps.push(
    `Prorated target: CEIL(${orders_target_monthly} / ${working_days_target} × ${working_days_actual}) = ${orders_prorated_target}`
  )

  const orders_variance = orders_achieved - orders_prorated_target

  // ── STEP 2: CATEGORY-SPECIFIC BASE + ORDERS LOGIC ────────────────
  if (category === "sponsored_type1") {
    const base_salary = rule.base_salary ?? 2000
    const daily_rate = base_salary / working_days_target
    base_amount = Math.round(daily_rate * working_days_actual * 100) / 100
    steps.push(`Base (prorated): ${daily_rate.toFixed(4)} × ${working_days_actual} = ${base_amount} SAR`)

    const bonus_rate = rule.bonus_rate ?? 9
    const deduct_rate = rule.deduction_rate ?? 7

    if (orders_variance > 0) {
      orders_bonus = orders_variance * bonus_rate
      steps.push(`Orders bonus: ${orders_variance} × ${bonus_rate} = +${orders_bonus} SAR`)
    } else if (orders_variance < 0) {
      orders_deduction = Math.abs(orders_variance) * deduct_rate
      steps.push(`Orders deduction: ${Math.abs(orders_variance)} × ${deduct_rate} = -${orders_deduction} SAR`)
    } else {
      steps.push("Orders at prorated target — no adjustment")
    }
  } else if (category === "sponsored_type2") {
    base_amount = rule.package_amount ?? 3200
    const threshold = rule.threshold_orders ?? 400
    const car_rent = rule.car_rent_deduction ?? 1700
    steps.push(`Package amount: ${base_amount} SAR`)
    steps.push(`Threshold: ${threshold} | Achieved: ${orders_achieved}`)

    // Type 2 uses flat threshold, NOT prorated. Car rent is binary.
    if (orders_achieved < threshold) {
      package_deduction = car_rent
      steps.push(`Below threshold → Car rent deduction: -${car_rent} SAR`)
      steps.push("NOTE: No per-order deduction for Sponsored Type 2")
    } else {
      steps.push("At or above threshold — no package deduction")
    }
  } else if (category === "freelancer") {
    const base_salary = rule.base_salary ?? 0
    const daily_rate = base_salary / working_days_target
    base_amount = Math.round(daily_rate * working_days_actual * 100) / 100
    steps.push(`Freelancer base (prorated): ${base_amount} SAR`)

    const bonus_rate = rule.bonus_rate ?? 0
    const deduct_rate = rule.deduction_rate ?? 0

    if (orders_variance > 0 && bonus_rate > 0) {
      orders_bonus = orders_variance * bonus_rate
      if (rule.bonus_cap && orders_bonus > rule.bonus_cap) {
        orders_bonus = rule.bonus_cap
        steps.push(`Bonus capped at: ${rule.bonus_cap} SAR`)
      }
    }
    if (orders_variance < 0 && deduct_rate > 0) {
      orders_deduction = Math.abs(orders_variance) * deduct_rate
      if (rule.deduction_cap && orders_deduction > rule.deduction_cap) {
        orders_deduction = rule.deduction_cap
        steps.push(`Deduction capped at: ${rule.deduction_cap} SAR`)
      }
    }
  }

  // ── STEP 3: APPROVED DEDUCTIONS FROM OTHER MODULES ───────────────
  const approved = deductions.filter(
    (d) => d.status === "approved" || d.status === "applied"
  )
  const deduction_lines = approved.map((d) => ({
    source: d.source,
    amount: d.amount,
    reason: d.reason,
    source_module: d.source_module,
    source_reference: d.source_reference ?? null,
    status: d.status as "approved" | "applied",
  }))
  const other_deductions_total = deduction_lines.reduce((s, d) => s + d.amount, 0)
  deduction_lines.forEach((d) =>
    steps.push(`${d.source_module} (${d.source}): -${d.amount} SAR — ${d.reason}`)
  )

  // ── STEP 4: TOTALS ───────────────────────────────────────────────
  const absence_deduction = input.absence_deduction ?? 0
  if (absence_deduction > 0) {
    steps.push(`Absence deduction: -${absence_deduction} SAR`)
  }
  const total_deductions = package_deduction + orders_deduction + other_deductions_total + absence_deduction
  let net_payroll = base_amount + orders_bonus - total_deductions

  // ── STEP 5: MINIMUM FLOOR ────────────────────────────────────────
  const minimum_floor = rule.minimum_net_floor ?? 0
  let minimum_floor_applied = false
  if (net_payroll < minimum_floor) {
    steps.push(`Net below floor (${minimum_floor} SAR) — floor applied`)
    net_payroll = minimum_floor
    minimum_floor_applied = true
  }

  // ── STEP 6: SAUDI MINIMUM WAGE ADVISORY (v2.0 M4) ──────────────
  // Advisory only — never blocks payroll, but flags for review.
  const below_minimum_wage = input.nationality_code === "SA" && net_payroll < SAUDI_MINIMUM_WAGE
  if (below_minimum_wage) {
    warnings.push(
      `BELOW_SAUDI_MINIMUM_WAGE: net ${net_payroll} < ${SAUDI_MINIMUM_WAGE} SAR`
    )
  }

  steps.push(`NET PAYROLL: ${net_payroll} SAR`)

  return {
    base_amount,
    orders_bonus,
    package_deduction,
    orders_deduction,
    orders_prorated_target,
    orders_variance,
    deduction_lines,
    total_deductions,
    net_payroll,
    minimum_floor_applied,
    calculation_steps: steps,
    warnings,
    below_minimum_wage,
  }
}
