"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { attendanceQuery, attendanceSummary, type AttendanceRow } from "@/lib/operations/overview-queries"
import { useTablePage } from "@/hooks/use-table-page"
import { useReadSummary } from "@/hooks/use-read-summary"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { CalendarDays, CheckCircle2, Clock, UserX } from "lucide-react"

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  present: { ar: "حاضر", en: "Present", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  late: { ar: "متأخر", en: "Late", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  absent_unexcused: { ar: "غائب", en: "Absent", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  absent_excused: { ar: "غائب بعذر", en: "Excused", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  on_leave: { ar: "إجازة", en: "On Leave", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  half_day: { ar: "نصف يوم", en: "Half Day", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  public_holiday: { ar: "عطلة", en: "Holiday", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  day_off: { ar: "راحة", en: "Day Off", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) } catch { return "—" }
}

function fmtDate(date: string): string {
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

export default function AttendancePage() {
  const { t, locale } = useTranslation()
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0])
  const buildQuery = useCallback((term: string) => attendanceQuery(createClient(), term, selectedDate), [selectedDate])
  const { rows, loading, error, search, setSearch, pagination, reload } = useTablePage<AttendanceRow>(buildQuery)
  const readSummary = useCallback((signal: AbortSignal) => attendanceSummary(createClient(), selectedDate, signal), [selectedDate])
  const summary = useReadSummary(readSummary)
  const counts = summary.value

  const kpiCards: KpiCardData[] = [
    { label: locale === "ar" ? "سجلات الحضور" : "Attendance records", value: counts?.[0] ?? "—", icon: CalendarDays, color: "#1E5A99" },
    { label: locale === "ar" ? "حاضر" : "Present", value: counts?.[1] ?? "—", icon: CheckCircle2, color: "#10B981" },
    { label: locale === "ar" ? "متأخر" : "Late", value: counts?.[2] ?? "—", icon: Clock, color: "#F59E0B" },
    { label: locale === "ar" ? "غائب دون عذر" : "Absent without excuse", value: counts?.[3] ?? "—", icon: UserX, color: "#EF4444" },
  ]

  const columns: TableColumn<AttendanceRow>[] = [
    { key: "driver", header: t.nav.drivers, render: (r) => r.driver ? <Link className="font-medium underline underline-offset-4" href={`/drivers/${r.driver_id}`}>{r.driver.full_name_ar}</Link> : "—" },
    { key: "code", header: "Code", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.driver?.driver_code ?? "—"}</span> },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.present
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{locale === "ar" ? s.ar : s.en}</span>
      },
    },
    { key: "check_in_time", header: "Check In", render: (r) => <span dir="ltr" className="tabular-nums">{fmtTime(r.check_in_time)}</span> },
    { key: "check_out_time", header: "Check Out", render: (r) => <span dir="ltr" className="tabular-nums">{fmtTime(r.check_out_time)}</span> },
    { key: "late_minutes", header: "Late (min)", render: (r) => r.late_minutes > 0 ? <span className="text-amber-600 tabular-nums">{r.late_minutes}</span> : <span className="text-muted-foreground">0</span> },
    { key: "working_day_value", header: "Day Value", render: (r) => <span className="tabular-nums">{(r.working_day_value * 100).toFixed(0)}%</span> },
  ]

  return (
    <div className="px-4 lg:px-6 py-4">
      <EnterpriseModulePage
        title={t.nav.attendance}
        subtitle={`${fmtDate(selectedDate)} · ${locale === "ar" ? "إدارة الحضور من ملف السائق. الملخص لجميع سجلات التاريخ المحدد." : "Manage attendance from the driver profile. Summary covers the selected date."}`}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        toolbarActions={
          <input
            type="date"
            aria-label={locale === "ar" ? "تاريخ الحضور" : "Attendance date"}
            value={selectedDate}
            onChange={(e) => { if (e.target.value) { setSelectedDate(e.target.value); pagination.onPageChange(1); summary.reload(); reload() } }}
            className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
          />
        }
        columns={columns}
        data={rows}
        isLoading={loading}
        pagination={pagination}
        loadError={error || summary.error ? (locale === "ar" ? "تعذر تحميل الحضور أو الملخص. أعد المحاولة." : "Could not load attendance or its summary. Try again.") : undefined}
        onRetry={() => { reload(); summary.reload() }}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
