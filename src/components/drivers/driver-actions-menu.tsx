"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { emitDriverChanged } from "@/lib/driver-events"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  archiveDriver,
  setDriverStatus,
  updateDriver,
} from "@/lib/drivers/actions"
import type { Driver, DriverStatus, DriverUpdateInput } from "@/types/drivers"
import {
  Archive,
  Ban,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  UserX,
} from "lucide-react"

const SAUDI_MOBILE_REGEX = /^(05\d{8}|\+9665\d{8})$/

type FieldType = "text" | "date" | "number" | "textarea" | "select"

interface FieldDef {
  key: string
  en: string
  ar: string
  type?: FieldType
  dirLtr?: boolean
  span?: boolean
  options?: { value: string; en: string; ar: string }[]
}

interface SectionDef {
  en: string
  ar: string
  fields: FieldDef[]
}

const EDIT_SECTIONS: SectionDef[] = [
  {
    en: "Identity",
    ar: "الهوية",
    fields: [
      { key: "full_name_ar", en: "Full name (Arabic)", ar: "الاسم الكامل (عربي)" },
      { key: "full_name_en", en: "Full name (English)", ar: "الاسم الكامل (إنجليزي)", dirLtr: true },
      { key: "preferred_name", en: "Preferred name", ar: "الاسم المفضل" },
      { key: "nationality", en: "Nationality", ar: "الجنسية" },
      { key: "date_of_birth", en: "Date of birth", ar: "تاريخ الميلاد", type: "date" },
      { key: "gender", en: "Gender", ar: "الجنس" },
      { key: "marital_status", en: "Marital status", ar: "الحالة الاجتماعية" },
    ],
  },
  {
    en: "Contact",
    ar: "التواصل",
    fields: [
      { key: "primary_mobile", en: "Primary mobile", ar: "الجوال الأساسي", dirLtr: true },
      { key: "secondary_mobile", en: "Secondary mobile", ar: "الجوال الثانوي", dirLtr: true },
      { key: "personal_email", en: "Personal email", ar: "البريد الشخصي", dirLtr: true },
      { key: "work_email", en: "Work email", ar: "البريد الوظيفي", dirLtr: true },
      { key: "current_city", en: "City", ar: "المدينة" },
      { key: "national_address", en: "National address", ar: "العنوان الوطني", type: "textarea", span: true },
    ],
  },
  {
    en: "Legal",
    ar: "القانونية",
    fields: [
      { key: "iqama_number", en: "Iqama number", ar: "رقم الإقامة", dirLtr: true },
      { key: "iqama_expiry_date", en: "Iqama expiry", ar: "انتهاء الإقامة", type: "date" },
      { key: "passport_number", en: "Passport number", ar: "رقم الجواز", dirLtr: true },
      { key: "passport_expiry_date", en: "Passport expiry", ar: "انتهاء الجواز", type: "date" },
      { key: "license_number", en: "License number", ar: "رقم الرخصة", dirLtr: true },
      { key: "license_type", en: "License type", ar: "نوع الرخصة" },
      { key: "license_expiry_date", en: "License expiry", ar: "انتهاء الرخصة", type: "date" },
    ],
  },
  {
    en: "Employment",
    ar: "التوظيف",
    fields: [
      {
        key: "category",
        en: "Category",
        ar: "الفئة",
        type: "select",
        options: [
          { value: "sponsored_type1", en: "Sponsored T1", ar: "كفيل نوع ١" },
          { value: "sponsored_type2", en: "Sponsored T2", ar: "كفيل نوع ٢" },
          { value: "freelancer", en: "Freelancer", ar: "مستقل" },
        ],
      },
      {
        key: "employment_type",
        en: "Employment type",
        ar: "نوع التوظيف",
        type: "select",
        options: [
          { value: "full_time", en: "Full time", ar: "دوام كامل" },
          { value: "part_time", en: "Part time", ar: "دوام جزئي" },
          { value: "contract", en: "Contract", ar: "عقد" },
          { value: "temporary", en: "Temporary", ar: "مؤقت" },
        ],
      },
      {
        key: "contract_type",
        en: "Contract type",
        ar: "نوع العقد",
        type: "select",
        options: [
          { value: "unlimited", en: "Unlimited", ar: "غير محدد" },
          { value: "limited", en: "Limited", ar: "محدد" },
          { value: "task_based", en: "Task based", ar: "بمهمة" },
        ],
      },
      { key: "job_title", en: "Job title", ar: "المسمى الوظيفي" },
      { key: "department", en: "Department", ar: "القسم" },
      { key: "hire_date", en: "Hire date", ar: "تاريخ التعيين", type: "date" },
      { key: "contract_start", en: "Contract start", ar: "بداية العقد", type: "date" },
      { key: "contract_end", en: "Contract end", ar: "نهاية العقد", type: "date" },
    ],
  },
  {
    en: "Payroll",
    ar: "الرواتب",
    fields: [
      { key: "basic_salary", en: "Basic salary", ar: "الراتب الأساسي", type: "number", dirLtr: true },
      { key: "housing_allowance", en: "Housing allowance", ar: "بدل السكن", type: "number", dirLtr: true },
      { key: "transport_allowance", en: "Transport allowance", ar: "بدل النقل", type: "number", dirLtr: true },
      { key: "bank_name", en: "Bank", ar: "البنك" },
      { key: "iban", en: "IBAN", ar: "IBAN", dirLtr: true, span: true },
    ],
  },
  {
    en: "Notes",
    ar: "ملاحظات",
    fields: [
      { key: "internal_notes", en: "Internal notes", ar: "ملاحظات داخلية", type: "textarea", span: true },
    ],
  },
]

interface StatusActionDef {
  status: DriverStatus
  en: string
  ar: string
  activeEn?: string
  activeAr?: string
  danger?: boolean
  reasonRequired?: boolean
  icon: typeof Pause
  visible: (current: DriverStatus) => boolean
}

const STATUS_ACTIONS: StatusActionDef[] = [
  {
    status: "suspended",
    en: "Suspend driver",
    ar: "إيقاف السائق",
    danger: true,
    reasonRequired: true,
    icon: Pause,
    visible: (s) => s === "active" || s === "on_leave",
  },
  {
    status: "active",
    en: "Reactivate",
    ar: "إعادة التنشيط",
    activeEn: "Activate",
    activeAr: "تفعيل",
    icon: CheckCircle2,
    visible: (s) => s === "suspended" || s === "on_leave" || s === "draft",
  },
  {
    status: "on_leave",
    en: "Put on leave",
    ar: "تحويل إلى إجازة",
    icon: CalendarClock,
    visible: (s) => s === "active",
  },
  {
    status: "terminated",
    en: "Terminate employment",
    ar: "إنهاء الخدمة",
    danger: true,
    reasonRequired: true,
    icon: UserX,
    visible: (s) => s !== "terminated" && s !== "blacklisted",
  },
  {
    status: "blacklisted",
    en: "Blacklist",
    ar: "حظر",
    danger: true,
    reasonRequired: true,
    icon: Ban,
    visible: (s) => s !== "blacklisted" && s !== "terminated",
  },
]

type PendingAction =
  | { kind: "status"; def: StatusActionDef }
  | { kind: "archive" }

interface DriverActionsMenuProps {
  driverId: string
  /** Full record if the caller already has it; otherwise fetched on demand. */
  driver?: Driver | null
  isAr: boolean
  /** "button" shows a labeled outline button (profile header); "icon" shows a compact ⋯ trigger (table rows). */
  variant?: "button" | "icon"
  /** Adds an "Open profile" item (used in list rows). */
  showOpenItem?: boolean
  onUpdated?: () => void
  /** When set, archive navigates here (profile page); on lists the row just disappears after refetch. */
  redirectAfterArchive?: string
}

export default function DriverActionsMenu({
  driverId,
  driver: initialDriver,
  isAr,
  variant = "button",
  showOpenItem = false,
  onUpdated,
  redirectAfterArchive,
}: DriverActionsMenuProps) {
  const router = useRouter()
  const [record, setRecord] = useState<Driver | null>(initialDriver ?? null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [acting, setActing] = useState(false)
  const [busy, setBusy] = useState(false)

  const ensureRecord = async (): Promise<Driver | null> => {
    if (record) return record
    setBusy(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("drivers")
        .select("*")
        .eq("id", driverId)
        .is("deleted_at", null)
        .maybeSingle()
      if (error || !data) {
        toast.error(isAr ? "فشل تحميل بيانات السائق" : "Failed to load driver")
        return null
      }
      const full = data as unknown as Driver
      setRecord(full)
      return full
    } finally {
      setBusy(false)
    }
  }

  const openEdit = async () => {
    const full = await ensureRecord()
    if (!full) return
    const init: Record<string, string> = {}
    const row = full as unknown as Record<string, unknown>
    for (const section of EDIT_SECTIONS) {
      for (const field of section.fields) {
        const value = row[field.key]
        init[field.key] = value === null || value === undefined ? "" : String(value)
      }
    }
    setForm(init)
    setEditOpen(true)
  }

  const openAction = async (action: PendingAction) => {
    const full = await ensureRecord()
    if (!full) return
    setReason("")
    setNote("")
    setPending(action)
  }

  const notifyChanged = () => {
    emitDriverChanged(driverId)
    onUpdated?.()
  }

  const onSave = async () => {
    if (!form.full_name_ar?.trim()) {
      toast.error(isAr ? "الاسم بالعربية مطلوب" : "Arabic full name is required")
      return
    }
    if (form.primary_mobile && !SAUDI_MOBILE_REGEX.test(form.primary_mobile.trim())) {
      toast.error(
        isAr ? "رقم الجوال غير صالح" : "Invalid Saudi mobile (05XXXXXXXX or +9665XXXXXXXX)",
      )
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const section of EDIT_SECTIONS) {
        for (const field of section.fields) {
          const raw = (form[field.key] ?? "").trim()
          if (field.type === "number") {
            payload[field.key] = raw === "" ? null : Number(raw)
          } else {
            payload[field.key] = raw === "" ? null : raw
          }
        }
      }
      const res = await updateDriver(driverId, payload as DriverUpdateInput)
      if (!res.success) {
        toast.error(res.error ?? (isAr ? "فشل الحفظ" : "Save failed"))
        return
      }
      toast.success(isAr ? "تم حفظ التغييرات" : "Changes saved")
      setEditOpen(false)
      notifyChanged()
    } finally {
      setSaving(false)
    }
  }

  const onConfirmAction = async () => {
    if (!pending) return
    setActing(true)
    try {
      if (pending.kind === "archive") {
        const res = await archiveDriver({ driverId, reason: reason.trim() })
        if (!res.success) {
          toast.error(res.error ?? (isAr ? "فشل الأرشفة" : "Archive failed"))
          return
        }
        toast.success(isAr ? "تمت أرشفة السائق" : "Driver archived")
        setPending(null)
        notifyChanged()
        if (redirectAfterArchive) router.push(redirectAfterArchive)
        return
      }
      const res = await setDriverStatus({
        driverId,
        status: pending.def.status,
        reason: reason.trim() || undefined,
        note: note.trim() || undefined,
      })
      if (!res.success) {
        toast.error(res.error ?? (isAr ? "فشل تغيير الحالة" : "Status change failed"))
        return
      }
      toast.success(isAr ? "تم تحديث الحالة" : "Status updated")
      setPending(null)
      setRecord((prev) => (prev ? { ...prev, status: pending.def.status } : prev))
      notifyChanged()
    } finally {
      setActing(false)
    }
  }

  const visibleStatusActions = record
    ? STATUS_ACTIONS.filter((a) => a.visible(record.status))
    : []

  const pendingTitle =
    pending?.kind === "archive"
      ? isAr
        ? "أرشفة السائق"
        : "Archive driver"
      : pending?.kind === "status" && record
        ? isAr
          ? (record.status === "draft" && pending.def.activeAr) || pending.def.ar
          : (record.status === "draft" && pending.def.activeEn) || pending.def.en
        : ""
  const pendingDanger =
    pending?.kind === "archive" ||
    (pending?.kind === "status" && pending.def.danger === true)
  const pendingReasonRequired =
    pending?.kind === "archive" ||
    (pending?.kind === "status" && pending.def.reasonRequired === true)
  const confirmDisabled =
    acting || (pendingReasonRequired && reason.trim().length < 5)

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          {variant === "icon" ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              className="h-7 w-7 rounded-full"
              aria-label={isAr ? "إجراءات" : "Actions"}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5" disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
              {isAr ? "إجراءات" : "Actions"}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel>
            {isAr ? "إدارة السائق" : "Driver administration"}
          </DropdownMenuLabel>
          {showOpenItem && (
            <DropdownMenuItem
              className="gap-2"
              onClick={() => router.push(`/drivers/${driverId}`)}
            >
              <ExternalLink className="h-4 w-4" />
              {isAr ? "فتح الملف" : "Open profile"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void openEdit()} className="gap-2">
            <Pencil className="h-4 w-4" />
            {isAr ? "تعديل البيانات" : "Edit driver"}
          </DropdownMenuItem>
          {visibleStatusActions.length > 0 && <DropdownMenuSeparator />}
          {visibleStatusActions.map((action) => (
            <DropdownMenuItem
              key={action.status}
              onClick={() => void openAction({ kind: "status", def: action })}
              className={
                action.danger
                  ? "gap-2 text-red-600 focus:text-red-600 dark:text-red-400"
                  : "gap-2"
              }
            >
              <action.icon className="h-4 w-4" />
              {isAr
                ? (record?.status === "draft" && action.activeAr) || action.ar
                : (record?.status === "draft" && action.activeEn) || action.en}
            </DropdownMenuItem>
          ))}
          {record && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void openAction({ kind: "archive" })}
                className="gap-2 text-red-600 focus:text-red-600 dark:text-red-400"
              >
                <Archive className="h-4 w-4" />
                {isAr ? "أرشفة" : "Archive"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit drawer */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent
          side={isAr ? "left" : "right"}
          className="w-full overflow-y-auto sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>
              {isAr ? "تعديل بيانات السائق" : "Edit driver"}
              {record ? ` — ${record.full_name_ar ?? ""}` : ""}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6 px-4 pb-6">
            {EDIT_SECTIONS.map((section) => (
              <section key={section.en}>
                <h3 className="mb-3 border-b border-border/40 pb-2 text-sm font-semibold text-foreground">
                  {isAr ? section.ar : section.en}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <div
                      key={field.key}
                      className={field.span ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}
                    >
                      <Label htmlFor={`edit-${driverId}-${field.key}`} className="text-xs">
                        {isAr ? field.ar : field.en}
                      </Label>
                      {field.type === "select" && field.options ? (
                        <Select
                          value={form[field.key] || "none"}
                          onValueChange={(v) =>
                            setForm((prev) => ({
                              ...prev,
                              [field.key]: v === "none" ? "" : v,
                            }))
                          }
                        >
                          <SelectTrigger id={`edit-${driverId}-${field.key}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            {field.options.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {isAr ? option.ar : option.en}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : field.type === "textarea" ? (
                        <Textarea
                          id={`edit-${driverId}-${field.key}`}
                          value={form[field.key] ?? ""}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          rows={3}
                        />
                      ) : (
                        <Input
                          id={`edit-${driverId}-${field.key}`}
                          type={
                            field.type === "date"
                              ? "date"
                              : field.type === "number"
                                ? "number"
                                : "text"
                          }
                          dir={field.dirLtr ? "ltr" : undefined}
                          value={form[field.key] ?? ""}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
            <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-4">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                {isAr ? "إلغاء" : "Cancel"}
              </Button>
              <Button onClick={() => void onSave()} disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isAr ? "حفظ التغييرات" : "Save changes"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirm dialog for status changes / archive */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingTitle}</DialogTitle>
            <DialogDescription>
              {record
                ? isAr
                  ? `السائق: ${record.full_name_ar} — الحالة الحالية: ${record.status}`
                  : `Driver: ${record.full_name_ar} — current status: ${record.status}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`action-reason-${driverId}`} className="text-xs">
                {isAr ? "السبب" : "Reason"}
                {pendingReasonRequired ? " *" : ""}
              </Label>
              <Textarea
                id={`action-reason-${driverId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={isAr ? "مثال: مخالفة سياسة العمل" : "e.g. Policy violation"}
              />
            </div>
            {pending?.kind === "status" && (
              <div className="space-y-1.5">
                <Label htmlFor={`action-note-${driverId}`} className="text-xs">
                  {isAr ? "ملاحظة داخلية (اختياري)" : "Internal note (optional)"}
                </Label>
                <Input
                  id={`action-note-${driverId}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={acting}>
              {isAr ? "تراجع" : "Cancel"}
            </Button>
            <Button
              onClick={() => void onConfirmAction()}
              disabled={confirmDisabled}
              variant={pendingDanger ? "destructive" : "default"}
              className="gap-1.5"
            >
              {acting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isAr ? "تأكيد" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
