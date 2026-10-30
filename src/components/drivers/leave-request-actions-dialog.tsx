"use client";

import { useTranslation } from "@/hooks/use-translation";
import { LocalizedText, useUiText } from "@/components/localized-text"
import { useState } from "react";

import { Loader2, Send } from "lucide-react";
import { toast } from "@/lib/toast";

import { emitDriverChanged } from "@/lib/drivers/driver-events";
import { useLeaveTypes } from "@/hooks/use-leave-types";
import { mutateDriverLeave } from "@/lib/drivers/leave-actions"
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";


export type LeaveRow = {
  id: string;
  workflow_version: number;
  reason?: string | null;
  deleted_at?: string | null;
  reviewed_at?: string | null;
  leave_type_id: string | null;
  leave_type_name: string | null;
  start_date: string;
  end_date: string;
  days_requested: number | null;
  status: string;
  created_at: string;
};

function diffDaysInclusive(start: string, end: string) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
  return days > 0 ? days : null;
}

type LeaveRequestEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LeaveRow;
  driverId: string;
  onSaved?: () => void;
};

/** Edit a pending leave request (type / dates / reason) before it is approved. */
export function LeaveRequestEditDialog(props: LeaveRequestEditDialogProps) {
  if (!props.open) return null;
  return <LeaveRequestEditForm key={JSON.stringify([props.driverId, props.row])} {...props} />;
}

function LeaveRequestEditForm({
  open,
  onOpenChange,
  row,
  driverId,
  onSaved,
}: LeaveRequestEditDialogProps) {
  const { locale } = useTranslation();
  const ui = useUiText()
  const catalog = useLeaveTypes();
  const leaveTypes = catalog.rows;

  const [selectedTypeId, setTypeId] = useState(row.leave_type_id ?? "");
  const typeId = leaveTypes.some(type => type.id === selectedTypeId) ? selectedTypeId : "";
  const [startDate, setStartDate] = useState(row.start_date);
  const [endDate, setEndDate] = useState(row.end_date);
  const [reason, setReason] = useState(row.reason ?? "");
  const [saving, setSaving] = useState(false);

  const days = diffDaysInclusive(startDate, endDate);

  const save = async () => {
    if (saving) return;
    if (!days) {
      toast.error(ui("End date must be on or after the start date"));
      return;
    }
    setSaving(true);
    try {
      const result=await mutateDriverLeave({action:"edit",requestId:row.id,expectedVersion:row.workflow_version,leaveTypeId:typeId,startDate,endDate,reason})
      if(!result.success)throw Error(locale==="ar"?result.errorAr:result.error)

      toast.success(ui("Leave request updated"));
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : ui("Failed to update leave request");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next=>{if(!saving)onOpenChange(next)}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle><LocalizedText text="Edit leave request" /></DialogTitle>
          <DialogDescription><LocalizedText text="Pending requests can be edited until they are approved or rejected." /></DialogDescription>
        </DialogHeader>

        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="leave-edit-type"><LocalizedText text="Leave type" /></Label>
            <Select
              value={typeId}
              onValueChange={setTypeId}
              disabled={saving||catalog.loading||catalog.error||leaveTypes.length === 0}
            >
              <SelectTrigger id="leave-edit-type">
                <SelectValue
 placeholder={ui(leaveTypes.length === 0 ? "No leave types configured" : "Select leave type")}
                />
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {locale === "ar" ? (type.name_ar ?? type.name_en ?? type.id) : (type.name_en ?? type.name_ar ?? type.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {catalog.error?<div role="alert" className="space-y-2 text-sm text-destructive"><p>{locale==="ar"?"تعذر تحميل أنواع الإجازات.":"Could not load leave types."}</p><Button variant="outline" size="sm" onClick={catalog.retry}>{locale==="ar"?"أعد المحاولة":"Try again"}</Button></div>:null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="leave-edit-start"><LocalizedText text="Start date" /></Label>
              <Input
                id="leave-edit-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-edit-end"><LocalizedText text="End date" /></Label>
              <Input
                id="leave-edit-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {days ? (locale === "ar" ? `${days} يوم مطلوب` : `${days} day${days === 1 ? "" : "s"} requested`) : ui("Select a valid date range")}
          </p>

          <div className="space-y-2">
            <Label htmlFor="leave-edit-reason"><LocalizedText text="Reason" /></Label>
            <Textarea
              id="leave-edit-reason"
              minLength={5} maxLength={500} required aria-describedby="leave-edit-reason-hint"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder={ui("Add context for the approver…")}
            />
            <p id="leave-edit-reason-hint" className="text-xs text-muted-foreground">{locale==="ar"?"مطلوب، من 5 إلى 500 حرف.":"Required, 5 to 500 characters."}</p>
          </div>
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}><LocalizedText text="Cancel" /></Button>
          <Button onClick={() => void save()} disabled={saving || catalog.loading || catalog.error || !days || !typeId || reason.trim().length<5 || reason.trim().length>500}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}<LocalizedText text="Save changes" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type LeaveRequestCancelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LeaveRow;
  driverId: string;
  onSaved?: () => void;
};

/** Cancel a pending leave request (soft delete — restorable while pending). */
export function LeaveRequestCancelDialog(props: LeaveRequestCancelDialogProps) {
  if (!props.open) return null;
  return <LeaveRequestCancelForm key={JSON.stringify([props.driverId, props.row])} {...props} />;
}

function LeaveRequestCancelForm({
  open,
  onOpenChange,
  row,
  driverId,
  onSaved,
}: LeaveRequestCancelDialogProps) {
  const ui = useUiText();
  const {locale}=useTranslation();
  const [reason,setReason]=useState("");
  const [cancelling, setCancelling] = useState(false);

  const confirmCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const result=await mutateDriverLeave({action:"cancel",requestId:row.id,expectedVersion:row.workflow_version,reason})
      if(!result.success)throw Error(locale==="ar"?result.errorAr:result.error)

      toast.success(ui("Leave request cancelled"));
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : ui("Failed to cancel leave request");
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!cancelling) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle><LocalizedText text="Cancel leave request" /></DialogTitle>
          <DialogDescription><LocalizedText text="Cancel this" />{row.leave_type_name ?? "leave"} <LocalizedText text="request (" />{row.start_date} →{" "}
            {row.end_date}<LocalizedText text=")? Cancelled requests are kept and can be restored while they remain pending." /></DialogDescription>
        </DialogHeader>
        <div className="space-y-2"><Label htmlFor="leave-cancel-reason">{locale==="ar"?"السبب":"Reason"}</Label><Textarea id="leave-cancel-reason" value={reason} onChange={event=>setReason(event.target.value)} minLength={5} maxLength={500} disabled={cancelling} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cancelling}><LocalizedText text="Keep request" /></Button>
          <Button
            variant="destructive"
            onClick={() => void confirmCancel()}
            disabled={cancelling || reason.trim().length<5}
          >
            {cancelling ? <Loader2 className="size-4 animate-spin" /> : null}<LocalizedText text="Cancel request" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type LeaveRequestRestoreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LeaveRow;
  driverId: string;
  onSaved?: () => void;
};

/** Restore a cancelled leave request that is still pending. */
export function LeaveRequestRestoreDialog(props: LeaveRequestRestoreDialogProps) {
  if (!props.open) return null;
  return <LeaveRequestRestoreForm key={JSON.stringify([props.driverId, props.row])} {...props} />;
}

function LeaveRequestRestoreForm({
  open,
  onOpenChange,
  row,
  driverId,
  onSaved,
}: LeaveRequestRestoreDialogProps) {
  const ui = useUiText();
  const {locale}=useTranslation();
  const [reason,setReason]=useState("");
  const [restoring, setRestoring] = useState(false);

  const confirmRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const result=await mutateDriverLeave({action:"restore",requestId:row.id,expectedVersion:row.workflow_version,reason})
      if(!result.success)throw Error(locale==="ar"?result.errorAr:result.error)

      toast.success(ui("Leave request restored"));
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : ui("Failed to restore leave request");
      toast.error(message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!restoring) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle><LocalizedText text="Restore leave request" /></DialogTitle>
          <DialogDescription><LocalizedText text="Restore the cancelled" />{row.leave_type_name ?? "leave"} <LocalizedText text="request (" />{row.start_date} →{" "}
            {row.end_date}<LocalizedText text=") back to pending?" /></DialogDescription>
        </DialogHeader>
        <div className="space-y-2"><Label htmlFor="leave-restore-reason">{locale==="ar"?"السبب":"Reason"}</Label><Textarea id="leave-restore-reason" value={reason} onChange={event=>setReason(event.target.value)} minLength={5} maxLength={500} disabled={restoring} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restoring}><LocalizedText text="Keep cancelled" /></Button>
          <Button onClick={() => void confirmRestore()} disabled={restoring || reason.trim().length<5}>
            {restoring ? <Loader2 className="size-4 animate-spin" /> : null}<LocalizedText text="Restore" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
