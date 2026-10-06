"use server"

// Server Actions for the Violations module (Module 5 — violations + deductions
// workflow). Surfaces `violations`, `violation_types`,
// `violation_deduction_ledger` + `external_fine_imports` (migration 019) —
// no schema changes.
//
//   * createViolation          — violations:create (type defaults compose)
//   * updateViolation          — violations:update (edit while pre-decision)
//   * startViolationReview     — violations:update (open → under_review)
//   * approveViolation         — violations:approve (→ resolved + pending ledger row)
//   * waiveViolation           — violations:approve (mandatory reason + waiver limit)
//   * applyLedgerDeduction     — violations:approve (pending → applied, draft/calculated period only)
//   * rollbackLedgerDeduction  — violations:approve (applied → pending, never after locked/paid)
//   * importExternalFines      — violations:create (paste import, natural-key idempotent)
//   * matchExternalFine        — violations:update (unmatched → matched)
//   * markExternalFine         — violations:update (duplicate/ignored queue hygiene)
//   * createViolationFromFine  — violations:create (matched fine → violation)
//   * upsertViolationType      — violations:update (types admin)
//   * deactivateViolationType  — violations:update (soft, never hard-delete)
//   * exportViolationsCsv      — violations:export (BOM CSV)
//   * getViolationEvidenceUrl  — violations:read (signed URL, violation-evidence bucket)
//
// Every mutation: permission gate + tenant scope from server only + zod +
// audit row + revalidation; cross-surface effects emit webhook events. The
// payroll composition rules live in module-utils (canApplyToPeriod /
// canRollbackFromPeriod) and lib/payroll/calculate.ts (pending rows with the
// matching deduction_month are consumed by the calc engine).

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitDrivers, rateLimitImports, rateLimitOrders } from "@/lib/auth/rate-limit"
import { toCsv } from "@/lib/accounting/csv-utils"
import { emit } from "@/lib/webhooks/events"
import {
  externalFineImportRowSchema,
  externalFineMarkSchema,
  externalFineMatchSchema,
  ledgerApplySchema,
  ledgerRollbackSchema,
  violationApproveSchema,
  violationCreateSchema,
  violationUpdateSchema,
  violationWaiveSchema,
  violationTypeUpsertSchema,
  type ExternalFineImportRow,
  type LedgerApplyInput,
  type LedgerRollbackInput,
  type ViolationApproveInput,
  type ViolationCreateInput,
  type ViolationUpdateInput,
  type ViolationWaiveInput,
  type ViolationTypeUpsertInput,
} from "@/types/violations-module"
import {
  canApplyToPeriod,
  canRollbackFromPeriod,
  deductionMonthKey,
  fineSourceToViolationSource,
  isViolationTransitionAllowed,
  isWaiverOverLimit,
} from "./module-utils"

export type ViolationActionResult = { success: boolean; error?: string; id?: string }
export type FineImportResult = {
  success: boolean
  error?: string
  inserted?: number
  failures?: { rowNumber: number; error: string }[]
}
export type ViolationExportResult = { success: boolean; csv?: string; error?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

/** The system_settings waiver limit key (seed 013: default 500 SAR). */
const WAIVER_LIMIT_KEY = "violations.admin_waiver_limit_sar"

async function readWaiverLimit(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string
): Promise<number | null> {
  const { data } = await admin
    .from("system_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", WAIVER_LIMIT_KEY)
    .is("deleted_at", null)
    .maybeSingle<{ value: string }>()
  if (!data?.value) return null
  const n = Number(data.value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createViolation(input: ViolationCreateInput): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = violationCreateSchema.parse(input)
    const admin = createAdminClient()

    // Driver must belong to the caller's tenant.
    const { data: driver } = await admin
      .from("drivers")
      .select("id, full_name_ar")
      .eq("id", parsed.driver_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!driver) return { success: false, error: "Driver not found in your tenant." }

    // Optional vehicle — tenant scope from the server only.
    if (parsed.vehicle_id) {
      const { data: vehicle } = await admin
        .from("vehicles")
        .select("id")
        .eq("id", parsed.vehicle_id)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .maybeSingle()
      if (!vehicle) return { success: false, error: "Vehicle not found in your tenant." }
    }

    // Optional violation type — severity + default deduction compose from it.
    let severity = parsed.severity ?? "minor"
    let deductionAmount = parsed.deduction_amount ?? null
    let typeName = ""
    if (parsed.violation_type_id) {
      const { data: type } = await admin
        .from("violation_types")
        .select("id, name_ar, severity, default_deduction")
        .eq("id", parsed.violation_type_id)
        .eq("tenant_id", currentUser.tenantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle()
      if (!type) return { success: false, error: "Violation type not found in your tenant." }
      if (!parsed.severity) severity = type.severity
      if (parsed.deduction_amount == null) deductionAmount = Number(type.default_deduction)
      typeName = type.name_ar
    }

    const { data, error } = await admin
      .from("violations")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        driver_id: parsed.driver_id,
        vehicle_id: parsed.vehicle_id ?? null,
        violation_type_id: parsed.violation_type_id ?? null,
        source: "manual",
        severity,
        incident_date: parsed.incident_date,
        incident_location: parsed.incident_location?.trim() || null,
        incident_description: parsed.incident_description,
        deduction_amount: deductionAmount ?? 0,
        status: "open",
        warning_level: 1,
        evidence_urls: parsed.evidence_paths?.length ? parsed.evidence_paths : null,
        reported_by: currentUser.authUserId,
        reported_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    const violationId = data.id

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_created",
      entityType: "violation",
      entityId: violationId,
      newValues: {
        driver_id: parsed.driver_id,
        severity,
        incident_date: parsed.incident_date,
        deduction_amount: deductionAmount ?? 0,
      },
    })

    emit("violation.created", currentUser.tenantId, {
      id: violationId,
      driverId: parsed.driver_id,
      type: typeName,
      fineAmount: deductionAmount ?? 0,
    })

    revalidatePath("/violations")
    return { success: true, id: violationId }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Edit while pre-decision (open / under_review) ───────────────────────────

export async function updateViolation(input: ViolationUpdateInput): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = violationUpdateSchema.parse(input)
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from("violations")
      .select("id, status")
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!existing) return { success: false, error: "Violation not found." }
    if (existing.status !== "open" && existing.status !== "under_review") {
      return { success: false, error: `A ${existing.status} violation can no longer be edited.` }
    }

    const { data, error } = await admin
      .from("violations")
      .update({
        vehicle_id: parsed.vehicle_id ?? null,
        violation_type_id: parsed.violation_type_id ?? null,
        severity: parsed.severity ?? "minor",
        incident_date: parsed.incident_date,
        incident_location: parsed.incident_location?.trim() || null,
        incident_description: parsed.incident_description,
        deduction_amount: parsed.deduction_amount ?? 0,
        evidence_urls: parsed.evidence_paths?.length ? parsed.evidence_paths : null,
        updated_by: currentUser.authUserId,
      })
      // Conditional claim — a concurrently decided violation loses the race.
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .in("status", ["open", "under_review"])
      .is("deleted_at", null)
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Violation was already decided." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_updated",
      entityType: "violation",
      entityId: parsed.id,
      newValues: {
        severity: parsed.severity ?? "minor",
        incident_date: parsed.incident_date,
        deduction_amount: parsed.deduction_amount ?? 0,
      },
    })

    revalidatePath("/violations")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Review workflow ─────────────────────────────────────────────────────────

/** Move an open violation into review (open → under_review). */
export async function startViolationReview(id: string): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { data: existing } = await admin
      .from("violations")
      .select("id, status")
      .eq("id", id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!existing) return { success: false, error: "Violation not found." }
    if (!isViolationTransitionAllowed(existing.status, "under_review")) {
      return { success: false, error: `A ${existing.status} violation cannot move to review.` }
    }

    const { data, error } = await admin
      .from("violations")
      .update({ status: "under_review", updated_by: currentUser.authUserId })
      .eq("id", id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "open") // conditional claim — 0 rows ⇒ already moved
      .is("deleted_at", null)
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Violation is no longer open." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_review_started",
      entityType: "violation",
      entityId: id,
      newValues: { from: "open", to: "under_review" },
    })

    revalidatePath("/violations")
    return { success: true, id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Approve a reviewed violation → status `resolved` and queue the deduction as
 * a PENDING ledger row for `deduction_month` (the payroll calc engine consumes
 * pending rows whose deduction_month matches the calculated period).
 * One violation ⇒ at most one live ledger row; the claim is the conditional
 * violation UPDATE with a compensating ledger delete when the race is lost.
 */
export async function approveViolation(input: ViolationApproveInput): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = violationApproveSchema.parse(input)
    const admin = createAdminClient()

    const { data: violation } = await admin
      .from("violations")
      .select("id, status, driver_id, deduction_amount")
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!violation) return { success: false, error: "Violation not found." }
    if (!isViolationTransitionAllowed(violation.status, "resolved")) {
      return { success: false, error: `A ${violation.status} violation cannot be approved.` }
    }
    if (!violation.driver_id) {
      return { success: false, error: "The violation has no driver — deductions require a driver." }
    }

    const amount = parsed.deduction_amount ?? Number(violation.deduction_amount ?? 0)
    if (amount <= 0) {
      return { success: false, error: "The deduction amount must be greater than zero to queue it." }
    }
    const deductionMonth = parsed.deduction_month ?? deductionMonthKey(new Date())

    // One live ledger row per violation (pending or applied blocks a re-queue).
    const { data: existingLedger } = await admin
      .from("violation_deduction_ledger")
      .select("id")
      .eq("violation_id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .in("status", ["pending", "applied"])
      .is("deleted_at", null)
      .maybeSingle()
    if (existingLedger) {
      return { success: false, error: "A deduction is already queued or applied for this violation." }
    }

    const { data: ledgerRow, error: ledgerErr } = await admin
      .from("violation_deduction_ledger")
      .insert({
        tenant_id: currentUser.tenantId,
        violation_id: parsed.id,
        driver_id: violation.driver_id,
        deduction_amount: amount,
        deduction_month: deductionMonth,
        status: "pending",
        created_by: currentUser.authUserId,
      })
      .select("id")
      .single()
    if (ledgerErr) return { success: false, error: ledgerErr.message }

    const { data: decided, error: updErr } = await admin
      .from("violations")
      .update({
        status: "resolved",
        reviewed_by: currentUser.authUserId,
        reviewed_at: new Date().toISOString(),
        review_notes: parsed.review_notes?.trim() || null,
        deduction_amount: amount,
        updated_by: currentUser.authUserId,
      })
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .in("status", ["open", "under_review"]) // conditional claim
      .is("deleted_at", null)
      .select("id")
      .single()
    if (updErr || !decided) {
      // Race lost (another reviewer decided it first) — compensate the queue insert.
      await admin.from("violation_deduction_ledger").delete().eq("id", ledgerRow.id)
      return { success: false, error: "Violation was already decided." }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_approved",
      entityType: "violation",
      entityId: parsed.id,
      newValues: {
        status: "resolved",
        deduction_amount: amount,
        deduction_month: deductionMonth,
        ledger_id: ledgerRow.id,
      },
    })

    emit("violation.resolved", currentUser.tenantId, {
      id: parsed.id,
      driverId: violation.driver_id,
      resolvedBy: currentUser.authUserId,
    })

    revalidatePath("/violations")
    revalidatePath("/payroll")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Waive a violation — reason mandatory; amounts above the tenant's
 * `violations.admin_waiver_limit_sar` setting require the GM (composes the
 * documented purpose of that setting; the seeded default is 500 SAR).
 */
export async function waiveViolation(input: ViolationWaiveInput): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = violationWaiveSchema.parse(input)
    const admin = createAdminClient()

    const { data: violation } = await admin
      .from("violations")
      .select("id, status, driver_id, deduction_amount")
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!violation) return { success: false, error: "Violation not found." }
    if (!isViolationTransitionAllowed(violation.status, "waived")) {
      return { success: false, error: `A ${violation.status} violation cannot be waived.` }
    }

    const limit = await readWaiverLimit(admin, currentUser.tenantId)
    const amount = Number(violation.deduction_amount ?? 0)
    if (isWaiverOverLimit(amount, limit) && currentUser.role !== "general_manager") {
      return {
        success: false,
        error: `Waiving ${amount.toFixed(2)} SAR exceeds the admin waiver limit (${Number(limit).toFixed(2)} SAR) — general-manager approval is required.`,
      }
    }

    const { data, error } = await admin
      .from("violations")
      .update({
        status: "waived",
        waiver_reason: parsed.waiver_reason,
        waived_by: currentUser.authUserId,
        waived_at: new Date().toISOString(),
        updated_by: currentUser.authUserId,
      })
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .in("status", ["open", "under_review"]) // conditional claim
      .is("deleted_at", null)
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Violation was already decided." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_waived",
      entityType: "violation",
      entityId: parsed.id,
      newValues: { status: "waived", waiver_reason: parsed.waiver_reason, deduction_amount: amount },
    })

    if (violation.driver_id) {
      emit("violation.resolved", currentUser.tenantId, {
        id: parsed.id,
        driverId: violation.driver_id,
        resolvedBy: currentUser.authUserId,
      })
    }

    revalidatePath("/violations")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Deduction ledger (payroll composition) ──────────────────────────────

/**
 * Apply a PENDING ledger row to a draft/calculated payroll period — never an
 * in_review/approved/paid/locked one. The parent violation flips to
 * `deduction_applied`; a lost race on either row compensates the other.
 */
export async function applyLedgerDeduction(input: LedgerApplyInput): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = ledgerApplySchema.parse(input)
    const admin = createAdminClient()

    const { data: ledger } = await admin
      .from("violation_deduction_ledger")
      .select("id, status, violation_id, driver_id")
      .eq("id", parsed.ledger_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!ledger) return { success: false, error: "Ledger row not found." }
    if (ledger.status !== "pending") {
      return { success: false, error: `Only pending deductions can be applied (this one is ${ledger.status}).` }
    }

    // The target period must be an unposted draft/calculated row of this tenant.
    const { data: period } = await admin
      .from("driver_payroll_periods")
      .select("id, status, period_year, period_month")
      .eq("id", parsed.payroll_period_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!period) return { success: false, error: "Payroll period not found in your tenant." }
    if (!canApplyToPeriod(period.status)) {
      return { success: false, error: `Deductions can only be applied to draft or calculated periods (this one is ${period.status}).` }
    }

    const { data: violation } = await admin
      .from("violations")
      .select("id, status")
      .eq("id", ledger.violation_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!violation) return { success: false, error: "Parent violation not found." }
    if (violation.status !== "resolved") {
      return { success: false, error: `The parent violation is ${violation.status} — only resolved violations apply.` }
    }

    const nowIso = new Date().toISOString()
    const { data: applied, error: applyErr } = await admin
      .from("violation_deduction_ledger")
      .update({
        status: "applied",
        applied_at: nowIso,
        applied_by: currentUser.authUserId,
        payroll_period_id: parsed.payroll_period_id,
        updated_by: currentUser.authUserId,
      })
      .eq("id", parsed.ledger_id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "pending") // conditional claim
      .is("deleted_at", null)
      .select("id")
      .single()
    if (applyErr) return { success: false, error: applyErr.message }
    if (!applied) return { success: false, error: "The deduction is no longer pending." }

    const { data: violationUpdated, error: violErr } = await admin
      .from("violations")
      .update({
        status: "deduction_applied",
        deduction_applied: true,
        deduction_applied_at: nowIso,
        deduction_applied_by: currentUser.authUserId,
        payroll_period_id: parsed.payroll_period_id,
        updated_by: currentUser.authUserId,
      })
      .eq("id", violation.id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "resolved") // conditional claim
      .select("id")
      .single()
    if (violErr || !violationUpdated) {
      // Compensate: the violation moved under us — keep the ledger pending.
      await admin
        .from("violation_deduction_ledger")
        .update({ status: "pending", applied_at: null, applied_by: null, payroll_period_id: null })
        .eq("id", parsed.ledger_id)
      return { success: false, error: "The parent violation changed state — try again." }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_deduction_applied",
      entityType: "violation_deduction",
      entityId: parsed.ledger_id,
      newValues: {
        violation_id: violation.id,
        payroll_period_id: parsed.payroll_period_id,
        period: `${period.period_year}-${String(period.period_month).padStart(2, "0")}`,
      },
    })

    revalidatePath("/violations")
    revalidatePath("/payroll")
    return { success: true, id: parsed.ledger_id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Roll an APPLIED ledger row back to pending — mirrors the M3 rollback
 * semantics (lib/payroll/deduction-rollback.ts). Refused once the target
 * period is locked or paid; the reason is mandatory and audited.
 */
export async function rollbackLedgerDeduction(input: LedgerRollbackInput): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = ledgerRollbackSchema.parse(input)
    const admin = createAdminClient()

    const { data: ledger } = await admin
      .from("violation_deduction_ledger")
      .select("id, status, violation_id, payroll_period_id")
      .eq("id", parsed.ledger_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!ledger) return { success: false, error: "Ledger row not found." }
    if (ledger.status !== "applied") {
      return { success: false, error: `Only applied deductions can be rolled back (this one is ${ledger.status}).` }
    }

    if (ledger.payroll_period_id) {
      const { data: period } = await admin
        .from("driver_payroll_periods")
        .select("id, status")
        .eq("id", ledger.payroll_period_id)
        .eq("tenant_id", currentUser.tenantId)
        .maybeSingle()
      if (period && !canRollbackFromPeriod(period.status)) {
        return { success: false, error: `The payroll period is ${period.status} — deductions can no longer be rolled back.` }
      }
    }

    const nowIso = new Date().toISOString()
    const { data: rolledBack, error: rbErr } = await admin
      .from("violation_deduction_ledger")
      .update({
        status: "pending",
        applied_at: null,
        applied_by: null,
        payroll_period_id: null,
        rollback_reason: parsed.reason,
        rolled_back_by: currentUser.authUserId,
        rolled_back_at: nowIso,
        updated_by: currentUser.authUserId,
      })
      .eq("id", parsed.ledger_id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "applied") // conditional claim
      .is("deleted_at", null)
      .select("id, violation_id")
      .single()
    if (rbErr) return { success: false, error: rbErr.message }
    if (!rolledBack) return { success: false, error: "The deduction is no longer applied." }

    // Parent violation back to pre-payment state (M3 parity — never clobbers
    // a violation someone already moved on).
    await admin
      .from("violations")
      .update({
        status: "resolved",
        deduction_applied: false,
        deduction_applied_at: null,
        deduction_applied_by: null,
        payroll_period_id: null,
        updated_by: currentUser.authUserId,
      })
      .eq("id", rolledBack.violation_id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "deduction_applied")

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_deduction_rolled_back",
      entityType: "violation_deduction",
      entityId: parsed.ledger_id,
      newValues: { violation_id: rolledBack.violation_id, reason: parsed.reason },
    })

    revalidatePath("/violations")
    revalidatePath("/payroll")
    return { success: true, id: parsed.ledger_id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── External fine imports ───────────────────────────────────────────────

/**
 * Paste-import government fine rows. The (tenant, external_ref, source)
 * UNIQUE key makes re-imports idempotent — duplicates surface as per-row
 * failures, partial-failure style (good rows commit, bad rows are listed).
 */
export async function importExternalFines(
  rows: unknown[],
  source: "manual" | "najm" | "moi" | "absher" = "manual",
  batchRef?: string
): Promise<FineImportResult> {
  try {
    await requirePermission("violations", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitImports(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    if (!Array.isArray(rows) || rows.length === 0) return { success: false, error: "No rows to import." }
    if (rows.length > 500) return { success: false, error: "Import is capped at 500 rows per batch." }

    const admin = createAdminClient()
    const batch = batchRef?.trim() || new Date().toISOString().slice(0, 19)

    const failures: { rowNumber: number; error: string }[] = []
    let inserted = 0

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] as { rowNumber?: unknown }
      const rowNumber =
        typeof raw?.rowNumber === "number" ? raw.rowNumber : i + 2
      const parsed = externalFineImportRowSchema.safeParse(raw)
      if (!parsed.success) {
        failures.push({ rowNumber, error: parsed.error.issues.map((iss) => iss.message).join("; ") })
        continue
      }
      const row: ExternalFineImportRow = parsed.data
      const { error: insErr } = await admin.from("external_fine_imports").insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        source,
        source_batch_ref: batch,
        external_ref: row.external_ref,
        external_source: row.external_source?.trim() || null,
        vehicle_plate: row.vehicle_plate?.trim() || null,
        violation_date: row.violation_date?.trim() || null,
        violation_location: row.violation_location?.trim() || null,
        violation_type_code: row.violation_type_code?.trim() || null,
        fine_amount: row.fine_amount ?? null,
        payment_deadline: row.payment_deadline?.trim() || null,
        match_notes: row.match_notes?.trim() || null,
        status: "unmatched",
      })
      if (insErr) {
        failures.push({
          rowNumber,
          error: insErr.message.includes("uq_external_fine")
            ? "duplicate fine for this batch source (already imported)"
            : insErr.message,
        })
      } else {
        inserted++
      }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "external_fines_imported",
      entityType: "external_fine_import",
      entityId: null,
      newValues: { source, batch_ref: batch, rows_received: rows.length, inserted, failed: failures.length },
    })

    revalidatePath("/violations")
    return { success: true, inserted, failures }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/** Match an unmatched fine to a tenant driver (matched_driver_id + matched_by). */
export async function matchExternalFine(
  input: z.infer<typeof externalFineMatchSchema>
): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = externalFineMatchSchema.parse(input)
    const admin = createAdminClient()

    const { data: fine } = await admin
      .from("external_fine_imports")
      .select("id, status")
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .maybeSingle()
    if (!fine) return { success: false, error: "Fine not found." }
    if (fine.status !== "unmatched") {
      return { success: false, error: `Only unmatched fines can be matched (this one is ${fine.status}).` }
    }

    const { data: driver } = await admin
      .from("drivers")
      .select("id")
      .eq("id", parsed.driver_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!driver) return { success: false, error: "Driver not found in your tenant." }

    const { data, error } = await admin
      .from("external_fine_imports")
      .update({
        status: "matched",
        matched_driver_id: parsed.driver_id,
        matched_by: currentUser.authUserId,
        matched_at: new Date().toISOString(),
        match_notes: parsed.match_notes?.trim() || null,
      })
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "unmatched") // conditional claim
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "The fine was already matched." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "external_fine_matched",
      entityType: "external_fine_import",
      entityId: parsed.id,
      newValues: { matched_driver_id: parsed.driver_id },
    })

    revalidatePath("/violations")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/** Mark an unmatched fine duplicate/ignored with a mandatory reason. */
export async function markExternalFine(
  input: z.infer<typeof externalFineMarkSchema>
): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = externalFineMarkSchema.parse(input)
    const admin = createAdminClient()

    const { data, error } = await admin
      .from("external_fine_imports")
      .update({
        status: parsed.status,
        match_notes: parsed.match_notes,
        matched_by: currentUser.authUserId,
        matched_at: new Date().toISOString(),
      })
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "unmatched") // queue hygiene only — matched/created rows stay
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Only unmatched fines can be marked." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "external_fine_marked",
      entityType: "external_fine_import",
      entityId: parsed.id,
      newValues: { status: parsed.status, match_notes: parsed.match_notes },
    })

    revalidatePath("/violations")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Create a violation from a MATCHED fine: severity/type compose from the
 * tenant's violation type matched by `violation_type_code` (fallback: minor +
 * the fine amount). The fine flips to `violation_created`; a lost race
 * soft-deletes the just-created violation (compensating action).
 */
export async function createViolationFromFine(fineId: string): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { data: fine } = await admin
      .from("external_fine_imports")
      .select(
        "id, status, source, external_ref, external_source, vehicle_plate, violation_date, violation_location, violation_type_code, fine_amount, matched_driver_id, matched_vehicle_id"
      )
      .eq("id", fineId)
      .eq("tenant_id", currentUser.tenantId)
      .maybeSingle()
    if (!fine) return { success: false, error: "Fine not found." }
    if (fine.status !== "matched") {
      return { success: false, error: `Match the fine to a driver first (this one is ${fine.status}).` }
    }
    if (!fine.matched_driver_id) {
      return { success: false, error: "The fine has no matched driver." }
    }

    // Compose type defaults from the code when the tenant has that type.
    let typeId: string | null = null
    let severity: "minor" | "moderate" | "major" | "critical" = "minor"
    if (fine.violation_type_code) {
      const { data: type } = await admin
        .from("violation_types")
        .select("id, severity, default_deduction")
        .eq("tenant_id", currentUser.tenantId)
        .eq("code", fine.violation_type_code)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle()
      if (type) {
        typeId = type.id
        severity = type.severity
      }
    }
    const amount = fine.fine_amount != null ? Number(fine.fine_amount) : 0
    const description =
      `External fine ${fine.external_ref} (${fine.external_source ?? fine.source})` +
      (fine.violation_location ? ` — ${fine.violation_location}` : "")

    const { data: created, error: insErr } = await admin
      .from("violations")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        driver_id: fine.matched_driver_id,
        vehicle_id: fine.matched_vehicle_id ?? null,
        violation_type_id: typeId,
        source: fineSourceToViolationSource(fine.source),
        severity,
        incident_date: fine.violation_date ?? new Date().toISOString().slice(0, 10),
        incident_location: fine.violation_location ?? null,
        incident_description: description,
        deduction_amount: amount,
        status: "open",
        warning_level: 1,
        external_fine_id: fine.id,
        reported_by: currentUser.authUserId,
        reported_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (insErr) return { success: false, error: insErr.message }

    const { data: linked, error: linkErr } = await admin
      .from("external_fine_imports")
      .update({ status: "violation_created", violation_id: created.id })
      .eq("id", fine.id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "matched") // conditional claim
      .select("id")
      .single()
    if (linkErr || !linked) {
      // Race lost — the fine was already converted; do not leave a duplicate.
      await admin.from("violations").update({ deleted_at: new Date().toISOString() }).eq("id", created.id)
      return { success: false, error: "The fine was already converted." }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_created_from_fine",
      entityType: "violation",
      entityId: created.id,
      newValues: {
        external_fine_id: fine.id,
        external_ref: fine.external_ref,
        driver_id: fine.matched_driver_id,
        deduction_amount: amount,
      },
    })

    emit("violation.created", currentUser.tenantId, {
      id: created.id,
      driverId: fine.matched_driver_id,
      type: fine.violation_type_code ?? "",
      fineAmount: amount,
    })

    revalidatePath("/violations")
    return { success: true, id: created.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Violation types admin (settings-style) ──────────────────────────────

export async function upsertViolationType(input: ViolationTypeUpsertInput): Promise<ViolationActionResult> {
  try {
    const isUpdate = typeof input.id === "string"
    await requirePermission("violations", isUpdate ? "update" : "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = violationTypeUpsertSchema.parse(input)
    const admin = createAdminClient()
    const values = {
      code: parsed.code,
      name_ar: parsed.name_ar,
      name_en: parsed.name_en?.trim() || null,
      category: parsed.category,
      severity: parsed.severity,
      default_deduction: parsed.default_deduction,
      warning_threshold: parsed.warning_threshold ?? 3,
      is_active: parsed.is_active ?? true,
      updated_by: currentUser.authUserId,
    }

    if (isUpdate) {
      const { data, error } = await admin
        .from("violation_types")
        .update(values)
        .eq("id", parsed.id!)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .select("id")
        .single()
      if (error) {
        if (error.message.includes("idx_violation_types_unique_code") || error.message.includes("duplicate key")) {
          return { success: false, error: "A violation type with this code already exists." }
        }
        return { success: false, error: error.message }
      }
      if (!data) return { success: false, error: "Violation type not found." }

      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.authUserId,
        module: "violations",
        action: "violation_type_updated",
        entityType: "violation_type",
        entityId: parsed.id!,
        newValues: { code: parsed.code, name_ar: parsed.name_ar, default_deduction: parsed.default_deduction },
      })
      revalidatePath("/violations")
      return { success: true, id: parsed.id! }
    }

    const { data, error } = await admin
      .from("violation_types")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        ...values,
      })
      .select("id")
      .single()
    if (error) {
      if (error.message.includes("idx_violation_types_unique_code") || error.message.includes("duplicate key")) {
        return { success: false, error: "A violation type with this code already exists." }
      }
      return { success: false, error: error.message }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_type_created",
      entityType: "violation_type",
      entityId: data.id,
      newValues: { code: parsed.code, name_ar: parsed.name_ar, severity: parsed.severity },
    })
    revalidatePath("/violations")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Soft-deactivate a violation type — never hard-deleted (violations rows
 * reference it via FK). The type stays queryable for history; new violations
 * can no longer pick it (is_active=false).
 */
export async function deactivateViolationType(id: string): Promise<ViolationActionResult> {
  try {
    await requirePermission("violations", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitDrivers(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("violation_types")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_by: currentUser.authUserId,
      })
      .eq("id", id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Violation type not found." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violation_type_deactivated",
      entityType: "violation_type",
      entityId: id,
      newValues: { is_active: false, deleted_at: "set" },
    })
    revalidatePath("/violations")
    return { success: true, id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── CSV export (RFC-4180 + UTF-8 BOM) ───────────────────────────────────

export async function exportViolationsCsv(): Promise<ViolationExportResult> {
  try {
    await requirePermission("violations", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitOrders(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const [violRes, ledgerRes] = await Promise.all([
      admin
        .from("violations")
        .select(
          "id,violation_ref,status,severity,source,incident_date,incident_location,incident_description,deduction_amount,deduction_applied,reviewed_at,waived_at,dispute_deadline," +
            "driver:drivers(full_name_ar,driver_code),vehicle:vehicles(plate_number),violation_types(name_ar,name_en,category)"
        )
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .order("reported_at", { ascending: false })
        .limit(10_000),
      admin
        .from("violation_deduction_ledger")
        .select("deduction_amount,status,deduction_month,applied_at,rolled_back_at,violation:violations(violation_ref),driver:drivers(driver_code)")
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10_000),
    ])
    if (violRes.error) return { success: false, error: violRes.error.message }
    if (ledgerRes.error) return { success: false, error: ledgerRes.error.message }

    type ViolRow = {
      violation_ref: string
      status: string
      severity: string
      source: string
      incident_date: string
      incident_location: string | null
      incident_description: string | null
      deduction_amount: number | null
      deduction_applied: boolean
      reviewed_at: string | null
      waived_at: string | null
      dispute_deadline: string | null
      driver: { full_name_ar: string | null; driver_code: string | null } | null
      vehicle: { plate_number: string | null } | null
      violation_types: { name_ar: string | null; name_en: string | null; category: string | null } | null
    }
    type LedgerRow = {
      deduction_amount: number | null
      status: string
      deduction_month: string
      applied_at: string | null
      rolled_back_at: string | null
      violation: { violation_ref: string }[] | null
      driver: { driver_code: string | null }[] | null
    }
    const violations = (violRes.data as unknown as ViolRow[] | null) ?? []
    const ledger = (ledgerRes.data as unknown as LedgerRow[] | null) ?? []

    const csv =
      "\uFEFF" +
      toCsv(
        ["Section", "Ref", "Driver", "Vehicle", "Type", "Severity", "Status", "Incident Date", "Location", "Deduction (SAR)", "Ledger Month", "Ledger Status", "Applied At", "Rolled Back At", "Description"],
        [
          ...violations.map((v) => [
            "violation", v.violation_ref, v.driver?.full_name_ar ?? "", v.vehicle?.plate_number ?? "",
            v.violation_types?.name_en || v.violation_types?.name_ar || "", v.severity, v.status,
            v.incident_date ?? "", v.incident_location ?? "",
            v.deduction_amount != null ? Number(v.deduction_amount).toFixed(2) : "",
            "", "", "", "", v.incident_description ?? "",
          ]),
          ...ledger.map((l) => [
            "ledger", l.violation?.[0]?.violation_ref ?? "", l.driver?.[0]?.driver_code ?? "", "", "", "", "", "", "",
            l.deduction_amount != null ? Number(l.deduction_amount).toFixed(2) : "",
            l.deduction_month, l.status, l.applied_at?.slice(0, 10) ?? "", l.rolled_back_at?.slice(0, 10) ?? "", "",
          ]),
        ]
      )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "violations",
      action: "violations_exported",
      entityType: "violation",
      entityId: null,
      newValues: { violations: violations.length, ledger_rows: ledger.length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Evidence signed URLs (violation-evidence private bucket) ────────────

/**
 * Short-lived signed URL for an evidence path stored in
 * violations.evidence_urls. Absolute http(s) values pass through untouched;
 * anything else is treated as a bucket path. Read-only, gated by
 * violations:read (the bucket itself has no anon access).
 */
export async function getViolationEvidenceUrl(path: string): Promise<{ url?: string; error?: string }> {
  try {
    await requirePermission("violations", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { error: "Not authenticated." }

    const clean = path.trim()
    if (!clean) return { error: "Empty evidence path." }
    if (/^https?:\/\//i.test(clean)) return { url: clean }

    const admin = createAdminClient()
    const bucketPath = clean.startsWith("violation-evidence/") ? clean.slice("violation-evidence/".length) : clean
    const { data, error } = await admin.storage
      .from("violation-evidence")
      .createSignedUrl(bucketPath, 300)
    if (error || !data?.signedUrl) return { error: "Could not generate an evidence link." }
    return { url: data.signedUrl }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error" }
  }
}
