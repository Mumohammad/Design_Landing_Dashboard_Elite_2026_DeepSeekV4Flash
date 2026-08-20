"use server"

// Payroll Server Actions — the UI-facing boundary for the payroll workflow.
//
// - calculatePayrollForPeriod  — payroll:create → runs the canonical M4
//   formula for every active driver in the tenant for one period
// - cancelPayrollPeriodAction   — payroll:update → cancels one period row and
//   rolls back all applied deductions (M3/M4 rollback chain)
// - generateWpsFile             — payroll:export → builds the SAMA WPS SIF
//   file content for all approved/paid records of one period
//
// All three enforce authorization server-side with requirePermission() and
// write immutable audit_log entries (ADR-007).

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { calculateDriverPayroll } from "./calculate"
import { cancelPayrollPeriod } from "./deduction-rollback"
import { generateWPSSIF, generateSIFFileName, type WPSPaymentRecord } from "./wps-generator"
import { rateLimitPayroll } from "@/lib/auth/rate-limit"
import { moduleLogger, logPerformance } from "@/lib/logger"
import { emit } from "@/lib/webhooks/events"

type ActionResult = { success: boolean; error?: string }

const log = moduleLogger("payroll")

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

type WpsPeriodRow = {
  period_year: number
  period_month: number
  status: string
  net_payroll: number | null
  base_amount: number | null
  total_deductions: number | null
  working_days_actual: number | null
  paid_at: string | null
  driver: {
    iqama_number: string | null
    full_name_ar: string | null
    iban: string | null
    housing_allowance: number | null
  } | null
}

/**
 * Run the canonical payroll calculation for every active/on-leave driver of
 * the current tenant for one period. Idempotent per (tenant, driver, period)
 * thanks to the UNIQUE constraint + upsert inside calculateDriverPayroll().
 */
export async function calculatePayrollForPeriod(
  periodYear: number,
  periodMonth: number
): Promise<ActionResult & { calculated?: number }> {
  try {
    await requirePermission("payroll", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitPayroll(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const t0 = Date.now()
    log.info({ userId: currentUser.id, tenantId: currentUser.tenantId, periodYear, periodMonth }, "calculatePayrollForPeriod started")

    const admin = createAdminClient()
    const { data: drivers } = await admin
      .from("drivers")
      .select("id")
      .eq("tenant_id", currentUser.tenantId)
      .in("status", ["active", "on_leave"])
      .is("deleted_at", null)

    if (!drivers?.length) {
      return { success: false, error: "No active drivers found for this tenant." }
    }

    let calculated = 0
    const errors: string[] = []
    for (const d of drivers as { id: string }[]) {
      try {
        await calculateDriverPayroll({ driverId: d.id, periodYear, periodMonth })
        calculated++
      } catch (e) {
        errors.push(`${d.id}: ${errorMessage(e)}`)
      }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "payroll",
      action: "payroll_run_calculated",
      entityType: "payroll_run",
      newValues: {
        period_year: periodYear,
        period_month: periodMonth,
        drivers_calculated: calculated,
        drivers_failed: errors.length,
      },
    })

    emit("payroll.calculated", currentUser.tenantId, {
      id: currentUser.tenantId,
      period: `${periodYear}-${String(periodMonth).padStart(2, "0")}`,
      totalAmount: 0,
      driverCount: calculated,
    })

    revalidatePath("/payroll")
    return {
      success: true,
      calculated,
      error:
        errors.length > 0
          ? `${errors.length} driver(s) failed (e.g. ${errors[0].split(": ")[1] ?? errors[0]}).`
          : undefined,
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Cancel a single payroll period row and roll back every applied deduction
 * (violations → pending, advances → approved). payroll:update only.
 */
export async function cancelPayrollPeriodAction(
  periodId: string,
  reason: string
): Promise<ActionResult> {
  try {
    await requirePermission("payroll", "update")
    // Note: cancelPayrollPeriod delegates to a module function; rate-limit at the action level.
    // We need the user but cancelPayrollPeriodAction doesn't call getCurrentUser() — add it.
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitPayroll(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }
    if (!reason.trim()) {
      return { success: false, error: "A cancellation reason is required." }
    }
    await cancelPayrollPeriod(periodId, reason.trim())

    emit("payroll.cancelled", currentUser.tenantId, {
      id: periodId,
      period: "",
    })

    revalidatePath("/payroll")
    return {
      success: true,
      error: undefined,
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Generate the SAMA WPS SIF file for all approved/paid records of one period.
 * payroll:export only. The client downloads `content` as `filename`.
 */
export async function generateWpsFile(
  periodYear: number,
  periodMonth: number
): Promise<ActionResult & { content?: string; filename?: string }> {
  try {
    await requirePermission("payroll", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitPayroll(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()

    const { data: periods } = await admin
      .from("driver_payroll_periods")
      .select(
        "period_year,period_month,status,net_payroll,base_amount,total_deductions,working_days_actual,paid_at,driver:drivers(iqama_number,full_name_ar,iban,housing_allowance)"
      )
      .eq("tenant_id", currentUser.tenantId)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .in("status", ["approved", "paid"])
      .is("deleted_at", null)

    const rows = (periods as unknown as WpsPeriodRow[]) ?? []
    if (rows.length === 0) {
      return {
        success: false,
        error: "No approved/paid payroll records found for this period.",
      }
    }

    // Company profile: MOL reference + WPS IBAN from system_settings.
    const { data: settings } = await admin
      .from("system_settings")
      .select("key,value")
      .eq("tenant_id", currentUser.tenantId)
      .in("key", ["company.mol_reference", "company.wps_iban"])
      .is("deleted_at", null)

    const settingMap = new Map(
      ((settings as { key: string; value: string }[] | null) ?? []).map((s) => [s.key, s.value])
    )
    const molReference = settingMap.get("company.mol_reference")
    const wpsIban = settingMap.get("company.wps_iban")
    if (!molReference || !wpsIban) {
      return {
        success: false,
        error:
          "Company WPS MOL reference and IBAN must be configured (system settings 'company.mol_reference' and 'company.wps_iban').",
      }
    }

    const payments: WPSPaymentRecord[] = rows.map((r) => ({
      driver: {
        iqama_number: r.driver?.iqama_number ?? "0000000000",
        full_name_ar: r.driver?.full_name_ar ?? "N/A",
      },
      iban: r.driver?.iban ?? "",
      net_payroll: Number(r.net_payroll ?? 0),
      base_amount: Number(r.base_amount ?? 0),
      housing_allowance: Number(r.driver?.housing_allowance ?? 0),
      other_allowances: 0,
      total_deductions: Number(r.total_deductions ?? 0),
      paid_at: r.paid_at ?? new Date().toISOString(),
      working_days_actual: Number(r.working_days_actual ?? 0),
    }))

    const periodLabel = `${periodYear}-${String(periodMonth).padStart(2, "0")}`
    const content = generateWPSSIF(payments, { mol_reference: molReference, iban: wpsIban }, periodLabel)
    const filename = generateSIFFileName(periodLabel)

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "payroll",
      action: "wps_file_generated",
      entityType: "payroll_run",
      newValues: { period: periodLabel, records: payments.length, filename },
    })

    emit("payroll.exported", currentUser.tenantId, {
      id: currentUser.tenantId,
      period: periodLabel,
      format: "WPS_SIF",
      recordCount: payments.length,
    })

    return { success: true, content, filename }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
