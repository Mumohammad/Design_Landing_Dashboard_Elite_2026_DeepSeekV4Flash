"use client"

import { useCallback, useEffect, useState } from "react"
import { useTablePage } from "@/hooks/use-table-page"
import { DriverHistoryToolbar } from "./driver-history-toolbar"
import { createClient } from "@/lib/supabase/client"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
import { Pencil, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { businessTimeInput } from "@/lib/driver-profile-operations/schema"
import { DriverTabsFormDialog } from "./driver-tabs-form-dialog"

type AttendanceTabProps = { driverId: string; isAr: boolean }

const STATUS_STYLES: Record<string, { ar: string; en: string; className: string }> = {
  present: {
    ar: "حاضر",
    en: "Present",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  late: {
    ar: "متأخر",
    en: "Late",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  half_day: {
    ar: "نصف يوم",
    en: "Half day",
    className: "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
  },
  absent_excused: {
    ar: "غياب بعذر",
    en: "Absent (excused)",
    className: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
  },
  absent_unexcused: {
    ar: "غياب بدون عذر",
    en: "Absent",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
  on_leave: {
    ar: "إجازة",
    en: "Leave",
    className: "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
  },
  public_holiday: {
    ar: "عطلة رسمية",
    en: "Holiday",
    className: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  },
  day_off: {
    ar: "يوم راحة",
    en: "Day off",
    className: "bg-muted text-muted-foreground",
  },
}

const ENTRY_METHOD_LABELS: Record<string, { ar: string; en: string }> = {
  manual: { ar: "يدوي", en: "Manual" },
  fingerprint: { ar: "بصمة", en: "Fingerprint" },
  gps: { ar: "GPS", en: "GPS" },
  import: { ar: "استيراد", en: "Import" },
}

type Summary = {
  period_year: number | null
  period_month: number | null
  days_present: number | null
  days_late: number | null
  days_absent_excused: number | null
  days_absent_unexcused: number | null
  days_on_leave: number | null
  total_overtime_minutes: number | null
}

function AttendanceStatusBadge({ status, isAr }: { status: string; isAr: boolean }) {
  const meta = STATUS_STYLES[status] ?? {
    ar: status,
    en: status,
    className: "bg-muted text-muted-foreground",
  }
  return <Badge className={meta.className}>{isAr ? meta.ar : meta.en}</Badge>
}

function fmtMinutes(min: number | null | undefined): string {
  if (min == null || Number(min) <= 0) return "—"
  const m = Number(min)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

export function AttendanceTab({ driverId, isAr }: AttendanceTabProps) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [summaryError, setSummaryError] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)

  const history=useTablePage<Record<string,unknown>>(useCallback((search: string)=>{
    let query=createClient().from("driver_attendance").select("id,attendance_date,status,check_in_time,check_out_time,late_minutes,overtime_minutes,entry_method,notes,is_locked,updated_at",{count:"exact"}).eq("driver_id",driverId).is("deleted_at",null).order("attendance_date",{ascending:false}).order("id")
    if(/^\d{4}-\d{2}-\d{2}$/.test(search))query=query.eq("attendance_date",search)
    else if(search.trim())query=query.ilike("notes","%"+search.replace(/[\\%_]/g,"\\$&")+"%")
    return query
  },[driverId]))
  const rows=history.loading?null:history.rows
  const loadError=history.error||summaryError
  const readSummary=useCallback(async()=>{
    const {data,error}=await createClient().from("driver_attendance_summary").select("period_year,period_month,days_present,days_late,days_absent_excused,days_absent_unexcused,days_on_leave,total_overtime_minutes").eq("driver_id",driverId).is("deleted_at",null).order("period_year",{ascending:false}).order("period_month",{ascending:false}).limit(1)
    setSummaryError(!!error);setSummary(error?null:((data?.[0] as Summary|undefined)??null))
  },[driverId])
  const reloadHistory=history.reload
  const load=useCallback(()=>{reloadHistory();void readSummary()},[reloadHistory,readSummary])
  useEffect(()=>{const timer=setTimeout(()=>void readSummary(),0);return()=>clearTimeout(timer)},[readSummary])
  const historyToolbar=<DriverHistoryToolbar search={history.search} onSearchChange={history.setSearch} pagination={history.pagination} loading={history.loading} error={loadError} onRefresh={load} isAr={isAr}/>

  // HR/other surfaces may also write attendance rows.
  useEffect(() => {
    return subscribeDriverChanged((detail) => {
      if (detail.driverId === driverId && detail.action === "attendance") void load()
    })
  }, [driverId, load])

  if (rows === null) {
    return (
      <div className="space-y-3">
        {historyToolbar}
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }

  const absentTotal =
    summary !== null
      ? Number(summary.days_absent_excused ?? 0) + Number(summary.days_absent_unexcused ?? 0)
      : null

  const chips: { label: string; value: string; color: string }[] = summary
    ? [
        {
          label: isAr ? "أيام الحضور" : "Present",
          value: String(summary.days_present ?? 0),
          color: "text-emerald-600 dark:text-emerald-400",
        },
        {
          label: isAr ? "أيام الغياب" : "Absent",
          value: String(absentTotal ?? 0),
          color: "text-red-600 dark:text-red-400",
        },
        {
          label: isAr ? "أيام التأخير" : "Late days",
          value: String(summary.days_late ?? 0),
          color: "text-amber-600 dark:text-amber-400",
        },
        {
          label: isAr ? "إجمالي الإضافي" : "Overtime",
          value: fmtMinutes(summary.total_overtime_minutes),
          color: "text-elite-blue-600 dark:text-elite-blue-300",
        },
      ]
    : []

  return (
    <div className="space-y-4">
      {historyToolbar}
      {loadError ? <p role="alert" className="text-sm text-destructive">{isAr ? "تعذر تحميل الحضور أو الملخص." : "Could not load attendance or its summary."} <Button variant="link" onClick={() => void load()}>{isAr ? "إعادة المحاولة" : "Retry"}</Button></p> : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {isAr ? `${history.count} سجل حضور` : `${history.count} attendance day${history.count === 1 ? "" : "s"}`}
        </span>
        <Button
          size="sm"
          className="h-9 gap-1.5 rounded-xl"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {isAr ? "إضافة يوم حضور" : "Add attendance day"}
        </Button>
      </div>

      {summary && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            {isAr ? "ملخص الفترة" : "Period summary"}:{" "}
            <span dir="ltr" className="tabular-nums">
              {summary.period_year}-{String(summary.period_month ?? "").padStart(2, "0")}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {chips.map((c) => (
              <div
                key={c.label}
                className="rounded-2xl border border-border/50 bg-card/60 p-4 text-center"
              >
                <div className={cn("text-2xl font-extrabold tabular-nums", c.color)} dir="ltr">
                  {c.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{c.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {isAr ? "لا توجد سجلات حضور بعد" : "No attendance records yet"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60">
          <table className="w-full min-w-[720px] text-start text-sm">
            <thead>
              <tr className="border-b border-border/50 text-[11px] text-muted-foreground">
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Date"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحضور" : "Check-in"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الانصراف" : "Check-out"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "تأخير" : "Late"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "إضافي" : "Overtime"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الإدخال" : "Entry"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "ملاحظات" : "Notes"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "إجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const method = ENTRY_METHOD_LABELS[String(r.entry_method ?? "")]
                const late = Number(r.late_minutes ?? 0)
                return (
                  <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground" dir="ltr">
                      {String(r.attendance_date ?? "—")}
                    </td>
                    <td className="px-4 py-3">
                      <AttendanceStatusBadge status={String(r.status ?? "present")} isAr={isAr} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground" dir="ltr">
                      {r.check_in_time ? businessTimeInput(r.check_in_time) : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground" dir="ltr">
                      {r.check_out_time ? businessTimeInput(r.check_out_time) : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 tabular-nums",
                        late > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                      )}
                      dir="ltr"
                    >
                      {late > 0 ? `+${late}m` : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                      {fmtMinutes(r.overtime_minutes as number | null)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {method ? (isAr ? method.ar : method.en) : String(r.entry_method ?? "—")}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">
                      {String(r.notes ?? "—")}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(r)
                          setFormOpen(true)
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-300"
                      >
                        <Pencil className="h-3 w-3" />
                        {isAr ? "تعديل" : "Edit"}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <DriverTabsFormDialog
        surface="attendance"
        mode={editing ? "edit" : "create"}
        open={formOpen}
        onOpenChange={setFormOpen}
        driverId={driverId}
        tenantId=""
        row={editing}
        onSaved={() => void load()}
      />
    </div>
  )
}
