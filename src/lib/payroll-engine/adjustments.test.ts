import { describe, expect, it } from "vitest"
import { activeCustomDeductions, advanceTrafficInstallments, groupTrafficDeductions } from "./adjustments"

const fine = (over: Record<string, unknown>) => ({ id: "f", riderId: "1", violationType: "Speed", amount: 900, status: "approved", installmentEnabled: false, installmentMonthlyAmount: 0, installmentTotalPaid: 0, installmentStatus: "none", ...over })
const ded = (over: Record<string, unknown>) => ({ id: "d", name: "Loan", nameAr: null, amount: 1000, status: "active", applyToAll: true, targetRiderIds: [], installmentEnabled: true, installmentMonthlyAmount: 400, installmentTotalPaid: 0, installmentStatus: "active", ...over })

describe("installment plans", () => {
  it("deducts the monthly installment, capped at the remaining balance", () => {
    expect(activeCustomDeductions([ded({ installmentTotalPaid: 800 })])[0].monthlyDeduction).toBe(200)
    expect(groupTrafficDeductions([fine({ installmentEnabled: true, installmentMonthlyAmount: 300, installmentTotalPaid: 750, installmentStatus: "active" })], ["1"]).get("1")?.total).toBe(150)
  })
  it("never re-deducts a completed plan (upstream deducted the full amount again)", () => {
    expect(activeCustomDeductions([ded({ installmentTotalPaid: 1000, installmentStatus: "completed" })])).toEqual([])
    expect(groupTrafficDeductions([fine({ installmentEnabled: true, installmentMonthlyAmount: 300, installmentTotalPaid: 900, installmentStatus: "completed" })], ["1"]).get("1")?.total ?? 0).toBe(0)
  })
  it("one-time fines are deducted in full; installment progress completes on the last month", () => {
    expect(groupTrafficDeductions([fine({})], ["1"]).get("1")?.total).toBe(900)
    expect(advanceTrafficInstallments([fine({ installmentEnabled: true, installmentMonthlyAmount: 300, installmentTotalPaid: 600, installmentStatus: "active" })], ["1"]))
      .toEqual([{ id: "f", installmentTotalPaid: 900, installmentStatus: "completed" }])
  })
})
