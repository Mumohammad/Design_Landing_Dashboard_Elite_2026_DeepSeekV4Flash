"use server"

// Income vs Expenses: monthly income records (synced from payroll runs or
// imported from a delivery company sheet), expense categories, monthly
// expenses, the confirmed active-driver count and the profit dashboard.
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitImports } from "@/lib/auth/rate-limit"
import { calculateIncome, resolveActiveDriverCount, type ExpenseInput } from "../income-engine"
import { computeIncomeDashboard, INCOME_NUMERIC_FIELDS, type IncomeDashboard, type IncomeRecordInput } from "../income-dashboard"
import { MONTH_KEY_RE } from "../month"
import { engineContext, failure, loadDriversByRider, type EngineContext, type EngineResult } from "./data"

const PATH = "/payroll/platform/income-expenses"
const monthKey = z.string().regex(MONTH_KEY_RE, "Month must be YYYY-MM")
const money = z.coerce.number().finite().min(0).max(999_999_999)
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform(v => (v ? v : null))
const now = () => new Date().toISOString()
const num = (v: unknown) => Number(v ?? 0) || 0

type NumField = typeof INCOME_NUMERIC_FIELDS[number]
const COLUMN: Record<NumField, string> = {
  basicPayment: "basic_payment", distancePayment: "distance_payment", segmentPayment: "segment_payment", acceptancePenalty: "acceptance_penalty",
  contactPenalty: "contact_penalty", stackingDeduction: "stacking_deduction", declinedPenalty: "declined_penalty", latePenalty: "late_penalty",
  noShowPenalty: "no_show_penalty", noShowSpecialPenalty: "no_show_special_penalty", dailyAcceptancePenalty: "daily_acceptance_penalty",
  missedDaysPenalty: "missed_days_penalty", riderBalance: "rider_balance",
}

type CustomField = { name: string; amount: number; type: "add" | "deduct" }

function recordFromRow(r: Record<string, unknown>): IncomeRecordInput {
  const out = { id: String(r.id), riderId: String(r.rider_id), driverName: String(r.driver_name ?? ""), companyName: String(r.company_name),
    customFieldsJson: Array.isArray(r.custom_fields) && r.custom_fields.length ? JSON.stringify(r.custom_fields) : null } as IncomeRecordInput
  for (const f of INCOME_NUMERIC_FIELDS) (out as unknown as Record<string, number>)[f] = num(r[COLUMN[f]])
  return out
}

// ─── Dashboard ────────────────────────────────────────────────────────────

export interface IncomeDashboardData extends IncomeDashboard {
  month: string; months: string[]; companies: string[]
  driverCount: { confirmed: number | null; notes: string | null; source: "confirmed" | "income" | "payroll" | "none" }
  expenses: Array<{ id: string; categoryId: string; categoryName: string; amount: number; allocationType: string; assignedRiderId: string | null; notes: string | null }>
  categories: Array<{ id: string; name: string; nameAr: string | null; defaultAmount: number; allocationType: string; description: string | null; isActive: boolean }>
  customFields: Array<{ id: string; name: string; nameAr: string | null; fieldType: "add" | "deduct"; isActive: boolean }>
}

async function loadMonth(ctx: EngineContext, month: string, company: string, rider: string) {
  let q = ctx.admin.from("payroll_income_records").select("*").eq("tenant_id", ctx.tenantId).eq("month_key", month).order("rider_id").limit(5000)
  if (company) q = q.eq("company_name", company)
  if (rider) q = q.eq("rider_id", rider)
  const [records, allIncome, expenses, count, latestRun, categories, customFields] = await Promise.all([
    q,
    ctx.admin.from("payroll_income_records").select("month_key,company_name,rider_id").eq("tenant_id", ctx.tenantId).limit(50000),
    ctx.admin.from("payroll_monthly_expenses").select("*").eq("tenant_id", ctx.tenantId).eq("month_key", month).order("created_at"),
    ctx.admin.from("payroll_driver_counts").select("active_driver_count,notes").eq("tenant_id", ctx.tenantId).eq("month_key", month).maybeSingle(),
    ctx.admin.from("payroll_engine_runs").select("total_drivers").eq("tenant_id", ctx.tenantId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.admin.from("payroll_expense_categories").select("*").eq("tenant_id", ctx.tenantId).order("name"),
    ctx.admin.from("payroll_custom_income_fields").select("*").eq("tenant_id", ctx.tenantId).order("name"),
  ])
  for (const r of [records, allIncome, expenses, count, latestRun, categories, customFields]) if (r.error) throw new Error(r.error.message)
  return { records: records.data ?? [], allIncome: allIncome.data ?? [], expenses: expenses.data ?? [], count: count.data, latestRun: latestRun.data,
    categories: categories.data ?? [], customFields: customFields.data ?? [] }
}

export async function getIncomeDashboard(input: unknown): Promise<EngineResult<IncomeDashboardData>> {
  try {
    const p = z.object({ month: monthKey, company: z.string().max(80).default(""), rider: z.string().max(64).default("") }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid filters" }
    const ctx = await engineContext("read")
    const { month, company, rider } = p.data
    const d = await loadMonth(ctx, month, company, rider)
    // Active driver count uses ALL income riders of the month (not the filtered view), like upstream.
    const monthRiders = d.allIncome.filter(r => r.month_key === month).map(r => r.rider_id as string)
    const confirmed = d.count?.active_driver_count ?? null
    const activeDriverCount = resolveActiveDriverCount({ confirmedCount: confirmed, incomeRiderIds: monthRiders, latestRunDriverCount: d.latestRun?.total_drivers ?? null })
    const source = confirmed && confirmed > 0 ? "confirmed" : new Set(monthRiders).size > 0 ? "income" : (d.latestRun?.total_drivers ?? 0) > 0 ? "payroll" : "none"
    const expenseInputs: ExpenseInput[] = d.expenses.map(e => ({ categoryName: e.category_name, amount: num(e.amount), allocationType: e.allocation_type, assignedRiderId: e.assigned_rider_id }))
    const dash = computeIncomeDashboard(d.records.map(recordFromRow), expenseInputs, activeDriverCount)
    return { success: true, data: {
      ...dash, month,
      months: [...new Set(d.allIncome.map(r => r.month_key as string))].sort().reverse(),
      companies: [...new Set(d.allIncome.map(r => r.company_name as string))].sort(),
      driverCount: { confirmed, notes: d.count?.notes ?? null, source },
      expenses: d.expenses.map(e => ({ id: e.id, categoryId: e.category_id, categoryName: e.category_name, amount: num(e.amount), allocationType: e.allocation_type, assignedRiderId: e.assigned_rider_id, notes: e.notes })),
      categories: d.categories.map(c => ({ id: c.id, name: c.name, nameAr: c.name_ar, defaultAmount: num(c.default_amount), allocationType: c.allocation_type, description: c.description, isActive: c.is_active })),
      customFields: d.customFields.map(f => ({ id: f.id, name: f.name, nameAr: f.name_ar, fieldType: f.field_type, isActive: f.is_active })),
    } }
  } catch (e) { return failure(e, "Could not load income and expenses") }
}

// ─── Income import (mapped rows from a delivery-company sheet) ────────────

const importSchema = z.object({
  month: monthKey,
  companyName: z.string().trim().min(1).max(80),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
  forceUpdate: z.boolean().default(false),
  preview: z.boolean().default(false),
  sourceFile: optText(200),
})

export interface IncomeImportResult {
  preview: boolean; rowCount: number; errors: string[]; totalIncome: number; totalPenalties: number
  imported: number; updated: number; duplicateRiderIds: string[]; payrollManaged: boolean
  rows: Array<{ riderId: string; driverName: string; totalIncome: number; totalPenalties: number; linked: boolean }>
}

export async function importIncomeRows(input: unknown): Promise<EngineResult<IncomeImportResult>> {
  try {
    const p = importSchema.safeParse(input)
    if (!p.success) return { success: false, error: p.error.issues.map(i => i.message).join("; ") }
    const { month, companyName, rows, forceUpdate, preview, sourceFile } = p.data
    const ctx = await engineContext(preview ? "read" : "create")
    if (!preview && !(await rateLimitImports(ctx.userId)).success) return { success: false, error: "Rate limit exceeded. Try again later." }

    // Same validation as upstream import-preview: missing / duplicate rider IDs, non-numeric amounts.
    const errors: string[] = []
    const seen = new Set<string>()
    const clean: Array<Record<NumField, number> & { riderId: string; driverName: string; customFields: CustomField[] }> = []
    rows.forEach((r, i) => {
      const rid = String(r.riderId ?? "").trim().replace(/\.0+$/, "")
      if (!rid) { errors.push(`Row ${i + 1}: missing rider_id`); return }
      if (rid.length > 64) { errors.push(`Row ${i + 1}: rider_id too long`); return }
      if (seen.has(rid)) { errors.push(`Row ${i + 1}: duplicate rider_id "${rid}"`); return }
      seen.add(rid)
      const row = { riderId: rid, driverName: String(r.driverName ?? "").trim().slice(0, 160) || `Rider ${rid}`, customFields: [] as CustomField[] } as Record<NumField, number> & { riderId: string; driverName: string; customFields: CustomField[] }
      for (const k of INCOME_NUMERIC_FIELDS) {
        const v = r[k]
        if (v === undefined || v === null || v === "") row[k] = 0
        else {
          const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim())
          if (!Number.isFinite(n)) { errors.push(`Row ${i + 1} (rider ${rid}): invalid ${k} = "${String(v).slice(0, 40)}"`); row[k] = 0 }
          else row[k] = n
        }
      }
      if (Array.isArray(r.customFields)) {
        for (const f of r.customFields.slice(0, 50) as Array<Record<string, unknown>>) {
          const amount = Number(f?.amount)
          if (!f?.name || !Number.isFinite(amount) || amount === 0) continue
          row.customFields.push({ name: String(f.name).slice(0, 120), amount: Math.abs(amount), type: f.type === "deduct" ? "deduct" : "add" })
        }
      }
      clean.push(row)
    })

    const existing = await ctx.admin.from("payroll_income_records").select("rider_id,run_id").eq("tenant_id", ctx.tenantId).eq("month_key", month).eq("company_name", companyName)
    if (existing.error) return failure(existing.error, "Could not check existing records")
    const existingIds = new Set((existing.data ?? []).map(r => r.rider_id as string))
    const payrollManaged = (existing.data ?? []).some(r => r.run_id)
    const duplicateRiderIds = clean.filter(r => existingIds.has(r.riderId)).map(r => r.riderId)
    const drivers = await loadDriversByRider(ctx, clean.map(r => r.riderId))
    const calcs = clean.map(r => ({ r, calc: calculateIncome({ ...r, customFieldsJson: r.customFields.length ? JSON.stringify(r.customFields) : null }) }))
    const summary = {
      rowCount: clean.length, errors, duplicateRiderIds, payrollManaged,
      totalIncome: calcs.reduce((s, c) => s + c.calc.totalIncome, 0), totalPenalties: calcs.reduce((s, c) => s + c.calc.totalPenalties, 0),
      rows: calcs.map(({ r, calc }) => ({ riderId: r.riderId, driverName: r.driverName, totalIncome: calc.totalIncome, totalPenalties: calc.totalPenalties, linked: drivers.has(r.riderId) })),
    }
    if (preview) return { success: true, data: { preview: true, imported: 0, updated: 0, ...summary } }
    if (clean.length === 0) return { success: false, error: errors[0] ?? "No valid rows" }
    if (duplicateRiderIds.length > 0 && !forceUpdate) return { success: false, error: `${duplicateRiderIds.length} record(s) already exist for ${companyName} in ${month}. Enable “Overwrite existing” to update them.` }

    const payload = calcs.map(({ r, calc }) => ({
      tenant_id: ctx.tenantId, month_key: month, rider_id: r.riderId, company_name: companyName, driver_id: drivers.get(r.riderId)?.id ?? null, driver_name: r.driverName,
      ...Object.fromEntries(INCOME_NUMERIC_FIELDS.map(f => [COLUMN[f], r[f]])),
      custom_fields: r.customFields.length ? r.customFields : null, total_income: calc.totalIncome, total_penalties: calc.totalPenalties,
      source_file: sourceFile, run_id: null, created_by: ctx.userId, updated_at: now(),
    }))
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await ctx.admin.from("payroll_income_records").upsert(payload.slice(i, i + 500), { onConflict: "tenant_id,month_key,rider_id,company_name" })
      if (error) return failure(error, "Import failed")
    }
    const updated = duplicateRiderIds.length
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "income_import", entityType: "payroll_income_records",
      newValues: { month, companyName, imported: clean.length - updated, updated, sourceFile, totalIncome: summary.totalIncome } })
    revalidatePath(PATH)
    return { success: true, data: { preview: false, imported: clean.length - updated, updated, ...summary } }
  } catch (e) { return failure(e, "Import failed") }
}

export async function deleteIncomeRecords(input: unknown): Promise<EngineResult<{ deleted: number }>> {
  try {
    const p = z.union([z.object({ id: z.string().uuid() }), z.object({ month: monthKey, companyName: z.string().trim().min(1).max(80) })]).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid request" }
    const ctx = await engineContext("update")
    let q = ctx.admin.from("payroll_income_records").delete({ count: "exact" }).eq("tenant_id", ctx.tenantId)
    q = "id" in p.data ? q.eq("id", p.data.id) : q.eq("month_key", p.data.month).eq("company_name", p.data.companyName)
    const { error, count } = await q
    if (error) return failure(error, "Delete failed")
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "income_records_deleted", entityType: "payroll_income_records", newValues: { ...p.data, deleted: count ?? 0 } })
    revalidatePath(PATH)
    return { success: true, data: { deleted: count ?? 0 } }
  } catch (e) { return failure(e, "Delete failed") }
}

// ─── Expense categories & monthly expenses ────────────────────────────────

const allocation = z.enum(["per_driver", "shared", "assigned"])

export async function saveExpenseCategory(input: unknown): Promise<EngineResult<{ id: string }>> {
  try {
    const p = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(120), nameAr: optText(120), defaultAmount: money.default(0),
      allocationType: allocation, description: optText(500), isActive: z.boolean().default(true) }).safeParse(input)
    if (!p.success) return { success: false, error: p.error.issues.map(i => i.message).join("; ") }
    const v = p.data
    const ctx = await engineContext(v.id ? "update" : "create")
    const row = { name: v.name, name_ar: v.nameAr, default_amount: v.defaultAmount, allocation_type: v.allocationType, description: v.description, is_active: v.isActive, updated_at: now() }
    const res = v.id
      ? await ctx.admin.from("payroll_expense_categories").update(row).eq("id", v.id).eq("tenant_id", ctx.tenantId).select("id").single()
      : await ctx.admin.from("payroll_expense_categories").insert({ ...row, tenant_id: ctx.tenantId }).select("id").single()
    if (res.error) return failure(res.error.code === "23505" ? new Error("A category with this name already exists") : res.error, "Could not save category")
    if (v.id) await ctx.admin.from("payroll_monthly_expenses").update({ category_name: v.name }).eq("category_id", v.id).eq("tenant_id", ctx.tenantId)
    revalidatePath(PATH)
    return { success: true, data: { id: res.data.id as string } }
  } catch (e) { return failure(e, "Could not save category") }
}

export async function deleteExpenseCategory(id: unknown): Promise<EngineResult> {
  try {
    const p = z.string().uuid().safeParse(id)
    if (!p.success) return { success: false, error: "Invalid request" }
    const ctx = await engineContext("update")
    const used = await ctx.admin.from("payroll_monthly_expenses").select("id", { count: "exact", head: true }).eq("category_id", p.data).eq("tenant_id", ctx.tenantId)
    if ((used.count ?? 0) > 0) return { success: false, error: `This category is used by ${used.count} monthly expense(s). Deactivate it instead.` }
    const { error } = await ctx.admin.from("payroll_expense_categories").delete().eq("id", p.data).eq("tenant_id", ctx.tenantId)
    if (error) return failure(error, "Delete failed")
    revalidatePath(PATH)
    return { success: true, data: undefined }
  } catch (e) { return failure(e, "Delete failed") }
}

const expenseSchema = z.object({
  id: z.string().uuid().optional(), month: monthKey, categoryId: z.string().uuid(), amount: money.refine(n => n > 0, "Amount must be greater than zero"),
  allocationType: allocation.optional(), assignedRiderId: optText(64), notes: optText(500),
})

export async function saveMonthlyExpense(input: unknown): Promise<EngineResult<{ id: string }>> {
  try {
    const p = expenseSchema.safeParse(input)
    if (!p.success) return { success: false, error: p.error.issues.map(i => i.message).join("; ") }
    const v = p.data
    const ctx = await engineContext(v.id ? "update" : "create")
    const cat = await ctx.admin.from("payroll_expense_categories").select("name,allocation_type").eq("id", v.categoryId).eq("tenant_id", ctx.tenantId).single()
    if (cat.error) return { success: false, error: "Expense category not found" }
    const allocationType = v.allocationType ?? cat.data.allocation_type
    if (allocationType === "assigned" && !v.assignedRiderId) return { success: false, error: "Choose the rider this expense is assigned to" }
    const driver = allocationType === "assigned" && v.assignedRiderId ? (await loadDriversByRider(ctx, [v.assignedRiderId])).get(v.assignedRiderId) : undefined
    const row = { month_key: v.month, category_id: v.categoryId, category_name: cat.data.name, amount: v.amount, allocation_type: allocationType,
      assigned_rider_id: allocationType === "assigned" ? v.assignedRiderId : null, assigned_driver_id: driver?.id ?? null, notes: v.notes, updated_at: now() }
    const res = v.id
      ? await ctx.admin.from("payroll_monthly_expenses").update(row).eq("id", v.id).eq("tenant_id", ctx.tenantId).select("id").single()
      : await ctx.admin.from("payroll_monthly_expenses").insert({ ...row, tenant_id: ctx.tenantId, created_by: ctx.userId }).select("id").single()
    if (res.error) return failure(res.error, "Could not save expense")
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: v.id ? "payroll_expense_updated" : "payroll_expense_created", entityType: "payroll_monthly_expenses", entityId: res.data.id as string, newValues: row })
    revalidatePath(PATH)
    return { success: true, data: { id: res.data.id as string } }
  } catch (e) { return failure(e, "Could not save expense") }
}

export async function deleteMonthlyExpense(id: unknown): Promise<EngineResult> {
  try {
    const p = z.string().uuid().safeParse(id)
    if (!p.success) return { success: false, error: "Invalid request" }
    const ctx = await engineContext("update")
    const { error, count } = await ctx.admin.from("payroll_monthly_expenses").delete({ count: "exact" }).eq("id", p.data).eq("tenant_id", ctx.tenantId)
    if (error) return failure(error, "Delete failed")
    if (!count) return { success: false, error: "Expense not found" }
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "payroll_expense_deleted", entityType: "payroll_monthly_expenses", entityId: p.data })
    revalidatePath(PATH)
    return { success: true, data: undefined }
  } catch (e) { return failure(e, "Delete failed") }
}

/** Add every active category's default amount as this month's expense (skips categories already entered). */
export async function applyDefaultExpenses(input: unknown): Promise<EngineResult<{ added: number }>> {
  try {
    const p = z.object({ month: monthKey }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid month" }
    const ctx = await engineContext("create")
    const [cats, existing] = await Promise.all([
      ctx.admin.from("payroll_expense_categories").select("id,name,default_amount,allocation_type").eq("tenant_id", ctx.tenantId).eq("is_active", true),
      ctx.admin.from("payroll_monthly_expenses").select("category_id").eq("tenant_id", ctx.tenantId).eq("month_key", p.data.month),
    ])
    if (cats.error || existing.error) return failure(cats.error ?? existing.error, "Could not apply defaults")
    const have = new Set((existing.data ?? []).map(e => e.category_id))
    const rows = (cats.data ?? []).filter(c => !have.has(c.id) && num(c.default_amount) > 0 && c.allocation_type !== "assigned").map(c => ({
      tenant_id: ctx.tenantId, month_key: p.data.month, category_id: c.id, category_name: c.name, amount: num(c.default_amount), allocation_type: c.allocation_type, created_by: ctx.userId,
    }))
    if (rows.length) {
      const { error } = await ctx.admin.from("payroll_monthly_expenses").insert(rows)
      if (error) return failure(error, "Could not apply defaults")
    }
    revalidatePath(PATH)
    return { success: true, data: { added: rows.length } }
  } catch (e) { return failure(e, "Could not apply defaults") }
}

export async function saveDriverCount(input: unknown): Promise<EngineResult> {
  try {
    const p = z.object({ month: monthKey, count: z.coerce.number().int().min(0).max(100000), notes: optText(300) }).safeParse(input)
    if (!p.success) return { success: false, error: "Enter a whole number of drivers" }
    const ctx = await engineContext("update")
    const { error } = await ctx.admin.from("payroll_driver_counts").upsert({ tenant_id: ctx.tenantId, month_key: p.data.month, active_driver_count: p.data.count,
      notes: p.data.notes, confirmed_by: ctx.userId, updated_at: now() }, { onConflict: "tenant_id,month_key" })
    if (error) return failure(error, "Could not save driver count")
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "payroll_driver_count_confirmed", entityType: "payroll_driver_counts", newValues: p.data })
    revalidatePath(PATH)
    return { success: true, data: undefined }
  } catch (e) { return failure(e, "Could not save driver count") }
}

export async function saveCustomIncomeField(input: unknown): Promise<EngineResult<{ id: string }>> {
  try {
    const p = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(120), nameAr: optText(120), fieldType: z.enum(["add", "deduct"]),
      description: optText(500), isActive: z.boolean().default(true) }).safeParse(input)
    if (!p.success) return { success: false, error: p.error.issues.map(i => i.message).join("; ") }
    const v = p.data
    const ctx = await engineContext(v.id ? "update" : "create")
    const row = { name: v.name, name_ar: v.nameAr, field_type: v.fieldType, description: v.description, is_active: v.isActive, updated_at: now() }
    const res = v.id
      ? await ctx.admin.from("payroll_custom_income_fields").update(row).eq("id", v.id).eq("tenant_id", ctx.tenantId).select("id").single()
      : await ctx.admin.from("payroll_custom_income_fields").insert({ ...row, tenant_id: ctx.tenantId }).select("id").single()
    if (res.error) return failure(res.error.code === "23505" ? new Error("A field with this name already exists") : res.error, "Could not save field")
    revalidatePath(PATH)
    return { success: true, data: { id: res.data.id as string } }
  } catch (e) { return failure(e, "Could not save field") }
}
