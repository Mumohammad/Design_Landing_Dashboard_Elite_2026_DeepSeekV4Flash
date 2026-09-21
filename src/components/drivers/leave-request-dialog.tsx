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

// Fallback when the lookup table is empty or unreachable — matches the
// seeded driver_leave_types rows (migration 00088).
const FALLBACK_LEAVE_TYPES = [
  { code: "annual", name_en: "Annual Leave", name_ar: "إجازة سنوية" },
  { code: "sick", name_en: "Sick Leave", name_ar: "إجازة مرضية" },
  { code: "emergency", name_en: "Emergency Leave", name_ar: "إجازة طارئة" },
  { code: "unpaid", name_en: "Unpaid Leave", name_ar: "إجازة بدون أجر" },
] as const;

type LeaveTypeRow = { code: string; name_en: string; name_ar: string };

type LeaveBalanceRow = Record<string, unknown>;

type LeaveRequestDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  driverName: string;
  existing?: LeaveBalanceRow | null;
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
  existing = null,
  onSaved,
}: LeaveRequestDialogProps) {
  const supabase = createClient();

  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRow[]>([...FALLBACK_LEAVE_TYPES]);
  const [typeCode, setTypeCode] = useState<string>(FALLBACK_LEAVE_TYPES[0].code);
  const [startDate, setStartDate] = useState<string>(toDateInputValue(new Date()));
  const [endDate, setEndDate] = useState<string>(toDateInputValue(new Date()));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("driver_leave_types")
        .select("code, name_en, name_ar")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (cancelled) return;
      const rows = (data as LeaveTypeRow[] | null) ?? [];
      if (rows.length > 0) {
        setLeaveTypes(rows);
        setTypeCode((current) => current || rows[0].code);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  useEffect(() => {
    if (!open) return;
    setTypeCode((existing?.leave_type_code as string | undefined) ?? FALLBACK_LEAVE_TYPES[0].code);
    setStartDate((existing?.start_date as string | undefined) ?? toDateInputValue(new Date()));
    setEndDate((existing?.end_date as string | undefined) ?? toDateInputValue(new Date()));
    setReason((existing?.reason as string | undefined) ?? "");
  }, [open, existing]);

  const days = diffDaysInclusive(startDate, endDate);

  const submit = async () => {
    if (saving) return;
    if (!days) {
      toast.error("End date must be on or after the start date");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from("driver_leave_requests").insert({
        driver_id: driverId,
        leave_type_code: typeCode,
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
            Submit a leave request for <span className="font-medium text-foreground">{driverName}</span>.
            It will be routed for approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="leave-type">Leave type</Label>
            <Select value={typeCode} onValueChange={setTypeCode}>
              <SelectTrigger id="leave-type">
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
          <Button onClick={() => void submit()} disabled={saving || !days}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
