"use client";

import { useEffect, useState } from "react";

import { Loader2, Trash2 } from "lucide-react";
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

export type DriverTabSurface = "attendance" | "violations" | "training" | "performance";

type FieldDef = {
  key: string;
  label: string;
  type: "date" | "text" | "number" | "textarea" | "select";
  required?: boolean;
  min?: string;
  options?: { value: string; label: string }[];
};

type SurfaceConfig = {
  table: string;
  action: DriverChangedActionName;
  editMode: "update" | "soft-delete";
  title: { create: string; edit: string };
  description: string;
  fields: FieldDef[];
};

type DriverChangedActionName =
  | "attendance"
  | "violation"
  | "training"
  | "performance";

const CONFIG: Record<DriverTabSurface, SurfaceConfig> = {
  attendance: {
    table: "driver_attendance",
    action: "attendance",
    editMode: "update",
    title: { create: "Add attendance day", edit: "Edit attendance day" },
    description: "One row per calendar day — the date must be unique per driver.",
    fields: [
      { key: "attendance_date", label: "Date", type: "date", required: true },
      {
        key: "status",
        label: "Status",
        type: "select",
        required: true,
        options: [
          { value: "present", label: "Present" },
          { value: "late", label: "Late" },
          { value: "half_day", label: "Half day" },
          { value: "absent_excused", label: "Absent (excused)" },
          { value: "absent_unexcused", label: "Absent" },
          { value: "on_leave", label: "On leave" },
          { value: "public_holiday", label: "Public holiday" },
          { value: "day_off", label: "Day off" },
        ],
      },
      { key: "check_in_time", label: "Check-in (HH:MM)", type: "text" },
      { key: "check_out_time", label: "Check-out (HH:MM)", type: "text" },
      { key: "late_minutes", label: "Late minutes", type: "number" },
      { key: "overtime_minutes", label: "Overtime minutes", type: "number" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
  violations: {
    table: "violations",
    action: "violation",
    editMode: "soft-delete",
    title: { create: "Add violation", edit: "Edit violation" },
    description: "Record a violation — it stays pending until reviewed.",
    fields: [
      { key: "incident_date", label: "Incident date", type: "date", required: true },
      { key: "incident_location", label: "Location", type: "text" },
      { key: "deduction_amount", label: "Deduction (SAR)", type: "number" },
      { key: "incident_description", label: "Description", type: "textarea" },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "pending", label: "Pending" },
          { value: "confirmed", label: "Confirmed" },
          { value: "waived", label: "Waived" },
          { value: "disputed", label: "Disputed" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
    ],
  },
  training: {
    table: "training_records",
    action: "training",
    editMode: "soft-delete",
    title: { create: "Add training record", edit: "Edit training record" },
    description: "Courses and certificates for this driver.",
    fields: [
      { key: "course_name", label: "Course name", type: "text", required: true },
      { key: "training_date", label: "Training date", type: "date", required: true },
      { key: "expiry_date", label: "Expiry date", type: "date" },
      { key: "provider", label: "Provider", type: "text" },
      { key: "score", label: "Score (%)", type: "number" },
      {
        key: "is_passed",
        label: "Result",
        type: "select",
        options: [
          { value: "true", label: "Passed" },
          { value: "false", label: "Failed" },
        ],
      },
      { key: "certificate_url", label: "Certificate URL", type: "text" },
    ],
  },
  performance: {
    table: "performance_reviews",
    action: "performance",
    editMode: "soft-delete",
    title: { create: "Add performance review", edit: "Edit performance review" },
    description: "Periodic reviews with scores and notes.",
    fields: [
      { key: "review_period", label: "Period", type: "text", required: true },
      { key: "review_date", label: "Review date", type: "date", required: true },
      { key: "attendance_score", label: "Attendance score", type: "number" },
      { key: "violations_score", label: "Violations score", type: "number" },
      { key: "platform_kpi_score", label: "Platform KPI score", type: "number" },
      { key: "overall_score", label: "Overall score", type: "number" },
      { key: "strengths", label: "Strengths", type: "textarea" },
      { key: "improvements", label: "Improvements", type: "textarea" },
      { key: "goals", label: "Goals", type: "textarea" },
    ],
  },
};

type Row = Record<string, unknown>;

type DriverTabsFormDialogProps = {
  surface: DriverTabSurface;
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  tenantId: string;
  /** Existing row for edit mode (from the tab's list query). */
  row?: Row | null;
  /** Pending violations edit to apply on save (see violations-tab). */
  pendingEdit?: Partial<Record<string, unknown>> | null;
  onSaved?: () => void;
};

function toStringValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function toDateInput(iso: unknown): string {
  const s = toStringValue(iso);
  if (!s) return "";
  return s.slice(0, 10);
}

function toTimeInput(iso: unknown): string {
  const s = toStringValue(iso);
  if (!s) return "";
  return s.slice(11, 16);
}

export function DriverTabsFormDialog({
  surface,
  mode,
  open,
  onOpenChange,
  driverId,
  tenantId,
  row = null,
  pendingEdit = null,
  onSaved,
}: DriverTabsFormDialogProps) {
  const config = CONFIG[surface];
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const field of config.fields) {
      const raw = row?.[field.key];
      if (field.type === "date") next[field.key] = toDateInput(raw);
      else if (field.key === "check_in_time" || field.key === "check_out_time")
        next[field.key] = toTimeInput(raw);
      else next[field.key] = toStringValue(raw);
    }
    setValues(next);
    setConfirmDelete(false);
  }, [open, row, config.fields]);

  const setField = (key: string, v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {};
    for (const field of config.fields) {
      const raw = values[field.key] ?? "";
      if (field.type === "number") {
        if (raw.trim() !== "") payload[field.key] = Number(raw);
        else payload[field.key] = null;
      } else if (field.type === "select") {
        if (field.key === "is_passed") payload[field.key] = raw === "true";
        else if (raw !== "") payload[field.key] = raw;
      } else {
        payload[field.key] = raw.trim() === "" ? null : raw.trim();
      }
    }
    return payload;
  };

  const save = async () => {
    if (saving) return;
    const missing = config.fields.filter(
      (f) => f.required && (values[f.key] ?? "").trim() === "",
    );
    if (missing.length > 0) {
      toast.error(`Required: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const payload = buildPayload();

      // Resolve the tenant from the driver row — RLS WITH CHECK requires it on
      // insert and the tab components don't carry tenant_id.
      let tenantIdResolved = tenantId;
      if (mode === "create" && !tenantIdResolved) {
        const { data: driverRow } = await supabase
          .from("drivers")
          .select("tenant_id")
          .eq("id", driverId)
          .maybeSingle();
        tenantIdResolved = (driverRow?.tenant_id as string | undefined) ?? "";
      }

      if (mode === "create") {
        if (!tenantIdResolved) throw new Error("Driver tenant not found");
        const insert: Record<string, unknown> = {
          ...payload,
          driver_id: driverId,
          tenant_id: tenantIdResolved,
        };
        if (surface === "violations") {
          insert.source = "manual";
          insert.status = payload.status ?? "pending";
        }
        if (surface === "attendance") {
          insert.entry_method = "manual";
        }
        const { error } = await supabase.from(config.table).insert(insert);
        if (error) throw error;
        toast.success("Saved");
      } else {
        const update: Record<string, unknown> = { ...payload, ...(pendingEdit ?? {}) };
        const { error } = await supabase
          .from(config.table)
          .update(update)
          .eq("id", String(row?.id ?? ""));
        if (error) throw error;
        toast.success("Saved");
      }

      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: config.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const softDelete = async () => {
    if (saving || !row?.id) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from(config.table)
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", String(row.id));
      if (error) throw error;
      toast.success("Deleted");
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: config.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? config.title.create : config.title.edit}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {config.fields.map((field) => (
            <div
              key={field.key}
              className={field.type === "textarea" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}
            >
              <Label htmlFor={`${surface}-${field.key}`}>
                {field.label}
                {field.required ? " *" : ""}
              </Label>
              {field.type === "textarea" ? (
                <Textarea
                  id={`${surface}-${field.key}`}
                  rows={3}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              ) : field.type === "select" ? (
                <Select
                  value={values[field.key] ?? ""}
                  onValueChange={(v) => setField(field.key, v)}
                >
                  <SelectTrigger id={`${surface}-${field.key}`}>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options ?? []).map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`${surface}-${field.key}`}
                  type={field.type === "number" ? "number" : field.type}
                  dir="ltr"
                  min={field.min}
                  step={field.type === "number" ? "any" : undefined}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          {mode === "edit" && config.editMode === "soft-delete" ? (
            confirmDelete ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={saving}
                >
                  Keep record
                </Button>
                <Button variant="destructive" onClick={() => void softDelete()} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Confirm delete
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            )
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "create" ? "Add" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DriverTabsFormDialog;
