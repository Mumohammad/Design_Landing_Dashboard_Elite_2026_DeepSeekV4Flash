// Pure, client-safe logic for the HR module (Module 3/11 — HR hub). Server
// actions (the "use server" sibling actions.ts) import from here; Client
// Components may import this file directly. No DB access, no "use server".

// ── Attendance board rollups ────────────────────────────────────────────────

export interface AttendanceDayRow {
  driver_id: string
  attendance_date: string
  status: string | null
  late_minutes: number | null
  overtime_minutes: number | null
  is_locked: boolean | null
}

export interface AttendanceGridCell {
  driver_id: string
  attendance_date: string
  status: string | null
  late_minutes: number
  overtime_minutes: number
  is_locked: boolean
}

/**
 * Pivot flat attendance rows into per-driver cells keyed
 * `${driver_id}|${attendance_date}` for the fleet board grid. Rows are not
 * zero-filled — a driver without a row for a date simply has no cell.
 */
export function attendanceGridCells(rows: AttendanceDayRow[]): Map<string, AttendanceGridCell> {
  const m = new Map<string, AttendanceGridCell>()
  for (const r of rows) {
    if (!r.driver_id || !r.attendance_date) continue
    m.set(`${r.driver_id}|${r.attendance_date}`, {
      driver_id: r.driver_id,
      attendance_date: r.attendance_date,
      status: r.status,
      late_minutes: Number(r.late_minutes ?? 0),
      overtime_minutes: Number(r.overtime_minutes ?? 0),
      is_locked: Boolean(r.is_locked),
    })
  }
  return m
}

// ── Attendance exceptions (late / absent / overtime) ───────────────────────

export type AttendanceExceptionKind = "late" | "absent_unexcused" | "absent_excused" | "half_day"

/**
 * One attendance row → its exception kind, or null when present/on-leave/day
 * off (not an exception). Used by the exceptions KPI and the exceptions
 * column filter.
 */
export function attendanceExceptionKind(row: { status: string | null }): AttendanceExceptionKind | null {
  switch (row.status) {
    case "late":
      return "late"
    case "absent_unexcused":
      return "absent_unexcused"
    case "absent_excused":
      return "absent_excused"
    case "half_day":
      return "half_day"
    default:
      return null
  }
}

// ── HR KPIs (on-leave today · pending leave · exceptions today · trainings ≤30d) ─

export interface HrKpis {
  onLeaveToday: number
  pendingLeave: number
  exceptionsToday: number
  trainingsExpiring: number
}

/**
 * Derive the HR home KPIs.
 *  - onLeaveToday: leave requests spanning today with status approved
 *  - pendingLeave: leave requests with status pending
 *  - exceptionsToday: attendance rows for today with an exception kind
 *  - trainingsExpiring: training_records with expiry_date within 30 days
 *    (inclusive) of `now` and not already expired
 */
export function hrKpis(
  leave: { status: string | null; start_date: string | null; end_date: string | null }[],
  attendance: { attendance_date: string | null; status: string | null }[],
  trainings: { expiry_date: string | null }[],
  now: Date
): HrKpis {
  const today = now.toISOString().slice(0, 10)
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  return {
    onLeaveToday: leave.filter(
      (l) =>
        l.status === "approved" &&
        (l.start_date ?? "") <= today &&
        (l.end_date ?? "") >= today
    ).length,
    pendingLeave: leave.filter((l) => l.status === "pending").length,
    exceptionsToday: attendance.filter(
      (a) => (a.attendance_date ?? "") === today && attendanceExceptionKind(a) !== null
    ).length,
    trainingsExpiring: trainings.filter((t) => {
      const exp = t.expiry_date
      return !!exp && exp >= today && exp <= horizon
    }).length,
  }
}

// ── Expiring trainings (≤ 30 days) ─────────────────────────────────────────

/** Filter + annotate training rows expiring within `days` (default 30). */
export function expiringTrainings<T extends { id: string; expiry_date: string | null }>(
  rows: T[],
  now: Date,
  days = 30
): (T & { days_left: number })[] {
  const today = now.toISOString().slice(0, 10)
  const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return rows
    .filter((r) => !!r.expiry_date && r.expiry_date >= today && r.expiry_date <= horizon)
    .map((r) => ({ ...r, days_left: Math.round((new Date(r.expiry_date!).getTime() - new Date(now).getTime()) / 86_400_000) }))
    .sort((a, b) => a.days_left - b.days_left)
}

// ── Leave balances rollup (by type, current year) ───────────────────────────

export interface LeaveBalanceRollup {
  leave_type_id: string
  entitled: number
  used: number
  pending: number
  remaining: number
}

/** Sum per leave type over the given balances (one type/year per row). */
export function rollupLeaveBalances(
  rows: { leave_type_id: string | null; entitled_days: number | null; used_days: number | null; pending_days: number | null; remaining_days: number | null }[]
): LeaveBalanceRollup[] {
  const m = new Map<string, LeaveBalanceRollup>()
  for (const r of rows) {
    if (!r.leave_type_id) continue
    const cur = m.get(r.leave_type_id) ?? {
      leave_type_id: r.leave_type_id,
      entitled: 0,
      used: 0,
      pending: 0,
      remaining: 0,
    }
    cur.entitled += Number(r.entitled_days ?? 0)
    cur.used += Number(r.used_days ?? 0)
    cur.pending += Number(r.pending_days ?? 0)
    cur.remaining += Number(r.remaining_days ?? 0)
    m.set(r.leave_type_id, cur)
  }
  return [...m.values()].sort((a, b) => a.leave_type_id.localeCompare(b.leave_type_id))
}

// ── Attendance period helpers ───────────────────────────────────────────────

/** `yyyy-mm` key for a period row. */
export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

/**
 * Locked periods are the payroll-calc gate (PAY001 otherwise) — the board
 * shows the lock state explicitly and refuses cell edits on locked dates.
 */
export function isPeriodLocked(status: string | null | undefined): boolean {
  return status === "locked"
}
