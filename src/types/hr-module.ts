import { z } from "zod"

// Module 3/11 — HR hub. Columns mirror migrations 018_attendance.sql +
// 023_hr.sql exactly — a SURFACING job over the existing schema; no new
// tables/columns introduced.

/** Mark an attendance period locked (payroll calc REQUIRES locked periods). */
export const attendancePeriodLockSchema = z.object({
  id: z.string().uuid(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export type AttendancePeriodLockInput = z.infer<typeof attendancePeriodLockSchema>

/** Re-open a locked attendance period (open ⇄ locked). */
export const attendancePeriodReopenSchema = z.object({
  id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(5, "A reopen reason is required")
    .max(1000),
})

export type AttendancePeriodReopenInput = z.infer<typeof attendancePeriodReopenSchema>

/**
 * Upsert one cell of the per-driver attendance grid (fleet board). The
 * (tenant, driver, date) UNIQUE key decides insert vs update via a
 * read-then-write with one 23505 retry (the supabase-js pattern from
 * platform payments — the unique index is NOT partial, so a raw upsert
 * also works; the retry loop stays for error-surface clarity).
 */
export const attendanceCellSchema = z.object({
  driver_id: z.string().uuid("Driver is required"),
  attendance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd"),
  status: z.enum(["present", "absent_excused", "absent_unexcused", "late", "half_day", "on_leave", "public_holiday", "day_off"]),
  late_minutes: z.number().int().min(0).max(1440).optional(),
  overtime_minutes: z.number().int().min(0).max(1440).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export type AttendanceCellInput = z.infer<typeof attendanceCellSchema>

/** Create a training record (mandatory dates). */
export const trainingCreateSchema = z.object({
  driver_id: z.string().uuid("Driver is required"),
  course_name: z.string().trim().min(2, "Course name is required").max(200),
  training_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd"),
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry must be yyyy-mm-dd")
    .nullable()
    .optional(),
  provider: z.string().trim().max(200).nullable().optional(),
  certificate_url: z.string().trim().max(500).nullable().optional(),
  score: z.number().min(0).max(100).nullable().optional(),
  is_passed: z.boolean().optional(),
})

export type TrainingCreateInput = z.infer<typeof trainingCreateSchema>

/** Create or edit a draft performance review. */
export const performanceReviewUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  driver_id: z.string().uuid("Driver is required"),
  review_period: z.string().trim().min(2, "Review period is required").max(40),
  review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd"),
  attendance_score: z.number().min(0).max(100).nullable().optional(),
  violations_score: z.number().min(0).max(100).nullable().optional(),
  platform_kpi_score: z.number().min(0).max(100).nullable().optional(),
  overall_score: z.number().min(0).max(100).nullable().optional(),
  strengths: z.string().trim().max(2000).nullable().optional(),
  improvements: z.string().trim().max(2000).nullable().optional(),
  goals: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
})

export type PerformanceReviewUpsertInput = z.infer<typeof performanceReviewUpsertSchema>

/** Insert or update one public_holidays row. */
export const holidayUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  name_ar: z.string().trim().min(2, "Arabic name is required").max(120),
  name_en: z.string().trim().max(120).nullable().optional(),
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd"),
  duration_days: z.number().int().min(1).max(30).optional(),
  calendar_type: z.enum(["gregorian", "hijri", "fixed"]).optional(),
  is_recurring: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export type HolidayUpsertInput = z.infer<typeof holidayUpsertSchema>

/** CSV export scope picker. */
export const hrExportKindSchema = z.enum(["leave", "attendance"])
export type HrExportKind = z.infer<typeof hrExportKindSchema>
