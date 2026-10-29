import { z } from "zod"

export const operationSurfaceSchema = z.enum(["attendance", "violations", "training", "performance"])
export type OperationSurface = z.infer<typeof operationSurfaceSchema>
export const BUSINESS_TIME_ZONE = "Asia/Riyadh"
export const VIOLATION_TRANSITIONS: Record<string, readonly string[]> = {
  open: ["open", "under_review", "acknowledged", "disputed", "escalated", "waived"],
  under_review: ["under_review", "acknowledged", "disputed", "resolved", "escalated", "waived"],
  acknowledged: ["acknowledged", "under_review", "disputed", "resolved", "waived"],
  disputed: ["disputed", "under_review", "escalated", "waived"],
  escalated: ["escalated", "under_review", "resolved", "waived"],
  resolved: ["resolved", "closed"],
  waived: ["waived"], closed: ["closed"], deduction_applied: ["deduction_applied"],
}
export const REVIEW_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["pending", "in_progress", "cancelled"],
  in_progress: ["in_progress", "completed", "cancelled"],
  completed: ["completed"], cancelled: ["cancelled"],
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid calendar date").refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, "Use a valid calendar date")
const nullableText = z.string().trim().max(5000).nullable().optional()
const score = z.number().finite().min(0).max(100).nullable().optional()
const money = z.number().finite().min(0).max(99999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use at most two decimal places")
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time (HH:MM)").nullable().optional()
const attendance = z.object({
  attendance_date: date,
  status: z.enum(["present", "late", "half_day", "absent_excused", "absent_unexcused", "on_leave", "public_holiday", "day_off"]),
  check_in_time: time, check_out_time: time,
  late_minutes: z.number().int().min(0).max(32767).nullable().optional(),
  overtime_minutes: z.number().int().min(0).max(32767).nullable().optional(), notes: nullableText,
})
const training = z.object({
  course_name: z.string().trim().min(1).max(300), training_date: date,
  expiry_date: date.nullable().optional(), provider: nullableText, score,
  is_passed: z.boolean().default(false),
  certificate_url: z.string().url().refine(value => ["http:", "https:"].includes(new URL(value).protocol), "Use an HTTP or HTTPS certificate URL").nullable().optional(),
}).refine(value => !value.expiry_date || value.expiry_date >= value.training_date, "Expiry date must follow the training date")
const performance = z.object({
  review_period: z.string().trim().min(1).max(100), review_date: date,
  attendance_score: score, violations_score: score, platform_kpi_score: score, overall_score: score,
  strengths: nullableText, improvements: nullableText, goals: nullableText,
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).default("pending"),
}).refine(value => value.status !== "completed" || [value.attendance_score, value.violations_score, value.platform_kpi_score, value.overall_score].every(score => score != null), "Complete all scores before completing the review")
const violation = z.object({
  incident_date: date, incident_location: nullableText,
  incident_description: z.string().trim().min(1, "Description is required").max(5000),
  violation_type_id: z.uuid().nullable().optional(),
  deduction_amount: money.nullable().optional(),
  status: z.enum(["open", "under_review", "acknowledged", "disputed", "resolved", "waived", "escalated", "closed"]).default("open"),
  review_notes: nullableText,
  deduction_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a deduction month (YYYY-MM)").nullable().optional(),
})

/** Saudi business days have a fixed UTC+03 offset. Never interpret the browser's local timezone. */
export function attendanceTimestamp(day: string, clock: string | null | undefined): string | null {
  date.parse(day)
  if (!clock) return null
  time.parse(clock)
  return new Date(`${day}T${clock}:00+03:00`).toISOString()
}
export function businessTimeInput(value: unknown): string {
  if (typeof value !== "string" || !value) return ""
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return ""
  return new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(timestamp)
}
export function parseOperationInput(surface: OperationSurface, input: unknown): Record<string, unknown> {
  if (surface === "attendance") {
    const parsed = attendance.parse(input)
    const checkIn = attendanceTimestamp(parsed.attendance_date, parsed.check_in_time)
    const checkOut = attendanceTimestamp(parsed.attendance_date, parsed.check_out_time)
    if (checkIn && checkOut && checkOut < checkIn) throw new Error("Check-out must be at or after check-in on the attendance date")
    return { ...parsed, check_in_time: checkIn, check_out_time: checkOut, late_minutes: parsed.late_minutes ?? 0, overtime_minutes: parsed.overtime_minutes ?? 0 }
  }
  if (surface === "training") return training.parse(input)
  if (surface === "performance") return performance.parse(input)
  const parsed = violation.parse(input)
  return { ...parsed, deduction_amount: parsed.deduction_amount ?? 0 }
}
