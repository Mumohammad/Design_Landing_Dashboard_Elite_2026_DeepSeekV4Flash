"use server"

// Rules Control Center, recurring bonus/deduction items, per-rider manual
// adjustments and traffic fines. All writes are tenant-scoped through the
// service-role client after the caller's payroll permission is verified.
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { writeAuditLog } from "@/lib/auth/sessions"
import { validateRuleUpdates, type RuleValues } from "../rule-validation"
import { DEFAULT_RULE_DEFINITIONS } from "../rules"
import { engineContext, failure, loadActiveRules, loadDriversByRider, type EngineResult } from "./data"

function revalidateAll() {
  revalidatePath("/payroll/platform")
  revalidatePath("/payroll/platform/rules")
  revalidatePath("/payroll/platform/adjustments")
}

const money = z.coerce.number().finite().min(0).max(99_999_999)
const riderId = z.string().trim().min(1).max(64)
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform(v => (v ? v : null))
const now = () => new Date().toISOString()

// ─── Rules ────────────────────────────────────────────────────────────────

export async function getPayrollRules(): Promise<EngineResult<{ id: string; name: string; values: RuleValues }>> {
  try {
    const ctx = await engineContext("read")
    const rules = await loadActiveRules(ctx)
    return { success: true, data: { id: rules.id, name: rules.name, values: rules.values } }
  } catch (e) { return failure(e, "Could not load payroll rules") }
}

export async function savePayrollRules(input: unknown): Promise<EngineResult<{ changed: number }>> {
  try {
    const p = z.object({ values: z.record(z.string(), z.unknown()) }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid request" }
    const checked = validateRuleUpdates(p.data.values)
    if (!checked.ok) return { success: false, error: checked.errors.join("; ") }
    const ctx = await engineContext("update")
    const current = await loadActiveRules(ctx)
    const next = { ...current.values, ...checked.values }
    const changed = Object.keys(checked.values).filter(k => JSON.stringify(current.values[k]) !== JSON.stringify(next[k]))
    if (changed.length === 0) return { success: true, data: { changed: 0 } }
    const { error } = await ctx.admin.from("payroll_engine_rule_sets").update({ rule_values: next, updated_by: ctx.userId, updated_at: now() })
      .eq("id", current.id).eq("tenant_id", ctx.tenantId)
    if (error) return failure(error, "Could not save rules")
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "platform_payroll_rules_updated", entityType: "payroll_engine_rule_sets", entityId: current.id,
      oldValues: Object.fromEntries(changed.map(k => [k, current.values[k]])), newValues: Object.fromEntries(changed.map(k => [k, next[k]])) })
    revalidateAll()
    return { success: true, data: { changed: changed.length } }
  } catch (e) { return failure(e, "Could not save rules") }
}

export async function resetPayrollRules(input: unknown): Promise<EngineResult> {
  try {
    const p = z.object({ group: z.string().max(40).nullable() }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid request" }
    const defs = DEFAULT_RULE_DEFINITIONS.filter(d => !p.data.group || d.group === p.data.group)
    const r = await savePayrollRules({ values: Object.fromEntries(defs.map(d => [d.key, d.defaultValue])) })
    return r.success ? { success: true, data: undefined } : r
  } catch (e) { return failure(e, "Could not reset rules") }
}

// ─── Recurring bonus / deduction items ────────────────────────────────────

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["bonus", "deduction"]),
  name: z.string().trim().min(1).max(120),
  nameAr: optText(120),
  amount: money,
  description: optText(500),
  status: z.enum(["active", "inactive"]).default("active"),
  applyToAll: z.boolean(),
  targetRiderIds: z.array(riderId).max(2000).default([]),
  installmentEnabled: z.boolean().default(false),
  installmentMonthlyAmount: money.default(0),
}).superRefine((v, c) => {
  if (!v.applyToAll && v.targetRiderIds.length === 0) c.addIssue({ code: "custom", message: "Choose at least one rider or apply to all riders" })
  if (v.installmentEnabled) {
    if (v.kind !== "deduction") c.addIssue({ code: "custom", message: "Installments apply to deductions only" })
    if (v.installmentMonthlyAmount <= 0) c.addIssue({ code: "custom", message: "Monthly installment must be greater than zero" })
    if (v.installmentMonthlyAmount > v.amount) c.addIssue({ code: "custom", message: "Monthly installment cannot exceed the total amount" })
  }
})

export async function savePayrollItem(input: unknown): Promise<EngineResult<{ id: string }>> {
  try {
    const p = itemSchema.safeParse(input)
    if (!p.success) return { success: false, error: p.error.issues.map(i => i.message).join("; ") }
    const v = p.data
    const ctx = await engineContext(v.id ? "update" : "create")
    const row = {
      kind: v.kind, name: v.name, name_ar: v.nameAr, amount: v.amount, item_type: "fixed", description: v.description, status: v.status,
      apply_to_all: v.applyToAll, target_rider_ids: v.applyToAll ? [] : [...new Set(v.targetRiderIds)],
      installment_enabled: v.installmentEnabled, installment_monthly_amount: v.installmentEnabled ? v.installmentMonthlyAmount : 0, updated_at: now(),
    }
    let id = v.id
    if (id) {
      const prev = await ctx.admin.from("payroll_engine_items").select("installment_enabled,installment_total_paid,installment_status").eq("id", id).eq("tenant_id", ctx.tenantId).single()
      if (prev.error) return { success: false, error: "Item not found" }
      const paid = Number(prev.data.installment_total_paid) || 0
      if (v.installmentEnabled && paid > v.amount) return { success: false, error: "Total amount cannot be below what was already paid" }
      const status = v.installmentEnabled ? (paid >= v.amount ? "completed" : "active") : "none"
      const { error } = await ctx.admin.from("payroll_engine_items").update({ ...row, installment_status: status, installment_total_paid: v.installmentEnabled ? paid : 0 }).eq("id", id).eq("tenant_id", ctx.tenantId)
      if (error) return failure(error, "Could not save item")
    } else {
      const { data, error } = await ctx.admin.from("payroll_engine_items").insert({ ...row, tenant_id: ctx.tenantId, created_by: ctx.userId,
        installment_status: v.installmentEnabled ? "active" : "none", installment_total_paid: 0 }).select("id").single()
      if (error) return failure(error, "Could not save item")
      id = data.id as string
    }
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: v.id ? "platform_payroll_item_updated" : "platform_payroll_item_created", entityType: "payroll_engine_items", entityId: id, newValues: row })
    revalidateAll()
    return { success: true, data: { id: id! } }
  } catch (e) { return failure(e, "Could not save item") }
}

// ─── Manual adjustments (per rider) ───────────────────────────────────────

const adjustmentSchema = z.object({
  id: z.string().uuid().optional(),
  riderId,
  title: z.string().trim().min(1).max(160),
  titleAr: optText(160),
  amount: money.refine(n => n > 0, "Amount must be greater than zero"),
  adjustmentType: z.enum(["bonus", "deduction"]),
  category: z.enum(["license", "custom_bonus", "custom_deduction", "custom"]).default("custom"),
  status: z.enum(["active", "inactive", "paid"]).default("active"),
  notes: optText(500),
})

export async function savePayrollAdjustment(input: unknown): Promise<EngineResult<{ id: string }>> {
  try {
    const p = adjustmentSchema.safeParse(input)
    if (!p.success) return { success: false, error: p.error.issues.map(i => i.message).join("; ") }
    const v = p.data
    const ctx = await engineContext(v.id ? "update" : "create")
    const driver = (await loadDriversByRider(ctx, [v.riderId])).get(v.riderId)
    const row = { rider_id: v.riderId, driver_id: driver?.id ?? null, title: v.title, title_ar: v.titleAr, amount: v.amount, adjustment_type: v.adjustmentType,
      category: v.category, status: v.status, notes: v.notes, updated_at: now() }
    let id = v.id
    if (id) {
      const { error, count } = await ctx.admin.from("payroll_engine_adjustments").update(row, { count: "exact" }).eq("id", id).eq("tenant_id", ctx.tenantId)
      if (error) return failure(error, "Could not save adjustment")
      if (!count) return { success: false, error: "Adjustment not found" }
    } else {
      const { data, error } = await ctx.admin.from("payroll_engine_adjustments").insert({ ...row, tenant_id: ctx.tenantId, created_by: ctx.userId }).select("id").single()
      if (error) return failure(error, "Could not save adjustment")
      id = data.id as string
    }
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: v.id ? "platform_payroll_adjustment_updated" : "platform_payroll_adjustment_created", entityType: "payroll_engine_adjustments", entityId: id, newValues: row })
    revalidateAll()
    return { success: true, data: { id: id! } }
  } catch (e) { return failure(e, "Could not save adjustment") }
}

// ─── Traffic fines ────────────────────────────────────────────────────────

const trafficSchema = z.object({
  id: z.string().uuid().optional(),
  riderId,
  ticketDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ticket date is required"),
  ticketNumber: optText(80),
  violationType: z.string().trim().min(1).max(160),
  amount: money.refine(n => n > 0, "Amount must be greater than zero"),
  status: z.enum(["pending", "approved", "rejected", "paid"]).default("approved"),
  notes: optText(500),
  installmentEnabled: z.boolean().default(false),
  installmentMonthlyAmount: money.default(0),
}).superRefine((v, c) => {
  if (v.installmentEnabled && v.installmentMonthlyAmount <= 0) c.addIssue({ code: "custom", message: "Monthly installment must be greater than zero" })
  if (v.installmentEnabled && v.installmentMonthlyAmount > v.amount) c.addIssue({ code: "custom", message: "Monthly installment cannot exceed the fine amount" })
})

export async function savePayrollTrafficFine(input: unknown): Promise<EngineResult<{ id: string }>> {
  try {
    const p = trafficSchema.safeParse(input)
    if (!p.success) return { success: false, error: p.error.issues.map(i => i.message).join("; ") }
    const v = p.data
    const ctx = await engineContext(v.id ? "update" : "create")
    const driver = (await loadDriversByRider(ctx, [v.riderId])).get(v.riderId)
    const row = { rider_id: v.riderId, driver_id: driver?.id ?? null, ticket_date: v.ticketDate, ticket_number: v.ticketNumber, violation_type: v.violationType,
      amount: v.amount, status: v.status, notes: v.notes, installment_enabled: v.installmentEnabled,
      installment_monthly_amount: v.installmentEnabled ? v.installmentMonthlyAmount : 0, updated_at: now() }
    let id = v.id
    if (id) {
      const prev = await ctx.admin.from("payroll_engine_traffic_fines").select("installment_total_paid").eq("id", id).eq("tenant_id", ctx.tenantId).single()
      if (prev.error) return { success: false, error: "Traffic fine not found" }
      const paid = Number(prev.data.installment_total_paid) || 0
      if (v.installmentEnabled && paid > v.amount) return { success: false, error: "Fine amount cannot be below what was already paid" }
      const { error } = await ctx.admin.from("payroll_engine_traffic_fines").update({ ...row, installment_total_paid: v.installmentEnabled ? paid : 0,
        installment_status: v.installmentEnabled ? (paid >= v.amount ? "completed" : "active") : "none" }).eq("id", id).eq("tenant_id", ctx.tenantId)
      if (error) return failure(error, "Could not save traffic fine")
    } else {
      const { data, error } = await ctx.admin.from("payroll_engine_traffic_fines").insert({ ...row, tenant_id: ctx.tenantId, created_by: ctx.userId,
        installment_total_paid: 0, installment_status: v.installmentEnabled ? "active" : "none" }).select("id").single()
      if (error) return failure(error, "Could not save traffic fine")
      id = data.id as string
    }
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: v.id ? "platform_payroll_traffic_updated" : "platform_payroll_traffic_created", entityType: "payroll_engine_traffic_fines", entityId: id, newValues: row })
    revalidateAll()
    return { success: true, data: { id: id! } }
  } catch (e) { return failure(e, "Could not save traffic fine") }
}

// ─── Delete (items / adjustments / fines) ─────────────────────────────────

const DELETABLE = { item: "payroll_engine_items", adjustment: "payroll_engine_adjustments", traffic: "payroll_engine_traffic_fines" } as const

export async function deletePayrollRecord(input: unknown): Promise<EngineResult> {
  try {
    const p = z.object({ kind: z.enum(["item", "adjustment", "traffic"]), id: z.string().uuid() }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid request" }
    const ctx = await engineContext("update") // no payroll:delete permission exists; edits are audited
    const table = DELETABLE[p.data.kind]
    // Installment progress already applied by an approved run must not vanish silently.
    if (p.data.kind !== "adjustment") {
      const prev = await ctx.admin.from(table).select("installment_total_paid").eq("id", p.data.id).eq("tenant_id", ctx.tenantId).single()
      if (prev.error) return { success: false, error: "Record not found" }
      if (Number(prev.data.installment_total_paid) > 0) return { success: false, error: "This record has installments paid by an approved payroll — mark it inactive/paid instead of deleting" }
    }
    const { error, count } = await ctx.admin.from(table).delete({ count: "exact" }).eq("id", p.data.id).eq("tenant_id", ctx.tenantId)
    if (error) return failure(error, "Delete failed")
    if (!count) return { success: false, error: "Record not found" }
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: `platform_payroll_${p.data.kind}_deleted`, entityType: table, entityId: p.data.id })
    revalidateAll()
    return { success: true, data: undefined }
  } catch (e) { return failure(e, "Delete failed") }
}
