"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createDriver } from "@/lib/drivers/actions"
import { useTranslation } from "@/hooks/use-translation"
import {
  validateSaudiIBAN,
  type DriverCategory,
  type DriverStatus,
  type EmploymentType,
  type ContractType,
} from "@/types/drivers"

const SAUDI_MOBILE_REGEX = /^(05\d{8}|\+9665\d{8})$/
const IQAMA_REGEX = /^[12]\d{9}$/

// Loose client-side schema (string values from the DOM). The canonical
// driverCreateSchema re-validates everything server-side in createDriver.
const formSchema = z
  .object({
    full_name_ar: z.string().trim().min(1),
    full_name_en: z.string().optional(),
    preferred_name: z.string().optional(),
    nationality: z.string().optional(),
    nationality_code: z
      .string()
      .regex(/^[A-Za-z]{2}$/, "ISO 2-letter code")
      .or(z.literal(""))
      .optional(),
    date_of_birth: z.string().optional(),
    gender: z.string().optional(),

    iqama_number: z
      .string()
      .regex(IQAMA_REGEX, "Invalid iqama number")
      .or(z.literal(""))
      .optional(),
    iqama_issue_date: z.string().optional(),
    iqama_expiry_date: z.string().optional(),
    passport_number: z.string().optional(),
    passport_expiry_date: z.string().optional(),
    license_number: z.string().optional(),
    license_type: z.string().optional(),
    license_expiry_date: z.string().optional(),

    primary_mobile: z
      .string()
      .regex(SAUDI_MOBILE_REGEX, "Saudi mobile: 05XXXXXXXX or +9665XXXXXXXX"),
    secondary_mobile: z
      .string()
      .regex(SAUDI_MOBILE_REGEX, "Invalid Saudi mobile")
      .or(z.literal(""))
      .optional(),
    personal_email: z.string().email("Invalid email").or(z.literal("")).optional(),
    work_email: z.string().email("Invalid email").or(z.literal("")).optional(),
    current_city: z.string().optional(),
    current_region: z.string().optional(),

    category: z.enum(["sponsored_type1", "sponsored_type2", "freelancer"]),
    employment_type: z
      .enum(["full_time", "part_time", "contract", "temporary"])
      .or(z.literal(""))
      .optional(),
    contract_type: z
      .enum(["unlimited", "limited", "task_based"])
      .or(z.literal(""))
      .optional(),
    status: z.enum([
      "draft",
      "active",
      "on_leave",
      "suspended",
      "terminated",
      "blacklisted",
    ]),
    job_title: z.string().optional(),
    department: z.string().optional(),
    hire_date: z.string().optional(),
    contract_start: z.string().optional(),
    contract_end: z.string().optional(),

    basic_salary: z.string().optional(),
    housing_allowance: z.string().optional(),
    transport_allowance: z.string().optional(),
    bank_name: z.string().optional(),
    iban: z
      .string()
      .refine((v) => !v || validateSaudiIBAN(v.replace(/\s/g, "").toUpperCase()), {
        message: "Invalid Saudi IBAN",
      })
      .optional(),

    internal_notes: z.string().optional(),
  })
  .refine(
    (d) => !d.contract_start || !d.contract_end || d.contract_end > d.contract_start,
    {
      message: "Contract end must be after start",
      path: ["contract_end"],
    },
  )

type FormValues = z.infer<typeof formSchema>

function toNullable(v: string | undefined): string | null {
  const t = v?.trim()
  return t ? t : null
}

function toNumberNullable(v: string | undefined): number | null {
  const t = v?.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const CATEGORIES: { value: DriverCategory; ar: string; en: string }[] = [
  { value: "sponsored_type1", ar: "كفيل نوع ١", en: "Sponsored Type 1" },
  { value: "sponsored_type2", ar: "كفيل نوع ٢", en: "Sponsored Type 2" },
  { value: "freelancer", ar: "مستقل", en: "Freelancer" },
]

const STATUSES: { value: DriverStatus; ar: string; en: string }[] = [
  { value: "draft", ar: "مسودة", en: "Draft" },
  { value: "active", ar: "نشط", en: "Active" },
  { value: "on_leave", ar: "في إجازة", en: "On Leave" },
  { value: "suspended", ar: "معلّق", en: "Suspended" },
  { value: "terminated", ar: "منهى", en: "Terminated" },
  { value: "blacklisted", ar: "محظور", en: "Blacklisted" },
]

const EMPLOYMENT_TYPES: { value: EmploymentType; ar: string; en: string }[] = [
  { value: "full_time", ar: "دوام كامل", en: "Full-time" },
  { value: "part_time", ar: "دوام جزئي", en: "Part-time" },
  { value: "contract", ar: "عقد", en: "Contract" },
  { value: "temporary", ar: "مؤقت", en: "Temporary" },
]

const CONTRACT_TYPES: { value: ContractType; ar: string; en: string }[] = [
  { value: "unlimited", ar: "غير محدد المدة", en: "Unlimited" },
  { value: "limited", ar: "محدد المدة", en: "Limited" },
  { value: "task_based", ar: "بالمهام", en: "Task-based" },
]

function Field({
  label,
  error,
  required,
  children,
  className,
}: {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-semibold">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}
    </div>
  )
}

export function CreateDriverDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "sponsored_type1",
      status: "draft",
    },
  })

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    const result = await createDriver({
      full_name_ar: values.full_name_ar.trim(),
      full_name_en: toNullable(values.full_name_en),
      preferred_name: toNullable(values.preferred_name),
      nationality: toNullable(values.nationality),
      nationality_code: toNullable(values.nationality_code),
      date_of_birth: toNullable(values.date_of_birth),
      gender: toNullable(values.gender),
      iqama_number: toNullable(values.iqama_number),
      iqama_issue_date: toNullable(values.iqama_issue_date),
      iqama_expiry_date: toNullable(values.iqama_expiry_date),
      passport_number: toNullable(values.passport_number),
      passport_expiry_date: toNullable(values.passport_expiry_date),
      license_number: toNullable(values.license_number),
      license_type: toNullable(values.license_type),
      license_expiry_date: toNullable(values.license_expiry_date),
      primary_mobile: values.primary_mobile.trim(),
      secondary_mobile: toNullable(values.secondary_mobile),
      personal_email: toNullable(values.personal_email),
      work_email: toNullable(values.work_email),
      current_city: toNullable(values.current_city),
      current_region: toNullable(values.current_region),
      category: values.category,
      employment_type: (toNullable(values.employment_type) as EmploymentType | null) ?? undefined,
      contract_type: (toNullable(values.contract_type) as ContractType | null) ?? undefined,
      status: values.status,
      job_title: toNullable(values.job_title),
      department: toNullable(values.department),
      hire_date: toNullable(values.hire_date),
      contract_start: toNullable(values.contract_start),
      contract_end: toNullable(values.contract_end),
      basic_salary: toNumberNullable(values.basic_salary),
      housing_allowance: toNumberNullable(values.housing_allowance),
      transport_allowance: toNumberNullable(values.transport_allowance),
      bank_name: toNullable(values.bank_name),
      iban: toNullable(values.iban),
      internal_notes: toNullable(values.internal_notes),
    })
    setSubmitting(false)

    if (result.success) {
      toast.success(isAr ? "تم إنشاء السائق بنجاح" : "Driver created successfully")
      reset()
      onOpenChange(false)
      router.refresh()
      if (result.id) router.push(`/drivers/${result.id}`)
    } else {
      toast.error(result.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {isAr ? "إنشاء سائق جديد" : "Create New Driver"}
          </DialogTitle>
          <DialogDescription>
            {isAr
              ? "املأ بيانات السائق الأساسية — تُعاد التحقق من الحقول على الخادم."
              : "Fill in the driver's core details — fields are re-validated on the server."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6" noValidate>
          {/* Identity */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "الهوية" : "Identity"}
            </legend>
            <Field label={isAr ? "الاسم الكامل (عربي)" : "Full name (Arabic)"} required error={errors.full_name_ar?.message}>
              <Input {...register("full_name_ar")} className={inputClass} />
            </Field>
            <Field label={isAr ? "الاسم الكامل (إنجليزي)" : "Full name (English)"} error={errors.full_name_en?.message}>
              <Input {...register("full_name_en")} className={inputClass} />
            </Field>
            <Field label={isAr ? "الاسم المفضل" : "Preferred name"} error={errors.preferred_name?.message}>
              <Input {...register("preferred_name")} className={inputClass} />
            </Field>
            <Field label={isAr ? "الجنسية" : "Nationality"} error={errors.nationality?.message}>
              <Input {...register("nationality")} className={inputClass} />
            </Field>
            <Field label={isAr ? "رمز الجنسية (ISO)" : "Nationality code (ISO)"} error={errors.nationality_code?.message}>
              <Input {...register("nationality_code")} maxLength={2} className={inputClass} dir="ltr" placeholder="SA, EG, PK..." />
            </Field>
            <Field label={isAr ? "تاريخ الميلاد" : "Date of birth"} error={errors.date_of_birth?.message}>
              <Input {...register("date_of_birth")} type="date" className={inputClass} />
            </Field>
            <Field label={isAr ? "الجنس" : "Gender"} error={errors.gender?.message}>
              <Input {...register("gender")} className={inputClass} placeholder={isAr ? "ذكر / أنثى" : "Male / Female"} />
            </Field>
          </fieldset>

          {/* Legal */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "البيانات الرسمية" : "Legal documents"}
            </legend>
            <Field label={isAr ? "رقم الإقامة" : "Iqama number"} error={errors.iqama_number?.message}>
              <Input {...register("iqama_number")} className={inputClass} dir="ltr" placeholder="1XXXXXXXXX" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={isAr ? "إصدار الإقامة" : "Iqama issue"}>
                <Input {...register("iqama_issue_date")} type="date" className={inputClass} />
              </Field>
              <Field label={isAr ? "انتهاء الإقامة" : "Iqama expiry"}>
                <Input {...register("iqama_expiry_date")} type="date" className={inputClass} />
              </Field>
            </div>
            <Field label={isAr ? "رقم جواز السفر" : "Passport number"} error={errors.passport_number?.message}>
              <Input {...register("passport_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field label={isAr ? "انتهاء الجواز" : "Passport expiry"}>
              <Input {...register("passport_expiry_date")} type="date" className={inputClass} />
            </Field>
            <Field label={isAr ? "رقم رخصة القيادة" : "Driving license no."} error={errors.license_number?.message}>
              <Input {...register("license_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field label={isAr ? "نوع الرخصة" : "License type"}>
              <Input {...register("license_type")} className={inputClass} placeholder={isAr ? "عمومي / خصوصي" : "Public / Private"} />
            </Field>
            <Field label={isAr ? "انتهاء الرخصة" : "License expiry"}>
              <Input {...register("license_expiry_date")} type="date" className={inputClass} />
            </Field>
          </fieldset>

          {/* Contact */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "التواصل" : "Contact"}
            </legend>
            <Field label={isAr ? "الجوال الأساسي" : "Primary mobile"} required error={errors.primary_mobile?.message}>
              <Input {...register("primary_mobile")} className={inputClass} dir="ltr" placeholder="05XXXXXXXX" />
            </Field>
            <Field label={isAr ? "جوال ثانوي" : "Secondary mobile"} error={errors.secondary_mobile?.message}>
              <Input {...register("secondary_mobile")} className={inputClass} dir="ltr" placeholder="05XXXXXXXX" />
            </Field>
            <Field label={isAr ? "البريد الشخصي" : "Personal email"} error={errors.personal_email?.message}>
              <Input {...register("personal_email")} type="email" className={inputClass} dir="ltr" />
            </Field>
            <Field label={isAr ? "البريد الوظيفي" : "Work email"} error={errors.work_email?.message}>
              <Input {...register("work_email")} type="email" className={inputClass} dir="ltr" />
            </Field>
            <Field label={isAr ? "المدينة" : "City"} error={errors.current_city?.message}>
              <Input {...register("current_city")} className={inputClass} />
            </Field>
            <Field label={isAr ? "المنطقة" : "Region"} error={errors.current_region?.message}>
              <Input {...register("current_region")} className={inputClass} />
            </Field>
          </fieldset>

          {/* Employment */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "التوظيف" : "Employment"}
            </legend>
            <Field label={isAr ? "الفئة" : "Category"} required error={errors.category?.message}>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {isAr ? c.ar : c.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label={isAr ? "الحالة" : "Status"} required error={errors.status?.message}>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {isAr ? s.ar : s.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label={isAr ? "نوع التوظيف" : "Employment type"} error={errors.employment_type?.message}>
              <Controller
                control={control}
                name="employment_type"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={(v) => field.onChange(v || undefined)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={isAr ? "اختر" : "Select"} />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {isAr ? t.ar : t.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label={isAr ? "نوع العقد" : "Contract type"} error={errors.contract_type?.message}>
              <Controller
                control={control}
                name="contract_type"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={(v) => field.onChange(v || undefined)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={isAr ? "اختر" : "Select"} />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {isAr ? t.ar : t.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label={isAr ? "المسمى الوظيفي" : "Job title"} error={errors.job_title?.message}>
              <Input {...register("job_title")} className={inputClass} />
            </Field>
            <Field label={isAr ? "القسم" : "Department"} error={errors.department?.message}>
              <Input {...register("department")} className={inputClass} />
            </Field>
            <Field label={isAr ? "تاريخ التعيين" : "Hire date"}>
              <Input {...register("hire_date")} type="date" className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={isAr ? "بداية العقد" : "Contract start"}>
                <Input {...register("contract_start")} type="date" className={inputClass} />
              </Field>
              <Field label={isAr ? "نهاية العقد" : "Contract end"} error={errors.contract_end?.message}>
                <Input {...register("contract_end")} type="date" className={inputClass} />
              </Field>
            </div>
          </fieldset>

          {/* Payroll */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "الراتب والبنك" : "Payroll & bank"}
            </legend>
            <Field label={isAr ? "الراتب الأساسي (ر.س)" : "Basic salary (SAR)"} error={errors.basic_salary?.message}>
              <Input {...register("basic_salary")} inputMode="decimal" className={inputClass} dir="ltr" placeholder="4000" />
            </Field>
            <Field label={isAr ? "بدل السكن (ر.س)" : "Housing allowance (SAR)"} error={errors.housing_allowance?.message}>
              <Input {...register("housing_allowance")} inputMode="decimal" className={inputClass} dir="ltr" placeholder="0" />
            </Field>
            <Field label={isAr ? "بدل النقل (ر.س)" : "Transport allowance (SAR)"} error={errors.transport_allowance?.message}>
              <Input {...register("transport_allowance")} inputMode="decimal" className={inputClass} dir="ltr" placeholder="0" />
            </Field>
            <Field label={isAr ? "اسم البنك" : "Bank name"} error={errors.bank_name?.message}>
              <Input {...register("bank_name")} className={inputClass} />
            </Field>
            <Field label={isAr ? "رقم الآيبان" : "IBAN"} error={errors.iban?.message}>
              <Input {...register("iban")} className={inputClass} dir="ltr" placeholder="SA00 0000 0000 0000 0000 0000" />
            </Field>
          </fieldset>

          {/* Notes */}
          <fieldset className="grid gap-2 rounded-2xl border border-border/50 bg-muted/20 p-4">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "ملاحظات داخلية" : "Internal notes"}
            </legend>
            <Textarea {...register("internal_notes")} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" />
          </fieldset>

          <div className="flex items-center justify-end gap-3 border-t border-border/50 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-gradient-to-r from-elite-blue-500 to-elite-blue-700 text-white hover:from-elite-blue-600 hover:to-elite-blue-800"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isAr ? "إنشاء السائق" : "Create driver"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
