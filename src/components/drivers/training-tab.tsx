"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

type TrainingTabProps = { driverId: string; isAr: boolean }

const TRAINING_STATUS_STYLES: Record<string, { ar: string; en: string; className: string }> = {
  completed: {
    ar: "مكتمل",
    en: "Completed",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  in_progress: {
    ar: "قيد التنفيذ",
    en: "In progress",
    className: "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
  },
  scheduled: {
    ar: "مجدول",
    en: "Scheduled",
    className: "bg-muted text-muted-foreground",
  },
  expired: {
    ar: "منتهي",
    en: "Expired",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
}

export function TrainingTab({ driverId, isAr }: TrainingTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_training_records")
        .select(
          "id, training_title, provider, start_date, end_date, expiry_date, status, score, cost, notes",
        )
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(30)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

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
          {isAr ? "لا توجد سجلات تدريب" : "No training records yet"}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[760px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الدورة" : "Course"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الجهة" : "Provider"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الإكمال" : "Completed"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الانتهاء" : "Expiry"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الدرجة" : "Score"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "التكلفة" : "Cost"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = TRAINING_STATUS_STYLES[String(r.status ?? "scheduled")] ?? {
              ar: String(r.status ?? "—"),
              en: String(r.status ?? "—"),
              className: "bg-muted text-muted-foreground",
            }
            const expiryDays = daysUntil(r.expiry_date ? String(r.expiry_date) : null)
            const expiryCls =
              expiryDays !== null && expiryDays < 0
                ? "text-red-600 dark:text-red-400"
                : expiryDays !== null && expiryDays <= 30
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
            return (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">
                  {String(r.training_title ?? "—")}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{String(r.provider ?? "—")}</td>
                <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                  {r.end_date ? String(r.end_date) : "—"}
                </td>
                <td className={`px-4 py-3 ${expiryCls}`} dir="ltr">
                  {r.expiry_date ? String(r.expiry_date) : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge className={status.className}>{isAr ? status.ar : status.en}</Badge>
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.score != null ? `${Number(r.score)}%` : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.cost != null
                    ? `${Number(r.cost).toLocaleString("en-US")} ${isAr ? "ر.س" : "SAR"}`
                    : "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
