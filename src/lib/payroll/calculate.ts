// Caller-bound payroll calculation. All source reads, exact-decimal arithmetic,
// revision selection and persistence commit together inside the database.
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import type { PayrollCalculationResult } from "./calculation-engine"

export interface CalculatePayrollInput { driverId: string; periodYear: number; periodMonth: number }
export interface CalculatePayrollOutput extends PayrollCalculationResult {
  id: string
  period: { driver_id: string; period_year: number; period_month: number; status: "calculated" }
}
const inputSchema = z.object({ driverId: z.string().uuid(), periodYear: z.number().int().min(2000).max(2100), periodMonth: z.number().int().min(1).max(12) })
const resultSchema = z.object({
  id: z.string().uuid(), base_amount: z.number().finite(), orders_bonus: z.number().finite(), package_deduction: z.number().finite(),
  orders_deduction: z.number().finite(), orders_prorated_target: z.number().int(), orders_variance: z.number().int(),
  total_deductions: z.number().finite(), net_payroll: z.number().finite(), minimum_floor_applied: z.boolean(), below_minimum_wage: z.boolean(),
  deduction_lines: z.array(z.object({ source: z.string(), amount: z.number().finite().nonnegative(), reason: z.string(), source_module: z.string(), source_reference: z.string().nullable().optional(), status: z.enum(["approved", "applied"]) })),
  calculation_steps: z.array(z.string()), warnings: z.array(z.string()),
  period: z.object({ driver_id: z.string().uuid(), period_year: z.number().int(), period_month: z.number().int(), status: z.literal("calculated") }),
})
export async function calculateDriverPayroll(input: CalculatePayrollInput): Promise<CalculatePayrollOutput> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new Error("Invalid payroll driver or period")
  const { driverId, periodYear, periodMonth } = parsed.data
  const client = await createClient()
  const { data, error } = await client.rpc("calculate_payroll_atomic", { p_driver: driverId, p_year: periodYear, p_month: periodMonth })
  if (error) throw new Error(error.message)
  const result = resultSchema.safeParse(data)
  if (!result.success || result.data.period.driver_id !== driverId || result.data.period.period_year !== periodYear || result.data.period.period_month !== periodMonth) {
    throw new Error("Payroll calculation returned an invalid result")
  }
  return result.data
}
