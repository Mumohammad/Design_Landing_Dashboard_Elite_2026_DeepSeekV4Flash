import "server-only"

// Shared draft-run recalculation. Used by the explicit "Recalculate" action
// and automatically after bonuses, deductions, fines or rules change, so draft
// payslips always reflect the latest inputs without a manual step.
import { writeAuditLog } from "@/lib/auth/sessions"
import { computePayrollRun, type ComputedRun, type PayrollException } from "../run"
import type { RawDriverData } from "../salary-engine"
import { payslipBreakdown } from "../payslip"
import { failure, loadActiveRules, loadDriversByRider, loadSources, type DriverLink, type EngineContext, type EngineResult } from "./data"

/** Adapter-level notes added on top of the upstream exceptions. */
export function adapterExceptions(raw: readonly RawDriverData[], drivers: Map<string, DriverLink>, computed?: ComputedRun): PayrollException[] {
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

export function runPayload(computed: ComputedRun, drivers: Map<string, DriverLink>, bankByRider: Record<string, { beneficiaryName: string; iban: string; bankName: string }>, fallbackBank: { beneficiaryName: string; iban: string; bankName: string; source: string } | null, rawInputs: readonly RawDriverData[]) {
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

export async function loadDraftInputs(ctx: EngineContext, runId: string) {
  const run = await ctx.admin.from("payroll_engine_runs").select("id,status,version,month_key,payroll_month,platform_name").eq("id", runId).eq("tenant_id", ctx.tenantId).single()
  if (run.error) throw new Error("Payroll run not found")
  const rows = await ctx.admin.from("payroll_engine_results").select("rider_id,raw_input,result,bank").eq("run_id", runId).eq("tenant_id", ctx.tenantId).order("id")
  if (rows.error) throw new Error(rows.error.message)
  return { run: run.data, rows: rows.data ?? [] }
}

/** Recalculate one draft run from its stored workbook inputs with the CURRENT rules and adjustments. */
export async function recalculateDraftRun(ctx: EngineContext, runId: string, expectedVersion?: number, automatic = false): Promise<EngineResult<{ totalNet: number }>> {
  const { run, rows } = await loadDraftInputs(ctx, runId)
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
    p_results: results, p_exceptions: [...computed.exceptions, ...adapterExceptions(rawInputs, drivers, computed)], p_income: income, p_run_id: run.id, p_expected_version: expectedVersion ?? run.version,
  })
  if (error) return failure(error, "Recalculation failed")
  await writeAuditLog({ tenantId: ctx.tenantId, actorId: ctx.userId, module: "payroll", action: automatic ? "platform_payroll_auto_recalculated" : "platform_payroll_recalculated", entityType: "payroll_engine_runs", entityId: run.id, newValues: { totalNet: computed.totals.totalNet, ruleSet: rules.name } })
  return { success: true, data: { totalNet: computed.totals.totalNet } }
}

const MAX_AUTO_RUNS = 24

/**
 * Recalculate every draft run affected by a payroll input change. riderIds
 * limits the refresh to runs containing those riders; null refreshes all
 * draft runs (rules or apply-to-all items). Failures never undo the saved
 * input: the run keeps its stale flag and approval still blocks until it is
 * recalculated.
 */
export async function refreshDraftRuns(ctx: EngineContext, riderIds: readonly string[] | null): Promise<{ refreshed: string[]; failed: number }> {
  let runIds: string[]
  if (riderIds && riderIds.length) {
    const hits = await ctx.admin.from("payroll_engine_results").select("run_id,payroll_engine_runs!inner(status)").eq("tenant_id", ctx.tenantId).in("rider_id", [...new Set(riderIds)]).eq("payroll_engine_runs.status", "draft").limit(500)
    if (hits.error) return { refreshed: [], failed: 1 }
    runIds = [...new Set((hits.data ?? []).map(h => h.run_id as string))]
  } else if (riderIds === null) {
    const runs = await ctx.admin.from("payroll_engine_runs").select("id").eq("tenant_id", ctx.tenantId).eq("status", "draft").order("created_at", { ascending: false }).limit(MAX_AUTO_RUNS)
    if (runs.error) return { refreshed: [], failed: 1 }
    runIds = (runs.data ?? []).map(r => r.id as string)
  } else return { refreshed: [], failed: 0 }
  const refreshed: string[] = []
  let failed = 0
  for (const id of runIds.slice(0, MAX_AUTO_RUNS)) {
    try {
      const out = await recalculateDraftRun(ctx, id, undefined, true)
      if (out.success) refreshed.push(id); else failed++
    } catch { failed++ }
  }
  return { refreshed, failed }
}
