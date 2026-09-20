"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"
import { LeaveRequestDialog } from "./leave-request-dialog"

type DriverLeaveTabProps = { driverId: string; isAr: boolean }

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

type Balance = {
  id: string
  entitled_days: number | null
  used_days: number | null
  pending_days: number | null
  remaining_days: number | null
  leave_types: { name_ar: string | null; name_en: string | null } | null
}

export function DriverLeaveTab({ driverId, isAr }: DriverLeaveTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [balances, setBalances] = useState<Balance[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const year = new Date().getFullYear()
    const [requests, bals] = await Promise.all([
      supabase
        .from("driver_leave_requests")
        .select(
          "id, start_date, end_date, days_requested, status, reason, requested_at, reviewed_at, leave_types(code, name_ar, name_en)",
        )
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("requested_at", { ascending: false })
        .limit(30),
      supabase
        .from("driver_leave_balances")
        .select("id, entitled_days, used_days, pending_days, remaining_days, leave_types(name_ar, name_en)")
        .eq("driver_id", driverId)
        .eq("year", year)
        .is("deleted_at", null),
    ])
    setRows(requests.error ? [] : (requests.data as Record<string, unknown>[]))
    setBalances(bals.error ? [] : ((bals.data ?? []) as unknown as Balance[]))
  }, [driverId])

  useEffect(() => {
    void load()
  }, [load])

  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {isAr ? `${rows.length} طلب` : `${rows.length} request${rows.length === 1 ? "" : "s"}`}
        </span>
        <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {isAr ? "طلب إجازة" : "New request"}
        </Button>
      </div>

      {balances.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {balances.map((b) => {
            const typeName = b.leave_types
              ? isAr
                ? (b.leave_types.name_ar ?? b.leave_types.name_en ?? "—")
                : (b.leave_types.name_en ?? b.leave_types.name_ar ?? "—")
              : "—"
            const remaining = Number(b.remaining_days ?? 0)
            return (
              <div
                key={b.id}
                className="rounded-2xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm"
              >
                <div className="text-xs text-muted-foreground">{typeName}</div>
                <div className="mt-1 flex items-baseline gap-1" dir="ltr">
                  <span
                    className={cn(
                      "text-xl font-extrabold tabular-nums",
                      remaining > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {remaining}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    / {Number(b.entitled_days ?? 0)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {isAr ? "متبقٍ / مستحق" : "remaining / entitled"}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">
            {isAr ? "لا توجد طلبات إجازة" : "No leave requests yet"}
          </p>
        </div>
      ) : (
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
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "تاريخ المراجعة" : "Reviewed"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lt = r.leave_types as { name_ar: string | null; name_en: string | null } | null
                const typeName = lt
                  ? isAr
                    ? (lt.name_ar ?? lt.name_en ?? "—")
                    : (lt.name_en ?? lt.name_ar ?? "—")
                  : "—"
                const status = LEAVE_STATUS_STYLES[String(r.status ?? "pending")] ?? {
                  ar: String(r.status ?? "—"),
                  en: String(r.status ?? "—"),
                  className: "bg-muted text-muted-foreground",
                }
                return (
                  <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">{typeName}</td>
                    <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                      {String(r.start_date ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                      {String(r.end_date ?? "—")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                      {r.days_requested != null ? String(r.days_requested) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={status.className}>{isAr ? status.ar : status.en}</Badge>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                      {String(r.reason ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                      {r.reviewed_at ? String(r.reviewed_at).slice(0, 10) : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <LeaveRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        driverId={driverId}
        isAr={isAr}
        onCreated={() => void load()}
      />
    </div>
  )
}
