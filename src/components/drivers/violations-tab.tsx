"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus } from "lucide-react"
import { ViolationDialog } from "./violation-dialog"

type ViolationsTabProps = { driverId: string; isAr: boolean }

const VIOLATION_STATUS_STYLES: Record<string, { ar: string; en: string; className: string }> = {
  pending: {
    ar: "قيد الانتظار",
    en: "Pending",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  paid: {
    ar: "مدفوعة",
    en: "Paid",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  disputed: {
    ar: "متنازع عليها",
    en: "Disputed",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
  waived: {
    ar: "معفاة",
    en: "Waived",
    className: "bg-muted text-muted-foreground",
  },
  deducted: {
    ar: "مخصومة",
    en: "Deducted",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  },
}

export function ViolationsTab({ driverId, isAr }: ViolationsTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("driver_violations")
      .select(
        "id, violation_type, violation_date, location, fine_amount, points, status, description, paid_by, reported_at",
      )
      .eq("driver_id", driverId)
      .is("deleted_at", null)
      .order("violation_date", { ascending: false })
      .limit(50)
    setRows(error ? [] : (data as Record<string, unknown>[]))
  }, [driverId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("driver_violations")
        .select(
          "id, violation_type, violation_date, location, fine_amount, points, status, description, paid_by, reported_at",
        )
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("violation_date", { ascending: false })
        .limit(50)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  const totals = useMemo(() => {
    let fines = 0
    let points = 0
    for (const r of rows ?? []) {
      fines += Number(r.fine_amount ?? 0)
      points += Number(r.points ?? 0)
    }
    return { fines, points }
  }, [rows])

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
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            {isAr ? "إجمالي الغرامات" : "Total fines"}
          </span>
          <div className="text-lg font-extrabold tabular-nums text-foreground" dir="ltr">
            {totals.fines.toLocaleString("en-US")} {isAr ? "ر.س" : "SAR"}
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            {isAr ? "النقاط" : "Points"}
          </span>
          <div className="text-lg font-extrabold tabular-nums text-foreground" dir="ltr">
            {totals.points}
          </div>
        </div>
        <div className="ms-auto">
          <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {isAr ? "إضافة مخالفة" : "Add violation"}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card/60 p-8 text-center backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">
            {isAr ? "لا توجد مخالفات مسجلة" : "No violations recorded"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
          <table className="w-full min-w-[760px] text-start text-sm">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "النوع" : "Type"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Date"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الموقع" : "Location"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الغرامة" : "Fine"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "النقاط" : "Points"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "يدفعها" : "Paid by"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = VIOLATION_STATUS_STYLES[String(r.status ?? "pending")] ?? {
                  ar: String(r.status ?? "—"),
                  en: String(r.status ?? "—"),
                  className: "bg-muted text-muted-foreground",
                }
                return (
                  <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {String(r.violation_type ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                      {String(r.violation_date ?? "—")}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">
                      {String(r.location ?? "—")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                      {r.fine_amount != null
                        ? `${Number(r.fine_amount).toLocaleString("en-US")} ${isAr ? "ر.س" : "SAR"}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                      {r.points != null ? String(r.points) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={status.className}>{isAr ? status.ar : status.en}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{String(r.paid_by ?? "—")}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ViolationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        driverId={driverId}
        onCreated={() => void load()}
      />
    </div>
  )
}
