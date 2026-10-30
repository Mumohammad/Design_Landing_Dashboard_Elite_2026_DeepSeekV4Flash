"use client"

import { useCallback, useEffect, useState } from "react"
import { useTablePage } from "@/hooks/use-table-page"
import { DriverHistoryToolbar } from "./driver-history-toolbar"
import { createClient } from "@/lib/supabase/client"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "@/lib/toast"
import { DriverTabsFormDialog } from "./driver-tabs-form-dialog"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import { archiveDriverProfileOperation } from "@/lib/driver-profile-operations/actions"

type TrainingTabProps = { driverId: string; isAr: boolean }

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
}

export function TrainingTab({ driverId, isAr }: TrainingTabProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const history=useTablePage<Record<string, unknown>>(useCallback((search: string)=>{
    let query=createClient().from("training_records").select("id, course_name, training_date, expiry_date, provider, certificate_url, score, is_passed, updated_at",{count:"exact"}).eq("driver_id",driverId).is("deleted_at",null).order("training_date",{ascending:false}).order("id")
    if(search.trim())query=query.ilike("course_name","%"+search.replace(/[\\%_]/g,"\\$&")+"%")
    return query
  },[driverId]))
  const rows=history.loading?null:history.rows
  const loadError=history.error
  const load=history.reload
  const historyToolbar=<DriverHistoryToolbar search={history.search} onSearchChange={history.setSearch} pagination={history.pagination} loading={history.loading} error={history.error} onRefresh={load} isAr={isAr}/>

  // Other surfaces (HR console) may also write training records.
  useEffect(() => {
    return subscribeDriverChanged((detail) => {
      if (detail.driverId === driverId && detail.action === "training") void load()
    })
  }, [driverId, load])

  const softDelete = async (row: Record<string, unknown>) => {
    setArchiveError(null)
    const result = await archiveDriverProfileOperation("training", driverId, String(row.id), String(row.updated_at ?? ""))
    if (!result.success) {
      setArchiveError(result.error ?? "Failed to archive training record")
      toast.error(result.error)
      return
    }
    toast.success(isAr ? "تمت أرشفة سجل التدريب" : "Training record archived")
    emitDriverChanged({ driverId, action: "training" })
    await load()
  }

  if (rows === null) {
    return (
      <div className="space-y-3">
        {historyToolbar}
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }


  return (
    <div className="space-y-4">
      {historyToolbar}
      {loadError ? <p role="alert" className="text-sm text-destructive">{isAr ? "تعذر تحميل سجلات التدريب." : "Could not load training records."} <Button variant="link" onClick={() => void load()}>{isAr ? "إعادة المحاولة" : "Retry"}</Button></p> : null}
      {archiveError ? <p role="alert" className="text-sm text-destructive">{archiveError}</p> : null}
      <div className="flex items-center justify-end">
        <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => { setEditing(null); setFormOpen(true) }}>
          <Plus className="h-3.5 w-3.5" />{isAr ? "إضافة سجل تدريب" : "Add training record"}
        </Button>
      </div>
      {rows.length === 0 && !loadError ? <p className="rounded-2xl border border-border/50 p-8 text-center text-sm text-muted-foreground">{isAr ? "لا توجد سجلات تدريب" : "No training records yet"}</p> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60">
          <table className="w-full min-w-[760px] text-start text-sm">
            <thead><tr className="border-b border-border/50 text-[11px] text-muted-foreground">
              {[isAr ? "الدورة" : "Course", isAr ? "الجهة" : "Provider", isAr ? "التاريخ" : "Date", isAr ? "الانتهاء" : "Expiry", isAr ? "الدرجة" : "Score", isAr ? "النتيجة" : "Result", isAr ? "الشهادة" : "Certificate", isAr ? "إجراءات" : "Actions"].map(label => <th key={label} className="px-4 py-3 text-start font-semibold">{label}</th>)}
            </tr></thead>
            <tbody>{rows.map(r => {
              const expiryDays = daysUntil(r.expiry_date ? String(r.expiry_date) : null)
              const expiryCls = expiryDays !== null && expiryDays < 0 ? "text-red-600 dark:text-red-400" : expiryDays !== null && expiryDays <= 30 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
              return (
                <tr key={String(r.id)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground">{String(r.course_name ?? "—")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(r.provider ?? "—")}</td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">{String(r.training_date ?? "—")}</td>
                  <td className={`px-4 py-3 ${expiryCls}`} dir="ltr">{String(r.expiry_date ?? "—")}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground/80" dir="ltr">{r.score != null ? `${Number(r.score)}%` : "—"}</td>
                  <td className="px-4 py-3">{r.is_passed == null ? <span className="text-muted-foreground">—</span> : String(r.is_passed) === "true" ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">{isAr ? "ناجح" : "Passed"}</Badge> : <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">{isAr ? "راسب" : "Failed"}</Badge>}</td>
                  <td className="px-4 py-3">{r.certificate_url && /^https?:\/\//i.test(String(r.certificate_url)) ? <a href={String(r.certificate_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-300"><ExternalLink className="h-3 w-3" />{isAr ? "عرض" : "View"}</a> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2">
                    <button type="button" onClick={() => { setEditing(r); setFormOpen(true) }} className="inline-flex items-center gap-1 text-xs font-medium text-elite-blue-600 hover:underline dark:text-elite-blue-300"><Pencil className="h-3 w-3" />{isAr ? "تعديل" : "Edit"}</button>
                    {confirmDeleteId === String(r.id) ? <span className="inline-flex items-center gap-1 text-xs"><button type="button" onClick={() => { setConfirmDeleteId(null); void softDelete(r) }} className="font-medium text-red-600 hover:underline dark:text-red-400">{isAr ? "تأكيد" : "Confirm"}</button><button type="button" onClick={() => setConfirmDeleteId(null)} className="text-muted-foreground hover:text-foreground">{isAr ? "إلغاء" : "Keep"}</button></span> : <button type="button" onClick={() => setConfirmDeleteId(String(r.id))} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline dark:text-red-400"><Trash2 className="h-3 w-3" />{isAr ? "أرشفة" : "Archive"}</button>}
                  </div></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      ) : null}
      <DriverTabsFormDialog surface="training" mode={editing ? "edit" : "create"} open={formOpen} onOpenChange={setFormOpen} driverId={driverId} tenantId="" row={editing} onSaved={() => void load()} />
    </div>
  )
}
