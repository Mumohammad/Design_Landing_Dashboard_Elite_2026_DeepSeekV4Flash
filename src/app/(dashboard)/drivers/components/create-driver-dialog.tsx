"use client"
import { driverErrorMessage } from "@/lib/drivers/error-messages"

import { cloneElement, isValidElement, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "@/lib/toast"
import { Briefcase, CircleAlert, IdCard, Loader2, Phone, StickyNote, UserRound, Wallet } from "lucide-react"

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
    full_name_ar: z.string().trim().min(1, "Required"),
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
    termination_date: z.string().optional(),
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

  .refine(data=>["terminated","blacklisted"].includes(data.status)?!!data.hire_date&&!!data.termination_date&&data.termination_date>=data.hire_date:!data.termination_date,{message:"Termination date must match employment status and be on or after hire date",path:["termination_date"]})

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

const ERROR_AR: Record<string, string> = {
  "Saudi mobile: 05XXXXXXXX or +9665XXXXXXXX": "رقم جوال سعودي: 05XXXXXXXX أو +9665XXXXXXXX",
  "Invalid Saudi mobile": "رقم جوال سعودي غير صحيح",
  "Invalid iqama number": "رقم إقامة غير صحيح (10 أرقام تبدأ بـ 1 أو 2)",
  "Invalid email": "بريد إلكتروني غير صحيح",
  "Invalid Saudi IBAN": "رقم آيبان سعودي غير صحيح",
  "ISO 2-letter code": "رمز من حرفين (مثل SA)",
  "Contract end must be after start": "يجب أن تكون نهاية العقد بعد بدايته",
  Required: "هذا الحقل مطلوب",
  "Termination date must match employment status and be on or after hire date": "تاريخ انتهاء العمل للحالات المنهية أو المحظورة فقط، ويجب أن يكون بعد تاريخ التعيين",
}

// Common rider nationalities: picking one fills the ISO code automatically.
const NATIONALITIES: { code: string; ar: string; en: string }[] = [
  { code: "SA", ar: "سعودي", en: "Saudi" }, { code: "EG", ar: "مصري", en: "Egyptian" },
  { code: "PK", ar: "باكستاني", en: "Pakistani" }, { code: "IN", ar: "هندي", en: "Indian" },
  { code: "BD", ar: "بنغلاديشي", en: "Bangladeshi" }, { code: "YE", ar: "يمني", en: "Yemeni" },
  { code: "SD", ar: "سوداني", en: "Sudanese" }, { code: "PH", ar: "فلبيني", en: "Filipino" },
  { code: "NP", ar: "نيبالي", en: "Nepali" }, { code: "LK", ar: "سريلانكي", en: "Sri Lankan" },
  { code: "JO", ar: "أردني", en: "Jordanian" }, { code: "SY", ar: "سوري", en: "Syrian" },
  { code: "ET", ar: "إثيوبي", en: "Ethiopian" }, { code: "KE", ar: "كيني", en: "Kenyan" },
  { code: "UG", ar: "أوغندي", en: "Ugandan" }, { code: "ID", ar: "إندونيسي", en: "Indonesian" },
]

const SECTIONS = [
  { id: "identity", icon: UserRound, ar: "الهوية", en: "Identity", hintAr: "الاسم والجنسية والبيانات الشخصية", hintEn: "Name, nationality and personal details" },
  { id: "legal", icon: IdCard, ar: "البيانات الرسمية", en: "Legal documents", hintAr: "الإقامة والجواز ورخصة القيادة", hintEn: "Iqama, passport and driving license" },
  { id: "contact", icon: Phone, ar: "التواصل", en: "Contact", hintAr: "أرقام الجوال والبريد والموقع", hintEn: "Mobiles, email and location" },
  { id: "employment", icon: Briefcase, ar: "التوظيف", en: "Employment", hintAr: "الفئة والحالة والعقد", hintEn: "Category, status and contract" },
  { id: "payroll", icon: Wallet, ar: "الراتب والبنك", en: "Payroll & bank", hintAr: "الراتب والبدلات وحساب البنك", hintEn: "Salary, allowances and bank account" },
  { id: "notes", icon: StickyNote, ar: "ملاحظات داخلية", en: "Internal notes", hintAr: "لا تظهر للسائق", hintEn: "Not visible to the driver" },
] as const

function Section({ id, isAr, children, cols = 3 }: { id: (typeof SECTIONS)[number]["id"]; isAr: boolean; children: React.ReactNode; cols?: 1 | 3 }) {
  const meta = SECTIONS.find((x) => x.id === id)!
  const Icon = meta.icon
  return (
    <section id={`create-driver-section-${id}`} aria-labelledby={`create-driver-section-${id}-title`} className="scroll-mt-28 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300"><Icon className="size-4" /></span>
        <div className="min-w-0">
          <h3 id={`create-driver-section-${id}-title`} className="text-sm font-semibold">{isAr ? meta.ar : meta.en}</h3>
          <p className="text-xs text-muted-foreground">{isAr ? meta.hintAr : meta.hintEn}</p>
        </div>
      </div>
      <div className={cols === 3 ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-2"}>{children}</div>
    </section>
  )
}

function MoneyInput(props: React.ComponentProps<typeof Input> & { isAr: boolean }) {
  const { isAr, className, ...rest } = props
  return (
    <div className="relative">
      <Input {...rest} className={`h-10 pe-12 text-end tabular-nums ${className ?? ""}`} />
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">{isAr ? "ر.س" : "SAR"}</span>
    </div>
  )
}

function Field({
  id,
  label,
  error,
  required,
  hint,
  isAr,
  children,
  className,
}: {
  id: string
  label: string
  error?: string
  required?: boolean
  hint?: string
  isAr?: boolean
  children: React.ReactNode
  className?: string
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, { "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })
    : children
  return (
    <div className={`grid content-start gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id} className="text-xs font-semibold text-foreground/80">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {control}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1 text-[11px] font-medium text-destructive"><CircleAlert className="size-3 shrink-0" />{isAr ? (ERROR_AR[error] ?? error) : error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
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
    setValue,
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
      termination_date: toNullable(values.termination_date),
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
      toast.error(driverErrorMessage(result.error, isAr, isAr ? "حدث خطأ" : "Something went wrong"))
    }
  }

  const inputClass = "h-10"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto overflow-x-hidden rounded-2xl p-0 sm:max-w-5xl [&>[data-slot=dialog-close]]:z-20">
        <div className="sticky top-0 z-10 min-w-0 border-b border-border/60 bg-background/95 pb-3 pl-4 pr-12 pt-4 backdrop-blur sm:pl-6">
          <DialogHeader className="text-start">
            <DialogTitle className="text-lg">
              {isAr ? "إنشاء سائق جديد" : "Create New Driver"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {isAr
                ? "الحقول المعلّمة بـ * مطلوبة، ويمكن إكمال الباقي لاحقاً من ملف السائق."
                : "Fields marked * are required; the rest can be completed later from the driver profile."}
            </DialogDescription>
          </DialogHeader>
          <nav aria-label={isAr ? "أقسام النموذج" : "Form sections"} className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {SECTIONS.map((sec) => (
              <a key={sec.id} href={`#create-driver-section-${sec.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`create-driver-section-${sec.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-elite-blue-500/40 hover:bg-elite-blue-500/10 hover:text-elite-blue-700 dark:hover:text-elite-blue-300">
                <sec.icon className="size-3.5" />{isAr ? sec.ar : sec.en}
              </a>
            ))}
          </nav>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="grid min-w-0 gap-4 px-4 py-4 sm:px-6" noValidate>
          {/* Identity */}
          <Section id="identity" isAr={isAr}>
            <Field isAr={isAr} id="create-driver-full_name_ar" label={isAr ? "الاسم الكامل (عربي)" : "Full name (Arabic)"} required error={errors.full_name_ar?.message}>
              <Input id="create-driver-full_name_ar" {...register("full_name_ar")} className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-full_name_en" label={isAr ? "الاسم الكامل (إنجليزي)" : "Full name (English)"} error={errors.full_name_en?.message}>
              <Input id="create-driver-full_name_en" {...register("full_name_en")} className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-preferred_name" label={isAr ? "الاسم المفضل" : "Preferred name"} error={errors.preferred_name?.message}>
              <Input id="create-driver-preferred_name" {...register("preferred_name")} className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-nationality" label={isAr ? "الجنسية" : "Nationality"} error={errors.nationality?.message}>
              <Input id="create-driver-nationality" list="create-driver-nationalities" autoComplete="off" {...register("nationality", { onChange: (e) => { const v = String(e.target.value).trim().toLowerCase(); const m = NATIONALITIES.find((n) => n.ar === v || n.en.toLowerCase() === v); if (m) setValue("nationality_code", m.code, { shouldValidate: true }) } })} className={inputClass} placeholder={isAr ? "اختر أو اكتب" : "Choose or type"} />
              <datalist id="create-driver-nationalities">{NATIONALITIES.map((n) => <option key={n.code} value={isAr ? n.ar : n.en} />)}</datalist>
            </Field>
            <Field isAr={isAr} id="create-driver-nationality_code" hint={isAr ? "يُملأ تلقائياً عند اختيار الجنسية" : "Filled automatically from the nationality"} label={isAr ? "رمز الجنسية (ISO)" : "Nationality code (ISO)"} error={errors.nationality_code?.message}>
              <Input id="create-driver-nationality_code" {...register("nationality_code")} maxLength={2} className={inputClass} dir="ltr" placeholder="SA, EG, PK..." />
            </Field>
            <Field isAr={isAr} id="create-driver-date_of_birth" label={isAr ? "تاريخ الميلاد" : "Date of birth"} error={errors.date_of_birth?.message}>
              <Input id="create-driver-date_of_birth" {...register("date_of_birth")} type="date" className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-gender" label={isAr ? "الجنس" : "Gender"} error={errors.gender?.message}>
              <Controller
                control={control}
                name="gender"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={(v) => field.onChange(v || undefined)}>
                    <SelectTrigger id="create-driver-gender" className="w-full data-[size=default]:h-10">
                      <SelectValue placeholder={isAr ? "اختر" : "Select"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">{isAr ? "ذكر" : "Male"}</SelectItem>
                      <SelectItem value="female">{isAr ? "أنثى" : "Female"}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </Section>

          {/* Legal */}
          <Section id="legal" isAr={isAr}>
            <Field isAr={isAr} id="create-driver-iqama_number" label={isAr ? "رقم الإقامة" : "Iqama number"} hint={isAr ? "10 أرقام تبدأ بـ 1 أو 2" : "10 digits starting with 1 or 2"} error={errors.iqama_number?.message}>
              <Input id="create-driver-iqama_number" {...register("iqama_number")} className={inputClass} dir="ltr" placeholder="1XXXXXXXXX" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field isAr={isAr} id="create-driver-iqama_issue_date" label={isAr ? "إصدار الإقامة" : "Iqama issue"}>
                <Input id="create-driver-iqama_issue_date" {...register("iqama_issue_date")} type="date" className={inputClass} />
              </Field>
              <Field isAr={isAr} id="create-driver-iqama_expiry_date" label={isAr ? "انتهاء الإقامة" : "Iqama expiry"}>
                <Input id="create-driver-iqama_expiry_date" {...register("iqama_expiry_date")} type="date" className={inputClass} />
              </Field>
            </div>
            <Field isAr={isAr} id="create-driver-passport_number" label={isAr ? "رقم جواز السفر" : "Passport number"} error={errors.passport_number?.message}>
              <Input id="create-driver-passport_number" {...register("passport_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field isAr={isAr} id="create-driver-passport_expiry_date" label={isAr ? "انتهاء الجواز" : "Passport expiry"}>
              <Input id="create-driver-passport_expiry_date" {...register("passport_expiry_date")} type="date" className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-license_number" label={isAr ? "رقم رخصة القيادة" : "Driving license no."} error={errors.license_number?.message}>
              <Input id="create-driver-license_number" {...register("license_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field isAr={isAr} id="create-driver-license_type" label={isAr ? "نوع الرخصة" : "License type"}>
              <Input id="create-driver-license_type" list="create-driver-license-types" autoComplete="off" {...register("license_type")} className={inputClass} placeholder={isAr ? "خاصة / عمومي / دراجة نارية" : "Private / Public / Motorcycle"} />
              <datalist id="create-driver-license-types">{(isAr ? ["خاصة", "عمومي", "دراجة نارية", "نقل ثقيل"] : ["Private", "Public", "Motorcycle", "Heavy transport"]).map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
            <Field isAr={isAr} id="create-driver-license_expiry_date" label={isAr ? "انتهاء الرخصة" : "License expiry"}>
              <Input id="create-driver-license_expiry_date" {...register("license_expiry_date")} type="date" className={inputClass} />
            </Field>
          </Section>

          {/* Contact */}
          <Section id="contact" isAr={isAr}>
            <Field isAr={isAr} id="create-driver-primary_mobile" label={isAr ? "الجوال الأساسي" : "Primary mobile"} hint={isAr ? "يبدأ بـ 05 أو +9665" : "Starts with 05 or +9665"} required error={errors.primary_mobile?.message}>
              <Input id="create-driver-primary_mobile" {...register("primary_mobile")} className={inputClass} dir="ltr" placeholder="05XXXXXXXX" />
            </Field>
            <Field isAr={isAr} id="create-driver-secondary_mobile" label={isAr ? "جوال ثانوي" : "Secondary mobile"} error={errors.secondary_mobile?.message}>
              <Input id="create-driver-secondary_mobile" {...register("secondary_mobile")} className={inputClass} dir="ltr" placeholder="05XXXXXXXX" />
            </Field>
            <Field isAr={isAr} id="create-driver-personal_email" label={isAr ? "البريد الشخصي" : "Personal email"} error={errors.personal_email?.message}>
              <Input id="create-driver-personal_email" {...register("personal_email")} type="email" className={inputClass} dir="ltr" />
            </Field>
            <Field isAr={isAr} id="create-driver-work_email" label={isAr ? "البريد الوظيفي" : "Work email"} error={errors.work_email?.message}>
              <Input id="create-driver-work_email" {...register("work_email")} type="email" className={inputClass} dir="ltr" />
            </Field>
            <Field isAr={isAr} id="create-driver-current_city" label={isAr ? "المدينة" : "City"} error={errors.current_city?.message}>
              <Input id="create-driver-current_city" {...register("current_city")} className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-current_region" label={isAr ? "المنطقة" : "Region"} error={errors.current_region?.message}>
              <Input id="create-driver-current_region" {...register("current_region")} className={inputClass} />
            </Field>
          </Section>

          {/* Employment */}
          <Section id="employment" isAr={isAr}>
            <Field isAr={isAr} id="create-driver-category" label={isAr ? "الفئة" : "Category"} required error={errors.category?.message}>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="create-driver-category" className="w-full data-[size=default]:h-10">
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
            <Field isAr={isAr} id="create-driver-status" label={isAr ? "الحالة" : "Status"} required error={errors.status?.message}>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="create-driver-status" className="w-full data-[size=default]:h-10">
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
            <Field isAr={isAr} id="create-driver-employment_type" label={isAr ? "نوع التوظيف" : "Employment type"} error={errors.employment_type?.message}>
              <Controller
                control={control}
                name="employment_type"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={(v) => field.onChange(v || undefined)}>
                    <SelectTrigger id="create-driver-employment_type" className="w-full data-[size=default]:h-10">
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
            <Field isAr={isAr} id="create-driver-contract_type" label={isAr ? "نوع العقد" : "Contract type"} error={errors.contract_type?.message}>
              <Controller
                control={control}
                name="contract_type"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={(v) => field.onChange(v || undefined)}>
                    <SelectTrigger id="create-driver-contract_type" className="w-full data-[size=default]:h-10">
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
            <Field isAr={isAr} id="create-driver-job_title" label={isAr ? "المسمى الوظيفي" : "Job title"} error={errors.job_title?.message}>
              <Input id="create-driver-job_title" {...register("job_title")} className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-department" label={isAr ? "القسم" : "Department"} error={errors.department?.message}>
              <Input id="create-driver-department" {...register("department")} className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-hire_date" label={isAr ? "تاريخ التعيين" : "Hire date"}>
              <Input id="create-driver-hire_date" {...register("hire_date")} type="date" className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-termination_date" label={isAr ? "تاريخ انتهاء العمل" : "Termination date"} error={errors.termination_date?.message}><Input id="create-driver-termination_date" {...register("termination_date")} type="date" className={inputClass}/><p className="text-xs text-muted-foreground">{isAr?"للسجلات المنهية أو المحظورة فقط.":"For terminated or blacklisted employment records."}</p></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field isAr={isAr} id="create-driver-contract_start" label={isAr ? "بداية العقد" : "Contract start"}>
                <Input id="create-driver-contract_start" {...register("contract_start")} type="date" className={inputClass} />
              </Field>
              <Field isAr={isAr} id="create-driver-contract_end" label={isAr ? "نهاية العقد" : "Contract end"} error={errors.contract_end?.message}>
                <Input id="create-driver-contract_end" {...register("contract_end")} type="date" className={inputClass} />
              </Field>
            </div>
          </Section>

          {/* Payroll */}
          <Section id="payroll" isAr={isAr}>
            <Field isAr={isAr} id="create-driver-basic_salary" label={isAr ? "الراتب الأساسي (ر.س)" : "Basic salary (SAR)"} error={errors.basic_salary?.message}>
              <MoneyInput isAr={isAr} id="create-driver-basic_salary" {...register("basic_salary")} inputMode="decimal" dir="ltr" placeholder="4000" />
            </Field>
            <Field isAr={isAr} id="create-driver-housing_allowance" label={isAr ? "بدل السكن (ر.س)" : "Housing allowance (SAR)"} error={errors.housing_allowance?.message}>
              <MoneyInput isAr={isAr} id="create-driver-housing_allowance" {...register("housing_allowance")} inputMode="decimal" dir="ltr" placeholder="0" />
            </Field>
            <Field isAr={isAr} id="create-driver-transport_allowance" label={isAr ? "بدل النقل (ر.س)" : "Transport allowance (SAR)"} error={errors.transport_allowance?.message}>
              <MoneyInput isAr={isAr} id="create-driver-transport_allowance" {...register("transport_allowance")} inputMode="decimal" dir="ltr" placeholder="0" />
            </Field>
            <Field isAr={isAr} id="create-driver-bank_name" label={isAr ? "اسم البنك" : "Bank name"} error={errors.bank_name?.message}>
              <Input id="create-driver-bank_name" {...register("bank_name")} className={inputClass} />
            </Field>
            <Field isAr={isAr} id="create-driver-iban" label={isAr ? "رقم الآيبان" : "IBAN"} hint={isAr ? "24 خانة تبدأ بـ SA" : "24 characters starting with SA"} error={errors.iban?.message}>
              <Input id="create-driver-iban" {...register("iban", { setValueAs: (v: string) => (v ?? "").replace(/\s/g, "").toUpperCase() })} className={`${inputClass} font-mono uppercase tracking-wide`} dir="ltr" maxLength={34} placeholder="SA00 0000 0000 0000 0000 0000" />
            </Field>
          </Section>

          {/* Notes */}
          <Section id="notes" isAr={isAr} cols={1}>
            <Label htmlFor="create-driver-internal_notes" className="sr-only">{isAr ? "ملاحظات داخلية" : "Internal notes"}</Label>
            <Textarea id="create-driver-internal_notes" {...register("internal_notes")} rows={3} placeholder={isAr ? "أي ملاحظات للفريق الداخلي…" : "Anything the internal team should know…"} />
          </Section>

          {Object.keys(errors).length > 0 && (
            <p role="alert" className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"><CircleAlert className="size-4 shrink-0" />{isAr ? `يرجى تصحيح ${Object.keys(errors).length} حقل قبل الحفظ.` : `Please fix ${Object.keys(errors).length} field(s) before saving.`}</p>
          )}
          <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
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
              className="rounded-xl bg-elite-blue-500 text-white hover:bg-elite-blue-600"
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
