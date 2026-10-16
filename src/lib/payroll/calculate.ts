// src/lib/payroll/calculate.ts
// v2.0 M4 — Payroll orchestration: loads all inputs from Supabase tables
// (driver + rule + attendance + orders + violation deductions + advances + COD)
// then calls the canonical calculateDriverPayrollFormula() and persists the result.

import { createAdminClient } from "@/lib/supabase/admin"
import { calculateDriverPayrollFormula, type PayrollCalculationResult } from "./calculation-engine"

export interface CalculatePayrollInput {
  driverId: string
  periodYear: number
  periodMonth: number
}

export interface CalculatePayrollOutput extends PayrollCalculationResult {
  period: {
    driver_id: string
    period_year: number
    period_month: number
    status: "calculated"
  }
}

function getNextMonthStart(year: number, month: number): string {
  const next = new Date(Date.UTC(year, month, 1))
  return next.toISOString().split("T")[0]
}

export async function calculateDriverPayroll(
  input: CalculatePayrollInput
): Promise<CalculatePayrollOutput> {
  const admin = createAdminClient()
  const { driverId, periodYear, periodMonth } = input

  if (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100 || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) throw new Error("Invalid payroll period")

  // ── 1. LOAD DRIVER + PAYROLL RULE ─────────────────────────────────
  const { data: driver, error: driverError } = await admin
    .from("drivers")
    .select("id, category, nationality_code, tenant_id, payroll_rule_id")
    .eq("id", driverId)
    .is("deleted_at", null)
    .single()
  if (driverError || !driver) throw new Error("DRV003")

  const { data: rule, error: ruleError } = await admin
    .from("driver_payroll_rules")
    .select("*")
    .eq("driver_id", driverId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .lt("effective_date", getNextMonthStart(periodYear, periodMonth))
    .order("effective_date", { ascending: false })
    .limit(1)
    .single()
  if (ruleError || !rule) throw new Error("DRV005")

  // ── 2. LOAD ATTENDANCE SUMMARY (must be locked) ───────────────────
  const { data: attendancePeriod, error: attendancePeriodError } = await admin
    .from("attendance_periods")
    .select("status")
    .eq("tenant_id", driver.tenant_id)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth)
    .is("deleted_at", null)
    .single()
  if (attendancePeriodError || attendancePeriod?.status !== "locked") throw new Error("PAY001")

  const { data: attSummary, error: attSummaryError } = await admin
    .from("driver_attendance_summary")
    .select("working_days_actual, days_absent_unexcused")
    .eq("driver_id", driverId)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth)
    .is("deleted_at", null)
    .single()

  if (attSummaryError || !attSummary) throw new Error("Attendance summary unavailable")

  const working_days_target = rule.working_days_target ?? 26
  const working_days_actual = attSummary?.working_days_actual ?? 0
  const daily_rate = ((rule.base_salary ?? rule.package_amount ?? 0) as number) / working_days_target

  // ── 3. LOAD ORDERS DATA ───────────────────────────────────────────
  const { data: ordersData, error: ordersDataError } = await admin
    .from("monthly_driver_orders")
    .select("total_delivered")
    .eq("driver_id", driverId)
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth)
    .is("deleted_at", null)
  if (ordersDataError) throw new Error("Orders unavailable")
  const orders_achieved = ordersData?.reduce((s: number, r: { total_delivered: number }) => s + (r.total_delivered ?? 0), 0) ?? 0

  // ── 4. LOAD APPROVED DEDUCTIONS FROM ALL MODULES ─────────────────
  const periodKey = `${periodYear}-${String(periodMonth).padStart(2, "0")}`

  // Violation deductions (pending = ready to apply this period)
  const { data: violationLedger, error: violationLedgerError } = await admin
    .from("violation_deduction_ledger")
    .select("id, deduction_amount, violation_id, violations(violation_ref)")
    .eq("driver_id", driverId)
    .eq("deduction_month", periodKey)
    .eq("status", "pending")
    .is("deleted_at", null)

  // Advances due this period
  const { data: advances, error: advancesError } = await admin
    .from("payroll_advances")
    .select("id, amount")
    .eq("driver_id", driverId)
    .eq("repayment_month", periodKey)
    .eq("status", "approved")
    .is("deleted_at", null)

  // COD deductions (unresolved shortfalls flagged for deduction)
  const monthStart = `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`
  const { data: codSessions, error: codSessionsError } = await admin
    .from("driver_cod_sessions")
    .select("id, cod_variance, cod_collected, cod_submitted")
    .eq("driver_id", driverId)
    .gte("session_date", monthStart)
    .lt("session_date", getNextMonthStart(periodYear, periodMonth))
    .eq("deduction_created", true)
    .eq("status", "pending")
    .is("deleted_at", null)

  if (violationLedgerError || advancesError || codSessionsError) throw new Error("Payroll deductions unavailable")

  // ── 5. BUILD DEDUCTIONS ARRAY ─────────────────────────────────────
  const deductions = [
    ...(violationLedger ?? []).map((r: { id: string; deduction_amount: number; violation_id: string; violations: { violation_ref: string }[] | null }) => ({
      source: "violation",
      amount: r.deduction_amount,
      reason: `مخالفة ${r.violations?.[0]?.violation_ref ?? r.violation_id}`,
      source_module: "violations",
      source_reference: r.violations?.[0]?.violation_ref ?? null,
      status: "approved" as const,
    })),
    ...(advances ?? []).map((r: { id: string; amount: number }) => ({
      source: "advance",
      amount: r.amount,
      reason: "سداد سلفة",
      source_module: "advances",
      source_reference: null,
      status: "approved" as const,
    })),
    ...(codSessions ?? []).filter((r: { cod_variance: number }) => r.cod_variance > 0).map((r: { id: string; cod_variance: number; cod_collected: number; cod_submitted: number }) => ({
      source: "cod",
      amount: r.cod_variance,
      reason: `نقص COD (محصَّل ${r.cod_collected} - مُسلَّم ${r.cod_submitted})`,
      source_module: "cod",
      source_reference: null,
      status: "approved" as const,
    })),
  ]

  // Absence deduction
  const absence_deduction = (attSummary?.days_absent_unexcused ?? 0) * daily_rate

  // ── 6. RUN THE CANONICAL FORMULA ──────────────────────────────────
  const result = calculateDriverPayrollFormula({
    category: driver.category,
    rule: rule as Record<string, unknown> as Parameters<typeof calculateDriverPayrollFormula>[0]["rule"],
    orders_achieved,
    working_days_actual,
    deductions,
    absence_deduction,
    nationality_code: driver.nationality_code,
  })

  // ── 7. PERSIST RESULTS ────────────────────────────────────────────
  const periodRecord = {
    tenant_id: driver.tenant_id,
    driver_id: driverId,
    period_year: periodYear,
    period_month: periodMonth,
    payroll_rule_id: rule.id,
    working_days_target,
    working_days_actual,
    target_orders_monthly: rule.target_orders ?? 450,
    orders_prorated_target: result.orders_prorated_target,
    orders_achieved,
    orders_variance: result.orders_variance,
    base_amount: result.base_amount,
    orders_bonus: result.orders_bonus,
    orders_deduction: result.orders_deduction,
    package_deduction: result.package_deduction,
    violations_deduction: (violationLedger ?? []).reduce((s: number, r: { deduction_amount: number }) => s + r.deduction_amount, 0),
    advance_deduction: (advances ?? []).reduce((s: number, r: { amount: number }) => s + r.amount, 0),
    absence_deduction,
    cod_deduction: (codSessions ?? []).filter((r: { cod_variance: number }) => r.cod_variance > 0).reduce((s: number, r: { cod_variance: number }) => s + r.cod_variance, 0),
    total_deductions: result.total_deductions,
    net_payroll: result.net_payroll,
    minimum_floor_applied: result.minimum_floor_applied,
    is_recovery: result.net_payroll < 0,
    below_minimum_wage: result.below_minimum_wage,
    status: "calculated",
    calculated_at: new Date().toISOString(),
  }

  const { error: upsertError } = await admin
    .from("driver_payroll_periods")
    .upsert(periodRecord, { onConflict: "tenant_id,driver_id,period_year,period_month" })
  if (upsertError) throw new Error(`Failed to persist payroll: ${upsertError.message}`)

  return { ...result, period: { driver_id: driverId, period_year: periodYear, period_month: periodMonth, status: "calculated" } }
}
