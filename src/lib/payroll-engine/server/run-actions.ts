"use server"

// Platform payroll runs: import → calculate (vendored engine) → review →
// approve (installments advance) → optional accounting journal draft.
import { createHash, randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { rateLimitImports, rateLimitPayroll } from "@/lib/auth/rate-limit"
import { parseWorkbook } from "../excel-parser"
import { computePayrollRun } from "../run"
import { payslipBreakdown } from "../payslip"
import type { RawDriverData } from "../salary-engine"
import { MONTH_KEY_RE, monthLabel } from "../month"
import { engineContext, failure, loadActiveRules, loadDriversByRider, loadSources, payrollSourceVersion, saveReviewedPayroll, attestPayrollCalculation, type EngineResult } from "./data"
import { adapterExceptions, loadDraftInputs, recalculateDraftRun, runPayload } from "./recalc"

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

export async function importPayrollWorkbook(input: unknown): Promise<EngineResult<{ runId: string; drivers: number; totalNet: number; warnings: number }>> {
  try {
    const parsed = importSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: parsed.error.issues.map(i => i.message).join("; ") }
    const ctx = await engineContext("create")
    if (!(await rateLimitImports(ctx.userId)).success) return { success: false, error: "Rate limit exceeded. Try again later." }
    const { path, fileName, monthKey, platformName, platformId } = parsed.data
    if (!path.startsWith(`${ctx.tenantId}/`) || !/\.(xlsx|xls)$/i.test(path)) return { success: false, error: "Invalid workbook location." }
    // Failed/unknown imports retain immutable uploads for safe retry/review.
    const file = await ctx.admin.storage.from(BUCKET).download(path)
    if (file.error || !file.data) return { success: false, error: "Uploaded workbook not found. Upload it again." }
    const bytes = new Uint8Array(await file.data.arrayBuffer())
    if (bytes.byteLength === 0) return { success: false, error: "The uploaded file is empty" }
    if (bytes.byteLength > MAX_WORKBOOK_BYTES) return { success: false, error: "Workbooks are limited to 10 MB." }

    let workbook
    try { workbook = parseWorkbook(bytes) } catch (e) { return { success: false, error: `Workbook parsing failed: ${e instanceof Error ? e.message : "unknown error"}` } }
    if (workbook.drivers.length === 0) return { success: false, error: "The RLVL sheet contains no rider rows with a rider_id. Check the workbook before importing." }

    const sourceVersion = await payrollSourceVersion()
    const [rules, sources, drivers] = await Promise.all([loadActiveRules(ctx), loadSources(ctx), loadDriversByRider(ctx, workbook.drivers.map(d => d.riderId), platformName)])
    const payrollMonth = monthLabel(monthKey)
    const rawInputs = workbook.drivers.map(d => structuredClone(d))
    const computed = computePayrollRun({ rawDrivers: workbook.drivers, parserWarnings: workbook.warnings, rules: rules.snapshot, ruleSetName: rules.name, payrollMonth, sources, advanceInstallments: false })
    const exceptions = [...computed.exceptions, ...adapterExceptions(rawInputs, drivers, computed)]
    const { results, income } = runPayload(computed, drivers, workbook.driverBanking, workbook.banking, rawInputs)

    const { data: runId, error } = await saveReviewedPayroll(ctx, {
      p_source_version: sourceVersion,
      p_run: { payroll_month: payrollMonth, month_key: monthKey, platform_name: platformName, platform_id: platformId ?? null, file_name: fileName, file_path: path,
        file_sha256: createHash("sha256").update(bytes).digest("hex"), file_size: bytes.byteLength, rule_set_id: rules.id, rule_set_name: rules.name,
        rule_snapshot: rules.snapshot, banking: workbook.banking, parser_warnings: workbook.warnings, totals: computed.totals },
      p_results: results, p_exceptions: exceptions, p_income: income,
    })
    if (error) return failure(error, "Could not save the payroll run")
    if (!z.string().uuid().safeParse(runId).success) return { success: false, error: "Import outcome could not be confirmed. Reload before retrying." }
    revalidate(runId as string)
    return { success: true, data: { runId: runId as string, drivers: results.length, totalNet: computed.totals.totalNet, warnings: exceptions.length } }
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

/** Recalculate a draft run from its stored workbook inputs with the CURRENT rules and adjustments. */
export async function recalculatePayrollRun(input: unknown): Promise<EngineResult<{ totalNet: number }>> {
  try {
    const p = z.object({ runId: z.string().uuid(), version: z.number().int().positive() }).safeParse(input)
    if (!p.success) return { success: false, error: "Invalid request" }
    const ctx = await engineContext("update")
    if (!(await rateLimitPayroll(ctx.userId)).success) return { success: false, error: "Rate limit exceeded. Try again later." }
    const out = await recalculateDraftRun(ctx, p.data.runId, p.data.version)
    if (!out.success) return out
    revalidate(p.data.runId)
    return out
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
    const caller = await createClient()
    const recovered = await caller.rpc("read_my_platform_payroll_approval", { p_run_id: p.data.runId, p_expected_version: p.data.version })
    if (recovered.error) return failure(recovered.error, "Approval recovery unavailable")
    if (recovered.data !== null) {
      const receipt = z.object({ run_id: z.literal(p.data.runId), advanced: z.number().int().nonnegative(), settled: z.number().int().nonnegative(), replayed: z.literal(true) }).safeParse(recovered.data)
      if (!receipt.success) return { success: false, error: "PAYENG_UNAVAILABLE" }
      revalidate(p.data.runId)
      return { success: true, data: { advanced: receipt.data.advanced, settled: receipt.data.settled } }
    }
    const sourceVersion = await payrollSourceVersion()
    const { run, rows } = await loadDraftInputs(ctx, p.data.runId)
    if (run.status !== "draft") return { success: false, error: "Only draft payroll runs can be approved" }
    const rawInputs = rows.map(r => r.raw_input as RawDriverData)
    const [rules, sources] = await Promise.all([loadActiveRules(ctx), loadSources(ctx)])
    const fresh = computePayrollRun({ rawDrivers: rawInputs.map(r => structuredClone(r)), rules: rules.snapshot, ruleSetName: rules.name, payrollMonth: run.payroll_month, sources, advanceInstallments: true })
    if (fresh.riders.some(({ result }) => payslipBreakdown(result).capFloorAdjustment < -0.005)) return { success: false, error: "PAYENG_UNRECOVERED" }
    const stored = new Map(rows.map(r => [r.rider_id, r.result]))
    const stale = fresh.riders.some(({ result }) => {
      const s = stored.get(result.riderId)
      return !s || !isDeepStrictEqual(s, JSON.parse(JSON.stringify(result)))
    })
    if (stale) return { success: false, error: "PAYENG011" }
    const byRider = new Map(fresh.riders.map(({ result }) => [result.riderId, result]))
    const changes = [
      ...fresh.installments.customDeductions.map(c => ({ table: "items", ...c })),
      ...fresh.installments.trafficViolations.map(c => ({ table: "traffic", ...c })),
      // One-off records included in this payroll are settled so they are not applied again next month.
      ...sources.trafficViolations.filter(v => !v.installmentEnabled && (byRider.get(v.riderId)?.trafficViolationsDeduction ?? 0) > 0).map(v => ({ table: "traffic_status", id: v.id })),
      ...sources.manualAdjustments.filter(a => byRider.has(a.riderId)).map(a => ({ table: "adjustment_status", id: a.id })),
    ]
    await attestPayrollCalculation(ctx, "approve", { changes, source: sourceVersion, run_id: run.id, expected_version: p.data.version, results: fresh.riders.map(r => r.result).sort((a, b) => a.riderId < b.riderId ? -1 : a.riderId > b.riderId ? 1 : 0) }, sourceVersion)
    const { data, error } = await caller.rpc("approve_my_platform_payroll", { p_run_id: run.id, p_expected_version: p.data.version, p_changes: changes, p_source_version: sourceVersion })
    if (error) return failure(error, "Approval failed")
    revalidate(run.id)
    const out = z.object({ advanced: z.number().int().nonnegative(), settled: z.number().int().nonnegative() }).safeParse(data)
    if (!out.success) return { success: false, error: "Approval outcome could not be confirmed. Reload before retrying." }
    return { success: true, data: out.data }
  } catch (e) { return failure(e, "Approval failed") }
}

export async function cancelPayrollRun(input: unknown): Promise<EngineResult> {
  try {
    const p = z.object({ runId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).safeParse(input)
    if (!p.success) return { success: false, error: "A cancellation reason (3–500 characters) is required" }
    await engineContext("update")
    const caller = await createClient()
    const { error } = await caller.rpc("cancel_my_platform_payroll", { p_run_id: p.data.runId, p_reason: p.data.reason })
    if (error) return failure(error, "Cancellation failed")
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
    await engineContext("approve")
    const caller = await createClient()
    const { data, error } = await caller.rpc("create_my_platform_payroll_journal", { p_run_id: p.data.runId, p_expense_account: p.data.expenseAccountId, p_payable_account: p.data.payableAccountId })
    if (error) return failure(error, "Could not create the journal draft")
    const result = z.object({ id: z.string().uuid() }).safeParse(data)
    if (!result.success) return { success: false, error: "Journal outcome could not be confirmed. Reload before retrying." }
    const journalId = result.data.id
    revalidate(p.data.runId)
    revalidatePath("/accounting")
    return { success: true, data: { journalId } }
  } catch (e) { return failure(e, "Could not create the journal draft") }
}
