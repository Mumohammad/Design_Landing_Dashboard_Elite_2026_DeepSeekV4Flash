"use client"

import { useEffect, useState } from "react"
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
import { createClient } from "@/lib/supabase/client"
import { createOrderEntry } from "@/lib/orders/actions"
import { useTranslation } from "@/hooks/use-translation"

const formSchema = z.object({
  driver_id: z.string().min(1, "Driver is required"),
  platform_id: z.string().min(1, "Platform is required"),
  entry_date: z.string().min(1, "Date is required"),
  shift_label: z.string().optional(),
  orders_delivered: z.string().optional(),
  orders_failed: z.string().optional(),
  orders_returned: z.string().optional(),
  orders_cancelled: z.string().optional(),
  total_distance_km: z.string().optional(),
  avg_order_distance_km: z.string().optional(),
  multi_order_batches: z.string().optional(),
  gross_revenue: z.string().optional(),
  platform_reported_revenue: z.string().optional(),
  notes: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

function toNum(v: string | undefined, fallback = 0): number {
  const t = v?.trim()
  if (!t) return fallback
  const n = Number(t)
  return Number.isFinite(n) ? n : fallback
}

function toNumNullable(v: string | undefined): number | null {
  const t = v?.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function toNullable(v: string | undefined): string | null {
  const t = v?.trim()
  return t ? t : null
}

interface DriverOption {
  id: string
  full_name_ar: string | null
  driver_code: string | null
}

interface PlatformOption {
  id: string
  name_ar: string | null
  name_en: string | null
}

const SHIFTS = [
  { value: "full_day", ar: "يوم كامل", en: "Full day" },
  { value: "morning", ar: "صباحية", en: "Morning" },
  { value: "evening", ar: "مسائية", en: "Evening" },
  { value: "night", ar: "ليلية", en: "Night" },
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

export function CreateOrderEntryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const [submitting, setSubmitting] = useState(false)
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [platforms, setPlatforms] = useState<PlatformOption[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      entry_date: new Date().toISOString().slice(0, 10),
      shift_label: "full_day",
      orders_delivered: "0",
      orders_failed: "0",
      orders_returned: "0",
      orders_cancelled: "0",
      multi_order_batches: "0",
    },
  })

  // Load drivers + platforms whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    let active = true
    const supabase = createClient()
    ;(async () => {
      const [drvRes, platRes] = await Promise.all([
        supabase
          .from("drivers")
          .select("id,full_name_ar,driver_code")
          .in("status", ["active", "on_leave"])
          .is("deleted_at", null)
          .order("full_name_ar", { ascending: true })
          .limit(100),
        supabase
          .from("delivery_platforms")
          .select("id,name_ar,name_en")
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true }),
      ])
      if (!active) return
      if (drvRes.error || platRes.error) {
        setLoadError(drvRes.error?.message ?? platRes.error?.message ?? null)
        return
      }
      setDrivers((drvRes.data as DriverOption[] | null) ?? [])
      setPlatforms((platRes.data as PlatformOption[] | null) ?? [])
      setLoadError(null)
    })()
    return () => {
      active = false
    }
  }, [open])

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    const result = await createOrderEntry({
      driver_id: values.driver_id,
      platform_id: values.platform_id,
      entry_date: values.entry_date,
      shift_label: values.shift_label === "full_day" ? null : toNullable(values.shift_label),
      orders_delivered: toNum(values.orders_delivered),
      orders_failed: toNum(values.orders_failed),
      orders_returned: toNum(values.orders_returned),
      orders_cancelled: toNum(values.orders_cancelled),
      total_distance_km: toNumNullable(values.total_distance_km),
      avg_order_distance_km: toNumNullable(values.avg_order_distance_km),
      multi_order_batches: toNum(values.multi_order_batches),
      gross_revenue: toNum(values.gross_revenue),
      platform_reported_revenue: toNumNullable(values.platform_reported_revenue),
      notes: toNullable(values.notes),
    })
    setSubmitting(false)

    if (result.success) {
      toast.success(isAr ? "تم تسجيل الطلبات بنجاح" : "Orders recorded successfully")
      reset()
      onOpenChange(false)
      onCreated()
    } else {
      toast.error(result.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{isAr ? "تسجيل طلبات اليوم" : "Record Daily Orders"}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "اختر السائق والمنصة ثم أدخل أعداد الطلبات والإيرادات — تُعاد التحقق على الخادم."
              : "Pick the driver and platform, then enter order counts and revenue — re-validated on the server."}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {loadError}
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6" noValidate>
            <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
              <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
                {isAr ? "السائق والمنصة" : "Driver & platform"}
              </legend>
              <Field label={isAr ? "السائق" : "Driver"} required error={errors.driver_id?.message}>
                <Controller
                  control={control}
                  name="driver_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={isAr ? "اختر السائق" : "Select driver"} />
                      </SelectTrigger>
                      <SelectContent>
                        {drivers.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.full_name_ar ?? d.driver_code ?? d.id.slice(0, 8)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label={isAr ? "المنصة" : "Platform"} required error={errors.platform_id?.message}>
                <Controller
                  control={control}
                  name="platform_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={isAr ? "اختر المنصة" : "Select platform"} />
                      </SelectTrigger>
                      <SelectContent>
                        {platforms.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name_ar ?? p.name_en ?? p.id.slice(0, 8)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label={isAr ? "التاريخ" : "Date"} required error={errors.entry_date?.message}>
                <Input {...register("entry_date")} type="date" className={inputClass} />
              </Field>
              <Field label={isAr ? "الوردية" : "Shift"} error={errors.shift_label?.message}>
                <Controller
                  control={control}
                  name="shift_label"
                  render={({ field }) => (
                    <Select value={field.value || "full_day"} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHIFTS.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {isAr ? s.ar : s.en}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </fieldset>

            <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
              <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
                {isAr ? "أعداد الطلبات" : "Order counts"}
              </legend>
              <Field label={isAr ? "طلبات مُسلّمة" : "Delivered"}>
                <Input {...register("orders_delivered")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
              <Field label={isAr ? "طلبات فاشلة" : "Failed"}>
                <Input {...register("orders_failed")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
              <Field label={isAr ? "طلبات مُرجَعة" : "Returned"}>
                <Input {...register("orders_returned")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
              <Field label={isAr ? "طلبات ملغاة" : "Cancelled"}>
                <Input {...register("orders_cancelled")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
            </fieldset>

            <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
              <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
                {isAr ? "المسافة والإيرادات" : "Distance & revenue"}
              </legend>
              <Field label={isAr ? "المسافة الإجمالية (كم)" : "Total distance (km)"}>
                <Input {...register("total_distance_km")} inputMode="decimal" className={inputClass} dir="ltr" />
              </Field>
              <Field label={isAr ? "متوسط مسافة الطلب (كم)" : "Avg order distance (km)"}>
                <Input {...register("avg_order_distance_km")} inputMode="decimal" className={inputClass} dir="ltr" />
              </Field>
              <Field label={isAr ? "دفعات متعددة الطلبات" : "Multi-order batches"}>
                <Input {...register("multi_order_batches")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
              <Field label={isAr ? "الإيرادات الإجمالية (ر.س)" : "Gross revenue (SAR)"}>
                <Input {...register("gross_revenue")} inputMode="decimal" className={inputClass} dir="ltr" />
              </Field>
              <Field label={isAr ? "إيرادات المنصة المبلّغة (ر.س)" : "Platform-reported revenue (SAR)"}>
                <Input {...register("platform_reported_revenue")} inputMode="decimal" className={inputClass} dir="ltr" />
              </Field>
            </fieldset>

            <fieldset className="grid gap-2 rounded-2xl border border-border/50 bg-muted/20 p-4">
              <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
                {isAr ? "ملاحظات" : "Notes"}
              </legend>
              <Textarea {...register("notes")} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" />
            </fieldset>

            <div className="flex items-center justify-end gap-3 border-t border-border/50 pt-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                {isAr ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-gradient-to-r from-elite-blue-500 to-elite-blue-700 text-white hover:from-elite-blue-600 hover:to-elite-blue-800"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isAr ? "حفظ الطلبات" : "Save orders"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
