import { describe, expect, it } from "vitest"
import {
  attendanceCellSchema,
  attendancePeriodReopenSchema,
  holidayUpsertSchema,
  performanceReviewUpsertSchema,
  trainingCreateSchema,
} from "@/types/hr-module"
import {
  attendanceExceptionKind,
  attendanceGridCells,
  expiringTrainings,
  hrKpis,
  isPeriodLocked,
  periodKey,
  rollupLeaveBalances,
} from "./module-utils"

describe("attendanceGridCells", () => {
  it("pivots rows into per-driver/date cells", () => {
    const cells = attendanceGridCells([
      { driver_id: "d1", attendance_date: "2026-10-01", status: "late", late_minutes: 25, overtime_minutes: 0, is_locked: false },
      { driver_id: "d2", attendance_date: "2026-10-01", status: "present", late_minutes: null, overtime_minutes: 30, is_locked: null },
    ])
    expect(cells.get("d1|2026-10-01")).toMatchObject({ status: "late", late_minutes: 25, is_locked: false })
    expect(cells.get("d2|2026-10-01")).toMatchObject({ status: "present", overtime_minutes: 30, is_locked: false })
    expect(cells.size).toBe(2)
  })

  it("skips rows without a driver or date (no zero-filling)", () => {
    const cells = attendanceGridCells([
      { driver_id: "", attendance_date: "2026-10-01", status: "present", late_minutes: null, overtime_minutes: null, is_locked: false },
      { driver_id: "d1", attendance_date: "", status: "present", late_minutes: null, overtime_minutes: null, is_locked: false },
    ])
    expect(cells.size).toBe(0)
  })
})

describe("attendanceExceptionKind", () => {
  it("maps exceptions and non-exceptions", () => {
    expect(attendanceExceptionKind({ status: "late" })).toBe("late")
    expect(attendanceExceptionKind({ status: "absent_unexcused" })).toBe("absent_unexcused")
    expect(attendanceExceptionKind({ status: "absent_excused" })).toBe("absent_excused")
    expect(attendanceExceptionKind({ status: "half_day" })).toBe("half_day")
    expect(attendanceExceptionKind({ status: "present" })).toBeNull()
    expect(attendanceExceptionKind({ status: "on_leave" })).toBeNull()
    expect(attendanceExceptionKind({ status: "day_off" })).toBeNull()
    expect(attendanceExceptionKind({ status: null })).toBeNull()
  })
})

describe("hrKpis", () => {
  const now = new Date("2026-10-06T12:00:00Z")

  it("counts all four KPIs", () => {
    const kpis = hrKpis(
      [
        { status: "approved", start_date: "2026-10-05", end_date: "2026-10-07" },
        { status: "approved", start_date: "2026-10-01", end_date: "2026-10-02" },
        { status: "pending", start_date: "2026-10-10", end_date: "2026-10-11" },
        { status: "pending", start_date: "2026-10-12", end_date: "2026-10-13" },
        { status: "rejected", start_date: "2026-10-06", end_date: "2026-10-06" },
      ],
      [
        { attendance_date: "2026-10-06", status: "late" },
        { attendance_date: "2026-10-06", status: "absent_unexcused" },
        { attendance_date: "2026-10-06", status: "present" },
        { attendance_date: "2026-10-05", status: "late" },
      ],
      [
        { expiry_date: "2026-10-20" },
        { expiry_date: "2026-11-04" },
        { expiry_date: "2026-12-01" },
        { expiry_date: "2026-10-01" },
        { expiry_date: null },
      ],
      now
    )
    expect(kpis.onLeaveToday).toBe(1)
    expect(kpis.pendingLeave).toBe(2)
    expect(kpis.exceptionsToday).toBe(2)
    expect(kpis.trainingsExpiring).toBe(2)
  })

  it("returns zeros for empty inputs", () => {
    expect(hrKpis([], [], [], now)).toEqual({ onLeaveToday: 0, pendingLeave: 0, exceptionsToday: 0, trainingsExpiring: 0 })
  })
})

describe("expiringTrainings", () => {
  const now = new Date("2026-10-06T12:00:00Z")

  it("keeps only rows within the horizon and sorts by days left", () => {
    const out = expiringTrainings(
      [
        { id: "a", expiry_date: "2026-10-20" },
        { id: "b", expiry_date: "2026-10-10" },
        { id: "c", expiry_date: "2026-12-01" },
        { id: "d", expiry_date: "2026-10-01" },
        { id: "e", expiry_date: null },
      ],
      now
    )
    expect(out.map((r) => r.id)).toEqual(["b", "a"])
    expect(out[0].days_left).toBe(4)
    expect(out[1].days_left).toBe(14)
  })
})

describe("rollupLeaveBalances", () => {
  it("sums per leave type", () => {
    const out = rollupLeaveBalances([
      { leave_type_id: "annual", entitled_days: 21, used_days: 5, pending_days: 2, remaining_days: 14 },
      { leave_type_id: "annual", entitled_days: 21, used_days: 3, pending_days: 0, remaining_days: 16 },
      { leave_type_id: "sick", entitled_days: 30, used_days: 1, pending_days: 0, remaining_days: 29 },
      { leave_type_id: null, entitled_days: 99, used_days: 0, pending_days: 0, remaining_days: 0 },
    ])
    expect(out).toHaveLength(2)
    const annual = out.find((r) => r.leave_type_id === "annual")!
    expect(annual).toEqual({ leave_type_id: "annual", entitled: 42, used: 8, pending: 2, remaining: 30 })
  })
})

describe("period helpers", () => {
  it("pads the month and detects locked periods", () => {
    expect(periodKey(2026, 3)).toBe("2026-03")
    expect(isPeriodLocked("locked")).toBe(true)
    expect(isPeriodLocked("open")).toBe(false)
    expect(isPeriodLocked(null)).toBe(false)
  })
})

describe("zod contracts", () => {
  const U1 = "9f1c0000-0000-4000-8000-000000000001"

  it("reopen demands a real reason; lock does not", () => {
    expect(attendancePeriodReopenSchema.safeParse({ id: U1, reason: "no" }).success).toBe(false)
    expect(attendancePeriodReopenSchema.safeParse({ id: U1, reason: "attendance corrections pending" }).success).toBe(true)
  })

  it("attendance cells validate the status enum and minutes", () => {
    expect(attendanceCellSchema.safeParse({ driver_id: U1, attendance_date: "2026-10-06", status: "late", late_minutes: 15 }).success).toBe(true)
    expect(attendanceCellSchema.safeParse({ driver_id: U1, attendance_date: "2026-10-06", status: "vacation" }).success).toBe(false)
    expect(attendanceCellSchema.safeParse({ driver_id: U1, attendance_date: "2026-10-06", status: "late", late_minutes: -5 }).success).toBe(false)
  })

  it("trainings require a driver, course and date", () => {
    expect(trainingCreateSchema.safeParse({ driver_id: U1, course_name: "Defensive driving", training_date: "2026-10-06" }).success).toBe(true)
    expect(trainingCreateSchema.safeParse({ driver_id: U1, course_name: "x", training_date: "2026-10-06" }).success).toBe(false)
    expect(trainingCreateSchema.safeParse({ driver_id: U1, course_name: "Course", training_date: "10/06/2026" }).success).toBe(false)
  })

  it("reviews validate scores and status", () => {
    expect(performanceReviewUpsertSchema.safeParse({ driver_id: U1, review_period: "2026-Q3", review_date: "2026-10-06", overall_score: 88.5 }).success).toBe(true)
    expect(performanceReviewUpsertSchema.safeParse({ driver_id: U1, review_period: "2026-Q3", review_date: "2026-10-06", overall_score: 101 }).success).toBe(false)
    expect(performanceReviewUpsertSchema.safeParse({ driver_id: U1, review_period: "2026-Q3", review_date: "2026-10-06", status: "published" }).success).toBe(false)
  })

  it("holidays validate calendar type and duration", () => {
    expect(holidayUpsertSchema.safeParse({ name_ar: "عيد الفطر", holiday_date: "2026-03-20", calendar_type: "hijri", duration_days: 3 }).success).toBe(true)
    expect(holidayUpsertSchema.safeParse({ name_ar: "عيد الفطر", holiday_date: "2026-03-20", calendar_type: "lunar" }).success).toBe(false)
    expect(holidayUpsertSchema.safeParse({ name_ar: "عيد الفطر", holiday_date: "2026-03-20", duration_days: 0 }).success).toBe(false)
  })
})
