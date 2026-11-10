"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitPayroll } from "@/lib/auth/rate-limit"
import { advanceSchema, attendancePreparationSchema, payrollPeriodSchema, periodBasisSchema, ruleSchema } from "./preparation-schema"

export type PreparationResult = { success: boolean; error?: string; data?: Record<string, unknown> }
async function mutate(action: string, payload: unknown, permission: "create" | "update" | "approve" = "update"): Promise<PreparationResult> {
  try {
    await requirePermission("payroll", permission)
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated or MFA required." }
    if (!(await rateLimitPayroll(user.id)).success) return { success: false, error: "Rate limit exceeded." }
    const client = await createClient()
    const { data, error } = await client.rpc("payroll_preparation_mutate", { p_action: action, p_payload: payload })
    if (error) return { success: false, error: error.message }
    revalidatePath("/payroll")
    revalidatePath("/payroll/preparation")
    return { success: true, data: data as Record<string, unknown> }
  } catch (e) { return { success: false, error: e instanceof Error ? e.message : "Preparation failed" } }
}
export async function loadPayrollPreparation(year: number, month: number): Promise<PreparationResult> {
  try {
    await requirePermission("payroll", "read")
    if (!await getCurrentUser()) return { success: false, error: "Not authenticated or MFA required." }
    const parsed = payrollPeriodSchema.parse({ year, month })
    const client = await createClient()
    const { data, error } = await client.rpc("payroll_preparation_read", { p_year: parsed.year, p_month: parsed.month })
    return error ? { success: false, error: error.message } : { success: true, data: data as Record<string, unknown> }
  } catch (e) { return { success: false, error: e instanceof Error ? e.message : "Unable to load preparation" } }
}
export async function savePayrollRule(input: unknown): Promise<PreparationResult> {
  const parsed = ruleSchema.safeParse(input)
  return parsed.success ? mutate("rule_save", parsed.data, parsed.data.id ? "update" : "create") : { success: false, error: parsed.error.issues.map(i => i.message).join("; ") }
}
export async function archivePayrollRule(input: unknown): Promise<PreparationResult> {
  const parsed = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive(), note: z.string().trim().min(5).max(1000) }).safeParse(input)
  return parsed.success ? mutate("rule_archive", parsed.data) : { success: false, error: "Rule, version and archive reason are required." }
}
export async function openPayrollPreparation(input: unknown): Promise<PreparationResult> {
  const parsed = payrollPeriodSchema.extend({ workingDays: z.number().int().min(1).max(31) }).safeParse(input)
  return parsed.success ? mutate("open", parsed.data, "create") : { success: false, error: "Enter a valid period and explicit working days." }
}
export async function savePayrollAttendance(input: unknown): Promise<PreparationResult> {
  const parsed = attendancePreparationSchema.safeParse(input)
  return parsed.success ? mutate("attendance_save", parsed.data) : { success: false, error: parsed.error.issues.map(i => i.message).join("; ") }
}
export async function reviewPayrollOrders(input: unknown): Promise<PreparationResult> {
  const parsed = payrollPeriodSchema.extend({ driverId: z.string().uuid(), expectedVersion: z.number().int().min(0), note: z.string().trim().min(5).max(1000), delivered: z.number().int().min(0), revenue: z.number().finite().min(0) }).safeParse(input)
  return parsed.success ? mutate("orders_review", parsed.data) : { success: false, error: "Review the actual order totals and supply a review note." }
}
export async function lockPayrollPreparation(input: unknown): Promise<PreparationResult> {
  const parsed = payrollPeriodSchema.extend({ expectedVersion: z.number().int().positive(), note: z.string().trim().min(5).max(1000) }).safeParse(input)
  return parsed.success ? mutate("lock", parsed.data, "approve") : { success: false, error: "Period version and lock review note are required." }
}
export async function savePayrollAdvance(input: unknown): Promise<PreparationResult> {
  const parsed = advanceSchema.safeParse(input)
  return parsed.success ? mutate("advance_save", parsed.data, parsed.data.id ? "update" : "create") : { success: false, error: parsed.error.issues.map(i => i.message).join("; ") }
}
export async function transitionPayrollAdvance(input: unknown): Promise<PreparationResult> {
  const parsed = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive(), to: z.enum(["approved", "cancelled", "repaid"]), note: z.string().trim().min(5).max(1000), payrollPeriodId: z.string().uuid().optional() }).safeParse(input)
  return parsed.success ? mutate("advance_transition", parsed.data, parsed.data.to === "approved" || parsed.data.to === "repaid" ? "approve" : "update") : { success: false, error: "Advance version, valid transition and reason are required." }
}

export async function savePayrollPeriodBasis(input: unknown): Promise<PreparationResult> {
  const parsed = periodBasisSchema.safeParse(input)
  return parsed.success ? mutate("basis_save", parsed.data, "approve") : { success: false, error: parsed.error.issues.map(i => i.message).join("; ") }
}
