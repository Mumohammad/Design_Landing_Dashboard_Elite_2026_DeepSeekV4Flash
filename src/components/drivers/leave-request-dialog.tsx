"use client";

import { useEffect, useState } from "react";

import { CalendarClock, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { emitDriverChanged } from "@/lib/drivers/driver-events";
import { createClient } from "@/lib/supabase/client";
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

type LeaveTypeRow = { id: string; name_en: string | null; name_ar: string | null };


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

export function LeaveRequestDialog({
  open,
  onOpenChange,
  driverId,
  driverName,
  onSaved,
}: LeaveRequestDialogProps) {
  const supabase = createClient();

  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRow[]>([]);
  const [typeId, setTypeId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>(toDateInputValue(new Date()));
  const [endDate, setEndDate] = useState<string>(toDateInputValue(new Date()));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Live schema: leave_types carries (id, name_en, name_ar) and
  // driver_leave_requests.leave_type_id references its id. When no types are
  // configured the select renders an empty state — never a hardcoded fallback.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("leave_types")
        .select("id, name_en, name_ar")
        .order("name_en", { ascending: true });
      if (cancelled) return;
      const rows = (data as LeaveTypeRow[] | null) ?? [];
      if (rows.length > 0) {
        setLeaveTypes(rows);
        setTypeId((current) => (current && rows.some((r) => r.id === current) ? current : rows[0].id));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  useEffect(() => {
    if (!open) return;
    setStartDate(toDateInputValue(new Date()));
    setEndDate(toDateInputValue(new Date()));
    setReason("");
    setTypeId((current) =>
      current && leaveTypes.some((r) => r.id === current) ? current : (leaveTypes[0]?.id ?? ""),
    );
  }, [open, leaveTypes]);

  const days = diffDaysInclusive(startDate, endDate);

  const submit = async () => {
    if (saving) return;
    if (!typeId) {
      toast.error("Select a leave type");
      return;
    }
    if (!days) {
      toast.error("End date must be on or after the start date");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Live schema: leave_type_id uuid NOT NULL; requested_by exists.
      const { error } = await supabase.from("driver_leave_requests").insert({
        driver_id: driverId,
        leave_type_id: typeId,
        start_date: startDate,
        end_date: endDate,
        days_requested: days,
        reason: reason.trim() || null,
        status: "pending",
        requested_by: user?.id ?? null,
      });

      if (error) throw error;

      toast.success(`Leave request submitted for ${driverName}`);
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit leave request";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" />
            Request Leave
          </DialogTitle>
          <DialogDescription>
            Submit a leave request for <span className="font-medium text-foreground">{driverName}</span>:
            {" "}
            It will be routed for approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="leave-type">Leave type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger id="leave-type">
                <SelectValue placeholder="Select leave type" />
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name_en ?? type.name_ar ?? type.id}
                    {type.name_ar ? ` · ${type.name_ar}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="leave-start">Start date</Label>
              <Input
                id="leave-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-end">End date</Label>
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
            {days ? `${days} day${days === 1 ? "" : "s"} requested` : "Select a valid date range"}
          </p>

          <div className="space-y-2">
            <Label htmlFor="leave-reason">Reason (optional)</Label>
            <Textarea
              id="leave-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Add context for the approver…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !days || !typeId}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LeaveRequestDialog;
