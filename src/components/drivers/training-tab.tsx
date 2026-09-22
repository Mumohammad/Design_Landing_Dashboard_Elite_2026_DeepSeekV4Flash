"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { DriverTabsFormDialog } from "./driver-tabs-form-dialog"
import { emitDriverChanged } from "@/lib/drivers/driver-events"

type TrainingTabProps = { driverId: string; isAr: boolean }

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
}

export function TrainingTab({ driverId, isAr }: TrainingTabProps) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("training_records")
      .select("id, course_name, training_date, expiry_date, provider, certificate_url, score, is_passed")
      .eq("driver_id", driverId)
      .is("deleted_at", null)
      .order("training_date", { ascending: false })
      .limit(30)
    setRows(error ? [] : (data as Record<string, unknown>[]))
  }, [driverId])

  useEffect(() => {
    // Defer to a task boundary — the react-hooks compiler flags sync setState
    // traced through the async load body.
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  // Other surfaces (HR console) may also write training records.
  useEffect(() => {
    return subscribeDriverChanged((detail) => {
      if (detail.driverId === driverId && detail.action === "training") void load()
    })
  }, [driverId, load])

  const softDelete = async (row: Record<string, unknown>) => {
    const supabase = createClient()
    const { error } = await supabase
      .from("training_records")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", String(row.id))
    if (error) {
      toast.error(isAr ? "فشل حذف سجل التدريب" : "Failed to delete training record")
      return
    }
    toast.success(isAr ? "تم حذف سجل التدريب" : "Training record deleted")
    emitDriverChanged({ driverId, action: "training" })
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
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          className="h-9 gap-1.5 rounded-xl"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {isAr ? "إضافة سجل تدريب" : "Add training record"}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-[760px] text-start text-sm">
        <thead>
          <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الدورة" : "Course"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الجهة" : "Provider"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "التاريخ" : "Date"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الانتهاء" : "Expiry"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الدرجة" : "Score"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "النتيجة" : "Result"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "الشهادة" : "Certificate"}</th>
            <th className="px-4 py-3 text-start font-semibold">{isAr ? "إجراءات" : "Actions"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expiryDays = daysUntil(r.expiry_date ? String(r.expiry_date) : null)
            const expiryCls =
              expiryDays !== null && expiryDays < 0
                ? "text-red-600 dark:text-red-400"
                : expiryDays !== null && expiryDays <= 30
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
            const passed = r.is_passed
            return (
              <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">
                  {String(r.course_name ?? "—")}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{String(r.provider ?? "—")}</td>
                <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                  {r.training_date ? String(r.training_date) : "—"}
                </td>
                <td className={`px-4 py-3 ${expiryCls}`} dir="ltr">
                  {r.expiry_date ? String(r.expiry_date) : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">
                  {r.score != null ? `${Number(r.score)}%` : "—"}
                </td>
                <td className="px-4 py-3">
                  {passed === null || passed === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : String(passed) === "true" ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                      {isAr ? "ناجح" : "Passed"}
                    </Badge>
                  ) : (
                    <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">
                      {isAr ? "راسب" : "Failed"}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.certificate_url ? (
                    <a
                      href={String(r.certificate_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-300"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {isAr ? "عرض" : "View"}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
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
                    {confirmDeleteId === String(r.id) ? (
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
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>

      <DriverTabsFormDialog
        surface="training"
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
