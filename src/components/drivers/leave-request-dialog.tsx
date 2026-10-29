"use client";

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useTranslation } from "@/hooks/use-translation"
import { useState } from "react";

import { CalendarClock, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { emitDriverChanged } from "@/lib/drivers/driver-events";
import { useLeaveTypes } from "@/hooks/use-leave-types";
import { mutateDriverLeave } from "@/lib/drivers/leave-actions"
import { formatDualDate } from "@/lib/formatting/hijri";
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



type LeaveRequestDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  driverName: string;
  existing?: Record<string, unknown> | null;
  onSaved?: () => void;
};

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function diffDaysInclusive(start: string, end: string) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
  return days > 0 ? days : null;
}

export function LeaveRequestDialog(props: LeaveRequestDialogProps) {
  if (!props.open) return null;
  return <LeaveRequestForm key={props.driverId} {...props} />;
}

function LeaveRequestForm({
  open,
  onOpenChange,
  driverId,
  driverName,
  onSaved,
}: LeaveRequestDialogProps) {
  const ui = useUiText()
  const { locale } = useTranslation()
  const catalog=useLeaveTypes();
  const leaveTypes=catalog.rows;
  const [selectedTypeId, setTypeId] = useState<string>("");
  const typeId=leaveTypes.some(type=>type.id===selectedTypeId)?selectedTypeId:leaveTypes[0]?.id??"";
  // Leave-type code of the current selection — drives the Saudi Labor Law hint.
  const selectedType = leaveTypes.find((t) => t.id === typeId);
  const selectedTypeCode = selectedType?.code;
  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date()));
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestKey]=useState(() => crypto.randomUUID());

  const days = diffDaysInclusive(startDate, endDate);

  const submit = async () => {
    if (saving) return;
    if (!typeId) {
      toast.error(locale==="ar"?"اختر نوع الإجازة":"Select a leave type");
      return;
    }
    if (!days) {
      toast.error(ui("End date must be on or after the start date"));
      return;
    }

    setSaving(true);
    try {
      const result=await mutateDriverLeave({action:"create",driverId,clientRequestId:requestKey,leaveTypeId:typeId,startDate,endDate,reason})
      if(!result.success)throw Error(locale==="ar"?result.errorAr:result.error)

      toast.success(locale==="ar"?`تم إرسال طلب إجازة ${driverName}`:`Leave request submitted for ${driverName}`);
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : ui("Failed to submit leave request");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next=>{if(!saving)onOpenChange(next)}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" /><LocalizedText text="Request Leave" /></DialogTitle>
          <DialogDescription><LocalizedText text="Submit a leave request for" /><span className="font-medium text-foreground">{driverName}</span>:
            {" "}<LocalizedText text="It will be routed for approval." /></DialogDescription>
        </DialogHeader>

        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="leave-type"><LocalizedText text="Leave type" /></Label>
            <Select value={typeId} onValueChange={setTypeId} disabled={saving||catalog.loading||catalog.error||leaveTypes.length===0}>
              <SelectTrigger id="leave-type">
                <SelectValue placeholder={catalog.loading?(locale==="ar"?"جارٍ التحميل…":"Loading…"):ui(leaveTypes.length?"Select leave type":"No leave types configured")} />
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
              <Label htmlFor="leave-start"><LocalizedText text="Start date" /></Label>
              <Input
                id="leave-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-end"><LocalizedText text="End date" /></Label>
              <Input
                id="leave-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {days ? (locale==="ar"?`${days} يوم مطلوب`:`${days} day${days === 1 ? "" : "s"} requested`) : ui("Select a valid date range")}
          </p>

          {/* Dual-calendar display (Saudi requirement): Gregorian + Hijri */}
          {days ? (
            <p className="text-xs text-muted-foreground" dir="ltr">
              {formatDualDate(startDate)} → {formatDualDate(endDate)}
            </p>
          ) : null}

          {/* Saudi Labor Law hint (Art. 109 / 117) — server-side enforcement
              lives in validate_leave_request() + the insert trigger. */}
          {selectedTypeCode === "annual" ? (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><LocalizedText text="Statutory entitlement: 21 days/year (< 5 years of service) or 30 days (5+ years)." /></p>
          ) : selectedTypeCode === "sick" ? (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><LocalizedText text="Statutory 120-day window: 30 days full pay · 60 days half pay · 30 days unpaid." /></p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="leave-reason"><LocalizedText text="Reason" /></Label>
            <Textarea
              id="leave-reason"
              minLength={5} maxLength={500} required aria-describedby="leave-reason-hint"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder={ui("Add context for the approver…")}
            />
            <p id="leave-reason-hint" className="text-xs text-muted-foreground">{locale==="ar"?"مطلوب، من 5 إلى 500 حرف.":"Required, 5 to 500 characters."}</p>
          </div>
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}><LocalizedText text="Cancel" /></Button>
          <Button onClick={() => void submit()} disabled={saving || catalog.loading || catalog.error || !days || !typeId || !requestKey || reason.trim().length<5 || reason.trim().length>500}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}<LocalizedText text="Submit Request" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LeaveRequestDialog;
