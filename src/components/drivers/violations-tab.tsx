"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { subscribeDriverChanged as subscribeViolations } from "@/lib/drivers/driver-events"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ViolationDialog } from "./violation-dialog"
import { DriverTabsFormDialog } from "./driver-tabs-form-dialog"
import { emitDriverChanged } from "@/lib/drivers/driver-events"

type ViolationsTabProps = { driverId: string; isAr: boolean }

const VIOLATION_STATUS_STYLES: Record<string, { ar: string; en: string; className: string }> = {
  pending: {
    ar: "قيد الانتظار",
    en: "Pending",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  confirmed: {
    ar: "مؤكدة",
    en: "Confirmed",
    className: "bg-elite-blue-500/15 text-elite-blue-700 dark:text-elite-blue-300",
  },
  deducted: {
    ar: "مخصومة",
    en: "Deducted",
    className: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  },
  paid: {
    ar: "مدفوعة",
    en: "Paid",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  waived: {
    ar: "معفاة",
    en: "Waived",
    className: "bg-muted text-muted-foreground",
  },
  disputed: {
    ar: "متنازع عليها",
    en: "Disputed",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
  cancelled: {
    ar: "ملغاة",
    en: "Cancelled",
    className: "bg-muted text-muted-foreground",
  },
}

const SEVERITY_STYLES: Record<string, { ar: string; en: string; className: string }> = {
  minor: {
    ar: "بسيطة",
    en: "Minor",
    className: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
  },
  moderate: {
    ar: "متوسطة",
    en: "Moderate",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  major: {
    ar: "جسيمة",
    en: "Major",
    className: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  },
  severe: {
    ar: "خطيرة",
    en: "Severe",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
  },
}

const SELECT_FIELDS =
  "id, violation_ref, incident_date, incident_location, deduction_amount, severity, status, warning_level, source, reported_at, violation_types(name_ar, name_en, category)"

export function ViolationsTab({ driverId, isAr }: ViolationsTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("violations")
      .select(SELECT_FIELDS)
      .eq("driver_id", driverId)
      .is("deleted_at", null)
      .order("incident_date", { ascending: false })
      .limit(50)
    setRows(error ? [] : (data as Record<string, unknown>[]))
  }, [driverId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("violations")
        .select(SELECT_FIELDS)
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("incident_date", { ascending: false })
        .limit(50)
      if (!cancelled) setRows(error ? [] : (data as Record<string, unknown>[]))
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  // Other surfaces (HR console, payroll) also record violations.
  useEffect(() => {
    let cancelled = false
    const off = subscribeViolations((detail) => {
      if (detail.driverId === driverId && detail.action === "violation" && !cancelled) void load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [driverId, load])

  const totals = useMemo(() => {
    let deductions = 0
    for (const r of rows ?? []) deductions += Number(r.deduction_amount ?? 0)
    return { count: (rows ?? []).length, deductions }
  }, [rows])

  const softDelete = async (row: Record<string, unknown>) => {
    const supabase = createClient()
    const { error } = await supabase
      .from("violations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", String(row.id))
    if (error) {
      toast.error(isAr ? "فشل حذف المخالفة" : "Failed to delete violation")
      return
    }
    toast.success(isAr ? "تم حذف المخالفة" : "Violation deleted")
    emitDriverChanged({ driverId, action: "violation" })
    await load()
  }

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
            {isAr ? "إجمالي الخصومات" : "Total deductions"}
          </span>
          <div className="text-lg font-extrabold tabular-nums text-foreground" dir="ltr">
            {totals.deductions.toLocaleString("en-US")} {isAr ? "ر.س" : "SAR"}
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            {isAr ? "عدد المخالفات" : "Violations"}
          </span>
          <div className="text-lg font-extrabold tabular-nums text-foreground" dir="ltr">
            {totals.count}
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
          <table className="w-full min-w-[780px] text-start text-sm">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "المرجع" : "Ref"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "النوع" : "Type"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Date"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الموقع" : "Location"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الخصم" : "Deduction"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الشدة" : "Severity"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "الحالة" : "Status"}</th>
                <th className="px-4 py-3 text-start font-semibold">{isAr ? "إجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vt = r.violation_types as {
                  name_ar: string | null
                  name_en: string | null
                } | null
                const typeName = vt
                  ? isAr
                    ? (vt.name_ar ?? vt.name_en ?? "—")
                    : (vt.name_en ?? vt.name_ar ?? "—")
                  : "—"
                const status = VIOLATION_STATUS_STYLES[String(r.status ?? "pending")] ?? {
                  ar: String(r.status ?? "—"),
                  en: String(r.status ?? "—"),
                  className: "bg-muted text-muted-foreground",
                }
                const severity = SEVERITY_STYLES[String(r.severity ?? "")] ?? null
                const deletable = r.status === "pending" || r.status === "cancelled"
                return (
                  <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground" dir="ltr">
                      {String(r.violation_ref ?? "—")}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{typeName}</td>
                    <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                      {String(r.incident_date ?? "—")}
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">
                      {String(r.incident_location ?? "—")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                      {r.deduction_amount != null
                        ? `${Number(r.deduction_amount).toLocaleString("en-US")} ${isAr ? "ر.س" : "SAR"}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {severity ? (
                        <Badge className={severity.className}>{isAr ? severity.ar : severity.en}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{String(r.severity ?? "—")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={status.className}>{isAr ? status.ar : status.en}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-300"
                        >
                          <Pencil className="h-3 w-3" />
                          {isAr ? "تعديل" : "Edit"}
                        </button>
                        {deletable ? (
                          confirmDeleteId === String(r.id) ? (
                            <span className="inline-flex items-center gap-1 text-xs">
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDeleteId(null)
                                  void softDelete(r)
                                }}
                                className="font-medium text-red-600 hover:underline dark:text-red-400"
                              >
                                {isAr ? "تأكيد" : "Confirm"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                {isAr ? "إلغاء" : "Keep"}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(String(r.id))}
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                            >
                              <Trash2 className="h-3 w-3" />
                              {isAr ? "حذف" : "Delete"}
                            </button>
                          )
                        ) : null}
                      </div>
                    </td>
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
      <DriverTabsFormDialog
        surface="violations"
        mode={editing ? "edit" : "create"}
        open={editing !== null}
        onOpenChange={(open) => { if (!open) setEditing(null) }}
        driverId={driverId}
        tenantId=""
        row={editing}
        onSaved={() => void load()}
      />
    </div>
  )
}
