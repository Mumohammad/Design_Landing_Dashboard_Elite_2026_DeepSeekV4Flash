"use server"

// Read models for the platform payroll screens (tenant-scoped, payroll:read).
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import type { DriverResultCalc, RawDriverData } from "../salary-engine"
import { engineContext, failure, type EngineResult } from "./data"
import { loadTenantLogoDataUrl } from "@/lib/branding/logo"
import type { PayslipCompany } from "@/components/payroll-engine/payslip-print"

const num = (v: unknown) => Number(v ?? 0) || 0

export interface RunSummary {
  id: string; payrollMonth: string; monthKey: string; platformName: string; fileName: string; ruleSetName: string; status: "draft" | "approved" | "cancelled"
  totalDrivers: number; totalGross: number; totalPenalties: number; totalNet: number; totalVariance: number; totalTraffic: number
  version: number; createdAt: string; approvedAt: string | null; cancelReason: string | null; journalEntryId: string | null; openExceptions: number
}

function summary(r: Record<string, unknown>, openExceptions = 0): RunSummary {
  return { id: String(r.id), payrollMonth: String(r.payroll_month), monthKey: String(r.month_key), platformName: String(r.platform_name), fileName: String(r.file_name),
    ruleSetName: String(r.rule_set_name), status: r.status as RunSummary["status"], totalDrivers: num(r.total_drivers), totalGross: num(r.total_gross),
    totalPenalties: num(r.total_penalties), totalNet: num(r.total_net), totalVariance: num(r.total_variance), totalTraffic: num(r.total_traffic),
    version: num(r.version), createdAt: String(r.created_at), approvedAt: (r.approved_at as string) ?? null, cancelReason: (r.cancel_reason as string) ?? null,
    journalEntryId: (r.journal_entry_id as string) ?? null, openExceptions }
}

export async function listPayrollRuns(): Promise<EngineResult<{ runs: RunSummary[]; platforms: Array<{ id: string; name: string }> }>> {
  try {
    const ctx = await engineContext("read")
    const [runs, exc, platforms] = await Promise.all([
      ctx.admin.from("payroll_engine_runs").select("*").eq("tenant_id", ctx.tenantId).order("month_key", { ascending: false }).order("created_at", { ascending: false }).limit(200),
      ctx.admin.from("payroll_engine_exceptions").select("run_id").eq("tenant_id", ctx.tenantId).eq("review_status", "open").in("severity", ["warning", "error"]).limit(20000),
      ctx.admin.from("delivery_platforms").select("id,name_en,name_ar").eq("tenant_id", ctx.tenantId).is("deleted_at", null).order("sort_order"),
    ])
    if (runs.error) throw new Error(runs.error.message)
    const open = new Map<string, number>()
    for (const e of exc.data ?? []) open.set(e.run_id, (open.get(e.run_id) ?? 0) + 1)
    return { success: true, data: {
      runs: (runs.data ?? []).map(r => summary(r, open.get(r.id) ?? 0)),
      platforms: (platforms.data ?? []).map(p => ({ id: p.id, name: p.name_en || p.name_ar })),
    } }
  } catch (e) { return failure(e, "Could not load payroll runs") }
}

export interface RunDetail {
  run: RunSummary & { fileSize: number | null; ruleSnapshot: Record<string, unknown>; banking: unknown; parserWarnings: string[]; installmentChanges: unknown[]; recalculatedAt: string | null }
  results: Array<{ id: string; riderId: string; driverId: string | null; driverName: string; result: DriverResultCalc; raw: RawDriverData; bank: { beneficiaryName?: string; iban?: string; bankName?: string } | null }>
  exceptions: Array<{ id: string; code: string; severity: "info" | "warning" | "error"; source: string; rowRef: string | null; message: string; suggestedAction: string | null; reviewStatus: string }>
}

export async function getPayrollRunDetail(id: unknown): Promise<EngineResult<RunDetail>> {
  try {
    const runId = z.string().uuid().parse(id)
    const ctx = await engineContext("read")
    const [run, results, exceptions] = await Promise.all([
      ctx.admin.from("payroll_engine_runs").select("*").eq("id", runId).eq("tenant_id", ctx.tenantId).single(),
      ctx.admin.from("payroll_engine_results").select("id,rider_id,driver_id,driver_name,result,raw_input,bank").eq("run_id", runId).eq("tenant_id", ctx.tenantId).order("rider_id"),
      ctx.admin.from("payroll_engine_exceptions").select("*").eq("run_id", runId).eq("tenant_id", ctx.tenantId).order("created_at"),
    ])
    if (run.error) return { success: false, error: "Payroll run not found" }
    if (results.error) throw new Error(results.error.message)
    const r = run.data
    return { success: true, data: {
      run: { ...summary(r, (exceptions.data ?? []).filter(e => e.review_status === "open" && e.severity !== "info").length), fileSize: r.file_size, ruleSnapshot: r.rule_snapshot,
        banking: r.banking, parserWarnings: r.parser_warnings ?? [], installmentChanges: r.installment_changes ?? [], recalculatedAt: r.recalculated_at },
      results: (results.data ?? []).map(x => ({ id: x.id, riderId: x.rider_id, driverId: x.driver_id, driverName: x.driver_name, result: x.result, raw: x.raw_input, bank: x.bank })),
      exceptions: (exceptions.data ?? []).map(e => ({ id: e.id, code: e.code, severity: e.severity, source: e.source, rowRef: e.row_ref, message: e.message, suggestedAction: e.suggested_action, reviewStatus: e.review_status })),
    } }
  } catch (e) { return failure(e, "Could not load the payroll run") }
}

export interface AdjustmentsData {
  items: Array<{ id: string; kind: "bonus" | "deduction"; name: string; nameAr: string | null; amount: number; description: string | null; status: string; applyToAll: boolean; targetRiderIds: string[]; installmentEnabled: boolean; installmentMonthlyAmount: number; installmentTotalPaid: number; installmentStatus: string }>
  adjustments: Array<{ id: string; riderId: string; driverName: string | null; title: string; titleAr: string | null; amount: number; adjustmentType: "bonus" | "deduction"; category: string; status: string; notes: string | null; createdAt: string }>
  traffic: Array<{ id: string; riderId: string; driverName: string | null; ticketDate: string; ticketNumber: string | null; violationType: string; amount: number; status: string; notes: string | null; installmentEnabled: boolean; installmentMonthlyAmount: number; installmentTotalPaid: number; installmentStatus: string }>
  riders: Array<{ riderId: string; name: string }>
}

export async function getPayrollAdjustments(): Promise<EngineResult<AdjustmentsData>> {
  try {
    const ctx = await engineContext("read")
    const [items, adj, traffic, drivers, lastResults] = await Promise.all([
      ctx.admin.from("payroll_engine_items").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }),
      ctx.admin.from("payroll_engine_adjustments").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(2000),
      ctx.admin.from("payroll_engine_traffic_fines").select("*").eq("tenant_id", ctx.tenantId).order("ticket_date", { ascending: false }).limit(2000),
      ctx.admin.from("drivers").select("rider_id,full_name_en,full_name_ar").eq("tenant_id", ctx.tenantId).is("deleted_at", null).not("rider_id", "is", null).limit(5000),
      ctx.admin.from("payroll_engine_results").select("rider_id,driver_name").eq("tenant_id", ctx.tenantId).limit(5000),
    ])
    for (const x of [items, adj, traffic]) if (x.error) throw new Error(x.error.message)
    const riders = new Map<string, string>()
    for (const r of lastResults.data ?? []) if (r.rider_id) riders.set(r.rider_id, r.driver_name || "")
    for (const d of drivers.data ?? []) if (d.rider_id) riders.set(d.rider_id, d.full_name_en || d.full_name_ar || riders.get(d.rider_id) || "")
    return { success: true, data: {
      items: (items.data ?? []).map(i => ({ id: i.id, kind: i.kind, name: i.name, nameAr: i.name_ar, amount: num(i.amount), description: i.description, status: i.status,
        applyToAll: i.apply_to_all, targetRiderIds: i.target_rider_ids ?? [], installmentEnabled: i.installment_enabled, installmentMonthlyAmount: num(i.installment_monthly_amount),
        installmentTotalPaid: num(i.installment_total_paid), installmentStatus: i.installment_status })),
      adjustments: (adj.data ?? []).map(a => ({ id: a.id, riderId: a.rider_id, driverName: riders.get(a.rider_id) ?? null, title: a.title, titleAr: a.title_ar, amount: num(a.amount),
        adjustmentType: a.adjustment_type, category: a.category, status: a.status, notes: a.notes, createdAt: a.created_at })),
      traffic: (traffic.data ?? []).map(t => ({ id: t.id, riderId: t.rider_id, driverName: riders.get(t.rider_id) ?? null, ticketDate: t.ticket_date, ticketNumber: t.ticket_number,
        violationType: t.violation_type, amount: num(t.amount), status: t.status, notes: t.notes, installmentEnabled: t.installment_enabled,
        installmentMonthlyAmount: num(t.installment_monthly_amount), installmentTotalPaid: num(t.installment_total_paid), installmentStatus: t.installment_status })),
      riders: [...riders.entries()].map(([riderId, name]) => ({ riderId, name })).sort((a, b) => a.riderId.localeCompare(b.riderId)),
    } }
  } catch (e) { return failure(e, "Could not load adjustments") }
}

/** Active postable accounts the CALLER can see (accounting RLS) for the journal draft dialog. */
export async function listJournalAccounts(): Promise<EngineResult<Array<{ id: string; code: string; name: string; type: string }>>> {
  try {
    await engineContext("approve")
    const client = await createClient()
    const { data, error } = await client.from("chart_of_accounts").select("id,account_code,name_ar,name_en,account_type").eq("is_active", true).is("deleted_at", null)
      .in("account_type", ["expense", "liability"]).order("account_code").limit(1000)
    if (error) return failure(error, "Could not load accounts")
    return { success: true, data: (data ?? []).map(a => ({ id: a.id, code: a.account_code, name: a.name_en || a.name_ar, type: a.account_type })) }
  } catch (e) { return failure(e, "Could not load accounts") }
}

/** Company details and logo printed on payslips (Settings → Company). */
export async function getPayslipCompany(): Promise<EngineResult<PayslipCompany>> {
  try {
    const ctx = await engineContext("read")
    const t = await ctx.admin.from("tenants").select("name_ar,name_en,legal_name,cr_number,vat_number,address,district,city,postal_code,building_number,phone,email,logo_url").eq("id", ctx.tenantId).single()
    if (t.error) return { success: false, error: "Could not load company details" }
    const d = t.data
    const logoDataUrl = await loadTenantLogoDataUrl(ctx.admin, ctx.tenantId, d.logo_url).catch(() => null)
    return { success: true, data: { nameAr: d.name_ar, nameEn: d.name_en, legalName: d.legal_name, crNumber: d.cr_number, vatNumber: d.vat_number, address: d.address, district: d.district,
      city: d.city, postalCode: d.postal_code, buildingNumber: d.building_number, phone: d.phone, email: d.email, logoDataUrl } }
  } catch (e) { return failure(e, "Could not load company details") }
}

export interface DriverPayslip { resultId: string; runId: string; monthKey: string; platformName: string; status: "draft" | "approved"; riderId: string; result: DriverResultCalc; bank: { beneficiaryName?: string; iban?: string; bankName?: string } | null }

/** Every non-cancelled platform payroll result linked to one driver profile, newest month first. */
export async function getDriverPayslips(driverId: unknown): Promise<EngineResult<DriverPayslip[]>> {
  try {
    const id = z.string().uuid().parse(driverId)
    const ctx = await engineContext("read")
    const rows = await ctx.admin.from("payroll_engine_results").select("id,run_id,rider_id,result,bank,payroll_engine_runs!inner(month_key,platform_name,status)")
      .eq("tenant_id", ctx.tenantId).eq("driver_id", id).neq("payroll_engine_runs.status", "cancelled").limit(120)
    if (rows.error) throw new Error(rows.error.message)
    const out = (rows.data ?? []).map(r => {
      const run = (Array.isArray(r.payroll_engine_runs) ? r.payroll_engine_runs[0] : r.payroll_engine_runs) as { month_key: string; platform_name: string; status: "draft" | "approved" }
      return { resultId: r.id as string, runId: r.run_id as string, monthKey: run.month_key, platformName: run.platform_name, status: run.status, riderId: r.rider_id as string, result: r.result as DriverResultCalc, bank: r.bank as DriverPayslip["bank"] }
    }).sort((a, b) => b.monthKey.localeCompare(a.monthKey) || a.platformName.localeCompare(b.platformName))
    return { success: true, data: out }
  } catch (e) { return failure(e, "Could not load payslips") }
}
