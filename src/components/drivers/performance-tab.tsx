"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type PerformanceTabProps = { driverId: string; isAr: boolean }

type Review = {
  id: string
  review_period: string | null
  review_date: string | null
  attendance_score: number | null
  violations_score: number | null
  platform_kpi_score: number | null
  overall_score: number | null
  strengths: string | null
  improvements: string | null
  goals: string | null
  status: string | null
}

const STATUS_STYLES: Record<string, { ar: string; en: string; className: string }> = {
  draft: {
    ar: "مسودة",
    en: "Draft",
    className: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
  },
  submitted: {
    ar: "مُرسلة",
    en: "Submitted",
    className: "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
  },
  approved: {
    ar: "معتمدة",
    en: "Approved",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  final: {
    ar: "نهائية",
    en: "Final",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
}

function scoreColor(v: number | null): string {
  if (v === null) return "text-muted-foreground"
  if (v >= 80) return "text-emerald-600 dark:text-emerald-400"
  if (v >= 60) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

export function PerformanceTab({ driverId, isAr }: PerformanceTabProps) {
  const [rows, setRows] = useState<Review[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("performance_reviews")
        .select(
          "id, review_period, review_date, attendance_score, violations_score, platform_kpi_score, overall_score, strengths, improvements, goals, status",
        )
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("review_date", { ascending: false })
        .limit(12)
      if (!cancelled) setRows(error ? [] : ((data ?? []) as unknown as Review[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
        <p className="text-sm text-muted-foreground">
          {isAr ? "لا توجد تقييمات أداء بعد" : "No performance reviews yet"}
        </p>
      </div>
    )
  }

  const latest = rows[0]
  const latestStatus = STATUS_STYLES[String(latest.status ?? "")] ?? null

  const metrics = [
    {
      label: isAr ? "الحضور" : "Attendance",
      value: latest.attendance_score,
    },
    {
      label: isAr ? "المخالفات" : "Violations",
      value: latest.violations_score,
    },
    {
      label: isAr ? "مؤشرات المنصة" : "Platform KPI",
      value: latest.platform_kpi_score,
    },
  ]

  const notes = [
    { label: isAr ? "نقاط القوة" : "Strengths", text: latest.strengths },
    { label: isAr ? "مجالات التحسين" : "Improvements", text: latest.improvements },
    { label: isAr ? "الأهداف" : "Goals", text: latest.goals },
  ].filter((n) => n.text && n.text.trim().length > 0)

  return (
    <div className="space-y-4">
      {/* Latest review highlight */}
      <div className="rounded-2xl border border-border/50 bg-card/60 p-5 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs text-muted-foreground">
              {isAr ? "أحدث تقييم" : "Latest review"}
            </div>
            <div className="text-sm font-semibold text-foreground" dir="ltr">
              {latest.review_period ?? latest.review_date ?? "—"}
            </div>
            {latestStatus && (
              <Badge className={cn("mt-1.5", latestStatus.className)}>
                {isAr ? latestStatus.ar : latestStatus.en}
              </Badge>
            )}
          </div>
          <div className="text-center">
            <div
              className={cn("text-3xl font-extrabold tabular-nums", scoreColor(latest.overall_score))}
              dir="ltr"
            >
              {latest.overall_score !== null ? Number(latest.overall_score) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {isAr ? "الدرجة الإجمالية" : "Overall score"}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl bg-muted/30 p-3 text-center">
              <div className={cn("text-lg font-bold tabular-nums", scoreColor(m.value))} dir="ltr">
                {m.value !== null ? Number(m.value) : "—"}
              </div>
              <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{m.label}</div>
            </div>
          ))}
        </div>
        {notes.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {notes.map((n) => (
              <div key={n.label} className="rounded-xl border border-border/40 bg-muted/20 p-3">
                <div className="text-[11px] font-semibold text-muted-foreground">{n.label}</div>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-foreground/80">
                  {n.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
        <table className="w-full min-w-[680px] text-start text-sm">
          <thead>
            <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الفترة" : "Period"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Date"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحضور" : "Attendance"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "المخالفات" : "Violations"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "KPI المنصة" : "Platform KPI"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الإجمالي" : "Overall"}</th>
              <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = STATUS_STYLES[String(r.status ?? "")] ?? null
              return (
                <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground" dir="ltr">
                    {r.review_period ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                    {r.review_date ?? "—"}
                  </td>
                  <td className={cn("px-4 py-3 tabular-nums", scoreColor(r.attendance_score))} dir="ltr">
                    {r.attendance_score !== null ? Number(r.attendance_score) : "—"}
                  </td>
                  <td className={cn("px-4 py-3 tabular-nums", scoreColor(r.violations_score))} dir="ltr">
                    {r.violations_score !== null ? Number(r.violations_score) : "—"}
                  </td>
                  <td className={cn("px-4 py-3 tabular-nums", scoreColor(r.platform_kpi_score))} dir="ltr">
                    {r.platform_kpi_score !== null ? Number(r.platform_kpi_score) : "—"}
                  </td>
                  <td
                    className={cn("px-4 py-3 font-semibold tabular-nums", scoreColor(r.overall_score))}
                    dir="ltr"
                  >
                    {r.overall_score !== null ? Number(r.overall_score) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {st ? (
                      <Badge className={st.className}>{isAr ? st.ar : st.en}</Badge>
                    ) : (
                      <span className="text-muted-foreground">{r.status ?? "—"}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
