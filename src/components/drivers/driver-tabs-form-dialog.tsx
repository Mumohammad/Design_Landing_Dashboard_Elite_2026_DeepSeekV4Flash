"use client";

import { friendlyError, currentIsArabic } from "@/lib/errors/friendly"
import { LocalizedText, useUiText } from "@/components/localized-text"
import { useState } from "react";

import { Loader2, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { emitDriverChanged } from "@/lib/drivers/driver-events";
import { saveDriverProfileOperation, archiveDriverProfileOperation } from "@/lib/driver-profile-operations/actions";
import { businessTimeInput, VIOLATION_TRANSITIONS, REVIEW_TRANSITIONS } from "@/lib/driver-profile-operations/schema";
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
  type: "date" | "time" | "month" | "text" | "number" | "textarea" | "select";
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
    editMode: "soft-delete",
    title: { create: "Add attendance day", edit: "Edit attendance day" },
    description: "One row per Saudi calendar day. Times use Asia/Riyadh (UTC+03:00). Check-out must follow check-in on the same day.",
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
      { key: "check_in_time", label: "Check-in (Saudi time)", type: "time" },
      { key: "check_out_time", label: "Check-out (Saudi time)", type: "time" },
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
    description: "Record and review a violation. Resolving a deduction queues it for the selected payroll month.",
    fields: [
      { key: "incident_date", label: "Incident date", type: "date", required: true },
      { key: "incident_location", label: "Location", type: "text" },
      { key: "deduction_amount", label: "Deduction (SAR)", type: "number" },
      { key: "incident_description", label: "Description", type: "textarea", required: true },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          ...["open", "under_review", "acknowledged", "disputed", "resolved", "waived", "escalated", "closed"].map(value => ({ value, label: value.replace(/_/g, " ") })),
        ],
      },
      { key: "review_notes", label: "Review notes / waiver reason", type: "textarea" },
      { key: "deduction_month", label: "Deduction month (when resolving)", type: "month" },
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
      { key: "status", label: "Status", type: "select", options: ["pending", "in_progress", "completed", "cancelled"].map(value => ({ value, label: value.replace(/_/g, " ") })) },
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

function toTimeInput(iso: unknown): string { return businessTimeInput(iso); }

function initialValues(surface: DriverTabSurface, mode: "create" | "edit", row: Row | null) {
  const next: Record<string, string> = {};
  for (const field of CONFIG[surface].fields) {
    const raw = row?.[field.key];
    if (field.type === "date") next[field.key] = toDateInput(raw);
    else if (field.key === "check_in_time" || field.key === "check_out_time")
      next[field.key] = toTimeInput(raw);
    else next[field.key] = toStringValue(raw);
  }
  if (mode === "create") {
    if (surface === "attendance") next.status = "present";
    if (surface === "violations") next.status = "open";
    if (surface === "performance") next.status = "pending";
    if (surface === "training") next.is_passed = "false";
  }
  return next;
}

export function DriverTabsFormDialog(props: DriverTabsFormDialogProps) {
  if (!props.open) return null;
  return <DriverTabsForm key={JSON.stringify([props.driverId, props.surface, props.mode, props.row])} {...props} />;
}

function DriverTabsForm({
  surface,
  mode,
  open,
  onOpenChange,
  driverId,
  row = null,
  onSaved,
}: DriverTabsFormDialogProps) {
  const ui = useUiText()
  const config = CONFIG[surface];
  const [values, setValues] = useState(() => initialValues(surface, mode, row));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const immutable = mode === "edit" && ((surface === "attendance" && Boolean(row?.is_locked)) || (surface === "performance" && ["completed", "cancelled"].includes(String(row?.status))) || (surface === "violations" && (["waived", "closed", "deduction_applied"].includes(String(row?.status)) || Boolean(row?.deduction_applied) || (Array.isArray(row?.violation_deduction_ledger) && row.violation_deduction_ledger.length > 0))));
  const canArchive = mode === "edit" && !(surface === "attendance" && row?.is_locked) && (surface !== "performance" || row?.status !== "completed") && (surface !== "violations" || (["open", "waived", "closed"].includes(String(row?.status)) && !row?.deduction_applied && !(Array.isArray(row?.violation_deduction_ledger) && row.violation_deduction_ledger.length)));

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
      const message = `Required: ${missing.map((f) => f.label).join(", ")}`;
      setSaveError(message);
      toast.error(message);
      return;
    }

    setSaving(true);
    try {
      setSaveError(null);
      const result = await saveDriverProfileOperation(surface, driverId, buildPayload(), mode === "edit" ? String(row?.id ?? "") : undefined, mode === "edit" ? String(row?.updated_at ?? "") : undefined);
      if (!result.success) throw new Error(result.error);
      toast.success(ui("Saved"));

      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: config.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save";
      setSaveError(message);
      toast.error(ui(message));
    } finally {
      setSaving(false);
    }
  };

  const softDelete = async () => {
    if (saving || !row?.id) return;
    setSaving(true);
    try {
      setSaveError(null);
      const result = await archiveDriverProfileOperation(surface, driverId, String(row.id), String(row.updated_at ?? ""));
      if (!result.success) throw new Error(result.error);
      toast.success(ui("Archived"));
      onOpenChange(false);
      onSaved?.();
      emitDriverChanged({ driverId, action: config.action });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ui(mode === "create" ? config.title.create : config.title.edit)}</DialogTitle>
          <DialogDescription>{ui(config.description)}</DialogDescription>
        </DialogHeader>

        {saveError ? <p role="alert" className="text-sm text-destructive">{(()=>{const f=friendlyError(saveError,currentIsArabic());return f===saveError?ui(saveError):f})()}</p> : null}
        {immutable ? <p className="text-sm text-muted-foreground">{ui("This finalized record is retained as history.")}</p> : null}
        <fieldset disabled={saving || immutable} className="grid gap-3 sm:grid-cols-2">
          {config.fields.map((field) => (
            <div
              key={field.key}
              className={field.type === "textarea" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}
            >
              <Label htmlFor={`${surface}-${field.key}`}>
                {ui(field.label)}
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
                  <SelectTrigger id={`${surface}-${field.key}`} className="w-full">
                    <SelectValue placeholder={ui("Select…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options ?? []).filter(opt => field.key !== "status" || (surface === "violations" ? (mode === "create" ? ["open"] : VIOLATION_TRANSITIONS[String(row?.status)] ?? []).includes(opt.value) : surface === "performance" ? (mode === "create" ? ["pending"] : REVIEW_TRANSITIONS[String(row?.status)] ?? []).includes(opt.value) : true)).map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {ui(opt.label)}
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
        </fieldset>

        <DialogFooter>
          {canArchive && config.editMode === "soft-delete" ? (
            confirmDelete ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={saving}
                ><LocalizedText text="Keep record" /></Button>
                <Button variant="destructive" onClick={() => void softDelete()} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}<LocalizedText text="Confirm archive" /></Button>
              </>
            ) : (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                <Trash2 className="size-4" /><LocalizedText text="Archive" /></Button>
            )
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}><LocalizedText text="Cancel" /></Button>
          <Button onClick={() => void save()} disabled={saving || immutable}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {ui(mode === "create" ? "Add" : "Save changes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DriverTabsFormDialog;
