"use client"

// /hr — HR management hub (Prompt O Part 4). Composes the driver-scoped HR
// tables at FLEET level: driver_leave_requests (+ balances, leave_types,
// public_holidays), driver_attendance (+ attendance_periods lock board),
// training_records, performance_reviews. RLS reads ride the browser client;
// mutations ride the server actions (leave decisions REUSE the
// decide_leave_request_atomic RPC). Rows deep-link into /drivers/[id].

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Users,
  CalendarOff,
  AlertTriangle,
  GraduationCap,
  Plus,
  Download,
  Pencil,
  CalendarClock,
  CalendarCheck,
  UserCheck,
  Award,
  Lock,
  Unlock,
  Check,
  X,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  decideLeaveFromHr,
  exportHrCsv,
  lockAttendancePeriod,
  reopenAttendancePeriod,
  setAttendanceCell,
} from "@/lib/hr-module/actions"
import {
  attendanceExceptionKind,
  attendanceGridCells,
  expiringTrainings,
  hrKpis,
  rollupLeaveBalances,
  type AttendanceGridCell,
} from "@/lib/hr-module/module-utils"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import {
  AddTrainingButton,
  AddTrainingDialog,
  HolidayDialog,
  PerformanceReviewDialog,
} from "./components/hr-dialogs"

interface DriverOption {
  id: string
  full_name_ar: string | null
  driver_code: string | null
}

interface LeaveRow {
  id: string
  driver_id: string
  leave_type_id: string | null
  start_date: string
  end_date: string
  days_requested: number
  reason: string | null
  status: string
  requested_at: string | null
  reviewed_at: string | null
  driver: { full_name_ar: string | null; driver_code: string | null } | null
  leave_types: { name_ar: string | null; name_en: string | null } | null
}

interface BalanceRow {
  id: string
  leave_type_id: string | null
  entitled_days: number | null
  used_days: number | null
  pending_days: number | null
  remaining_days: number | null
}

interface HolidayRow {
  id: string
  name_ar: string
  name_en: string | null
  holiday_date: string | null
  duration_days: number | null
  calendar_type: string
  is_recurring: boolean
}

interface AttendanceRow {
  id: string
  driver_id: string
  attendance_date: string
  status: string
  late_minutes: number
  overtime_minutes: number
  is_locked: boolean
  driver: { full_name_ar: string | null; driver_code: string | null } | null
}

interface PeriodRow {
  id: string
  period_year: number
  period_month: number
  status: string
  working_days_count: number | null
}

interface TrainingRow {
  id: string
  driver_id: string
  course_name: string
  training_date: string
  expiry_date: string | null
  provider: string | null
  score: number | null
  is_passed: boolean
  driver: { full_name_ar: string | null; driver_code: string | null } | null
}

interface ReviewRow {
  id: string
  driver_id: string
  review_period: string
  review_date: string
  overall_score: number | null
  status: string
  driver: { full_name_ar: string | null; driver_code: string | null } | null
}

const LEAVE_STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  pending: { ar: "معلقة", en: "Pending", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  approved: { ar: "معتمدة", en: "Approved", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  rejected: { ar: "مرفوضة", en: "Rejected", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  cancelled: { ar: "ملغاة", en: "Cancelled", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

export default function HRPage() {
  const { t } = useTranslation()
  const hm = t.hrModule
  const isAr = t.common.status === "الحالة"

  const [leave, setLeave] = useState<LeaveRow[]>([])
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [holidays, setHolidays] = useState<HolidayRow[]>([])
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  const [periods, setPeriods] = useState<PeriodRow[]>([])
  const [trainings, setTrainings] = useState<TrainingRow[]>([])
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState("leave")
  const [attDate, setAttDate] = useState(new Date().toISOString().slice(0, 10))

  // Dialog sessions (session-keyed remounts — state derives from props).
  const [trainingDialogOpen, setTrainingDialogOpen] = useState(false)
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [editingReview, setEditingReview] = useState<ReviewRow | null>(null)
  const [holidayDialogOpen, setHolidayDialogOpen] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState<HolidayRow | null>(null)

  // Never sets state synchronously: every setState call sits after an await,
  // so the effect body only starts the async job and cannot cascade renders
  // (the setState-in-effect lint rule). The initial spinner is the
  // useState(true) default; refetches after mutations refresh silently.
  const loadData = useCallback(async () => {
    const supabase = createClient()
    const [leaveRes, balRes, holRes, attRes, perRes, trnRes, revRes, drvRes] = await Promise.all([
      supabase
        .from("driver_leave_requests")
        .select("id,driver_id,leave_type_id,start_date,end_date,days_requested,reason,status,requested_at,reviewed_at,driver:drivers(full_name_ar,driver_code),leave_types(name_ar,name_en)")
        .is("deleted_at", null)
        .order("requested_at", { ascending: false })
        .limit(500),
      supabase
        .from("driver_leave_balances")
        .select("id,leave_type_id,entitled_days,used_days,pending_days,remaining_days")
        .is("deleted_at", null)
        .limit(2000),
      supabase
        .from("public_holidays")
        .select("id,name_ar,name_en,holiday_date,duration_days,calendar_type,is_recurring")
        .eq("is_active", true)
        .order("holiday_date", { ascending: false })
        .limit(300),
      supabase
        .from("driver_attendance")
        .select("id,driver_id,attendance_date,status,late_minutes,overtime_minutes,is_locked,driver:drivers(full_name_ar,driver_code)")
        .is("deleted_at", null)
        .order("attendance_date", { ascending: false })
        .limit(2000),
      supabase
        .from("attendance_periods")
        .select("id,period_year,period_month,status,working_days_count")
        .is("deleted_at", null)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .limit(36),
      supabase
        .from("training_records")
        .select("id,driver_id,course_name,training_date,expiry_date,provider,score,is_passed,driver:drivers(full_name_ar,driver_code)")
        .is("deleted_at", null)
        .order("training_date", { ascending: false })
        .limit(500),
      supabase
        .from("performance_reviews")
        .select("id,driver_id,review_period,review_date,overall_score,status,driver:drivers(full_name_ar,driver_code)")
        .is("deleted_at", null)
        .order("review_date", { ascending: false })
        .limit(500),
      supabase
        .from("drivers")
        .select("id,full_name_ar,driver_code")
        .is("deleted_at", null)
        .order("full_name_ar", { ascending: true })
        .limit(1000),
    ])
    setLeave((leaveRes.data as unknown as LeaveRow[]) ?? [])
    setBalances((balRes.data as BalanceRow[]) ?? [])
    setHolidays((holRes.data as HolidayRow[]) ?? [])
    setAttendance((attRes.data as unknown as AttendanceRow[]) ?? [])
    setPeriods((perRes.data as PeriodRow[]) ?? [])
    setTrainings((trnRes.data as unknown as TrainingRow[]) ?? [])
    setReviews((revRes.data as unknown as ReviewRow[]) ?? [])
    setDrivers((drvRes.data as DriverOption[]) ?? [])
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void (async () => {
      await Promise.resolve()
      await loadData()
    })()
  }, [loadData])

  // ── Derived state (all pure, from module-utils) ──

  const kpis = useMemo(
    () =>
      hrKpis(
        leave.map((l) => ({ status: l.status, start_date: l.start_date, end_date: l.end_date })),
        attendance.map((a) => ({ attendance_date: a.attendance_date, status: a.status })),
        trainings.map((tr) => ({ expiry_date: tr.expiry_date })),
        new Date()
      ),
    [leave, attendance, trainings]
  )

  const kpiCards: KpiCardData[] = [
    { label: hm.kpiOnLeaveToday, value: kpis.onLeaveToday, icon: CalendarOff, color: "#8B5CF6" },
    { label: hm.kpiPendingLeave, value: kpis.pendingLeave, icon: UserCheck, color: "#F59E0B" },
    { label: hm.kpiExceptionsToday, value: kpis.exceptionsToday, icon: AlertTriangle, color: "#EF4444" },
    { label: hm.kpiTrainingsExpiring, value: kpis.trainingsExpiring, icon: GraduationCap, color: "#1E5A99" },
  ]

  const balanceRollup = useMemo(() => {
    const roll = rollupLeaveBalances(balances)
    const nameFor = (id: string) =>
      // Resolve the label from any leave row / holiday-style join we already have.
      leave.find((l) => l.leave_type_id === id)?.leave_types?.name_ar ?? id
    return roll.map((r) => ({ ...r, label: nameFor(r.leave_type_id) }))
  }, [balances, leave])

  const expiring = useMemo(() => expiringTrainings(trainings, new Date()), [trainings])

  const boardDate = attDate
  const dayRows = useMemo(() => attendance.filter((a) => a.attendance_date === boardDate), [attendance, boardDate])
  const cellMap = useMemo(() => attendanceGridCells(dayRows), [dayRows])
  const boardDrivers = useMemo(() => {
    // Drivers with a row today first, then the rest of the roster (board is
    // roster-complete; absent cells are simply empty — not zero-filled).
    const withRow = new Set(dayRows.map((r) => r.driver_id))
    return [...drivers].sort((a, b) => Number(withRow.has(b.id)) - Number(withRow.has(a.id)))
  }, [drivers, dayRows])
  const periodForBoardDate = useMemo(() => {
    const [y, m] = boardDate.split("-").map(Number)
    return periods.find((p) => p.period_year === y && p.period_month === m) ?? null
  }, [periods, boardDate])
  const boardLocked = periodForBoardDate ? periodForBoardDate.status === "locked" : false

  function refreshAll() {
    void loadData()
  }

  async function handleExport(kind: "leave" | "attendance") {
    const res = await exportHrCsv(kind)
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `hr-${kind}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t.common.export)
    } else {
      toast.error(res.error ?? "Error")
    }
  }

  const attStatusLabel = (s: string) => {
    const map: Record<string, string> = {
      present: hm.statusPresent,
      late: hm.statusLate,
      absent_excused: hm.statusAbsentExcused,
      absent_unexcused: hm.statusAbsentUnexcused,
      half_day: hm.statusHalfDay,
      on_leave: hm.statusOnLeave,
      public_holiday: hm.statusPublicHoliday,
      day_off: hm.statusDayOff,
    }
    return map[s] ?? s
  }

  const leaveColumns: TableColumn<LeaveRow>[] = [
    {
      key: "driver",
      header: t.nav.drivers,
      render: (r) => (
        <Link href={`/drivers/${r.driver_id}`} className="font-medium hover:underline">{r.driver?.full_name_ar ?? "—"}</Link>
      ),
    },
    { key: "type", header: hm.colLeaveType, render: (r) => r.leave_types?.name_ar ?? "—" },
    { key: "range", header: hm.colLeaveRange, render: (r) => <span dir="ltr" className="text-xs">{r.start_date} → {r.end_date}</span> },
    { key: "days", header: hm.colLeaveDays, render: (r) => <span dir="ltr" className="tabular-nums">{r.days_requested}</span> },
    {
      key: "status",
      header: hm.colLeaveStatus,
      render: (r) => {
        const s = LEAVE_STATUS_META[r.status] ?? LEAVE_STATUS_META.pending
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{isAr ? s.ar : s.en}</span>
      },
    },
    { key: "reason", header: hm.colLeaveReason, render: (r) => <span className="text-xs">{r.reason ?? "—"}</span> },
  ]

  const reviewColumns: TableColumn<ReviewRow>[] = [
    {
      key: "driver",
      header: t.nav.drivers,
      render: (r) => (
        <Link href={`/drivers/${r.driver_id}`} className="font-medium hover:underline">{r.driver?.full_name_ar ?? "—"}</Link>
      ),
    },
    { key: "review_period", header: hm.colPeriod, render: (r) => <span dir="ltr">{r.review_period}</span> },
    { key: "review_date", header: hm.colReviewDate, render: (r) => <span dir="ltr">{r.review_date}</span> },
    { key: "overall_score", header: hm.colOverall, render: (r) => <span dir="ltr" className="tabular-nums">{r.overall_score != null ? Number(r.overall_score).toFixed(1) : "—"}</span> },
    {
      key: "status",
      header: hm.colReviewStatus,
      render: (r) => <span dir="ltr" className="text-xs">{r.status}</span>,
    },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="leave">{hm.tabLeave}</TabsTrigger>
          <TabsTrigger value="attendance">{hm.tabAttendance}</TabsTrigger>
          <TabsTrigger value="training">{hm.tabTraining}</TabsTrigger>
          <TabsTrigger value="performance">{hm.tabPerformance}</TabsTrigger>
          <TabsTrigger value="settings">{hm.tabSettings}</TabsTrigger>
        </TabsList>

        <TabsContent value="leave" className="mt-0">
          <EnterpriseModulePage
            title={t.nav.hrManagement}
            subtitle={hm.subtitle}
            kpiCards={kpiCards}
            primaryCtaIcon={Users}
            toolbarActions={
              <Button variant="outline" size="sm" onClick={() => void handleExport("leave")}>
                <Download className="mr-1 h-4 w-4" />
                {t.common.export}
              </Button>
            }
            columns={leaveColumns}
            data={leave}
            isLoading={isLoading}
            emptyStateMessage={t.common.noData}
            rowActions={(r) =>
              r.status === "pending" ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    title={hm.approveLeave}
                    onClick={async () => {
                      const reason = window.prompt(hm.leaveDecisionReason, "")
                      if (reason == null) return
                      const res = await decideLeaveFromHr({ requestId: r.id, decision: "approved", reason: reason.trim() || "approved from HR hub" })
                      if (res.success) {
                        toast.success(t.common.saved)
                        emitDriverChanged({ driverId: r.driver_id, action: "leave" })
                        refreshAll()
                      } else toast.error(res.error ?? "Error")
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={hm.rejectLeave}
                    onClick={async () => {
                      const reason = window.prompt(hm.leaveDecisionReason, "")
                      if (reason == null) return
                      if (reason.trim().length < 5) {
                        toast.error(hm.leaveDecisionReasonRequired)
                        return
                      }
                      const res = await decideLeaveFromHr({ requestId: r.id, decision: "rejected", reason: reason.trim() })
                      if (res.success) {
                        toast.success(t.common.saved)
                        emitDriverChanged({ driverId: r.driver_id, action: "leave" })
                        refreshAll()
                      } else toast.error(res.error ?? "Error")
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : null
            }
          />
          {/* Balances rollup (current year) */}
          <div className="mt-4 rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold">{hm.balancesTitle}</div>
            {balanceRollup.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{hm.noBalances}</p>
            ) : (
              <table className="w-full">
                <thead className="bg-muted/20">
                  <tr>
                    {[hm.balColType, hm.balColEntitled, hm.balColUsed, hm.balColPending, hm.balColRemaining].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {balanceRollup.map((b) => (
                    <tr key={b.leave_type_id}>
                      <td className="px-4 py-2 text-sm">{b.label}</td>
                      <td className="px-4 py-2 text-sm tabular-nums" dir="ltr">{b.entitled}</td>
                      <td className="px-4 py-2 text-sm tabular-nums" dir="ltr">{b.used}</td>
                      <td className="px-4 py-2 text-sm tabular-nums" dir="ltr">{b.pending}</td>
                      <td className="px-4 py-2 text-sm tabular-nums" dir="ltr">{b.remaining}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="attendance" className="mt-0">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{hm.attendanceTitle}</p>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">{hm.attendanceDate}</Label>
                  <Input dir="ltr" type="date" className="h-9 w-40" value={attDate} onChange={(e) => setAttDate(e.target.value)} />
                </div>
                {periodForBoardDate && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${boardLocked ? "bg-purple-500/15 text-purple-600 border-purple-500/20" : "bg-emerald-500/15 text-emerald-600 border-emerald-500/20"}`}>
                    {boardLocked ? <Lock className="mr-1 h-3 w-3" /> : <Unlock className="mr-1 h-3 w-3" />}
                    {boardLocked ? hm.lockedStatus : hm.openStatus} · <span dir="ltr">{periodForBoardDate.period_year}-{String(periodForBoardDate.period_month).padStart(2, "0")}</span>
                  </span>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => void handleExport("attendance")}>
                <Download className="mr-1 h-4 w-4" />
                {t.common.export}
              </Button>
            </div>

            <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/20">
                    <tr>
                      {[t.nav.drivers, hm.colLeaveStatus, hm.colLate, hm.colOvertime, t.common.actions].map((h) => (
                        <th key={h} className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {isLoading ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">{t.common.loading}</td></tr>
                    ) : boardDrivers.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">{t.common.noData}</td></tr>
                    ) : (
                      boardDrivers.map((d) => {
                        const cell: AttendanceGridCell | undefined = cellMap.get(`${d.id}|${boardDate}`)
                        const exception = cell ? attendanceExceptionKind({ status: cell.status }) : null
                        return (
                          <tr key={d.id}>
                            <td className="px-4 py-2 text-sm">
                              <Link href={`/drivers/${d.id}`} className="font-medium hover:underline">{d.full_name_ar ?? d.driver_code ?? d.id}</Link>
                            </td>
                            <td className="px-4 py-2 text-sm">
                              {cell ? (
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${exception ? "bg-amber-500/15 text-amber-600 border-amber-500/20" : "bg-emerald-500/15 text-emerald-600 border-emerald-500/20"}`} dir="ltr">
                                  {attStatusLabel(cell.status ?? "")}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-sm tabular-nums" dir="ltr">{cell ? cell.late_minutes : "—"}</td>
                            <td className="px-4 py-2 text-sm tabular-nums" dir="ltr">{cell ? cell.overtime_minutes : "—"}</td>
                            <td className="px-4 py-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={boardLocked}
                                title={boardLocked ? hm.lockedCellToast : hm.editCell}
                                onClick={async () => {
                                  const next = window.prompt(hm.fieldStatus, cell?.status ?? "present")
                                  if (!next) return
                                  const res = await setAttendanceCell({
                                    driver_id: d.id,
                                    attendance_date: boardDate,
                                    status: next.trim() as "present",
                                  })
                                  if (res.success) {
                                    toast.success(t.common.saved)
                                    emitDriverChanged({ driverId: d.id, action: "attendance" })
                                    refreshAll()
                                  } else toast.error(res.error ?? "Error")
                                }}
                              >
                                <CalendarCheck className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="training" className="mt-0">
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold">{hm.kpiTrainingsExpiring}: <span dir="ltr" className="tabular-nums">{expiring.length}</span></p>
              {expiring.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">{hm.noExpiring}</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs">
                  {expiring.slice(0, 8).map((tr) => {
                    const drv = trainings.find((x) => x.id === tr.id)
                    return (
                      <li key={tr.id} className="flex items-center justify-between gap-2">
                        <Link href={drv ? `/drivers/${drv.driver_id}` : "#"} className="hover:underline">
                          {drv?.driver?.full_name_ar ?? "—"} · {tr.course_name}
                        </Link>
                        <span dir="ltr" className="text-amber-600">{tr.expiry_date} ({tr.days_left})</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-semibold">{hm.trainingsTitle}</p>
                <AddTrainingButton open={trainingDialogOpen} drivers={drivers} onOpenChange={setTrainingDialogOpen} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/20">
                    <tr>
                      {[t.nav.drivers, hm.colCourse, hm.colTrainingDate, hm.colExpiry, hm.colProvider, hm.colScore].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {trainings.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">{hm.noTrainings}</td></tr>
                    ) : (
                      trainings.slice(0, 100).map((tr) => (
                        <tr key={tr.id}>
                          <td className="px-4 py-2 text-sm">
                            <Link href={`/drivers/${tr.driver_id}`} className="hover:underline">{tr.driver?.full_name_ar ?? "—"}</Link>
                          </td>
                          <td className="px-4 py-2 text-sm">{tr.course_name}</td>
                          <td className="px-4 py-2 text-sm" dir="ltr">{tr.training_date}</td>
                          <td className="px-4 py-2 text-sm" dir="ltr">{tr.expiry_date ?? "—"}</td>
                          <td className="px-4 py-2 text-sm">{tr.provider ?? "—"}</td>
                          <td className="px-4 py-2 text-sm tabular-nums" dir="ltr">{tr.score != null ? Number(tr.score).toFixed(0) : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="performance" className="mt-0">
          <EnterpriseModulePage
            title={hm.reviewsTitle}
            primaryCtaIcon={Award}
            primaryCtaLabel={hm.addReview}
            onPrimaryCta={() => { setEditingReview(null); setReviewDialogOpen(true) }}
            columns={reviewColumns}
            data={reviews}
            isLoading={isLoading}
            emptyStateMessage={hm.noReviews}
            rowActions={(r) =>
              r.status === "pending" || r.status === "in_progress" ? (
                <Button size="sm" variant="ghost" title={hm.editReview} onClick={() => { setEditingReview(r); setReviewDialogOpen(true) }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : null
            }
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-semibold">{hm.periodsTitle}</p>
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/20">
                    <tr>
                      {[hm.colPeriodLabel, hm.colPeriodStatus, t.common.actions].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {periods.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-muted-foreground">{t.common.noData}</td></tr>
                    ) : (
                      periods.map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-2 text-sm" dir="ltr">{p.period_year}-{String(p.period_month).padStart(2, "0")}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${p.status === "locked" ? "bg-purple-500/15 text-purple-600 border-purple-500/20" : "bg-emerald-500/15 text-emerald-600 border-emerald-500/20"}`}>
                              {p.status === "locked" ? hm.lockedStatus : hm.openStatus}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {p.status === "open" ? (
                              <Button size="sm" variant="outline" onClick={async () => {
                                const notes = window.prompt(hm.lockPeriodDesc, "")
                                if (notes == null) return
                                const res = await lockAttendancePeriod({ id: p.id, notes: notes.trim() || null })
                                if (res.success) { toast.success(t.common.saved); refreshAll() } else toast.error(res.error ?? "Error")
                              }}>
                                <Lock className="mr-1 h-3.5 w-3.5" />
                                {hm.lockPeriod}
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={async () => {
                                const reason = window.prompt(hm.reopenReason, "")
                                if (reason == null) return
                                if (reason.trim().length < 5) { toast.error(hm.reopenReasonRequired); return }
                                const res = await reopenAttendancePeriod({ id: p.id, reason: reason.trim() })
                                if (res.success) { toast.success(t.common.saved); refreshAll() } else toast.error(res.error ?? "Error")
                              }}>
                                <Unlock className="mr-1 h-3.5 w-3.5" />
                                {hm.reopenPeriod}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-semibold">{hm.holidaysTitle}</p>
                <Button size="sm" variant="outline" onClick={() => { setEditingHoliday(null); setHolidayDialogOpen(true) }}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {hm.addHoliday}
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/20">
                    <tr>
                      {[hm.colHolidayName, hm.colHolidayDate, hm.colCalendarType, t.common.actions].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {holidays.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">{hm.noHolidays}</td></tr>
                    ) : (
                      holidays.slice(0, 50).map((h) => (
                        <tr key={h.id}>
                          <td className="px-4 py-2 text-sm">{h.name_ar}{h.name_en ? <span className="ms-1 text-xs text-muted-foreground">{h.name_en}</span> : null}</td>
                          <td className="px-4 py-2 text-sm" dir="ltr">{h.holiday_date ?? "—"}{(h.duration_days ?? 1) > 1 ? <span className="ms-1 text-xs text-muted-foreground" dir="ltr">+{h.duration_days! - 1}</span> : null}</td>
                          <td className="px-4 py-2 text-sm" dir="ltr">{h.calendar_type}</td>
                          <td className="px-4 py-2">
                            <Button size="sm" variant="ghost" title={t.common.edit} onClick={() => { setEditingHoliday(h); setHolidayDialogOpen(true) }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {trainingDialogOpen && (
        <AddTrainingDialog
          key={`training-new`}
          open
          drivers={drivers}
          onClose={() => setTrainingDialogOpen(false)}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setTrainingDialogOpen(false)
              refreshAll()
            }
          }}
        />
      )}
      {reviewDialogOpen && (
        <PerformanceReviewDialog
          key={`review-${editingReview?.id ?? "new"}`}
          open
          drivers={drivers}
          review={editingReview}
          onClose={() => { setReviewDialogOpen(false); setEditingReview(null) }}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setReviewDialogOpen(false)
              setEditingReview(null)
              refreshAll()
            }
          }}
        />
      )}
      {holidayDialogOpen && (
        <HolidayDialog
          key={`holiday-${editingHoliday?.id ?? "new"}`}
          open
          holiday={editingHoliday}
          onClose={() => { setHolidayDialogOpen(false); setEditingHoliday(null) }}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setHolidayDialogOpen(false)
              setEditingHoliday(null)
              refreshAll()
            }
          }}
        />
      )}
    </div>
  )
}
