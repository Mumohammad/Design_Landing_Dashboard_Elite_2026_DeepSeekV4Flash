"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

type DriverLeaveTabProps = { driverId: string; isAr: boolean }

const LEAVE_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  annual: { ar: "سنوية", en: "Annual" },
  sick: { ar: "مرضية", en: "Sick" },
  emergency: { ar: "طارئة", en: "Emergency" },
  unpaid: { ar: "بدون راتب", en: "Unpaid" },
  hajj: { ar: "حج", en: "Hajj" },
  maternity: { ar: "أمومة", en: "Maternity" },
}

const LEAVE_STATUS_STYLES: Record<string, { ar: string; en: string; className: string }> = {
  pending: {
    ar: "قيد الانتظار",
    en: "Pending",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  approved: {
    ar: "معتمدة",
    en: "Approved",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  rejected: {
    ar: "مرفوضة",
    en: "Rejected",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
  cancelled: {
    ar: "ملغاة",
    en: "Cancelled",
    className: "bg-muted text-muted-foreground",
  },
}

export function DriverLeaveTab({ driverId, isAr }: DriverLeaveTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_leave_requests")
        .select(
          "id, leave_type, start_date, end_date, days_count, status, reason, approver, decided_at, created_at",
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
          {isAr ? "لا توجد طلبات إجازة" : "No leave requests yet"}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[720px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "النوع" : "Type"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "من" : "From"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "إلى" : "To"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الأيام" : "Days"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "السبب" : "Reason"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "المعتمد" : "Approver"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const type = LEAVE_TYPE_LABELS[String(r.leave_type ?? "")]
            const status = LEAVE_STATUS_STYLES[String(r.status ?? "pending")] ?? {
              ar: String(r.status ?? "—"),
              en: String(r.status ?? "—"),
              className: "bg-muted text-muted-foreground",
            }
            return (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">
                  {type ? (isAr ? type.ar : type.en) : String(r.leave_type ?? "—")}
                </td>
                <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                  {String(r.start_date ?? "—")}
                </td>
                <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                  {String(r.end_date ?? "—")}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.days_count != null ? String(r.days_count) : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge className={status.className}>{isAr ? status.ar : status.en}</Badge>
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                  {String(r.reason ?? "—")}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{String(r.approver ?? "—")}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
