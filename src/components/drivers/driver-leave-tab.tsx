"use client";

import { useCallback, useEffect, useState } from "react";

import { CalendarClock, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { emitDriverChanged, subscribeDriverChanged } from "@/lib/drivers/driver-events";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  /** RTL flag passed by some callers; content is bilingual so no branching needed. */
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
  const supabase = createClient();
  const displayName = driverName?.trim() || "the driver";
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<LeaveRow | null>(null);
  const [cancelRow, setCancelRow] = useState<LeaveRow | null>(null);
  const [restoreRow, setRestoreRow] = useState<LeaveRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("driver_leave_requests")
      .select("id, leave_type_code, start_date, end_date, days_requested, status, created_at")
      .eq("driver_id", driverId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    // Cancelled rows stay listed so they can be restored while pending.
    setRows(((data as LeaveRow[] | null) ?? []).filter((row) => row.status !== "rejected"));
    setLoading(false);
  }, [driverId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribeDriverChanged((detail) => {
      if (detail.driverId === driverId && detail.action === "leave") void load();
    });
  }, [driverId, load]);

  const act = async (row: LeaveRow, action: "approved" | "rejected") => {
    if (actingId) return;
    setActingId(row.id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("driver_leave_requests")
        .update({ status: action, decided_by: user?.id ?? null, decided_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw error;

      // Approved leave moves the driver to on_leave automatically.
      if (action === "approved") {
        const { error: statusError } = await supabase.rpc("set_driver_status", {
          p_driver_id: driverId,
          p_status: "on_leave",
          p_reason: `Leave approved (${row.leave_type_code})`,
          p_changed_by: user?.id ?? null,
        });
        if (statusError) throw statusError;
      }

      toast.success(`Leave ${action} for ${displayName}`);
      await load();
      emitDriverChanged({ driverId, action: action === "approved" ? "status" : "leave" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update leave request";
      toast.error(message);
    } finally {
      setActingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading leave requests…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <CalendarClock className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No leave requests</p>
        <p className="text-xs text-muted-foreground">
          Submit a leave request from the actions menu to track driver time off.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium capitalize text-foreground">
              {row.leave_type_code.replace(/_/g, " ")}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.start_date} → {row.end_date}
              {row.days_requested ? ` · ${row.days_requested} days` : ""}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[row.status] ?? "outline"} className="capitalize">
            {row.status}
          </Badge>
          {row.status === "pending" ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={actingId === row.id}
                onClick={() => void act(row, "approved")}
              >
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={actingId === row.id}
                onClick={() => void act(row, "rejected")}
              >
                <XCircle className="size-3.5 text-destructive" />
                Reject
              </Button>
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
        row={editRow ?? { id: "", leave_type_code: "", start_date: "", end_date: "", days_requested: null, status: "", created_at: "" }}
        driverId={driverId}
        onSaved={() => void load()}
      />
      <LeaveRequestCancelDialog
        open={cancelRow !== null}
        onOpenChange={(open) => {
          if (!open) setCancelRow(null);
        }}
        row={cancelRow ?? { id: "", leave_type_code: "", start_date: "", end_date: "", days_requested: null, status: "", created_at: "" }}
        driverId={driverId}
        onSaved={() => void load()}
      />
      <LeaveRequestRestoreDialog
        open={restoreRow !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreRow(null);
        }}
        row={restoreRow ?? { id: "", leave_type_code: "", start_date: "", end_date: "", days_requested: null, status: "", created_at: "" }}
        driverId={driverId}
        onSaved={() => void load()}
      />
    </div>
  );
}

export default DriverLeaveTab;
