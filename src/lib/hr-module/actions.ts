"use server"

// Server Actions for the HR module (Module 3/11 — HR hub). Surfaces
// `attendance_periods`, `driver_attendance`, `driver_leave_requests` (via the
// decide_leave_request_atomic RPC — REUSED, not re-derived), `leave_types`,
// `public_holidays`, `training_records` + `performance_reviews`
// (migrations 018/023) — no schema changes.
//
//   * lockAttendancePeriod    — attendance:update (open → locked, mandatory notes)
//   * reopenAttendancePeriod  — attendance:update (locked → open, mandatory reason)
//   * setAttendanceCell       — attendance:update (upsert one grid cell)
//   * decideLeaveFromHr       — attendance:approve (composes decide_leave_request_atomic)
//   * createTrainingRecord    — hr:create (training_records)
//   * upsertPerformanceReview — hr:create / hr:update (drafts + edit while pending)
//   * upsertHoliday           — attendance:create (public_holidays admin)
//   * exportHrCsv             — hr:export (leave/attendance BOM CSV)
//
// Every mutation: permission gate + tenant scope from server only + zod +
// audit row + revalidation; cross-surface effects emit driver-changed events
// (client bus) and webhook events where the catalog has them. The payroll
// composition rule (locked periods) lives in module-utils (isPeriodLocked)
// and lib/payroll/calculate.ts (PAY001 unless locked).

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimit } from "@/lib/auth/rate-limit"
import { toCsv } from "@/lib/accounting/csv-utils"
import {
  attendanceCellSchema,
  attendancePeriodLockSchema,
  attendancePeriodReopenSchema,
  holidayUpsertSchema,
  hrExportKindSchema,
  performanceReviewUpsertSchema,
  trainingCreateSchema,
  type AttendanceCellInput,
  type AttendancePeriodLockInput,
  type AttendancePeriodReopenInput,
  type HolidayUpsertInput,
  type HrExportKind,
  type PerformanceReviewUpsertInput,
  type TrainingCreateInput,
} from "@/types/hr-module"

export type HrActionResult = { success: boolean; error?: string; id?: string }
export type HrExportResult = { success: boolean; csv?: string; error?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

/** HR mutations are low-frequency: 30/min per user, shared limiter key. */
async function rateLimitHr(userId: string) {
  return rateLimit(`hr:${userId}`, 30, "minute")
}

// ── Attendance periods (open ⇄ locked) ─────────────────────────────────

/**
 * Lock an open attendance period — the payroll calc engine refuses to run
 * against unlocked months (PAY001), so this is the gate that closes a month.
 * Mandatory notes; the conditional UPDATE claims the open row.
 */
export async function lockAttendancePeriod(input: AttendancePeriodLockInput): Promise<HrActionResult> {
  try {
    await requirePermission("attendance", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitHr(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = attendancePeriodLockSchema.parse(input)
    const admin = createAdminClient()

    const { data, error } = await admin
      .from("attendance_periods")
      .update({
        status: "locked",
        locked_by: currentUser.authUserId,
        locked_at: new Date().toISOString(),
        updated_by: currentUser.authUserId,
      })
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "open") // conditional claim — 0 rows ⇒ already locked
      .is("deleted_at", null)
      .select("id, period_year, period_month")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "The period is no longer open." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "attendance",
      action: "attendance_period_locked",
      entityType: "attendance_period",
      entityId: parsed.id,
      newValues: {
        period: `${data.period_year}-${String(data.period_month).padStart(2, "0")}`,
        notes: parsed.notes ?? null,
      },
    })

    revalidatePath("/hr")
    revalidatePath("/attendance")
    revalidatePath("/payroll")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Re-open a locked attendance period — mandatory reason, audited. Payroll
 * periods already calculated from the locked month are NOT touched (the
 * payroll module owns its own state machine); this only re-opens attendance.
 */
export async function reopenAttendancePeriod(input: AttendancePeriodReopenInput): Promise<HrActionResult> {
  try {
    await requirePermission("attendance", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitHr(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = attendancePeriodReopenSchema.parse(input)
    const admin = createAdminClient()

    const { data, error } = await admin
      .from("attendance_periods")
      .update({
        status: "open",
        locked_by: null,
        locked_at: null,
        updated_by: currentUser.authUserId,
      })
      .eq("id", parsed.id)
      .eq("tenant_id", currentUser.tenantId)
      .eq("status", "locked") // conditional claim — 0 rows ⇒ already open
      .is("deleted_at", null)
      .select("id, period_year, period_month")
      .single()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "The period is no longer locked." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "attendance",
      action: "attendance_period_reopened",
      entityType: "attendance_period",
      entityId: parsed.id,
      newValues: {
        period: `${data.period_year}-${String(data.period_month).padStart(2, "0")}`,
        reason: parsed.reason,
      },
    })

    revalidatePath("/hr")
    revalidatePath("/attendance")
    revalidatePath("/payroll")
    return { success: true, id: parsed.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Attendance grid cell (fleet board) ─────────────────────────────

/**
 * Upsert one cell of the per-driver attendance grid. The (tenant, driver,
 * date) UNIQUE key arbitrates insert vs update; a lost insert race retries
 * as an update once. Locked periods (is_locked row or locked period) are
 * refused — the board must never rewrite a closed month.
 */
export async function setAttendanceCell(input: AttendanceCellInput): Promise<HrActionResult> {
  try {
    await requirePermission("attendance", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitHr(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = attendanceCellSchema.parse(input)
    const admin = createAdminClient()

    // Driver must belong to the caller's tenant.
    const { data: driver } = await admin
      .from("drivers")
      .select("id")
      .eq("id", parsed.driver_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!driver) return { success: false, error: "Driver not found in your tenant." }

    const rowValues = {
      status: parsed.status,
      late_minutes: parsed.late_minutes ?? 0,
      overtime_minutes: parsed.overtime_minutes ?? 0,
      notes: parsed.notes?.trim() || null,
      updated_by: currentUser.authUserId,
    }

    // Refuse to write into a locked month (period-level guard).
    const monthStart = parsed.attendance_date.slice(0, 7)
    const [yearStr, monthStr] = monthStart.split("-")
    const { data: period } = await admin
      .from("attendance_periods")
      .select("id, status")
      .eq("tenant_id", currentUser.tenantId)
      .eq("period_year", Number(yearStr))
      .eq("period_month", Number(monthStr))
      .is("deleted_at", null)
      .maybeSingle()
    if (period && period.status === "locked") {
      return { success: false, error: "The attendance period is locked — reopen it before editing." }
    }

    const findExisting = () =>
      admin
        .from("driver_attendance")
        .select("id, is_locked")
        .eq("tenant_id", currentUser.tenantId)
        .eq("driver_id", parsed.driver_id)
        .eq("attendance_date", parsed.attendance_date)
        .is("deleted_at", null)
        .maybeSingle<{ id: string; is_locked: boolean }>()

    let rowId: string | null = null
    for (let attempt = 0; attempt < 2 && !rowId; attempt++) {
      const { data: existing } = await findExisting()
      if (existing) {
        if (existing.is_locked) {
          return { success: false, error: "This attendance row is locked." }
        }
        const { error } = await admin
          .from("driver_attendance")
          .update(rowValues)
          .eq("id", existing.id)
          .eq("tenant_id", currentUser.tenantId)
          .eq("is_locked", false)
          .is("deleted_at", null)
          .select("id")
          .single()
        if (error) return { success: false, error: error.message }
        rowId = existing.id
      } else {
        const { data: inserted, error } = await admin
          .from("driver_attendance")
          .insert({
            tenant_id: currentUser.tenantId,
            driver_id: parsed.driver_id,
            attendance_date: parsed.attendance_date,
            entry_method: "manual",
            created_by: currentUser.authUserId,
            ...rowValues,
          })
          .select("id")
          .single()
        if (error) {
          if (error.code === "23505" && attempt === 0) continue // concurrent insert won — update instead
          return { success: false, error: error.message }
        }
        rowId = inserted.id
      }
    }
    if (!rowId) return { success: false, error: "Could not save the attendance cell (concurrent update)." }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "attendance",
      action: "attendance_cell_set",
      entityType: "driver_attendance",
      entityId: rowId,
      newValues: {
        driver_id: parsed.driver_id,
        attendance_date: parsed.attendance_date,
        status: parsed.status,
        late_minutes: parsed.late_minutes ?? 0,
        overtime_minutes: parsed.overtime_minutes ?? 0,
      },
    })

    revalidatePath("/hr")
    revalidatePath("/attendance")
    return { success: true, id: rowId }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Leave decision (composes the #52 atomic RPC — REUSED, not re-derived) ──

export type LeaveDecisionInput = {
  requestId: string
  decision: "approved" | "rejected"
  reason: string
}

/**
 * Decide a driver leave request from the HR hub. The whole transition is ONE
 * atomic RPC (decide_leave_request_atomic, migration 20260926120000): the
 * conditional UPDATE claims the pending row (0 rows ⇒ LVE002 already
 * decided), approved leave flips the driver to on_leave via set_driver_status,
 * rejection persists the mandatory reason in review_notes. The Saudi accrual
 * validator (#49) stays the DB-side gate — this action adds nothing to it.
 */
export async function decideLeaveFromHr(input: LeaveDecisionInput): Promise<HrActionResult> {
  try {
    await requirePermission("attendance", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitHr(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const requestId = z.string().uuid().parse(input.requestId)
    const decision = z.enum(["approved", "rejected"]).parse(input.decision)
    const reason = z.string().trim().min(5).max(1000).parse(input.reason)

    const admin = createAdminClient()
    const { data: rpcData, error: rpcErr } = await admin.rpc("decide_leave_request_atomic", {
      p_tenant_id: currentUser.tenantId,
      p_request_id: requestId,
      p_decision: decision,
      p_reason: decision === "rejected" ? reason : null,
      p_reviewer: currentUser.authUserId,
    })
    if (rpcErr) {
      if (rpcErr.message.includes("LVE002")) {
        return { success: false, error: "Leave request already decided." }
      }
      if (rpcErr.message.includes("LVE001")) {
        return { success: false, error: rpcErr.message.split("LVE001:")[1]?.trim() || "Leave request fails validation." }
      }
      return { success: false, error: rpcErr.message }
    }
    const rpc = rpcData as { driver_id?: string; days_requested?: number } | null

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "attendance",
      action: "leave_reviewed",
      entityType: "leave_request",
      entityId: requestId,
      newValues: {
        from: "pending",
        to: decision,
        reason,
        driver_id: rpc?.driver_id ?? null,
        days_requested: rpc?.days_requested ?? null,
        surface: "hr_hub",
      },
    })

    revalidatePath("/hr")
    revalidatePath("/approvals")
    if (rpc?.driver_id) revalidatePath(`/drivers/${rpc.driver_id}`)
    return { success: true, id: requestId }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Training records ────────────────────────────────────────────

export async function createTrainingRecord(input: TrainingCreateInput): Promise<HrActionResult> {
  try {
    await requirePermission("hr", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitHr(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = trainingCreateSchema.parse(input)
    const admin = createAdminClient()

    const { data: driver } = await admin
      .from("drivers")
      .select("id")
      .eq("id", parsed.driver_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!driver) return { success: false, error: "Driver not found in your tenant." }

    const { data, error } = await admin
      .from("training_records")
      .insert({
        tenant_id: currentUser.tenantId,
        driver_id: parsed.driver_id,
        course_name: parsed.course_name,
        training_date: parsed.training_date,
        expiry_date: parsed.expiry_date?.trim() || null,
        provider: parsed.provider?.trim() || null,
        certificate_url: parsed.certificate_url?.trim() || null,
        score: parsed.score ?? null,
        is_passed: parsed.is_passed ?? false,
        created_by: currentUser.authUserId,
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "hr",
      action: "training_record_created",
      entityType: "training_record",
      entityId: data.id,
      newValues: {
        driver_id: parsed.driver_id,
        course_name: parsed.course_name,
        expiry_date: parsed.expiry_date ?? null,
      },
    })

    revalidatePath("/hr")
    revalidatePath(`/drivers/${parsed.driver_id}`)
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Performance reviews (drafts; edit while pending/in_progress) ──

export async function upsertPerformanceReview(input: PerformanceReviewUpsertInput): Promise<HrActionResult> {
  try {
    const isUpdate = typeof input.id === "string"
    await requirePermission("hr", isUpdate ? "update" : "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitHr(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = performanceReviewUpsertSchema.parse(input)
    const admin = createAdminClient()

    const { data: driver } = await admin
      .from("drivers")
      .select("id")
      .eq("id", parsed.driver_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()
    if (!driver) return { success: false, error: "Driver not found in your tenant." }

    const values = {
      driver_id: parsed.driver_id,
      review_period: parsed.review_period,
      review_date: parsed.review_date,
      attendance_score: parsed.attendance_score ?? null,
      violations_score: parsed.violations_score ?? null,
      platform_kpi_score: parsed.platform_kpi_score ?? null,
      overall_score: parsed.overall_score ?? null,
      strengths: parsed.strengths?.trim() || null,
      improvements: parsed.improvements?.trim() || null,
      goals: parsed.goals?.trim() || null,
      status: parsed.status ?? "pending",
      updated_by: currentUser.authUserId,
    }

    if (isUpdate) {
      const { data: existing } = await admin
        .from("performance_reviews")
        .select("id, status")
        .eq("id", parsed.id!)
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .maybeSingle()
      if (!existing) return { success: false, error: "Performance review not found." }
      if (existing.status !== "pending" && existing.status !== "in_progress") {
        return { success: false, error: `A ${existing.status} review can no longer be edited.` }
      }

      const { data, error } = await admin
        .from("performance_reviews")
        .update(values)
        .eq("id", parsed.id!)
        .eq("tenant_id", currentUser.tenantId)
        .in("status", ["pending", "in_progress"]) // conditional claim
        .is("deleted_at", null)
        .select("id")
        .single()
      if (error) return { success: false, error: error.message }
      if (!data) return { success: false, error: "The review was already completed." }

      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.authUserId,
        module: "hr",
        action: "performance_review_updated",
        entityType: "performance_review",
        entityId: parsed.id!,
        newValues: { review_period: parsed.review_period, overall_score: parsed.overall_score ?? null },
      })
      revalidatePath("/hr")
      revalidatePath(`/drivers/${parsed.driver_id}`)
      return { success: true, id: parsed.id! }
    }

    const { data, error } = await admin
      .from("performance_reviews")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        ...values,
      })
      .select("id")
      .single()
    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "hr",
      action: "performance_review_created",
      entityType: "performance_review",
      entityId: data.id,
      newValues: { driver_id: parsed.driver_id, review_period: parsed.review_period },
    })
    revalidatePath("/hr")
    revalidatePath(`/drivers/${parsed.driver_id}`)
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Public holidays admin ───────────────────────────────────────

export async function upsertHoliday(input: HolidayUpsertInput): Promise<HrActionResult> {
  try {
    const isUpdate = typeof input.id === "string"
    await requirePermission("attendance", isUpdate ? "update" : "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitHr(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsed = holidayUpsertSchema.parse(input)
    const admin = createAdminClient()
    const values = {
      name_ar: parsed.name_ar,
      name_en: parsed.name_en?.trim() || null,
      holiday_date: parsed.holiday_date,
      duration_days: parsed.duration_days ?? 1,
      calendar_type: parsed.calendar_type ?? "gregorian",
      is_recurring: parsed.is_recurring ?? false,
      notes: parsed.notes?.trim() || null,
    }

    if (isUpdate) {
      const { data, error } = await admin
        .from("public_holidays")
        .update(values)
        .eq("id", parsed.id!)
        .eq("tenant_id", currentUser.tenantId)
        .select("id")
        .single()
      if (error) return { success: false, error: error.message }
      if (!data) return { success: false, error: "Holiday not found." }

      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.authUserId,
        module: "attendance",
        action: "public_holiday_updated",
        entityType: "public_holiday",
        entityId: parsed.id!,
        newValues: { name_ar: parsed.name_ar, holiday_date: parsed.holiday_date },
      })
      revalidatePath("/hr")
      revalidatePath("/attendance")
      return { success: true, id: parsed.id! }
    }

    const { data, error } = await admin
      .from("public_holidays")
      .insert({
        tenant_id: currentUser.tenantId,
        created_by: currentUser.authUserId,
        ...values,
      })
      .select("id")
      .single()
    if (error) {
      if (error.message.includes("uq_public_holiday") || error.message.includes("duplicate key")) {
        return { success: false, error: "A holiday already exists on this date." }
      }
      return { success: false, error: error.message }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "attendance",
      action: "public_holiday_created",
      entityType: "public_holiday",
      entityId: data.id,
      newValues: { name_ar: parsed.name_ar, holiday_date: parsed.holiday_date, calendar_type: values.calendar_type },
    })
    revalidatePath("/hr")
    revalidatePath("/attendance")
    return { success: true, id: data.id }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── CSV export (RFC-4180 + UTF-8 BOM) ───────────────────────────

export async function exportHrCsv(kind: HrExportKind): Promise<HrExportResult> {
  try {
    await requirePermission("hr", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitHr(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const parsedKind = hrExportKindSchema.parse(kind)
    const admin = createAdminClient()

    if (parsedKind === "leave") {
      const { data, error } = await admin
        .from("driver_leave_requests")
        .select(
          "id,status,start_date,end_date,days_requested,reason,reviewed_at,review_notes,driver:drivers(full_name_ar,driver_code),leave_types(name_ar,name_en)"
        )
        .eq("tenant_id", currentUser.tenantId)
        .is("deleted_at", null)
        .order("requested_at", { ascending: false })
        .limit(10_000)
      if (error) return { success: false, error: error.message }

      type Row = {
        status: string
        start_date: string
        end_date: string
        days_requested: number
        reason: string | null
        reviewed_at: string | null
        review_notes: string | null
        driver: { full_name_ar: string | null; driver_code: string | null } | null
        leave_types: { name_ar: string | null; name_en: string | null } | null
      }
      const rows = (data as unknown as Row[] | null) ?? []
      const csv =
        "\uFEFF" +
        toCsv(
          ["Driver", "Code", "Leave Type", "Status", "Start", "End", "Days", "Reason", "Reviewed At", "Review Notes"],
          rows.map((r) => [
            r.driver?.full_name_ar ?? "", r.driver?.driver_code ?? "",
            r.leave_types?.name_ar ?? r.leave_types?.name_en ?? "",
            r.status, r.start_date ?? "", r.end_date ?? "", r.days_requested,
            r.reason ?? "", r.reviewed_at?.slice(0, 10) ?? "", r.review_notes ?? "",
          ])
        )

      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.authUserId,
        module: "hr",
        action: "hr_exported",
        entityType: "leave_request",
        entityId: null,
        newValues: { kind: "leave", rows: rows.length },
      })
      return { success: true, csv }
    }

    const { data, error } = await admin
      .from("driver_attendance")
      .select(
        "id,attendance_date,status,late_minutes,overtime_minutes,is_locked,driver:drivers(full_name_ar,driver_code)"
      )
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("attendance_date", { ascending: false })
      .limit(10_000)
    if (error) return { success: false, error: error.message }

    type Row = {
      attendance_date: string
      status: string
      late_minutes: number
      overtime_minutes: number
      is_locked: boolean
      driver: { full_name_ar: string | null; driver_code: string | null } | null
    }
    const rows = (data as unknown as Row[] | null) ?? []
    const csv =
      "\uFEFF" +
      toCsv(
        ["Driver", "Code", "Date", "Status", "Late (min)", "Overtime (min)", "Locked"],
        rows.map((r) => [
          r.driver?.full_name_ar ?? "", r.driver?.driver_code ?? "",
          r.attendance_date ?? "", r.status, r.late_minutes, r.overtime_minutes,
          r.is_locked ? "yes" : "no",
        ])
      )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "hr",
      action: "hr_exported",
      entityType: "driver_attendance",
      entityId: null,
      newValues: { kind: "attendance", rows: rows.length },
    })
    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
