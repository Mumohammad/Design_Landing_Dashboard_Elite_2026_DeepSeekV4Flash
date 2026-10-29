import { z } from "zod"

const money = z.number().finite().min(0).max(99_999_999.99).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, "Use at most two decimal places")
const rate = money.refine((v) => v <= 9999.99, "Rate is too large")
export const payrollPeriodSchema = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) })
export const ruleSchema = z.object({
  id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(),
  driverId: z.string().uuid(), category: z.enum(["sponsored_type1", "sponsored_type2", "freelancer"]),
  effectiveDate: z.iso.date(), workingDaysTarget: z.number().int().min(1).max(31), targetOrders: z.number().int().min(0).max(1_000_000),
  baseSalary: money.optional(), bonusRate: rate.optional(), deductionRate: rate.optional(), packageAmount: money.optional(),
  thresholdOrders: z.number().int().min(0).max(1_000_000).optional(), carRentDeduction: money.optional(),
  bonusCap: money.optional(), deductionCap: money.optional(), minimumNetFloor: money,
  note: z.string().trim().min(5).max(1000),
}).superRefine((v, ctx) => {
  if (Boolean(v.id) !== Boolean(v.expectedVersion)) ctx.addIssue({ code: "custom", message: "Rule version is required for edits" })
  const required: (keyof typeof v)[] = v.category === "sponsored_type2"
    ? ["packageAmount", "thresholdOrders", "carRentDeduction"] : ["baseSalary", "bonusRate", "deductionRate"]
  if (v.category === "freelancer") required.push("bonusCap", "deductionCap")
  for (const field of required) if (v[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: "Enter an explicit value, including zero when appropriate" })
})
export const attendanceStatuses = ["present", "absent_excused", "absent_unexcused", "late", "half_day", "on_leave", "public_holiday", "day_off"] as const
export const attendancePreparationSchema = payrollPeriodSchema.extend({
  driverId: z.string().uuid(), expectedVersion: z.number().int().min(0),
  employedFrom: z.iso.date().optional(), employedTo: z.iso.date().optional(),
  days: z.array(z.object({ date: z.iso.date(), status: z.enum(attendanceStatuses) })).min(1).max(31),
  note: z.string().trim().min(5).max(1000),
}).superRefine((v, ctx) => {
  const monthDays = new Date(Date.UTC(v.year, v.month, 0)).getUTCDate()
  const prefix = `${v.year}-${String(v.month).padStart(2, "0")}-`
  const from = v.employedFrom ?? prefix + "01"
  const to = v.employedTo ?? prefix + String(monthDays).padStart(2, "0")
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1
  if (!from.startsWith(prefix) || !to.startsWith(prefix) || count < 1 || v.days.length !== count || new Set(v.days.map(d => d.date)).size !== count || v.days.some(d => d.date < from || d.date > to)) {
    ctx.addIssue({ code: "custom", message: "Classify every employed date exactly once; dates outside recorded employment are excluded" })
  }
})
export const advanceSchema = z.object({
  requestId: z.string().uuid().optional(),
  id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(),
  driverId: z.string().uuid(), amount: money.refine(v => v > 0, "Amount must be positive"), advanceDate: z.iso.date(),
  repaymentMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/), reason: z.string().trim().min(5).max(1000),
}).superRefine((v, ctx) => {
  if (!v.id && !v.requestId) ctx.addIssue({ code: "custom", message: "A request identifier is required for safe advance retries" })
  if (v.repaymentMonth < v.advanceDate.slice(0, 7)) ctx.addIssue({ code: "custom", message: "Repayment cannot precede the advance" })
  if (Boolean(v.id) !== Boolean(v.expectedVersion)) ctx.addIssue({ code: "custom", message: "Advance version is required for edits" })
})

/** Persisted rule completeness guard: never allow engine fallback rates into a payroll run. */
export function assertExplicitPayrollRule(rule: Record<string, unknown>, category: string) {
  const fields = ["working_days_target", "target_orders", "minimum_net_floor", ...(category === "sponsored_type2"
    ? ["package_amount", "threshold_orders", "car_rent_deduction"] : ["base_salary", "bonus_rate", "deduction_rate"]),
    ...(category === "freelancer" ? ["bonus_cap", "deduction_cap"] : [])]
  if (rule.category !== category || fields.some(k => rule[k] == null || !Number.isFinite(Number(rule[k])) || Number(rule[k]) < 0)
    || !Number.isInteger(Number(rule.working_days_target)) || Number(rule.working_days_target) < 1 || Number(rule.working_days_target) > 31) {
    throw new Error("PAY_RULE_INCOMPLETE: review explicit payroll values before calculation")
  }
}

export const periodBasisSchema = payrollPeriodSchema.extend({
  driverId: z.string().uuid(), expectedVersion: z.number().int().min(0), ruleId: z.string().uuid(), ruleVersion: z.number().int().positive(),
  employedFrom: z.iso.date(), employedTo: z.iso.date(), periodBaseAmount: money, periodOrderTarget: z.number().int().min(0).max(1_000_000),
  periodAbsenceDeduction: money, periodMinimumFloor: money, periodPackageThreshold: z.number().int().min(0).max(1_000_000).optional(), periodRentDeduction: money.optional(),
  ratesAcknowledged: z.literal(true), note: z.string().trim().min(5).max(1000),
}).refine(v => v.employedFrom <= v.employedTo && v.employedFrom.startsWith(`${v.year}-${String(v.month).padStart(2,"0")}-`) && v.employedTo.startsWith(`${v.year}-${String(v.month).padStart(2,"0")}-`), "Employment dates must be inside this payroll period")
