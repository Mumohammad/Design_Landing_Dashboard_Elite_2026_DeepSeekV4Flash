import { describe, it, expect } from "vitest"
import vectors from "./formula-vectors.json"
import { calculateDriverPayrollFormula, type DriverCategory } from "./calculation-engine"
describe("documented payroll formula parity vectors", () => {
 it.each(vectors)("$name", vector => {
  const actual=calculateDriverPayrollFormula({ category:vector.rule.category as DriverCategory, rule:vector.rule, orders_achieved:vector.orders,working_days_actual:vector.days,
   deductions: vector.other ? [{source:"fixture",amount:vector.other,reason:"Reviewed deduction",source_module:"fixture",status:"approved"}] : [],
   absence_deduction:vector.absence,nationality_code:vector.sa ? "SA" : "OTHER",advisory_minimum_net:vector.advisory })
  for(const [key,expected] of Object.entries(vector.expected)) {
   const value=actual[key as keyof typeof actual]
   if(typeof expected==="number") expect(value).toBeCloseTo(expected,8)
   else expect(value).toBe(expected)
  }
 })
})
