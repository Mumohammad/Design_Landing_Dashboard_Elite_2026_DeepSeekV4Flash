"use client";

import { useTranslation } from "@/hooks/use-translation";
import { LocalizedText, useUiText } from "@/components/localized-text"
import { useCallback, useEffect, useState } from "react";

import { useTablePage } from "@/hooks/use-table-page"
import { DriverHistoryToolbar } from "./driver-history-toolbar"
import { LeaveRequestDialog } from "./leave-request-dialog"
import { CalendarClock, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { emitDriverChanged, subscribeDriverChanged } from "@/lib/drivers/driver-events";
import { createClient } from "@/lib/supabase/client";
import { formatDualDate } from "@/lib/formatting/hijri";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"
import { decideLeaveRequest } from "@/lib/approvals/actions"
import {
  LeaveRequestCancelDialog,
  LeaveRequestEditDialog,
  LeaveRequestRestoreDialog,
  type LeaveRow,
} from "./leave-request-actions-dialog";

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  approved: "outline",
  rejected: "destructive",
  cancelled: "destructive",
};

type DriverLeaveTabProps = {
  driverId: string;
  /** Optional — some callers only pass driverId (+ isAr). */
  driverName?: string;
  /** Legacy caller prop; the shared locale context controls the interface. */
  isAr?: boolean;
  /**
   * Render-prop for per-row extra actions (edit while pending / cancel /
   * restore). Receives the row plus prepared action callbacks.
   */
  children?: (
    row: LeaveRow,
    actions: {
      disabled: boolean;
      onEdit: () => void;
      onCancel: () => void;
      onRestore: () => void;
    },
  ) => React.ReactNode;
};

export function DriverLeaveTab({ driverId, driverName, children }: DriverLeaveTabProps) {
  const { locale } = useTranslation();
  const ui = useUiText();
  const supabase = createClient();
  const displayName = driverName?.trim() || (locale === "ar" ? "السائق" : "the driver");

  const [createOpen,setCreateOpen]=useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [reviewReasons,setReviewReasons]=useState<Record<string,string>>({})
  const [editRow, setEditRow] = useState<LeaveRow | null>(null);
  const [cancelRow, setCancelRow] = useState<LeaveRow | null>(null);
  const [restoreRow, setRestoreRow] = useState<LeaveRow | null>(null);

  const query=useCallback((search:string)=>{
    let request=supabase.from("driver_leave_requests").select("id,workflow_version,reason,deleted_at,reviewed_at,leave_type_id,start_date,end_date,days_requested,status,created_at,leave_types(name_en,name_ar)",{count:"exact"}).eq("driver_id",driverId).or("deleted_at.is.null,status.eq.cancelled").order("created_at",{ascending:false}).order("id",{ascending:false})
    if(search)request=request.ilike("reason","%"+search.replace(/[\\%_]/g,character=>"\\"+character)+"%")
    return request
  },[supabase,driverId])
  const history=useTablePage<LeaveRow&{leave_types:{name_en:string|null;name_ar:string|null}|null}>(query)
  const rows=history.rows.map(row=>({...row,leave_type_name:locale==="ar"?row.leave_types?.name_ar??row.leave_types?.name_en??null:row.leave_types?.name_en??row.leave_types?.name_ar??null}))
  const loading=history.loading
  const load=history.reload
  const toolbar=<div className="space-y-3"><div className="flex justify-end"><Button onClick={()=>setCreateOpen(true)}>{locale==="ar"?"طلب إجازة":"Request Leave"}</Button></div><DriverHistoryToolbar search={history.search} onSearchChange={history.setSearch} pagination={history.pagination} loading={loading} error={history.error} onRefresh={load} isAr={locale==="ar"}/><LeaveRequestDialog open={createOpen} onOpenChange={setCreateOpen} driverId={driverId} driverName={displayName} onSaved={load}/></div>

  useEffect(() => {
    return subscribeDriverChanged((detail) => {
      if (detail.driverId === driverId && detail.action === "leave") void load();
    });
  }, [driverId, load]);

  const act = async (row: LeaveRow, action: "approved" | "rejected") => {
    if (actingId) return;
    setActingId(row.id);
    try {
      const result=await decideLeaveRequest({requestId:row.id,expectedVersion:row.workflow_version,decision:action,reason:reviewReasons[row.id]?.trim()??""})
      if(!result.success){if(result.alreadyDecided)await load();throw new Error(locale==="ar"?result.errorAr??"تعذر مراجعة الطلب.":result.error??"Could not review this request.")}

      toast.success(locale === "ar" ? `تم ${action === "approved" ? "اعتماد" : "رفض"} إجازة ${displayName}` : `Leave ${action} for ${displayName}`);
      await load();
      emitDriverChanged({ driverId, action: action === "approved" ? "status" : "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : ui("Failed to update leave request");
      toast.error(message);
    } finally {
      setActingId(null);
    }
  };

  if(history.error)return <div className="space-y-3">{toolbar}<div role="alert" className="rounded-xl border p-4">{locale==="ar"?"تعذر تحميل سجل الإجازات. أعد المحاولة.":"Could not load leave history. Try again."}<Button variant="outline" onClick={load}>{locale==="ar"?"أعد المحاولة":"Try again"}</Button></div></div>

  if (loading) {
    return (
      <div className="space-y-3">{toolbar}<div role="status" className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /><LocalizedText text="Loading leave requests…" /></div></div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-3">{toolbar}<div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <CalendarClock className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground"><LocalizedText text="No leave requests" /></p>
        <p className="text-xs text-muted-foreground">{locale==="ar"?"استخدم زر طلب إجازة لتسجيل فترة الإجازة ومراجعتها.":"Use Request Leave to record and review dated time off."}</p>
      </div></div>
    );
  }

  return (
    <div className="space-y-2">
      {toolbar}
      {rows.map((row) => (
        <div
          key={row.id}
          data-testid="driver-leave-record" data-leave-id={row.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {row.leave_type_name ?? (locale === "ar" ? "إجازة" : "Leave")}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.start_date} → {row.end_date}
              {row.days_requested ? ` · ${row.days_requested} ${locale === "ar" ? "يوم" : "days"}` : ""}
            </p>
            {/* Dual calendar (Saudi requirement): Gregorian + Umm al-Qura Hijri */}
            <p className="text-[11px] text-muted-foreground/80" dir="ltr">
              {formatDualDate(row.start_date)} → {formatDualDate(row.end_date)}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[row.status] ?? "outline"} className="capitalize">
            {ui(row.status.charAt(0).toUpperCase() + row.status.slice(1))}
          </Badge>
          {row.status === "pending" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input value={reviewReasons[row.id]??""} onChange={event=>setReviewReasons(previous=>({...previous,[row.id]:event.target.value}))} maxLength={500} aria-label={locale==="ar"?"سبب المراجعة":"Review reason"} placeholder={locale==="ar"?"سبب المراجعة (5 أحرف على الأقل)":"Review reason (at least 5 characters)"} className="w-full sm:w-56"/>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={actingId === row.id || (reviewReasons[row.id]?.trim().length??0)<5}
                onClick={() => void act(row, "approved")}
              >
                <CheckCircle2 className="size-3.5 text-emerald-500" /><LocalizedText text="Approve" /></Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={actingId === row.id || (reviewReasons[row.id]?.trim().length??0)<5}
                onClick={() => void act(row, "rejected")}
              >
                <XCircle className="size-3.5 text-destructive" /><LocalizedText text="Reject" /></Button>
            </div>
          ) : null}
          {children
            ? children(row, {
                disabled: actingId === row.id,
                onEdit: () => setEditRow(row),
                onCancel: () => setCancelRow(row),
                onRestore: () => setRestoreRow(row),
              })
            : null}
        </div>
      ))}

      <LeaveRequestEditDialog
        open={editRow !== null}
        onOpenChange={(open) => {
          if (!open) setEditRow(null);
        }}
        row={
          editRow ?? {
            id: "",
            workflow_version: 1,
            leave_type_id: null,
            leave_type_name: null,
            start_date: "",
            end_date: "",
            days_requested: null,
            status: "",
            created_at: "",
          }
        }
        driverId={driverId}
        onSaved={() => void load()}
      />
      <LeaveRequestCancelDialog
        open={cancelRow !== null}
        onOpenChange={(open) => {
          if (!open) setCancelRow(null);
        }}
        row={
          cancelRow ?? {
            id: "",
            workflow_version: 1,
            leave_type_id: null,
            leave_type_name: null,
            start_date: "",
            end_date: "",
            days_requested: null,
            status: "",
            created_at: "",
          }
        }
        driverId={driverId}
        onSaved={() => void load()}
      />
      <LeaveRequestRestoreDialog
        open={restoreRow !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreRow(null);
        }}
        row={
          restoreRow ?? {
            id: "",
            workflow_version: 1,
            leave_type_id: null,
            leave_type_name: null,
            start_date: "",
            end_date: "",
            days_requested: null,
            status: "",
            created_at: "",
          }
        }
        driverId={driverId}
        onSaved={() => void load()}
      />
    </div>
  );
}

export default DriverLeaveTab;
