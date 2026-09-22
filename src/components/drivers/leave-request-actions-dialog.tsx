"use client";

import { useEffect, useState } from "react";

import { Loader2, Send } from "lucide-react";
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

const FALLBACK_LEAVE_TYPES = [
  { code: "annual", name_en: "Annual Leave", name_ar: "إجازة سنوية" },
  { code: "sick", name_en: "Sick Leave", name_ar: "إجازة مرضية" },
  { code: "emergency", name_en: "Emergency Leave", name_ar: "إجازة طارئة" },
  { code: "unpaid", name_en: "Unpaid Leave", name_ar: "إجازة بدون أجر" },
] as const;

type LeaveTypeRow = { code: string; name_en: string; name_ar: string };

export type LeaveRow = {
  id: string;
  leave_type_code: string;
  start_date: string;
  end_date: string;
  days_requested: number | null;
  status: string;
  created_at: string;
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

function useLeaveTypes(enabled: boolean) {
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRow[]>([...FALLBACK_LEAVE_TYPES]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await createClient()
        .from("driver_leave_types")
        .select("code, name_en, name_ar")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (cancelled) return;
      const rows = (data as LeaveTypeRow[] | null) ?? [];
      if (rows.length > 0) setLeaveTypes(rows);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return leaveTypes;
}

type LeaveRequestEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LeaveRow;
  driverId: string;
  onSaved?: () => void;
};

/** Edit a pending leave request (type / dates / reason) before it is approved. */
export function LeaveRequestEditDialog({
  open,
  onOpenChange,
  row,
  driverId,
  onSaved,
}: LeaveRequestEditDialogProps) {
  const supabase = createClient();
  const leaveTypes = useLeaveTypes(open);

  const [typeCode, setTypeCode] = useState(row.leave_type_code);
  const [startDate, setStartDate] = useState(row.start_date);
  const [endDate, setEndDate] = useState(row.end_date);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTypeCode(row.leave_type_code);
    setStartDate(row.start_date);
    setEndDate(row.end_date);
    let cancelled = false;
    const loadReason = async () => {
      const { data } = await supabase
        .from("driver_leave_requests")
        .select("reason")
        .eq("id", row.id)
        .maybeSingle();
      if (!cancelled) setReason((data?.reason as string | null) ?? "");
    };
    void loadReason();
    return () => {
      cancelled = true;
    };
  }, [open, row, supabase]);

  const days = diffDaysInclusive(startDate, endDate);

  const save = async () => {
    if (saving) return;
    if (!days) {
      toast.error("End date must be on or after the start date");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("driver_leave_requests")
        .update({
          leave_type_code: typeCode,
          start_date: startDate,
          end_date: endDate,
          days_requested: days,
          reason: reason.trim() || null,
        })
        .eq("id", row.id);
      if (error) throw error;

      toast.success("Leave request updated");
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update leave request";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit leave request</DialogTitle>
          <DialogDescription>
            Pending requests can be edited until they are approved or rejected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="leave-edit-type">Leave type</Label>
            <Select value={typeCode} onValueChange={setTypeCode}>
              <SelectTrigger id="leave-edit-type">
                <SelectValue placeholder="Select leave type" />
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map((type) => (
                  <SelectItem key={type.code} value={type.code}>
                    {type.name_en} · {type.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="leave-edit-start">Start date</Label>
              <Input
                id="leave-edit-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-edit-end">End date</Label>
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
            {days ? `${days} day${days === 1 ? "" : "s"} requested` : "Select a valid date range"}
          </p>

          <div className="space-y-2">
            <Label htmlFor="leave-edit-reason">Reason</Label>
            <Textarea
              id="leave-edit-reason"
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
          <Button onClick={() => void save()} disabled={saving || !days}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Save changes
          </Button>
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
export function LeaveRequestCancelDialog({
  open,
  onOpenChange,
  row,
  driverId,
  onSaved,
}: LeaveRequestCancelDialogProps) {
  const supabase = createClient();
  const [cancelling, setCancelling] = useState(false);

  const confirmCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const { error } = await supabase
        .from("driver_leave_requests")
        .update({ status: "cancelled", deleted_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw error;

      toast.success("Leave request cancelled");
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to cancel leave request";
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!cancelling) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel leave request</DialogTitle>
          <DialogDescription>
            Cancel this {row.leave_type_code.replace(/_/g, " ")} request (
            {row.start_date} → {row.end_date})? Cancelled requests are kept and can be restored
            while they remain pending.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cancelling}>
            Keep request
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmCancel()}
            disabled={cancelling}
          >
            {cancelling ? <Loader2 className="size-4 animate-spin" /> : null}
            Cancel request
          </Button>
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
export function LeaveRequestRestoreDialog({
  open,
  onOpenChange,
  row,
  driverId,
  onSaved,
}: LeaveRequestRestoreDialogProps) {
  const supabase = createClient();
  const [restoring, setRestoring] = useState(false);

  const confirmRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const { error } = await supabase
        .from("driver_leave_requests")
        .update({ status: "pending", deleted_at: null })
        .eq("id", row.id);
      if (error) throw error;

      toast.success("Leave request restored");
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to restore leave request";
      toast.error(message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!restoring) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restore leave request</DialogTitle>
          <DialogDescription>
            Restore the cancelled {row.leave_type_code.replace(/_/g, " ")} request (
            {row.start_date} → {row.end_date}) back to pending?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restoring}>
            Keep cancelled
          </Button>
          <Button onClick={() => void confirmRestore()} disabled={restoring}>
            {restoring ? <Loader2 className="size-4 animate-spin" /> : null}
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
