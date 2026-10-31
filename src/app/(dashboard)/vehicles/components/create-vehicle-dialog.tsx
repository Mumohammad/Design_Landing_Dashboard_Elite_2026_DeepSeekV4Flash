"use client"

import * as React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "@/lib/toast"
import { CarFront, CircleAlert, Cog, Gauge, Loader2, ShieldCheck, StickyNote } from "lucide-react"
import { FORM_BODY_CLASS, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_HEADER_CLASS, FormSection, FormSectionNav, SuffixInput } from "@/components/forms/form-kit"

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
import { createVehicle, updateVehicle } from "@/lib/vehicles/actions"
import { useTranslation } from "@/hooks/use-translation"
import { isSaudiPlate, normalizeSaudiPlate, type VehicleCreateInput, type VehicleStatus, type VehicleCondition, type FuelType } from "@/types/vehicles"

const SAUDI_PLATE_HINT = "أ ب ج 1234 / ABC 1234 / 1234567"


// Loose client-side schema (string values from the DOM). The canonical
// vehicleCreateSchema re-validates everything server-side in createVehicle.
const formSchema = z
  .object({
    vehicle_code: z.string().optional(),
    plate_number: z
      .string()
      .trim()
      .min(4, "Plate number is required")
      .refine((v) => isSaudiPlate(normalizeSaudiPlate(v)), "Invalid Saudi plate format"),
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

const ERROR_AR: Record<string, string> = {
  "Make is required": "الماركة مطلوبة",
  "Model is required": "الموديل مطلوب",
  "Plate number is required": "رقم اللوحة مطلوب",
  "Year must be 1980 or later": "سنة الصنع يجب أن تكون 1980 أو أحدث",
}

function Field({
  isAr,
  label,
  error,
  required,
  children,
  className,
}: {
  isAr?: boolean
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  // Associate the label with its control so screen readers (and tests) can find it.
  const generatedId = React.useId()
  const child = React.isValidElement<{ id?: string }>(children) ? children : null
  const controlId = child?.props.id ?? generatedId
  return (
    <div className={`grid content-start gap-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-semibold text-foreground/80" htmlFor={controlId}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {child ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, { id: controlId, "aria-invalid": error ? true : undefined }) : children}
      {error && <p className="flex items-center gap-1 text-[11px] font-medium text-destructive"><CircleAlert className="size-3 shrink-0" />{isAr ? (ERROR_AR[error] ?? error) : error}</p>}
    </div>
  )
}

export function CreateVehicleDialog({
  open,
  onOpenChange,
  initialVehicle,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialVehicle?: VehicleCreateInput & {id:string;version:number}
  onSaved?: () => void
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
      ...(initialVehicle ? Object.fromEntries(Object.entries(initialVehicle).map(([key,value])=>[key,value==null?"":typeof value==="number"?String(value):value])) : {}),
    },
  })

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    const input: VehicleCreateInput = {
      vehicle_code: toNullable(values.vehicle_code),
      plate_number: normalizeSaudiPlate(values.plate_number),
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
    }
    const result = initialVehicle ? await updateVehicle(initialVehicle.id,initialVehicle.version,input) : await createVehicle(input)
    setSubmitting(false)

    if (result.success) {
      toast.success(isAr ? "تم حفظ المركبة" : "Vehicle saved")
      reset()
      onOpenChange(false)
      router.refresh()
      onSaved?.()
      if (!initialVehicle && result.id) router.push(`/vehicles/${result.id}`)
    } else {
      toast.error(result.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
    }
  }

  const inputClass = "h-10"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${FORM_DIALOG_CLASS} sm:max-w-5xl`}>
        <div className={FORM_HEADER_CLASS}>
        <DialogHeader className="text-start">
          <DialogTitle className="text-lg">{initialVehicle ? (isAr ? "تعديل المركبة" : "Edit vehicle") : (isAr ? "إنشاء مركبة جديدة" : "Create New Vehicle")}</DialogTitle>
          <DialogDescription className="text-xs">
            {isAr
              ? "أدخل بيانات المركبة. تتحكم التعيينات والصيانة في إتاحة المركبة."
              : "Enter the vehicle details. Assignments and maintenance control availability."}
          </DialogDescription>
        </DialogHeader>
          <FormSectionNav label={isAr ? "أقسام النموذج" : "Form sections"} items={[
            { id: "create-vehicle-section-identity", icon: CarFront, label: isAr ? "البيانات الأساسية" : "Identity" },
            { id: "create-vehicle-section-technical", icon: Cog, label: isAr ? "البيانات الفنية" : "Identification" },
            { id: "create-vehicle-section-status", icon: Gauge, label: isAr ? "الحالة والتشغيل" : "Status & operation" },
            { id: "create-vehicle-section-documents", icon: ShieldCheck, label: isAr ? "الوثائق والصلاحيات" : "Documents & validity" },
            { id: "create-vehicle-section-notes", icon: StickyNote, label: isAr ? "ملاحظات" : "Notes" },
          ]} />
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className={FORM_BODY_CLASS} noValidate>
          {/* Identity */}
          <FormSection id="create-vehicle-section-identity" icon={CarFront} cols={2} title={isAr ? "البيانات الأساسية" : "Identity"} hint={isAr ? "اللوحة والطراز وسنة الصنع" : "Plate, make, model and year"}>
            <Field isAr={isAr} label={isAr ? "رمز المركبة" : "Vehicle code"} error={errors.vehicle_code?.message}>
              <Input {...register("vehicle_code")} className={inputClass} dir="ltr" placeholder="VEH-XXXXXX" />
            </Field>
            <Field isAr={isAr} label={isAr ? "رقم اللوحة" : "Plate number"} required error={errors.plate_number?.message}>
              <Input
                {...register("plate_number")}
                className={inputClass}
                dir="ltr"
                placeholder={isAr ? "أ ب ج 1234" : "ABC 1234"}
              />
            </Field>
            <Field isAr={isAr} label={isAr ? "نوع اللوحة" : "Plate type"} error={errors.plate_type?.message}>
              <Input {...register("plate_type")} className={inputClass} placeholder={isAr ? "خاصة / نقل" : "Private / Transport"} />
            </Field>
            <Field isAr={isAr} label={isAr ? "الماركة" : "Make"} required error={errors.make?.message}>
              <Input {...register("make")} className={inputClass} placeholder={isAr ? "تويوتا" : "Toyota"} />
            </Field>
            <Field isAr={isAr} label={isAr ? "الموديل" : "Model"} required error={errors.model?.message}>
              <Input {...register("model")} className={inputClass} placeholder={isAr ? "كامري" : "Camry"} />
            </Field>
            <Field isAr={isAr} label={isAr ? "سنة الصنع" : "Year"} error={errors.year?.message}>
              <Input {...register("year")} inputMode="numeric" className={inputClass} dir="ltr" placeholder="2024" />
            </Field>
            <Field isAr={isAr} label={isAr ? "اللون" : "Color"} error={errors.color?.message}>
              <Input {...register("color")} className={inputClass} />
            </Field>
          </FormSection>

          {/* Identification */}
          <FormSection id="create-vehicle-section-technical" icon={Cog} cols={2} title={isAr ? "البيانات الفنية" : "Identification"} hint={isAr ? "الشاصي والمحرك ورقم VIN" : "Chassis, engine and VIN"}>
            <Field isAr={isAr} label={isAr ? "رقم الشاصي" : "Chassis number"} error={errors.chassis_number?.message}>
              <Input {...register("chassis_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field isAr={isAr} label={isAr ? "رقم المحرك" : "Engine number"} error={errors.engine_number?.message}>
              <Input {...register("engine_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field isAr={isAr} label={isAr ? "رقم الهيكل (VIN)" : "VIN"} error={errors.vin?.message}>
              <Input {...register("vin")} className={inputClass} dir="ltr" />
            </Field>
            <Field isAr={isAr} label={isAr ? "نوع الوقود" : "Fuel type"} error={errors.fuel_type?.message}>
              <Controller
                control={control}
                name="fuel_type"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={(v) => field.onChange(v || undefined)}>
                    <SelectTrigger className="w-full data-[size=default]:h-10">
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
          </FormSection>

          {/* Status */}
          <FormSection id="create-vehicle-section-status" icon={Gauge} cols={3} title={isAr ? "الحالة والتشغيل" : "Status & operation"} hint={isAr ? "الإتاحة والوقود وعداد المسافة" : "Availability, fuel and odometer"}>
            <Field isAr={isAr} label={isAr ? "الحالة" : "Status"} required error={errors.status?.message}>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full data-[size=default]:h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(initialVehicle && !STATUSES.some(s=>s.value===initialVehicle.status) ? [...STATUSES,{value:initialVehicle.status!,ar:"تديرها العمليات",en:"Managed by operations"}] : STATUSES).map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {isAr ? s.ar : s.en}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field isAr={isAr} label={isAr ? "حالة المركبة" : "Condition"} required error={errors.condition_status?.message}>
              <Controller
                control={control}
                name="condition_status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full data-[size=default]:h-10">
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
            <Field isAr={isAr} label={isAr ? "عداد الكيلومترات" : "Odometer (km)"} error={errors.odometer_current?.message}>
              <SuffixInput suffix={isAr ? "كم" : "km"} {...register("odometer_current")} inputMode="numeric" dir="ltr" placeholder="0" />
            </Field>
          </FormSection>

          {/* Documents */}
          <FormSection id="create-vehicle-section-documents" icon={ShieldCheck} cols={2} title={isAr ? "الوثائق والصلاحيات" : "Documents & validity"} hint={isAr ? "التأمين والاستمارة والفحص الدوري" : "Insurance, registration and inspection"}>
            <Field isAr={isAr} label={isAr ? "انتهاء التأمين" : "Insurance expiry"}>
              <Input {...register("insurance_expiry")} type="date" className={inputClass} />
            </Field>
            <Field isAr={isAr} label={isAr ? "شركة التأمين" : "Insurance provider"}>
              <Input {...register("insurance_provider")} className={inputClass} />
            </Field>
            <Field isAr={isAr} label={isAr ? "رقم وثيقة التأمين" : "Policy number"}>
              <Input {...register("insurance_policy_number")} className={inputClass} dir="ltr" />
            </Field>
            <Field isAr={isAr} label={isAr ? "انتهاء الاستمارة" : "Registration expiry"}>
              <Input {...register("registration_expiry")} type="date" className={inputClass} />
            </Field>
            <Field isAr={isAr} label={isAr ? "انتهاء الفحص الدوري" : "Inspection expiry"}>
              <Input {...register("inspection_expiry")} type="date" className={inputClass} />
            </Field>
            <Field isAr={isAr} label={isAr ? "انتهاء بطاقة التشغيل" : "Operating card expiry"}>
              <Input {...register("operating_card_expiry")} type="date" className={inputClass} />
            </Field>
          </FormSection>

          {/* Notes */}
          <FormSection id="create-vehicle-section-notes" icon={StickyNote} cols={1} title={isAr ? "ملاحظات" : "Notes"} hint={isAr ? "ملاحظات داخلية" : "Internal notes"}>
            <Textarea {...register("notes")} rows={3} />
          </FormSection>

          <p className="text-[11px] text-muted-foreground">
            {isAr ? "تلميح اللوحة:" : "Plate hint:"} {SAUDI_PLATE_HINT}
          </p>

          <div className={FORM_FOOTER_CLASS}>
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
              {initialVehicle ? (isAr?"حفظ التغييرات":"Save changes") : (isAr ? "إنشاء المركبة" : "Create vehicle")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
