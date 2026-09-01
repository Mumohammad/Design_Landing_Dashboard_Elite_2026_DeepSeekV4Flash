"use client";

import * as React from "react";
import { useFormContext } from "react-hook-form";
import { format } from "date-fns";
import { ar, bn, enUS } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  Check,
  CloudUpload,
  FileText,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { useDriverRegistration } from "../provider";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface UploadedDocument {
  path: string;
  fileName: string;
  mimeType: string;
  size: number;
}

type UploadErrorCode = "type" | "size" | "network" | "unknown";

export type UploadResult =
  | { ok: true; file: UploadedDocument }
  | { ok: false; error: UploadErrorCode };

/* ------------------------------------------------------------------ */
/* Upload (browser → Supabase Storage)                                 */
/*                                                                     */
/* Storage policy (migrations 059/060) allows anonymous inserts ONLY   */
/* under driver-applications/drafts/ with UUID-format names and an     */
/* extension allowlist. The previous implementation used React useId   */
/* folder names and timestamp-based file names — every upload was      */
/* rejected by the storage RLS. Both segments are now real UUIDs.      */
/* ------------------------------------------------------------------ */

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadRegistrationDocument(
  draftId: string,
  _documentType: string,
  file: File,
): Promise<UploadResult> {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "type" };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: "size" };
  }

  const supabase = createClient();
  const rawExt = file.name.includes(".") ? (file.name.split(".").pop() ?? "") : "";
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const safeDraftId = UUID_RE.test(draftId) ? draftId : crypto.randomUUID();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const path = `drafts/${safeDraftId}/${fileName}`;

  const { error } = await supabase.storage
    .from("driver-applications")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });

  if (error) {
    // Surface the real server-side reason (RLS, bucket missing, …) so the
    // next field test shows the exact rejection in the browser console.
    console.error("[registration] document upload failed:", error);
    return {
      ok: false,
      error: error.message.includes("duplicate") ? "unknown" : "network",
    };
  }

  return {
    ok: true,
    file: { path, fileName, mimeType: file.type, size: file.size },
  };
}

/* ------------------------------------------------------------------ */
/* Shared error translation (zod message keys → localized strings)     */
/* ------------------------------------------------------------------ */

type RegistrationDict = ReturnType<typeof useDriverRegistration>["dict"];

export function translateFieldError(
  dict: RegistrationDict,
  messageKey: string | undefined,
): string | undefined {
  if (!messageKey) return undefined;
  switch (messageKey) {
    case "errorRequired":
      return dict.common.errorRequired;
    case "errorInvalidMobile":
      return dict.common.errorInvalidMobile;
    case "errorInvalidEmail":
      return dict.common.errorInvalidEmail;
    case "errorTooLong":
      return dict.common.errorTooLong;
    case "errorNone":
      return dict.platforms.errorNone;
    default:
      return dict.common.errorGeneric;
  }
}

/* ------------------------------------------------------------------ */
/* Step chrome                                                         */
/* ------------------------------------------------------------------ */

export function StepHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-1.5">
      <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
        {title}
      </h2>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function StepNav({ onBack }: { onBack?: () => void }) {
  const { dict } = useDriverRegistration();
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {dict.common.back}
        </button>
      ) : (
        <span />
      )}
      <button
        type="submit"
        className="h-11 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-lg shadow-elite-blue-500/25 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40"
      >
        {dict.common.next}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Labeled text input                                                  */
/* ------------------------------------------------------------------ */

export interface TextFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  optional?: boolean;
  error?: string;
}

export function TextField({
  label,
  optional = false,
  error,
  className,
  ...props
}: TextFieldProps) {
  const { dict } = useDriverRegistration();
  const id = React.useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        {optional && (
          <span className="text-xs font-normal text-muted-foreground">
            ({dict.common.optional})
          </span>
        )}
      </Label>
      <Input
        id={id}
        aria-invalid={!!error}
        className={cn(
          "h-12 rounded-2xl border-border/70 bg-card/60 shadow-sm transition-all duration-200",
          "hover:border-elite-blue-500/40 hover:shadow",
          "focus-visible:border-elite-blue-500/60 focus-visible:ring-4 focus-visible:ring-elite-blue-500/15",
          error && "border-destructive focus-visible:ring-destructive/30",
        )}
        {...props}
      />
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Date field (popover calendar with month/year dropdowns)             */
/* ------------------------------------------------------------------ */

const DATE_LOCALES = { en: enUS, ar, ur: enUS, bn } as const;

type Validity = "valid" | "expiring" | "expired";

export interface DateFieldProps {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  checkValidity?: boolean;
  birthDate?: boolean;
}

export function DateField({
  label,
  value,
  onChange,
  error,
  checkValidity = false,
  birthDate = false,
}: DateFieldProps) {
  const { dict, locale } = useDriverRegistration();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);

  const selected = value ? new Date(`${value}T00:00:00`) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startMonth = new Date(1950, 0);
  const endMonth = birthDate
    ? new Date(today.getFullYear() - 16, 11)
    : new Date(today.getFullYear() + 15, 11);
  const defaultMonth = selected ?? (birthDate ? new Date(2000, 0) : today);

  let validity: Validity | null = null;
  if (checkValidity && selected) {
    const diffMs = selected.getTime() - today.getTime();
    validity =
      diffMs < 0 ? "expired" : diffMs / 86400000 <= 90 ? "expiring" : "valid";
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className={cn(
              "h-12 w-full justify-start rounded-2xl border-border/70 bg-card/60 px-4 text-start font-normal shadow-sm transition-all duration-200",
              "hover:border-elite-blue-500/40 hover:shadow",
              "focus-visible:border-elite-blue-500/60 focus-visible:ring-4 focus-visible:ring-elite-blue-500/15",
              !value && "text-muted-foreground",
              error && "border-destructive focus-visible:ring-destructive/30",
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-elite-blue-500" />
            {selected ? format(selected, "dd/MM/yyyy") : dict.common.select}
            {validity && (
              <span
                className={cn(
                  "ms-auto rounded-full px-2 py-0.5 text-[10px] font-bold",
                  validity === "valid" &&
                    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  validity === "expiring" &&
                    "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  validity === "expired" &&
                    "bg-destructive/10 text-destructive",
                )}
              >
                {validity === "valid"
                  ? dict.common.valid
                  : validity === "expiring"
                    ? dict.common.expiringSoon
                    : dict.common.expired}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto rounded-2xl border-border/70 p-2 shadow-2xl shadow-elite-blue-900/10"
          align="start"
        >
          <Calendar
            mode="single"
            locale={DATE_LOCALES[locale]}
            dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}
            selected={selected ?? undefined}
            onSelect={(day) => {
              if (day) onChange(format(day, "yyyy-MM-dd"));
              setOpen(false);
            }}
            autoFocus
            captionLayout="dropdown"
            startMonth={startMonth}
            endMonth={endMonth}
            defaultMonth={defaultMonth}
            reverseYears={birthDate}
            classNames={{
              dropdowns: "flex w-full items-center justify-center gap-2 pb-1",
              dropdown_root: "relative inline-flex items-center",
              dropdown:
                "h-9 cursor-pointer appearance-none rounded-lg border border-border/70 bg-card px-2.5 text-[13px] font-bold text-foreground shadow-sm transition-colors hover:border-elite-blue-500/50 hover:bg-elite-blue-500/5 focus:outline-none focus:ring-2 focus:ring-elite-blue-500/30",
            }}
          />
        </PopoverContent>
      </Popover>
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Selectable card (work type, driver category, …)                     */
/* ------------------------------------------------------------------ */

export interface SelectCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  desc?: string;
  icon?: string;
}

export function SelectCard({
  selected,
  onSelect,
  title,
  desc,
  icon,
}: SelectCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full flex-col items-start gap-1 rounded-2xl border p-5 text-start transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-elite-blue-500/20",
        "active:scale-[0.99]",
        selected
          ? "border-elite-blue-500 bg-elite-blue-500/5 shadow-lg shadow-elite-blue-500/10"
          : "border-border bg-card hover:-translate-y-0.5 hover:border-elite-blue-500/40 hover:shadow-md",
      )}
    >
      <span
        className="absolute end-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors"
        style={
          selected
            ? {
                borderColor: "var(--elite-blue-500, #1E5A99)",
                background: "#1E5A99",
              }
            : undefined
        }
      >
        {selected && <Check className="h-3 w-3 text-white" />}
      </span>
      {icon && (
        <span className="text-2xl" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="mt-1 text-sm font-bold text-foreground">{title}</span>
      {desc && (
        <span className="text-[13px] leading-relaxed text-muted-foreground">
          {desc}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* File field                                                          */
/*                                                                     */
/* Two bugs killed the wizard's Continue button here:                  */
/*  1. The uploaded path lived only in this component's local state —  */
/*     the surrounding react-hook-form field (identityAttachment /     */
/*     licenseAttachment) stayed empty, so zod blocked submit with no  */
/*     visible error. We now sync the path into the form when the      */
/*     field exists (no-op outside a FormProvider, e.g. vehicle and    */
/*     documents steps manage their own state).                        */
/*  2. The missing-attachment validation error is rendered under the   */
/*     dropzone instead of failing silently.                           */
/* ------------------------------------------------------------------ */

const ATTACHMENT_FORM_FIELD: Record<string, string> = {
  identity: "identityAttachment",
  license: "licenseAttachment",
};

export interface FileFieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  file: UploadedDocument | null;
  onFile: (file: UploadedDocument | null) => void;
  draftId: string;
  documentType: string;
  onLocalPreview?: (url: string | null) => void;
}

export function FileField({
  label,
  hint,
  required = false,
  file,
  onFile,
  draftId,
  documentType,
  onLocalPreview,
}: FileFieldProps) {
  const { dict } = useDriverRegistration();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);

  const form = useFormContext();
  const formField = ATTACHMENT_FORM_FIELD[documentType];
  const formError = formField
    ? (
        form?.formState.errors as Record<
          string,
          { message?: string } | undefined
        >
      )[formField]?.message
    : undefined;

  const syncToForm = (path: string, validate: boolean) => {
    if (!form || !formField) return;
    form.setValue(formField, path, { shouldDirty: true });
    if (path) {
      form.clearErrors(formField);
    } else if (validate) {
      void form.trigger(formField);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    const picked = files?.[0];
    if (!picked) return;
    setUploadError(null);
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(picked.type)) {
      setUploadError(dict.common.uploadErrorType);
      return;
    }
    if (picked.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(dict.common.uploadErrorSize);
      return;
    }
    const preview = URL.createObjectURL(picked);
    onLocalPreview?.(preview);
    setUploading(true);
    const result = await uploadRegistrationDocument(
      draftId,
      documentType,
      picked,
    );
    setUploading(false);
    if (!result.ok || !result.file) {
      onLocalPreview?.(null);
      setUploadError(
        result.error === "type"
          ? dict.common.uploadErrorType
          : dict.common.errorGeneric,
      );
      return;
    }
    onFile(result.file);
    syncToForm(result.file.path, false);
  };

  const handleRemove = () => {
    onFile(null);
    onLocalPreview?.(null);
    syncToForm("", true);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-semibold">
          {label}
          {required && (
            <span className="ms-1.5 rounded-full bg-elite-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-elite-orange-600 dark:text-elite-orange-400">
              {dict.documents.requiredLabel}
            </span>
          )}
        </Label>
        {file && (
          <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" /> {dict.common.uploaded}
          </span>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center transition-all duration-200",
          dragActive &&
            "scale-[1.01] border-elite-blue-500 bg-elite-blue-500/10 shadow-lg shadow-elite-blue-500/10",
          !dragActive &&
            (file
              ? "border-emerald-500/50 bg-emerald-500/5"
              : "border-border bg-card/60 hover:border-elite-blue-500/50 hover:bg-elite-blue-500/[0.03]"),
        )}
      >
        {uploading ? (
          <div className="flex w-full flex-col items-center gap-3 py-4">
            <CloudUpload className="h-6 w-6 animate-pulse text-elite-blue-500" />
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 animate-[marquee-x_1.2s_linear_infinite] rounded-full bg-elite-blue-500" />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {dict.common.uploading}
            </span>
          </div>
        ) : file ? (
          <div className="flex items-center gap-3 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-start">
              <p className="max-w-56 truncate text-sm font-semibold text-foreground">
                {file.fileName}
              </p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ms-2 h-8 w-8 text-muted-foreground"
              onClick={handleRemove}
              aria-label={dict.common.remove}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-elite-blue-500/10 text-elite-blue-600 transition-transform duration-200 dark:text-elite-blue-300">
              <CloudUpload className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {dict.common.dragDrop}
              </p>
              <p className="text-xs text-muted-foreground">
                {dict.common.or} · JPG, PNG, WEBP, PDF · 5 MB
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() => inputRef.current?.click()}
              >
                {dict.common.upload}
              </Button>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_MIME_TYPES.join(",")}
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {hint && !uploadError && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {uploadError && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {uploadError}
        </p>
      )}
      {!uploadError && !file && formError && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {translateFieldError(dict, formError)}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Local photo preview (profile photo square)                          */
/* ------------------------------------------------------------------ */

export function PhotoPreview({ previewUrl }: { previewUrl: string | null }) {
  if (!previewUrl) return null;
  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
  return (
    <img
      src={previewUrl}
      alt=""
      className="h-24 w-24 rounded-2xl border border-border object-cover shadow-sm"
    />
  );
}
