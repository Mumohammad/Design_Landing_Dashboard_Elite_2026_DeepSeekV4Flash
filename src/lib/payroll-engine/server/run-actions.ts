"use server"

// Platform payroll runs: import → calculate (vendored engine) → review →
// approve (installments advance) → optional accounting journal draft.
import { createHash, randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitImports, rateLimitPayroll } from "@/lib/auth/rate-limit"
import { parseWorkbook } from "../excel-parser"
import { computePayrollRun, type ComputedRun, type PayrollException } from "../run"
import type { RawDriverData } from "../salary-engine"
import { payslipBreakdown } from "../payslip"
import { MONTH_KEY_RE, monthEndDate, monthLabel, toHalalas } from "../month"
import { engineContext, failure, loadActiveRules, loadDriversByRider, loadSources, type DriverLink, type EngineContext, type EngineResult } from "./data"

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024
const BUCKET = "payroll-workbooks"

const importSchema = z.object({
  path: z.string().min(10).max(300),
  fileName: z.string().trim().min(1).max(200),
  monthKey: z.string().regex(MONTH_KEY_RE),
  platformName: z.string().trim().min(1).max(80),
  platformId: z.string().uuid().nullable().optional(),
})

function revalidate(runId?: string) {
  revalidatePath("/payroll/platform")
  if (runId) revalidatePath(`/payroll/platform/runs/${runId}`)
  revalidatePath("/payroll/platform/income-expenses")
}

/** Adapter-level notes added on top of the upstream exceptions. */
function adapterExceptions(raw: readonly RawDriverData[], drivers: Map<string, DriverLink>, computed?: ComputedRun): PayrollException[] {
  const out: PayrollException[] = []
  for (const { result } of computed?.riders ?? []) {
    const slip = payslipBreakdown(result)
    if (slip.capFloorAdjustment < -0.005) out.push({ code: "UNRECOVERED_DEDUCTIONS", severity: "warning", source: "calculation", rowRef: result.riderId,
      message: `Rider ${result.riderId}: deductions exceed pay by SAR ${(-slip.capFloorAdjustment).toFixed(2)} (net limited by zero / salary floor / deduction cap); this amount is not recovered`,
      suggestedAction: "Recover the balance next month with a manual deduction, or confirm it is written off" })
  }
  for (const r of raw) {
    if (!drivers.has(r.riderId)) out.push({ code: "UNLINKED_RIDER", severity: "info", source: "driver_link", rowRef: r.riderId,
      message: `Rider ${r.riderId}${r.name ? ` (${r.name})` : ""} is not linked to a driver profile (Drivers → Rider ID)`, suggestedAction: "Add the platform rider ID to the driver profile, then recalculate" })
  }
  const first = raw[0]
  if (first && (first.carDeduction > 0 || first.tgaDeduction > 0)) {
    out.push({ code: "CONTRACT_LEVEL_DEDUCTION", severity: "warning", source: "parser", rowRef: null,
      message: `WR sheet car deduction SAR ${first.carDeduction.toFixed(2)} and TGA SAR ${first.tgaDeduction.toFixed(2)} are contract totals and are applied to every rider (upstream rule)`,
      suggestedAction: "Confirm this is intended, or disable “Car deduction” / “TGA deduction” in the rules and use per-rider adjustments" })
  }
  return out
}

function runPayload(computed: ComputedRun, drivers: Map<string, DriverLink>, bankByRider: Record<string, { beneficiaryName: string; iban: string; bankName: string }>, fallbackBank: { beneficiaryName: string; iban: string; bankName: string; source: string } | null, rawInputs: readonly RawDriverData[]) {
  const rawByRider = new Map(rawInputs.map(r => [r.riderId, r]))
  const results = computed.riders.map(({ result }) => {
    const link = drivers.get(result.riderId)
    const wb = bankByRider[result.riderId]
    return {
      rider_id: result.riderId,
      driver_id: link?.id ?? null,
      driver_name: result.driverName || link?.name || `Rider ${result.riderId}`,
      result,
      raw_input: rawByRider.get(result.riderId),
      bank: wb ?? (link?.iban ? { beneficiaryName: link.name, iban: link.iban, bankName: link.bankName ?? "" } : fallbackBank && fallbackBank.source !== "none" ? fallbackBank : null),
    }
  })
  const income = computed.incomeRows.map(i => ({ ...i, driverId: drivers.get(i.riderId)?.id ?? null, driverName: results.find(r => r.rider_id === i.riderId)?.driver_name ?? "" }))
  return { results, income }
}

export async function importPayrollWorkbook(input: unknown): Promise<EngineResult<{ runId: string; drivers: number; totalNet: number; warnings: number }>> {
  try {
    const parsed = importSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues.map(i => i.message).join("; ") }
    const ctx = await engineContext("create")
    if (!(await rateLimitImports(ctx.userId)).success) return { success: false, error: "Rate limit exceeded. Try again later." }
    const { path, fileName, monthKey, platformName, platformId } = parsed.data
    if (!path.startsWith(`${ctx.tenantId}/`) || !/\.(xlsx|xls)$/i.test(path)) return { success: false, error: "Invalid workbook location." }
    // Archived workbooks are only kept when a run references them; any failed
    // import removes its upload so storage never accumulates orphan files.
    let saved = false
    try {
    const file = await ctx.admin.storage.from(BUCKET).download(path)
    if (file.error || !file.data) return { success: false, error: "Uploaded workbook not found. Upload it again." }
    const bytes = new Uint8Array(await file.data.arrayBuffer())
    if (bytes.byteLength === 0) return { success: false, error: "The uploaded file is empty" }
    if (bytes.byteLength > MAX_WORKBOOK_BYTES) return { success: false, error: "Workbooks are limited to 10 MB." }

    let workbook
    try { workbook = parseWorkbook(bytes) } catch (e) { return { success: false, error: `Workbook parsing failed: ${e instanceof Error ? e.message : "unknown error"}` } }
    if (workbook.drivers.length === 0) return { success: false, error: "The RLVL sheet contains no rider rows with a rider_id. Check the workbook before importing." }

    const [rules, sources, drivers] = await Promise.all([loadActiveRules(ctx), loadSources(ctx), loadDriversByRider(ctx, workbook.drivers.map(d => d.riderId))])
    const payrollMonth = monthLabel(monthKey)
    const rawInputs = workbook.drivers.map(d => structuredClone(d))
    const computed = computePayrollRun({ rawDrivers: workbook.drivers, parserWarnings: workbook.warnings, rules: rules.snapshot, ruleSetName: rules.name, payrollMonth, sources, advanceInstallments: false })
    const exceptions = [...computed.exceptions, ...adapterExceptions(rawInputs, drivers, computed)]
    const { results, income } = runPayload(computed, drivers, workbook.driverBanking, workbook.banking, rawInputs)

    const { data: runId, error } = await ctx.admin.rpc("payroll_engine_save_run", {
      p_tenant: ctx.tenantId, p_actor: ctx.userId,
      p_run: { payroll_month: payrollMonth, month_key: monthKey, platform_name: platformName, platform_id: platformId ?? null, file_name: fileName, file_path: path,
        file_sha256: createHash("sha256").update(bytes).digest("hex"), file_size: bytes.byteLength, rule_set_id: rules.id, rule_set_name: rules.name,
        rule_snapshot: rules.snapshot, banking: workbook.banking, parser_warnings: workbook.warnings, totals: computed.totals },
      p_results: results, p_exceptions: exceptions, p_income: income,
    })
    if (error) return failure(error, "Could not save the payroll run")
    saved = true
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "platform_payroll_imported", entityType: "payroll_engine_runs", entityId: runId as string,
      newValues: { fileName, monthKey, platformName, drivers: results.length, totalNet: computed.totals.totalNet, ruleSet: rules.name } })
    revalidate(runId as string)
    return { success: true, data: { runId: runId as string, drivers: results.length, totalNet: computed.totals.totalNet, warnings: exceptions.length } }
    } finally {
      if (!saved) await ctx.admin.storage.from(BUCKET).remove([path]).catch(() => undefined)
    }
  } catch (e) { return failure(e, "Import failed") }
}

/** Storage path for a new workbook upload (client uploads directly with RLS). */
export async function preparePayrollWorkbookUpload(fileName: unknown): Promise<EngineResult<{ path: string }>> {
  try {
    const name = z.string().trim().min(1).max(200).regex(/\.(xlsx|xls)$/i, "Upload an Excel workbook (.xlsx)").safeParse(fileName)
    if (!name.success) return { success: false, error: name.error.issues[0]?.message ?? "Invalid file" }
    const ctx = await engineContext("create")
    const ext = name.data.toLowerCase().endsWith(".xls") ? "xls" : "xlsx"
    return { success: true, data: { path: `${ctx.tenantId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}` } }
  } catch (e) { return failure(e, "Upload unavailable") }
}

async function loadDraftInputs(ctx: EngineContext, runId: string) {
  const run = await ctx.admin.from("payroll_engine_runs").select("id,status,version,month_key,payroll_month,platform_name").eq("id", runId).eq("tenant_id", ctx.tenantId).single()
  if (run.error) throw new Error("Payroll run not found")
  const rows = await ctx.admin.from("payroll_engine_results").select("rider_id,raw_input,result,bank").eq("run_id", runId).eq("tenant_id", ctx.tenantId).order("id")
  if (rows.error) throw new Error(rows.error.message)
  return { run: run.data, rows: rows.data ?? [] }
}

/** Recalculate a draft run from its stored workbook inputs with the CURRENT rules and adjustments. */
export async function recalculatePayrollRun(input: unknown): Promise<EngineResult<{ totalNet: number }>> {
  try {
    const p = z.object({ runId: z.string().uuid(), version: z.number().int().positive() }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid request" }
    const ctx = await engineContext("update")
    if (!(await rateLimitPayroll(ctx.userId)).success) return { success: false, error: "Rate limit exceeded. Try again later." }
    const { run, rows } = await loadDraftInputs(ctx, p.data.runId)
    if (run.status !== "draft") return { success: false, error: "Only draft payroll runs can be recalculated" }
    const rawInputs = rows.map(r => r.raw_input as RawDriverData)
    const [rules, sources, drivers] = await Promise.all([loadActiveRules(ctx), loadSources(ctx), loadDriversByRider(ctx, rawInputs.map(r => r.riderId))])
    const warnings = await ctx.admin.from("payroll_engine_runs").select("parser_warnings").eq("id", run.id).single()
    const parserWarnings = (warnings.data?.parser_warnings as string[] | null) ?? []
    const computed = computePayrollRun({ rawDrivers: rawInputs.map(r => structuredClone(r)), parserWarnings, rules: rules.snapshot, ruleSetName: rules.name, payrollMonth: run.payroll_month, sources, advanceInstallments: false })
    const bankByRider = Object.fromEntries(rows.filter(r => r.bank).map(r => [r.rider_id, r.bank as { beneficiaryName: string; iban: string; bankName: string }]))
    const { results, income } = runPayload(computed, drivers, bankByRider, null, rawInputs)
    const { error } = await ctx.admin.rpc("payroll_engine_save_run", {
      p_tenant: ctx.tenantId, p_actor: ctx.userId,
      p_run: { payroll_month: run.payroll_month, month_key: run.month_key, platform_name: run.platform_name, rule_set_id: rules.id, rule_set_name: rules.name, rule_snapshot: rules.snapshot, totals: computed.totals },
      p_results: results, p_exceptions: [...computed.exceptions, ...adapterExceptions(rawInputs, drivers, computed)], p_income: income, p_run_id: run.id, p_expected_version: p.data.version,
    })
    if (error) return failure(error, "Recalculation failed")
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "platform_payroll_recalculated", entityType: "payroll_engine_runs", entityId: run.id, newValues: { totalNet: computed.totals.totalNet, ruleSet: rules.name } })
    revalidate(run.id)
    return { success: true, data: { totalNet: computed.totals.totalNet } }
  } catch (e) { return failure(e, "Recalculation failed") }
}

/**
 * Approve a draft run. The stored results must still equal a fresh
 * calculation from current rules and adjustments (otherwise recalculate
 * first), so the installment progress applied here matches the payslips.
 */
export async function approvePayrollRun(input: unknown): Promise<EngineResult<{ advanced: number; settled: number }>> {
  try {
    const p = z.object({ runId: z.string().uuid(), version: z.number().int().positive() }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid request" }
    const ctx = await engineContext("approve")
    const { run, rows } = await loadDraftInputs(ctx, p.data.runId)
    if (run.status !== "draft") return { success: false, error: "Only draft payroll runs can be approved" }
    const rawInputs = rows.map(r => r.raw_input as RawDriverData)
    const [rules, sources] = await Promise.all([loadActiveRules(ctx), loadSources(ctx)])
    const fresh = computePayrollRun({ rawDrivers: rawInputs.map(r => structuredClone(r)), rules: rules.snapshot, ruleSetName: rules.name, payrollMonth: run.payroll_month, sources, advanceInstallments: true })
    const stored = new Map(rows.map(r => [r.rider_id, r.result as { finalNetSalary: number; grossSalaryBeforePenalties: number }]))
    const stale = fresh.riders.some(({ result }) => {
      const s = stored.get(result.riderId)
      return !s || s.finalNetSalary !== result.finalNetSalary || s.grossSalaryBeforePenalties !== result.grossSalaryBeforePenalties
    })
    if (stale) return { success: false, error: "Rules or adjustments changed since this run was calculated. Recalculate, review, then approve." }
    const byRider = new Map(fresh.riders.map(({ result }) => [result.riderId, result]))
    const changes = [
      ...fresh.installments.customDeductions.map(c => ({ table: "items", ...c })),
      ...fresh.installments.trafficViolations.map(c => ({ table: "traffic", ...c })),
      // One-off records included in this payroll are settled so they are not applied again next month.
      ...sources.trafficViolations.filter(v => !v.installmentEnabled && (byRider.get(v.riderId)?.trafficViolationsDeduction ?? 0) > 0).map(v => ({ table: "traffic_status", id: v.id })),
      ...sources.manualAdjustments.filter(a => byRider.has(a.riderId)).map(a => ({ table: "adjustment_status", id: a.id })),
    ]
    const { data, error } = await ctx.admin.rpc("payroll_engine_approve_run", { p_tenant: ctx.tenantId, p_actor: ctx.userId, p_run_id: run.id, p_expected_version: p.data.version, p_changes: changes })
    if (error) return failure(error, "Approval failed")
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "platform_payroll_approved", entityType: "payroll_engine_runs", entityId: run.id, newValues: data as Record<string, unknown> })
    revalidate(run.id)
    const out = data as { advanced: number; settled: number }
    return { success: true, data: { advanced: Number(out.advanced) || 0, settled: Number(out.settled) || 0 } }
  } catch (e) { return failure(e, "Approval failed") }
}

export async function cancelPayrollRun(input: unknown): Promise<EngineResult> {
  try {
    const p = z.object({ runId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).safeParse(input)
    if (!p.success) return { success: false, error: "A cancellation reason (3–500 characters) is required" }
    const ctx = await engineContext("update")
    const { error } = await ctx.admin.rpc("payroll_engine_cancel_run", { p_tenant: ctx.tenantId, p_actor: ctx.userId, p_run_id: p.data.runId, p_reason: p.data.reason })
    if (error) return failure(error, "Cancellation failed")
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "platform_payroll_cancelled", entityType: "payroll_engine_runs", entityId: p.data.runId, newValues: { reason: p.data.reason } })
    revalidate(p.data.runId)
    return { success: true, data: undefined }
  } catch (e) { return failure(e, "Cancellation failed") }
}

export async function updatePayrollException(input: unknown): Promise<EngineResult> {
  try {
    const p = z.object({ id: z.string().uuid(), status: z.enum(["open", "resolved", "ignored"]) }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid request" }
    const ctx = await engineContext("update")
    const { data, error } = await ctx.admin.from("payroll_engine_exceptions").update({ review_status: p.data.status }).eq("id", p.data.id).eq("tenant_id", ctx.tenantId).select("run_id").single()
    if (error) return failure(error, "Update failed")
    revalidate(data.run_id)
    return { success: true, data: undefined }
  } catch (e) { return failure(e, "Update failed") }
}

/** Signed download link for the archived original workbook. */
export async function payrollWorkbookDownloadUrl(runId: unknown): Promise<EngineResult<{ url: string }>> {
  try {
    const id = z.string().uuid().parse(runId)
    const ctx = await engineContext("read")
    const { data } = await ctx.admin.from("payroll_engine_runs").select("file_path,file_name").eq("id", id).eq("tenant_id", ctx.tenantId).single()
    if (!data?.file_path) return { success: false, error: "No archived workbook for this run" }
    const signed = await ctx.admin.storage.from(BUCKET).createSignedUrl(data.file_path, 120, { download: data.file_name })
    if (signed.error) return failure(signed.error, "Download unavailable")
    return { success: true, data: { url: signed.data.signedUrl } }
  } catch (e) { return failure(e, "Download unavailable") }
}

/**
 * Create an accounting journal DRAFT for an approved run (Dr salaries expense /
 * Cr salaries payable, net pay rounded to halalas). Uses the caller's own
 * accounting permission through save_journal_draft; accountants post it.
 */
export async function createPayrollJournalDraft(input: unknown): Promise<EngineResult<{ journalId: string }>> {
  try {
    const p = z.object({ runId: z.string().uuid(), expenseAccountId: z.string().uuid(), payableAccountId: z.string().uuid() }).safeParse(input)
    if (!p.success) return { success: false, error: "Choose the expense and payable accounts" }
    if (p.data.expenseAccountId === p.data.payableAccountId) return { success: false, error: "Expense and payable accounts must differ" }
    const ctx = await engineContext("approve")
    const run = await ctx.admin.from("payroll_engine_runs").select("id,status,month_key,payroll_month,platform_name,total_net,total_drivers,journal_entry_id").eq("id", p.data.runId).eq("tenant_id", ctx.tenantId).single()
    if (run.error) return { success: false, error: "Payroll run not found" }
    if (run.data.status !== "approved") return { success: false, error: "Approve the payroll run first" }
    if (run.data.journal_entry_id) return { success: false, error: "A journal draft already exists for this run" }
    const rows = await ctx.admin.from("payroll_engine_results").select("final_net_salary").eq("run_id", run.data.id).eq("tenant_id", ctx.tenantId)
    if (rows.error) return failure(rows.error, "Could not read results")
    // Sum of per-rider payable amounts (each rounded to halalas) = what is actually paid.
    const amount = toHalalas((rows.data ?? []).reduce((s, r) => s + toHalalas(Number(r.final_net_salary)), 0))
    if (amount <= 0) return { success: false, error: "Net payroll is zero — nothing to post" }
    const client = await createClient()
    const description = `Rider payroll ${run.data.payroll_month} — ${run.data.platform_name} (${run.data.total_drivers} riders)`
    const { data, error } = await client.rpc("save_journal_draft", { p_input: {
      entry_date: monthEndDate(run.data.month_key), description_ar: `رواتب المناديب ${run.data.month_key} — ${run.data.platform_name}`, description_en: description,
      lines: [
        { account_id: p.data.expenseAccountId, debit: amount, credit: 0, description },
        { account_id: p.data.payableAccountId, debit: 0, credit: amount, description },
      ] } })
    if (error) return failure(error, "Could not create the journal draft")
    const journalId = (data as { id: string }).id
    const link = await ctx.admin.from("payroll_engine_runs").update({ journal_entry_id: journalId, updated_at: new Date().toISOString() }).eq("id", run.data.id).eq("tenant_id", ctx.tenantId).is("journal_entry_id", null)
    if (link.error) return failure(link.error, "Journal created but could not be linked")
    await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: "platform_payroll_journal_draft", entityType: "payroll_engine_runs", entityId: run.data.id, newValues: { journalId, amount } })
    revalidate(run.data.id)
    revalidatePath("/accounting")
    return { success: true, data: { journalId } }
  } catch (e) { return failure(e, "Could not create the journal draft") }
}
