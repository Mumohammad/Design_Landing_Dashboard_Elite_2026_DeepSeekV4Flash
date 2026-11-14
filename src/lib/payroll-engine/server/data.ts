import "server-only"
import { readCompleteRows } from "@/lib/analytics/complete-read"
import { DELIVERY_PLATFORMS } from "@/lib/drivers/platforms"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission, type PermissionAction } from "@/lib/auth/authorization"
import type { CustomBonusRecord, CustomDeductionRecord, ManualAdjustmentRecord, TrafficViolationRecord } from "../adjustments"
import type { PayrollSources } from "../run"
import { buildRuleSnapshot } from "../run"
import { completeRuleValues, type RuleValues } from "../rule-validation"
import type { RuleSnapshot } from "../salary-engine"

export type EngineResult<T = undefined> = { success: true; data: T } | { success: false; error: string }

/** userId is the auth.users id (all created_by/approved_by FKs and audit actor ids reference auth.users). */
export interface EngineContext { tenantId: string; userId: string; admin: SupabaseClient }

export async function payrollSourceVersion(): Promise<number> {
  const caller = await createClient()
  const { data, error } = await caller.rpc("read_my_payroll_source_version")
  if (error || !Number.isSafeInteger(data) || data < 0) throw new Error("Payroll inputs could not be confirmed. Reload before saving.")
  return data as number
}

export async function attestPayrollCalculation(ctx: EngineContext, operation: "save" | "approve", payload: Record<string, unknown>, sourceVersion: number): Promise<void> {
  const { data, error } = await ctx.admin.rpc("attest_platform_payroll", { p_tenant: ctx.tenantId, p_actor: ctx.userId, p_operation: operation, p_payload: payload, p_source_version: sourceVersion })
  if (error || data !== true) throw new Error("Payroll calculation could not be confirmed. Reload and recalculate before saving.")
}

export async function saveReviewedPayroll(ctx: EngineContext, args: { p_run: Record<string, unknown>; p_results: unknown[]; p_exceptions: unknown[]; p_income: unknown[]; p_source_version: number; p_run_id?: string; p_expected_version?: number }) {
  await attestPayrollCalculation(ctx, "save", { run: args.p_run, results: args.p_results, exceptions: args.p_exceptions, income: args.p_income, source: args.p_source_version, run_id: args.p_run_id ?? null, expected_version: args.p_expected_version ?? null }, args.p_source_version)
  const caller = await createClient()
  return caller.rpc("save_my_platform_payroll", args)
}

/** Permission + caller-derived tenant; service-role client is only returned after both checks. */
export async function engineContext(action: PermissionAction): Promise<EngineContext> {
  await requirePermission("payroll", action)
  const user = await getCurrentUser()
  if (!user?.tenantId) throw new Error("Not authenticated or MFA required.")
  return { tenantId: user.tenantId, userId: user.authUserId, admin: createAdminClient() }
}

export function failure(e: unknown, fallback: string): { success: false; error: string } {
  const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : fallback
  const known = /^PAYENG\d{3}:\s*.{1,500}$/.test(message)
  return { success: false, error: known ? message : "PAYENG_UNAVAILABLE" }
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0

export async function loadSources(ctx: EngineContext): Promise<Required<PayrollSources>> {
  const [items, adjustments, traffic] = await Promise.all([
    readCompleteRows(() => ctx.admin.from("payroll_engine_items").select("*", { count: "exact" }).eq("tenant_id", ctx.tenantId).order("id", { ascending: true })),
    readCompleteRows(() => ctx.admin.from("payroll_engine_adjustments").select("*", { count: "exact" }).eq("tenant_id", ctx.tenantId).eq("status", "active").order("id", { ascending: true })),
    readCompleteRows(() => ctx.admin.from("payroll_engine_traffic_fines").select("*", { count: "exact" }).eq("tenant_id", ctx.tenantId).eq("status", "approved").order("id", { ascending: true })),
  ])
  for (const r of [items, adjustments, traffic]) if (r.error) throw new Error(r.error.message)
  const customBonuses: CustomBonusRecord[] = (items.data ?? []).filter(i => i.kind === "bonus").map(i => ({
    id: i.id, name: i.name, nameAr: i.name_ar, amount: num(i.amount), type: i.item_type, status: i.status,
    applyToAll: i.apply_to_all, targetRiderIds: i.target_rider_ids ?? [],
  }))
  const customDeductions: CustomDeductionRecord[] = (items.data ?? []).filter(i => i.kind === "deduction").map(i => ({
    id: i.id, name: i.name, nameAr: i.name_ar, amount: num(i.amount), status: i.status, applyToAll: i.apply_to_all,
    targetRiderIds: i.target_rider_ids ?? [], installmentEnabled: i.installment_enabled,
    installmentMonthlyAmount: num(i.installment_monthly_amount), installmentTotalPaid: num(i.installment_total_paid), installmentStatus: i.installment_status,
  }))
  const manualAdjustments: ManualAdjustmentRecord[] = (adjustments.data ?? []).map(a => ({
    id: a.id, riderId: a.rider_id, title: a.title, titleAr: a.title_ar, amount: num(a.amount), type: a.adjustment_type, category: a.category, status: a.status,
  }))
  const trafficViolations: TrafficViolationRecord[] = (traffic.data ?? []).map(v => ({
    id: v.id, riderId: v.rider_id, violationType: v.violation_type, amount: num(v.amount), status: v.status,
    installmentEnabled: v.installment_enabled, installmentMonthlyAmount: num(v.installment_monthly_amount),
    installmentTotalPaid: num(v.installment_total_paid), installmentStatus: v.installment_status,
  }))
  return { customBonuses, customDeductions, manualAdjustments, trafficViolations }
}

/** Missing rules use read-only repository defaults. Only an authorized save persists a rule set. */
export async function loadActiveRules(ctx: EngineContext): Promise<{ id: string | null; name: string; values: RuleValues; snapshot: RuleSnapshot; updatedAt: string | null }> {
  const { data, error } = await ctx.admin.from("payroll_engine_rule_sets").select("id,name,rule_values,updated_at")
    .eq("tenant_id", ctx.tenantId).eq("status", "active").maybeSingle()
  if (error) throw new Error(error.message)
  if (data) {
    const values = completeRuleValues(data.rule_values as Record<string, unknown>)
    return { id: data.id, name: data.name, values, snapshot: buildRuleSnapshot(values), updatedAt: data.updated_at }
  }
  const values = completeRuleValues({})
  return { id: null, name: "Default payroll rules", values, snapshot: buildRuleSnapshot(values), updatedAt: null }
}

export interface DriverLink { id: string; name: string; iban: string | null; bankName: string | null }

/** Resolve a rider only within the selected platform; the primary legacy ID
 * may belong to another platform and must never select a bank beneficiary. */
export async function loadDriversByRider(ctx: EngineContext, riderIds: readonly string[], platformName?: string): Promise<Map<string, DriverLink>> {
  const map = new Map<string, DriverLink>()
  const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  const platform = DELIVERY_PLATFORMS.find(item => [item.code, item.en, item.ar].some(name => normalized(name) === normalized(platformName ?? "")))
  if (!platform) return map
  const unique = [...new Set(riderIds.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 300) {
    const rows = await readCompleteRows(() => ctx.admin.from("driver_platform_accounts")
      .select("id,platform_driver_id,drivers!inner(id,tenant_id,deleted_at,full_name_en,full_name_ar,iban,bank_name)", { count: "exact" })
      .eq("tenant_id", ctx.tenantId).eq("platform_code", platform.code).eq("status", "active").is("deleted_at", null)
      .eq("drivers.tenant_id", ctx.tenantId).is("drivers.deleted_at", null).in("platform_driver_id", unique.slice(i, i + 300)).order("id", { ascending: true }))
    if (rows.error || !rows.data) throw Error("Platform rider links unavailable")
    for (const row of rows.data) {
      const driver = (Array.isArray(row.drivers) ? row.drivers[0] : row.drivers) as unknown as { id: string; tenant_id: string; full_name_en: string; full_name_ar: string; iban: string | null; bank_name: string | null } | null
      if (!driver || driver.tenant_id !== ctx.tenantId || map.has(row.platform_driver_id)) throw Error("Ambiguous platform rider link")
      map.set(row.platform_driver_id, { id: driver.id, name: driver.full_name_en || driver.full_name_ar || "", iban: driver.iban, bankName: driver.bank_name })
    }
  }
  return map
}
