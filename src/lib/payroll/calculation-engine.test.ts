// Financial Phase 14 — unit tests for the canonical payroll formula
// (TEST-STRATEGY.md §3.1): prorated order targets (CEIL), the three contract
// categories, deduction filtering, minimum net floor, and the Saudi
// minimum-wage advisory.
import { describe, expect, it } from "vitest"
import { calculateDriverPayrollFormula, type DeductionLine } from "./calculation-engine"

const EMPTY_DEDUCTIONS: DeductionLine[] = []

describe("Sponsored Type 1 — base + per-order bonus/deduction", () => {
  const rule = { base_salary: 2000, target_orders: 450, working_days_target: 26 }

  it("bonus above the full-month target", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule,
      orders_achieved: 500,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.orders_prorated_target).toBe(450)
    expect(r.orders_variance).toBe(50)
    expect(r.base_amount).toBe(2000)
    expect(r.orders_bonus).toBe(450) // 50 × 9
    expect(r.net_payroll).toBe(2450)
  })

  it("prorates the target to actual working days (CEIL, driver-favourable)", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule,
      orders_achieved: 250,
      working_days_actual: 13, // half month → target 225
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.orders_prorated_target).toBe(225)
    expect(r.base_amount).toBe(1000) // 2000/26 × 13
    expect(r.orders_bonus).toBe(225) // 25 × 9
    expect(r.net_payroll).toBe(1225)
  })

  it("deducts per-order below the prorated target", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule,
      orders_achieved: 400,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.orders_deduction).toBe(350) // 50 × 7
    expect(r.net_payroll).toBe(1650)
  })

  it("applies no adjustment exactly at target", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule,
      orders_achieved: 450,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.orders_bonus).toBe(0)
    expect(r.orders_deduction).toBe(0)
    expect(r.net_payroll).toBe(2000)
  })
})

describe("Sponsored Type 2 — package + flat threshold + binary car-rent", () => {
  const rule = { package_amount: 3200, threshold_orders: 400, car_rent_deduction: 1700 }

  it("deducts car rent when orders are below the flat threshold", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type2",
      rule,
      orders_achieved: 300,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.package_deduction).toBe(1700)
    expect(r.net_payroll).toBe(1500)
  })

  it("waives car rent at or above the threshold", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type2",
      rule,
      orders_achieved: 400,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.package_deduction).toBe(0)
    expect(r.net_payroll).toBe(3200)
  })
})

describe("Freelancer — prorated base + capped bonus/deduction", () => {
  const rule = {
    base_salary: 1500,
    working_days_target: 26,
    bonus_rate: 10,
    deduction_rate: 5,
    bonus_cap: 500,
    deduction_cap: 100,
  }

  it("pays bonus above target (uncapped)", () => {
    const r = calculateDriverPayrollFormula({
      category: "freelancer",
      rule,
      orders_achieved: 470,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.orders_bonus).toBe(200) // 20 × 10
    expect(r.net_payroll).toBe(1700)
  })

  it("caps the bonus", () => {
    const r = calculateDriverPayrollFormula({
      category: "freelancer",
      rule,
      orders_achieved: 560,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.orders_bonus).toBe(500) // 1100 → capped
    expect(r.net_payroll).toBe(2000)
  })

  it("caps the deduction", () => {
    const r = calculateDriverPayrollFormula({
      category: "freelancer",
      rule,
      orders_achieved: 400,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.orders_deduction).toBe(100) // 250 → capped
    expect(r.net_payroll).toBe(1400)
  })

  it("applies no adjustment when rates are zero", () => {
    const r = calculateDriverPayrollFormula({
      category: "freelancer",
      rule: { base_salary: 1500, working_days_target: 26 },
      orders_achieved: 470,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.orders_bonus).toBe(0)
    expect(r.orders_deduction).toBe(0)
    expect(r.net_payroll).toBe(1500)
  })
})

describe("deductions", () => {
  it("includes approved/applied deduction lines and excludes pending ones", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule: { base_salary: 2000 },
      orders_achieved: 450,
      working_days_actual: 26,
      deductions: [
        { source: "VIO-0001", amount: 100, reason: "مخالفة سرعة", source_module: "violations", status: "approved" },
        // The input type only allows approved/applied statuses; the cast proves
        // the runtime filter still drops anything else (defence in depth).
        { source: "ADV-0001", amount: 50, reason: "سلفة", source_module: "payroll", status: "pending" } as unknown as DeductionLine,
        { source: "VIO-0002", amount: 30, reason: "مخالفة أخرى", source_module: "violations", status: "applied" },
      ],
    })
    expect(r.deduction_lines).toHaveLength(2)
    expect(r.total_deductions).toBe(130)
    expect(r.net_payroll).toBe(1870)
  })

  it("adds the absence deduction", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule: { base_salary: 2000 },
      orders_achieved: 450,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
      absence_deduction: 200,
    })
    expect(r.total_deductions).toBe(200)
    expect(r.net_payroll).toBe(1800)
  })
})

describe("minimum net floor + Saudi minimum-wage advisory", () => {
  it("raises the net to the configured floor when below", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule: { base_salary: 2000, minimum_net_floor: 2000 },
      orders_achieved: 400, // net would be 1650
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.minimum_floor_applied).toBe(true)
    expect(r.net_payroll).toBe(2000)
  })

  it("does not apply the floor when the net is above it", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule: { base_salary: 2000, minimum_net_floor: 1500 },
      orders_achieved: 400,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
    })
    expect(r.minimum_floor_applied).toBe(false)
    expect(r.net_payroll).toBe(1650)
  })

  it("flags Saudi nationals below the minimum wage as advisory", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule: { base_salary: 2000 },
      orders_achieved: 450,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
      nationality_code: "SA",
    })
    expect(r.below_minimum_wage).toBe(true)
    expect(r.warnings.join(" ")).toContain("BELOW_SAUDI_MINIMUM_WAGE")
  })

  it("does not flag non-Saudi nationals", () => {
    const r = calculateDriverPayrollFormula({
      category: "sponsored_type1",
      rule: { base_salary: 2000 },
      orders_achieved: 450,
      working_days_actual: 26,
      deductions: EMPTY_DEDUCTIONS,
      nationality_code: "EG",
    })
    expect(r.below_minimum_wage).toBe(false)
  })
})
