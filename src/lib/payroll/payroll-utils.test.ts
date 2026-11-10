// Unit tests for the payroll-surface wiring (Prompt F): status transition
// guards (users-module idiom), reason-required matrix, CSV serializer, and
// the rollups feeding the live orders/COD KPIs.
import { describe, expect, it } from "vitest"
import {
  ALLOWED_PAYROLL_TRANSITIONS,
  isPayrollTransitionAllowed,
  transitionRequiresReason,
  payrollRowsToCsv,
  periodKey,
  rollupMonthlyOrders,
  rollupCodSessions,
  type PayrollStatus,
} from "./payroll-utils"

describe("payroll status transition guards", () => {
  it("allows the forward happy path", () => {
    expect(isPayrollTransitionAllowed("draft", "calculated")).toBe(true)
    expect(isPayrollTransitionAllowed("calculated", "in_review")).toBe(true)
    expect(isPayrollTransitionAllowed("in_review", "approved")).toBe(true)
    expect(isPayrollTransitionAllowed("approved", "paid")).toBe(true)
  })

  it("allows review bounce-back and the cancellation family", () => {
    expect(isPayrollTransitionAllowed("in_review", "calculated")).toBe(true)
    expect(isPayrollTransitionAllowed("draft", "cancelled")).toBe(true)
    expect(isPayrollTransitionAllowed("calculated", "cancelled")).toBe(true)
    expect(isPayrollTransitionAllowed("in_review", "cancelled")).toBe(true)
    expect(isPayrollTransitionAllowed("approved", "cancelled")).toBe(true)
  })

  it("treats paid, locked and cancelled as terminal", () => {
    const terminal: PayrollStatus[] = ["paid", "locked", "cancelled"]
    for (const from of terminal) {
      expect(ALLOWED_PAYROLL_TRANSITIONS[from]).toEqual([])
      for (const to of Object.keys(ALLOWED_PAYROLL_TRANSITIONS) as PayrollStatus[]) {
        expect(isPayrollTransitionAllowed(from, to)).toBe(false)
      }
    }
  })

  it("refuses skips and self-transitions", () => {
    expect(isPayrollTransitionAllowed("draft", "approved")).toBe(false)
    expect(isPayrollTransitionAllowed("draft", "paid")).toBe(false)
    expect(isPayrollTransitionAllowed("calculated", "approved")).toBe(false)
    expect(isPayrollTransitionAllowed("approved", "calculated")).toBe(false)
    expect(isPayrollTransitionAllowed("approved", "approved")).toBe(false)
    expect(isPayrollTransitionAllowed("paid", "cancelled")).toBe(false)
  })

  it("requires a reason only on the cancellation family", () => {
    expect(transitionRequiresReason("approved", "cancelled")).toBe(true)
    expect(transitionRequiresReason("draft", "cancelled")).toBe(true)
    expect(transitionRequiresReason("approved", "paid")).toBe(false)
    expect(transitionRequiresReason("in_review", "approved")).toBe(false)
    expect(transitionRequiresReason("calculated", "in_review")).toBe(false)
  })
})

describe("payrollRowsToCsv", () => {
  it("serializes rows with a UTF-8 BOM and the full header", () => {
    const csv = payrollRowsToCsv([
      {
        period_year: 2026,
        period_month: 9,
        status: "approved",
        driver_code: "DRV-001",
        driver_name: "سائق تجربة",
        orders_achieved: 480,
        orders_prorated_target: 450,
        orders_variance: 30,
        base_amount: 2000,
        orders_bonus: 270,
        total_deductions: 100,
        cod_deduction: 0,
        net_payroll: 2170,
        below_minimum_wage: false,
        minimum_floor_applied: false,
        manual_override: false,
      },
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain("Period,Driver Code,Driver,Status")
    expect(csv).toContain("2026-09,DRV-001")
    expect(csv).toContain("approved")
    expect(csv).toContain("2170")
  })

  it("escapes commas, quotes and newlines per RFC-4180", () => {
    const csv = payrollRowsToCsv([
      {
        period_year: 2026,
        period_month: 1,
        status: "draft",
        driver_code: "DRV,9",
        driver_name: 'The "Best" Driver',
        orders_achieved: 0,
        orders_prorated_target: 0,
        orders_variance: 0,
        base_amount: 0,
        orders_bonus: 0,
        total_deductions: 0,
        cod_deduction: 0,
        net_payroll: 0,
        below_minimum_wage: false,
        minimum_floor_applied: false,
        manual_override: false,
      },
    ])
    expect(csv).toContain('"DRV,9"')
    expect(csv).toContain('"The ""Best"" Driver"')
  })

  it("renders empty cells for null values (status/period always present)", () => {
    const csv = payrollRowsToCsv([
      {
        period_year: 2026,
        period_month: 2,
        status: "draft",
        driver_code: null,
        driver_name: null,
        orders_achieved: null,
        orders_prorated_target: null,
        orders_variance: null,
        base_amount: null,
        orders_bonus: null,
        total_deductions: null,
        cod_deduction: null,
        net_payroll: null,
        below_minimum_wage: null,
        minimum_floor_applied: null,
        manual_override: null,
      },
    ])
    const dataLine = csv.split("\n")[1]
    // Period, status and the boolean flags render their defaults; every
    // nullable metric renders empty.
    expect(dataLine).toBe("2026-02,,,draft,,,,,,,,,no,no,no")
  })
})

describe("periodKey", () => {
  it("zero-pads the month", () => {
    expect(periodKey(2026, 9)).toBe("2026-09")
    expect(periodKey(2026, 12)).toBe("2026-12")
    expect(periodKey(2026, 1)).toBe("2026-01")
  })
})

describe("rollupMonthlyOrders", () => {
  it("aggregates per-platform rows into one rollup", () => {
    const r = rollupMonthlyOrders([
      { total_delivered: 100, total_failed: 5, total_returned: 3, total_revenue: 1500.5 },
      { total_delivered: 50, total_failed: 2, total_returned: 1, total_revenue: 800 },
    ])
    expect(r.total_delivered).toBe(150)
    expect(r.total_failed).toBe(7)
    expect(r.total_returned).toBe(4)
    expect(r.total_revenue).toBe(2300.5)
    expect(r.platforms).toBe(2)
  })

  it("treats null metric rows as zeros", () => {
    const r = rollupMonthlyOrders([
      { total_delivered: null, total_failed: null, total_returned: null, total_revenue: null },
    ])
    expect(r.total_delivered).toBe(0)
    expect(r.total_revenue).toBe(0)
    expect(r.platforms).toBe(1)
  })

  it("returns an empty rollup for an empty set", () => {
    const r = rollupMonthlyOrders([])
    expect(r.total_delivered).toBe(0)
    expect(r.platforms).toBe(0)
  })
})

describe("rollupCodSessions", () => {
  it("sums collected/submitted/variance and counts pending", () => {
    const r = rollupCodSessions([
      { cod_collected: 500, cod_submitted: 400, cod_variance: 100, status: "pending" },
      { cod_collected: 300, cod_submitted: 300, cod_variance: 0, status: "reconciled" },
      { cod_collected: 200, cod_submitted: 150, cod_variance: 50, status: "pending" },
    ])
    expect(r.sessions).toBe(3)
    expect(r.collected).toBe(1000)
    expect(r.submitted).toBe(850)
    expect(r.variance).toBe(150)
    expect(r.pending).toBe(2)
  })

  it("counts zero sessions for an empty set", () => {
    const r = rollupCodSessions([])
    expect(r.sessions).toBe(0)
    expect(r.pending).toBe(0)
  })
})
