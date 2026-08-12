"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { CalendarDays, CheckCircle2, Clock, UserX } from "lucide-react"

interface AttendanceRow {
  id: string
  attendance_date: string
  status: string
  check_in_time: string | null
  check_out_time: string | null
  late_minutes: number
  working_day_value: number
  driver: { full_name_ar: string; driver_code: string } | null
}

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
  const { t } = useTranslation()
  const [data, setData] = useState<AttendanceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0])

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const supabase = createClient()
      const { data: result, error } = await supabase
        .from("driver_attendance")
        .select("id,attendance_date,status,check_in_time,check_out_time,late_minutes,working_day_value,driver:drivers(full_name_ar,driver_code)")
        .eq("attendance_date", selectedDate)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100)
      if (error) { console.error(error); setData([]) }
      else { setData((result as unknown as AttendanceRow[]) ?? []) }
      setIsLoading(false)
    }
    load()
  }, [selectedDate])

  const filtered = search
    ? data.filter(r => r.driver?.full_name_ar?.includes(search) || r.driver?.driver_code?.includes(search))
    : data

  const kpiCards: KpiCardData[] = [
    { label: t.dashboard.totalDrivers, value: data.length, icon: CalendarDays, color: "#1E5A99" },
    { label: t.dashboard.activeToday, value: data.filter(r => r.status === "present").length, icon: CheckCircle2, color: "#10B981" },
    { label: t.common.pending, value: data.filter(r => r.status === "late").length, icon: Clock, color: "#F59E0B" },
    { label: t.common.inactive, value: data.filter(r => r.status === "absent_unexcused").length, icon: UserX, color: "#EF4444" },
  ]

  const columns: TableColumn<AttendanceRow>[] = [
    { key: "driver", header: t.nav.drivers, render: (r) => <span className="font-medium">{r.driver?.full_name_ar ?? "—"}</span> },
    { key: "code", header: "Code", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.driver?.driver_code ?? "—"}</span> },
    {
      key: "status", header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.present
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.ar}</span>
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
        subtitle={fmtDate(selectedDate)}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        toolbarActions={
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-9 rounded-xl border border-border/50 bg-muted/30 px-3 text-sm"
          />
        }
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyStateMessage={t.common.noData}
      />
    </div>
  )
}
