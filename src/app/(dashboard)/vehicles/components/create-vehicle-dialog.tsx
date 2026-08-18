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
import { createVehicle } from "@/lib/vehicles/actions"
import { useTranslation } from "@/hooks/use-translation"
import type { VehicleStatus, VehicleCondition, FuelType } from "@/types/vehicles"

const SAUDI_PLATE_HINT = "أ ب ج 1234 / ABC 1234 / 1234567"

function isSaudiPlate(val: string): boolean {
  const arabicPlate = /^[\u0600-\u06FF]{1,3}\s?\d{3,4}$/
  const englishPlate = /^[A-Z]{1,3}\s?\d{3,4}$/
  const numericOnly = /^\d{4,7}$/
  return arabicPlate.test(val) || englishPlate.test(val) || numericOnly.test(val)
}

// Loose client-side schema (string values from the DOM). The canonical
// vehicleCreateSchema re-validates everything server-side in createVehicle.
const formSchema = z
  .object({
    vehicle_code: z.string().optional(),
    plate_number: z
      .string()
      .trim()
      .min(4, "Plate number is required")
      .refine(isSaudiPlate, "Invalid Saudi plate format"),
    plate_type: z.string().optional(),
    make: z.string().trim().min(1, "Make is required"),
    model: z.string().trim().min(1, "Model is required"),
    year: z.string().optional(),
    color: z.string().optional(),
    chassis_number: z.string().optional(),
    engine_number: z.string().optional(),
    vin: z.string().optional(),
    status: z.enum(["available", "assigned", "in_maintenance", "off_road", "retired"]),
    condition_status: z.enum(["excellent", "good", "fair", "poor", "damaged"]),
    fuel_type: z
      .enum(["petrol", "diesel", "hybrid", "electric"])
      .or(z.literal(""))
      .optional(),
    odometer_current: z.string().optional(),
    insurance_expiry: z.string().optional(),
    insurance_provider: z.string().optional(),
    insurance_policy_number: z.string().optional(),
    registration_expiry: z.string().optional(),
    inspection_expiry: z.string().optional(),
    operating_card_expiry: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((d) => !d.year || Number(d.year) >= 1980, {
    message: "Year must be 1980 or later",
    path: ["year"],
  })

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

const STATUSES: { value: VehicleStatus; ar: string; en: string }[] = [
  { value: "available", ar: "متاحة", en: "Available" },
  { value: "assigned", ar: "مُعيّنة", en: "Assigned" },
  { value: "in_maintenance", ar: "في الصيانة", en: "In Maintenance" },
  { value: "off_road", ar: "خارج الخدمة", en: "Off Road" },
  { value: "retired", ar: "مُتقاعدة", en: "Retired" },
]

const CONDITIONS: { value: VehicleCondition; ar: string; en: string }[] = [
  { value: "excellent", ar: "ممتازة", en: "Excellent" },
  { value: "good", ar: "جيدة", en: "Good" },
  { value: "fair", ar: "متوسطة", en: "Fair" },
  { value: "poor", ar: "ضعيفة", en: "Poor" },
  { value: "damaged", ar: "متضررة", en: "Damaged" },
]

const FUEL_TYPES: { value: FuelType; ar: string; en: string }[] = [
  { value: "petrol", ar: "بنزين", en: "Petrol" },
  { value: "diesel", ar: "ديزل", en: "Diesel" },
  { value: "hybrid", ar: "هجين", en: "Hybrid" },
  { value: "electric", ar: "كهربائية", en: "Electric" },
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

export function CreateVehicleDialog({
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
      status: "available",
      condition_status: "good",
    },
  })

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    const result = await createVehicle({
      vehicle_code: toNullable(values.vehicle_code),
      plate_number: values.plate_number.trim(),
      plate_type: toNullable(values.plate_type),
      make: values.make.trim(),
      model: values.model.trim(),
      year: toNumberNullable(values.year),
      color: toNullable(values.color),
      chassis_number: toNullable(values.chassis_number),
      engine_number: toNullable(values.engine_number),
      vin: toNullable(values.vin),
      status: values.status,
      condition_status: values.condition_status,
      fuel_type: (toNullable(values.fuel_type) as FuelType | null) ?? null,
      odometer_current: toNumberNullable(values.odometer_current) ?? 0,
      insurance_expiry: toNullable(values.insurance_expiry),
      insurance_provider: toNullable(values.insurance_provider),
      insurance_policy_number: toNullable(values.insurance_policy_number),
      registration_expiry: toNullable(values.registration_expiry),
      inspection_expiry: toNullable(values.inspection_expiry),
      operating_card_expiry: toNullable(values.operating_card_expiry),
      notes: toNullable(values.notes),
    })
    setSubmitting(false)

    if (result.success) {
      toast.success(isAr ? "تم إنشاء المركبة بنجاح" : "Vehicle created successfully")
      reset()
      onOpenChange(false)
      router.refresh()
      if (result.id) router.push(`/vehicles/${result.id}`)
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
          <DialogTitle>{isAr ? "إنشاء مركبة جديدة" : "Create New Vehicle"}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "املأ بيانات المركبة الأساسية — تُعاد التحقق من الحقول على الخادم."
              : "Fill in the vehicle's core details — fields are re-validated on the server."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6" noValidate>
          {/* Identity */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "البيانات الأساسية" : "Identity"}
            </legend>
            <Field label={isAr ? "رمز المركبة" : "Vehicle code"} error={errors.vehicle_code?.message}>
              <Input {...register("vehicle_code")} className={inputClass} dir="ltr" placeholder="VEH-XXXXXX" />
            </Field>
            <Field label={isAr ? "رقم اللوحة" : "Plate number"} required error={errors.plate_number?.message}>
              <Input
                {...register("plate_number")}
                className={inputClass}
                dir="ltr"
                placeholder={isAr ? "أ ب ج 1234" : "ABC 1234"}
              />
            </Field>
            <Field label={isAr ? "نوع اللوحة" : "Plate type"} error={errors.plate_type?.message}>
              <Input {...register("plate_type")} className={inputClass} placeholder={isAr ? "خاصة / نقل" : "Private / Transport"} />
            </Field>
            <Field label={isAr ? "الماركة" : "Make"} required error={errors.make?.message}>
              <Input {...register("make")} className={inputClass} placeholder={isAr ? "تويوتا" : "Toyota"} />
            </Field>
            <Field label={isAr ? "الموديل" : "Model"} required error={errors.model?.message}>
              <Input {...register("model")} className={inputClass} placeholder={isAr ? "كامري" : "Camry"} />
            </Field>
            <Field label={isAr ? "سنة الصنع" : "Year"} error={errors.year?.message}>
              <Input {...register("year")} inputMode="numeric" className={inputClass} dir="ltr" placeholder="2024" />
            </Field>
            <Field label={isAr ? "اللون" : "Color"} error={errors.color?.message}>
              <Input {...register("color")} className={inputClass} />
            </Field>
          </fieldset>

          {/* Identification */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "البيانات الفنية" : "Identification"}
            </legend>
            <Field label={isAr ? "رقم الشاصي" : "Chassis number"} error={errors.chassis_number?.message}>
              <Input {...register("chassis_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field label={isAr ? "رقم المحرك" : "Engine number"} error={errors.engine_number?.message}>
              <Input {...register("engine_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field label={isAr ? "رقم الهيكل (VIN)" : "VIN"} error={errors.vin?.message}>
              <Input {...register("vin")} className={inputClass} dir="ltr" />
            </Field>
            <Field label={isAr ? "نوع الوقود" : "Fuel type"} error={errors.fuel_type?.message}>
              <Controller
                control={control}
                name="fuel_type"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={(v) => field.onChange(v || undefined)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={isAr ? "اختر" : "Select"} />
                    </SelectTrigger>
                    <SelectContent>
                      {FUEL_TYPES.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {isAr ? f.ar : f.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </fieldset>

          {/* Status */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-3">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "الحالة والتشغيل" : "Status & operation"}
            </legend>
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
            <Field label={isAr ? "حالة المركبة" : "Condition"} required error={errors.condition_status?.message}>
              <Controller
                control={control}
                name="condition_status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {isAr ? c.ar : c.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label={isAr ? "عداد الكيلومترات" : "Odometer (km)"} error={errors.odometer_current?.message}>
              <Input {...register("odometer_current")} inputMode="numeric" className={inputClass} dir="ltr" placeholder="0" />
            </Field>
          </fieldset>

          {/* Documents */}
          <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "الوثائق والصلاحيات" : "Documents & validity"}
            </legend>
            <Field label={isAr ? "انتهاء التأمين" : "Insurance expiry"}>
              <Input {...register("insurance_expiry")} type="date" className={inputClass} />
            </Field>
            <Field label={isAr ? "شركة التأمين" : "Insurance provider"}>
              <Input {...register("insurance_provider")} className={inputClass} />
            </Field>
            <Field label={isAr ? "رقم وثيقة التأمين" : "Policy number"}>
              <Input {...register("insurance_policy_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field label={isAr ? "انتهاء الاستمارة" : "Registration expiry"}>
              <Input {...register("registration_expiry")} type="date" className={inputClass} />
            </Field>
            <Field label={isAr ? "انتهاء الفحص الدوري" : "Inspection expiry"}>
              <Input {...register("inspection_expiry")} type="date" className={inputClass} />
            </Field>
            <Field label={isAr ? "انتهاء بطاقة التشغيل" : "Operating card expiry"}>
              <Input {...register("operating_card_expiry")} type="date" className={inputClass} />
            </Field>
          </fieldset>

          {/* Notes */}
          <fieldset className="grid gap-2 rounded-2xl border border-border/50 bg-muted/20 p-4">
            <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
              {isAr ? "ملاحظات" : "Notes"}
            </legend>
            <Textarea {...register("notes")} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" />
          </fieldset>

          <p className="text-[11px] text-muted-foreground">
            {isAr ? "تلميح اللوحة:" : "Plate hint:"} {SAUDI_PLATE_HINT}
          </p>

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
              {isAr ? "إنشاء المركبة" : "Create vehicle"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
