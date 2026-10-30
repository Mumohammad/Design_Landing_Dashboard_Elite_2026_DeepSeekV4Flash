import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission, type PermissionAction } from "@/lib/auth/authorization"
import type { CustomBonusRecord, CustomDeductionRecord, ManualAdjustmentRecord, TrafficViolationRecord } from "../adjustments"
import type { PayrollSources } from "../run"
import { buildRuleSnapshot } from "../run"
import { completeRuleValues, type RuleValues } from "../rule-validation"
import type { RuleSnapshot } from "../salary-engine"

export type EngineResult<T = undefined> = { success: true; data: T } | { success: false; error: string }

/** userId is the auth.users id (all created_by/approved_by FKs and audit actor ids reference auth.users). */
export interface EngineContext { tenantId: string; userId: string; admin: SupabaseClient }

/** Permission + caller-derived tenant; service-role client is only returned after both checks. */
export async function engineContext(action: PermissionAction): Promise<EngineContext> {
  await requirePermission("payroll", action)
  const user = await getCurrentUser()
  if (!user?.tenantId) throw new Error("Not authenticated or MFA required.")
  return { tenantId: user.tenantId, userId: user.authUserId, admin: createAdminClient() }
}

export function failure(e: unknown, fallback: string): { success: false; error: string } {
  const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : fallback
  return { success: false, error: message.replace(/^PAYENG\d{3}:\s*/, "") || fallback }
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0

export async function loadSources(ctx: EngineContext): Promise<Required<PayrollSources>> {
  const [items, adjustments, traffic] = await Promise.all([
    ctx.admin.from("payroll_engine_items").select("*").eq("tenant_id", ctx.tenantId),
    ctx.admin.from("payroll_engine_adjustments").select("*").eq("tenant_id", ctx.tenantId).eq("status", "active"),
    ctx.admin.from("payroll_engine_traffic_fines").select("*").eq("tenant_id", ctx.tenantId).eq("status", "approved"),
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

/** Active rule set for the tenant; created from the upstream defaults on first use. */
export async function loadActiveRules(ctx: EngineContext): Promise<{ id: string; name: string; values: RuleValues; snapshot: RuleSnapshot }> {
  const { data, error } = await ctx.admin.from("payroll_engine_rule_sets").select("id,name,rule_values")
    .eq("tenant_id", ctx.tenantId).eq("status", "active").maybeSingle()
  if (error) throw new Error(error.message)
  if (data) {
    const values = completeRuleValues(data.rule_values as Record<string, unknown>)
    return { id: data.id, name: data.name, values, snapshot: buildRuleSnapshot(values) }
  }
  const values = completeRuleValues({})
  const inserted = await ctx.admin.from("payroll_engine_rule_sets").insert({
    tenant_id: ctx.tenantId, name: "Default payroll rules", status: "active", rule_values: values,
    created_by: ctx.userId, updated_by: ctx.userId, activated_by: ctx.userId, activated_at: new Date().toISOString(),
  }).select("id,name").single()
  if (inserted.error) {
    // A concurrent first use created it — read the winner.
    const again = await ctx.admin.from("payroll_engine_rule_sets").select("id,name,rule_values").eq("tenant_id", ctx.tenantId).eq("status", "active").single()
    if (again.error) throw new Error(inserted.error.message)
    const v = completeRuleValues(again.data.rule_values as Record<string, unknown>)
    return { id: again.data.id, name: again.data.name, values: v, snapshot: buildRuleSnapshot(v) }
  }
  return { id: inserted.data.id, name: inserted.data.name, values, snapshot: buildRuleSnapshot(values) }
}

export interface DriverLink { id: string; name: string; iban: string | null; bankName: string | null }

/** Tenant drivers keyed by platform rider ID (drivers.rider_id). */
export async function loadDriversByRider(ctx: EngineContext, riderIds: readonly string[]): Promise<Map<string, DriverLink>> {
  const map = new Map<string, DriverLink>()
  const unique = [...new Set(riderIds.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 300) {
    const { data, error } = await ctx.admin.from("drivers").select("id,rider_id,full_name_en,full_name_ar,iban,bank_name")
      .eq("tenant_id", ctx.tenantId).is("deleted_at", null).in("rider_id", unique.slice(i, i + 300))
    if (error) throw new Error(error.message)
    for (const d of data ?? []) {
      if (d.rider_id && !map.has(d.rider_id)) map.set(d.rider_id, { id: d.id, name: d.full_name_en || d.full_name_ar || "", iban: d.iban, bankName: d.bank_name })
    }
  }
  return map
}
