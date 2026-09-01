"use client"

import * as React from "react"
import { useFormContext } from "react-hook-form"
import { format } from "date-fns"
import { ar, bn, enUS } from "date-fns/locale"
import type { Locale } from "date-fns"
import { Calendar as CalendarIcon, Check, FileText, UploadCloud, X } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { LogoMark } from "@/components/logo"
import { useDriverRegistration } from "@/contexts/driver-registration-context"
import { registrationLocaleMeta, type RegistrationLocale } from "@/lib/driver-registration/i18n"
import { FlagIcon } from "@/components/flag-icon"
import {
  ALLOWED_TYPES,
  MAX_FILE_BYTES,
  uploadApplicationFile,
  type UploadedFile,
} from "@/lib/driver-registration/storage"

// ── date-fns locale mapping (date-fns has no `ur` locale — fall back to enUS)
const dateLocales: Record<RegistrationLocale, Locale> = { en: enUS, ar: ar, ur: enUS, bn: bn }

// ── Portal header (logo + language switcher) ────────────────────────────────
export function RegistrationHeader() {
  const { dict, locale, setLocale } = useDriverRegistration()
  const [langOpen, setLangOpen] = React.useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 lg:px-8">
        <div className="flex items-center gap-3">
          <LogoMark size={38} />
          <div className="leading-tight">
            <p className="text-sm font-bold text-foreground">{dict.header.brand}</p>
            <p className="text-[11px] text-muted-foreground">{dict.header.tagline}</p>
          </div>
        </div>

        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 font-semibold"
            aria-expanded={langOpen}
            aria-haspopup="listbox"
            onClick={() => setLangOpen((o) => !o)}
          >
            <FlagIcon code={locale} />
            <span>{registrationLocaleMeta[locale].label}</span>
          </Button>
          {langOpen && (
            <>
              <button
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Close language menu"
                onClick={() => setLangOpen(false)}
              />
              <ul
                role="listbox"
                aria-label={dict.language.label}
                className="absolute end-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-lg"
              >
                {(Object.keys(registrationLocaleMeta) as RegistrationLocale[]).map((code) => (
                  <li key={code}>
                    <button
                      role="option"
                      aria-selected={code === locale}
                      onClick={() => {
                        setLocale(code)
                        setLangOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                        code === locale
                          ? "bg-elite-blue-500/10 font-bold text-elite-blue-600 dark:text-elite-blue-300"
                          : "text-foreground hover:bg-accent"
                      )}
                    >
                      <FlagIcon code={code} />
                      <span>{registrationLocaleMeta[code].label}</span>
                      {code === locale && <Check className="ms-auto h-4 w-4" />}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

// ── Text field ──────────────────────────────────────────────────────────────
export function Field({
  label,
  optional = false,
  error,
  className,
  ...props
}: React.ComponentProps<typeof Input> & {
  label: string
  optional?: boolean
  error?: string
}) {
  const { dict } = useDriverRegistration()
  const id = React.useId()
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        {optional && (
          <span className="text-xs font-normal text-muted-foreground">({dict.common.optional})</span>
        )}
      </Label>
      <Input
        id={id}
        aria-invalid={!!error}
        className={cn(
          "h-12 rounded-2xl border-border/70 bg-card/60 shadow-sm transition-all duration-200",
          "hover:border-elite-blue-500/40 hover:shadow",
          "focus-visible:border-elite-blue-500/60 focus-visible:ring-4 focus-visible:ring-elite-blue-500/15",
          error && "border-destructive focus-visible:ring-destructive/30"
        )}
        {...props}
      />
      {error && <p className="text-xs font-medium text-destructive" role="alert">{error}</p>}
    </div>
  )
}

// ── Date field with year/month dropdowns + validity status ──────────────────
// react-day-picker v9: captionLayout="dropdown" gives instant year/month jumps
// instead of stepping month-by-month (critical for birth dates).
//
// NOTE on windows: the DEFAULT window is deliberately wide (1950 → +15y) so no
// existing call site can ever be trapped (steps.tsx does not yet pass birthDate).
// Pass birthDate for DOB-style fields to tighten the window and open at 2000.
export function DateField({
  label,
  value,
  onChange,
  error,
  checkValidity = false,
  birthDate = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  checkValidity?: boolean
  /** true for date-of-birth style fields: past window (1950 → now−16y), opens at 2000 */
  birthDate?: boolean
}) {
  const { dict, locale } = useDriverRegistration()
  const id = React.useId()
  const [open, setOpen] = React.useState(false)

  const parsed = value ? new Date(value + "T00:00:00") : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Wide default window (safe for every field); birthDate tightens to the past.
  const startMonth = new Date(1950, 0)
  const endMonth = birthDate
    ? new Date(today.getFullYear() - 16, 11)
    : new Date(today.getFullYear() + 15, 11)
  const defaultMonth = parsed ?? (birthDate ? new Date(2000, 0) : today)

  let validity: "valid" | "expiring" | "expired" | null = null
  if (checkValidity && parsed) {
    const ms = parsed.getTime() - today.getTime()
    const days = ms / 86400000
    if (ms < 0) validity = "expired"
    else if (days <= 90) validity = "expiring"
    else validity = "valid"
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
              error && "border-destructive focus-visible:ring-destructive/30"
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-elite-blue-500" />
            {value ? format(parsed!, "dd/MM/yyyy") : dict.common.select}
            {validity && (
              <span
                className={cn(
                  "ms-auto rounded-full px-2 py-0.5 text-[10px] font-bold",
                  validity === "valid" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  validity === "expiring" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  validity === "expired" && "bg-destructive/10 text-destructive"
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
            locale={dateLocales[locale]}
            dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}
            selected={parsed ?? undefined}
            onSelect={(d) => {
              if (d) onChange(format(d, "yyyy-MM-dd"))
              setOpen(false)
            }}
            autoFocus
            captionLayout="dropdown"
            startMonth={startMonth}
            endMonth={endMonth}
            defaultMonth={defaultMonth}
            reverseYears={birthDate}
            classNames={{
              dropdowns:
                "flex w-full items-center justify-center gap-2 pb-1",
              dropdown_root: "relative inline-flex items-center",
              dropdown:
                "h-9 cursor-pointer appearance-none rounded-lg border border-border/70 bg-card px-2.5 text-[13px] font-bold text-foreground shadow-sm transition-colors hover:border-elite-blue-500/50 hover:bg-elite-blue-500/5 focus:outline-none focus:ring-2 focus:ring-elite-blue-500/30",
            }}
          />
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs font-medium text-destructive" role="alert">{error}</p>}
    </div>
  )
}

// ── Selection card (radio-style) ────────────────────────────────────────────
export function SelectionCard({
  selected,
  onSelect,
  title,
  desc,
  icon,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  desc?: string
  icon?: React.ReactNode
}) {
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
          : "border-border bg-card hover:-translate-y-0.5 hover:border-elite-blue-500/40 hover:shadow-md"
      )}
    >
      <span className="absolute end-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors"
        style={selected ? { borderColor: "var(--elite-blue-500, #1E5A99)", background: "#1E5A99" } : undefined}
      >
        {selected && <Check className="h-3 w-3 text-white" />}
      </span>
      {icon && <span className="text-2xl" aria-hidden>{icon}</span>}
      <span className="mt-1 text-sm font-bold text-foreground">{title}</span>
      {desc && <span className="text-[13px] leading-relaxed text-muted-foreground">{desc}</span>}
    </button>
  )
}

// ── File upload card (with progress + success check + real drag-drop) ───────
//
// Continue-button fix: the uploaded path used to live only in this card's
// local state, so the surrounding form's identityAttachment/licenseAttachment
// stayed "" and zod blocked submit with NO visible error. We now sync the
// path into the form when a matching field exists (no-op outside a
// FormProvider — the vehicle/documents steps manage their own state), and the
// missing-attachment error renders under the dropzone.
export function UploadCard({
  label,
  hint,
  required = false,
  file,
  onFile,
  draftId,
  documentType,
  onLocalPreview,
}: {
  label: string
  hint?: string
  required?: boolean
  file: UploadedFile | null
  onFile: (file: UploadedFile | null) => void
  draftId: string
  documentType: string
  onLocalPreview?: (url: string | null) => void
}) {
  const { dict } = useDriverRegistration()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dragOver, setDragOver] = React.useState(false)

  const form = useFormContext()
  const formField =
    documentType === "identity"
      ? "identityAttachment"
      : documentType === "license"
      ? "licenseAttachment"
      : null
  const attachmentError = formField
    ? (form?.formState.errors as Record<string, { message?: string } | undefined>)[formField]?.message
    : undefined

  const syncToForm = (path: string) => {
    if (!form || !formField) return
    form.setValue(formField, path, { shouldDirty: true })
    if (path) form.clearErrors(formField)
    else void form.trigger(formField)
  }

  const handleFiles = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setError(null)
    if (!ALLOWED_TYPES.includes(f.type)) {
      setError(dict.common.uploadErrorType)
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setError(dict.common.uploadErrorSize)
      return
    }
    // Local preview (private bucket: object URLs are the only way to show it).
    const previewUrl = URL.createObjectURL(f)
    onLocalPreview?.(previewUrl)
    setBusy(true)
    const result = await uploadApplicationFile(draftId, documentType, f)
    setBusy(false)
    if (!result.ok || !result.file) {
      onLocalPreview?.(null)
      setError(result.error === "type" ? dict.common.uploadErrorType : dict.common.errorGeneric)
      return
    }
    onFile(result.file)
    syncToForm(result.file.path)
  }

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
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          "relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center transition-all duration-200",
          dragOver &&
            "scale-[1.01] border-elite-blue-500 bg-elite-blue-500/10 shadow-lg shadow-elite-blue-500/10",
          !dragOver &&
            (file
              ? "border-emerald-500/50 bg-emerald-500/5"
              : "border-border bg-card/60 hover:border-elite-blue-500/50 hover:bg-elite-blue-500/[0.03]")
        )}
      >
        {busy ? (
          <div className="flex w-full flex-col items-center gap-3 py-4">
            <UploadCloud className="h-6 w-6 animate-pulse text-elite-blue-500" />
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 animate-[marquee-x_1.2s_linear_infinite] rounded-full bg-elite-blue-500" />
            </div>
            <span className="text-xs font-medium text-muted-foreground">{dict.common.uploading}</span>
          </div>
        ) : file ? (
          <div className="flex items-center gap-3 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-start">
              <p className="max-w-56 truncate text-sm font-semibold text-foreground">{file.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ms-2 h-8 w-8 text-muted-foreground"
              onClick={() => {
                onFile(null)
                onLocalPreview?.(null)
                syncToForm("")
              }}
              aria-label={dict.common.remove}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-elite-blue-500/10 text-elite-blue-600 transition-transform duration-200 dark:text-elite-blue-300">
              <UploadCloud className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">{dict.common.dragDrop}</p>
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
          accept={ALLOWED_TYPES.join(",")}
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs font-medium text-destructive" role="alert">{error}</p>}
      {!error && !file && attachmentError && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {attachmentError === "errorRequired" ? dict.common.errorRequired : dict.common.errorGeneric}
        </p>
      )}
    </div>
  )
}

// ── Avatar (profile photo preview — local object URL, private bucket) ────────
export function ProfilePhotoAvatar({ previewUrl }: { previewUrl: string | null }) {
  if (!previewUrl) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
    <img
      src={previewUrl}
      alt=""
      className="h-24 w-24 rounded-2xl border border-border object-cover shadow-sm"
    />
  )
}
