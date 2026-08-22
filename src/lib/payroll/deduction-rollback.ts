// src/lib/payroll/deduction-rollback.ts
// v2.0 M4 — cancelPayrollPeriod + M3 rollbackPayrollDeductions.
// When a payroll period is cancelled, all applied deductions MUST be rolled back:
// 1. Violation deduction ledger rows → status back to 'pending'
// 2. Parent violations → status back to 'resolved', deduction_applied = false
// 3. Payroll advances → status back to 'approved' (not 'repaid')
// 4. Audit log entries for each rollback

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/auth/authorization"

export interface RollbackResult {
  rolledBackCount: number
  violationRefs: string[]
  advanceCount: number
}

// ── M3: Roll back violation deductions applied to a payroll period ──
export async function rollbackPayrollDeductions(
  payrollPeriodId: string,
  cancelledBy: string,
  reason: string
): Promise<RollbackResult> {
  const admin = createAdminClient()

  // 1. Find all ledger rows applied to this payroll period
  const { data: ledgerRows, error: fetchError } = await admin
    .from("violation_deduction_ledger")
    .select("id, violation_id, deduction_amount")
    .eq("payroll_period_id", payrollPeriodId)
    .eq("status", "applied")

  if (fetchError || !ledgerRows?.length) {
    return { rolledBackCount: 0, violationRefs: [], advanceCount: 0 }
  }

  const ledgerIds = ledgerRows.map((r: { id: string }) => r.id)
  const violationIds = ledgerRows.map((r: { violation_id: string }) => r.violation_id)

  // 2. Roll back ledger rows to 'pending'
  const { error: ledgerError } = await admin
    .from("violation_deduction_ledger")
    .update({
      status: "pending",
      applied_at: null,
      applied_by: null,
      payroll_period_id: null,
      rollback_reason: reason,
      rolled_back_by: cancelledBy,
      rolled_back_at: new Date().toISOString(),
    })
    .in("id", ledgerIds)

  if (ledgerError) {
    throw new Error(`Ledger rollback failed: ${ledgerError.message}`)
  }

  // 3. Roll back parent violation status
  const { data: violations, error: violError } = await admin
    .from("violations")
    .update({
      deduction_applied: false,
      deduction_applied_at: null,
      deduction_applied_by: null,
      payroll_period_id: null,
      status: "resolved", // back to pre-payment state
    })
    .in("id", violationIds)
    .select("violation_ref")

  if (violError) {
    throw new Error(`Violation rollback failed: ${violError.message}`)
  }

  // 4. Resolve the tenant_id for audit entries by looking up the parent
  // payroll record (rollbackPayrollDeductions is a utility that receives
  // only the payroll period ID, not the full user context).
  const { data: payrollRow } = await admin
    .from("driver_payroll_periods")
    .select("tenant_id")
    .eq("id", payrollPeriodId)
    .maybeSingle<{ tenant_id: string }>()
  const tenantId = payrollRow?.tenant_id ?? null

  // 5. Write audit entries for each rolled-back violation
  const auditEntries = ledgerRows.map((row: { violation_id: string; deduction_amount: number }) => ({
    tenant_id: tenantId,
    actor_id: cancelledBy,
    module: "violations",
    entity_type: "violation_deduction",
    entity_id: row.violation_id,
    action: "deduction_rolled_back",
    new_values: { reason, payroll_period_id: payrollPeriodId },
    old_values: { status: "applied", payroll_period_id: payrollPeriodId },
  }))
  if (auditEntries.length > 0) {
    await admin.from("audit_log").insert(auditEntries)
  }

  return {
    rolledBackCount: ledgerIds.length,
    violationRefs: violations?.map((v: { violation_ref: string }) => v.violation_ref) ?? [],
    advanceCount: 0,
  }
}

// ── M4: Cancel a payroll period (calls M3 rollback) ──
export async function cancelPayrollPeriod(
  driverPayrollId: string,
  reason: string
): Promise<{
  rolledBackCount: number
  violationRefs: string[]
  advanceCount: number
}> {
  const admin = createAdminClient()
  const currentUser = await getCurrentUser()
  if (!currentUser) {
    throw new Error("No authenticated user")
  }
  const cancelledBy = currentUser.authUserId

  // 1. Get the payroll period record — MUST verify tenant ownership
  // (service-role client bypasses RLS, so we enforce tenant_id explicitly).
  const { data: payroll, error: payrollError } = await admin
    .from("driver_payroll_periods")
    .select("*")
    .eq("id", driverPayrollId)
    .eq("tenant_id", currentUser.tenantId)
    .single()

  if (payrollError || !payroll) {
    throw new Error("PAY001") // payroll not found or belongs to another tenant
  }
  if (payroll.status === "paid") {
    throw new Error("PAY005") // payroll already paid — cannot cancel
  }
  // Idempotency guard: if already cancelled, return early without
  // creating duplicate rollback/audit rows.
  if (payroll.status === "cancelled") {
    return { rolledBackCount: 0, violationRefs: [], advanceCount: 0 }
  }

  // 2. Roll back violation deductions (M3)
  const rollbackResult = await rollbackPayrollDeductions(driverPayrollId, cancelledBy, reason)

  // 3. Roll back advance repayments
  const periodKey = `${payroll.period_year}-${String(payroll.period_month).padStart(2, "0")}`
  const { data: advances, error: advError } = await admin
    .from("payroll_advances")
    .update({ status: "approved", payroll_period_id: null })
    .eq("driver_id", payroll.driver_id)
    .eq("repayment_month", periodKey)
    .eq("status", "repaid")
    .select("id")

  if (advError) {
    console.error("Advance rollback error:", advError.message)
  }
  const advanceCount = advances?.length ?? 0

  // 4. Update payroll status to cancelled
  const { error: updateError } = await admin
    .from("driver_payroll_periods")
    .update({
      status: "cancelled",
      cancel_reason: reason,
      cancelled_by: cancelledBy,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", driverPayrollId)

  if (updateError) {
    throw new Error(`Payroll cancel failed: ${updateError.message}`)
  }

  // 5. Write audit entry
  await admin.from("audit_log").insert({
    tenant_id: payroll.tenant_id,
    actor_id: cancelledBy,
    module: "payroll",
    entity_type: "driver_payroll_period",
    entity_id: driverPayrollId,
    action: "payroll_cancelled",
    new_values: { reason, rolledback_violations: rollbackResult.violationRefs, rolledback_advances: advanceCount },
    old_values: { status: payroll.status },
  })

  return {
    rolledBackCount: rollbackResult.rolledBackCount,
    violationRefs: rollbackResult.violationRefs,
    advanceCount,
  }
}
