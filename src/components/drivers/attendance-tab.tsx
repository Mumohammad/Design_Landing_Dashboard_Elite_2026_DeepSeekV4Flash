"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type AttendanceTabProps = { driverId: string; isAr: boolean }

const STATUS_STYLES: Record<string, { ar: string; en: string; className: string }> = {
  present: {
    ar: "حاضر",
    en: "Present",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  absent: {
    ar: "غائب",
    en: "Absent",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
  late: {
    ar: "متأخر",
    en: "Late",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  on_leave: {
    ar: "إجازة",
    en: "Leave",
    className: "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
  },
  holiday: {
    ar: "عطلة",
    en: "Holiday",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  },
}

function AttendanceStatusBadge({ status, isAr }: { status: string; isAr: boolean }) {
  const meta = STATUS_STYLES[status] ?? {
    ar: status,
    en: status,
    className: "bg-muted text-muted-foreground",
  }
  return <Badge className={meta.className}>{isAr ? meta.ar : meta.en}</Badge>
}

export function AttendanceTab({ driverId, isAr }: AttendanceTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_attendance_records")
        .select(
          "id, attendance_date, check_in_time, check_out_time, scheduled_hours, overtime_hours, status, notes",
        )
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("attendance_date", { ascending: false })
        .limit(60)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  const summary = useMemo(() => {
    const counts = { present: 0, absent: 0, late: 0 }
    for (const r of rows ?? []) {
      const s = String(r.status ?? "")
      if (s === "present") counts.present += 1
      else if (s === "absent") counts.absent += 1
      else if (s === "late") counts.late += 1
    }
    return counts
  }, [rows])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
        <p className="text-sm text-muted-foreground">
          {isAr ? "لا توجد سجلات حضور بعد" : "No attendance records yet"}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            { key: "present", value: summary.present, color: "text-emerald-600 dark:text-emerald-400" },
            { key: "absent", value: summary.absent, color: "text-red-600 dark:text-red-400" },
            { key: "late", value: summary.late, color: "text-amber-600 dark:text-amber-400" },
          ] as const
        ).map((s) => (
          <div
            key={s.key}
            className="rounded-2xl border border-border/50 bg-card/60 p-4 text-center backdrop-blur-sm"
          >
            <div className={cn("text-2xl font-extrabold tabular-nums", s.color)}>{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {isAr ? STATUS_STYLES[s.key].ar : STATUS_STYLES[s.key].en}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
        <table className="w-full min-w-[680px] text-start text-sm">
          <thead>
            <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Date"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحضور" : "Check-in"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الانصراف" : "Check-out"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الساعات" : "Hours"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "إضافي" : "Overtime"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "ملاحظات" : "Notes"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground" dir="ltr">
                  {String(r.attendance_date ?? "—")}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground" dir="ltr">
                  {r.check_in_time ? String(r.check_in_time).slice(0, 5) : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground" dir="ltr">
                  {r.check_out_time ? String(r.check_out_time).slice(0, 5) : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.scheduled_hours != null ? `${Number(r.scheduled_hours)}h` : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.overtime_hours != null && Number(r.overtime_hours) > 0
                    ? `+${Number(r.overtime_hours)}h`
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <AttendanceStatusBadge status={String(r.status ?? "present")} isAr={isAr} />
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                  {String(r.notes ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
