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
import { createOrderEntry, updateOrderEntry, type OrderListRow } from "@/lib/orders/actions"
import { useTranslation } from "@/hooks/use-translation"

const countInput=z.string().optional().refine(value=>!value?.trim() || (Number.isInteger(Number(value)) && Number(value)>=0), "Enter a nonnegative whole number")
const amountInput=z.string().optional().refine(value=>!value?.trim() || (Number.isFinite(Number(value)) && Number(value)>=0), "Enter a nonnegative amount")
const formSchema = z.object({
  driver_id: z.string().min(1, "Driver is required"),
  platform_id: z.string().min(1, "Platform is required"),
  entry_date: z.string().min(1, "Date is required"),
  shift_label: z.string().optional(),
  orders_delivered: countInput,
  orders_failed: countInput,
  orders_returned: countInput,
  orders_cancelled: countInput,
  total_distance_km: amountInput,
  avg_order_distance_km: amountInput,
  multi_order_batches: countInput,
  gross_revenue: amountInput,
  platform_reported_revenue: amountInput,
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
  htmlFor,
  error,
  required,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor} className="text-xs font-semibold">
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
  entry,
}: {
  entry?: Partial<OrderListRow> | null
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
  const [saveError, setSaveError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: entry ? {
      driver_id:entry.driver_id,platform_id:entry.platform_id,entry_date:entry.entry_date,shift_label:entry.shift_label ?? "full_day",
      ...Object.fromEntries(["orders_delivered","orders_failed","orders_returned","orders_cancelled","multi_order_batches","gross_revenue","platform_reported_revenue","total_distance_km","avg_order_distance_km"].map(key=>[key,String(entry[key as keyof OrderListRow] ?? "")])),notes:entry.notes ?? "",
    } : {
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
      const driverRows:DriverOption[]=[], platformRows:PlatformOption[]=[]
      const readDrivers=async()=>{
        let offset=0,total=Infinity
        while(offset<total){
          let query=supabase.from("drivers").select("id,full_name_ar,driver_code",{count:"exact"}).is("deleted_at",null).order("id")
          query=entry?.driver_id?query.or("status.in.(active,on_leave),id.eq."+entry.driver_id):query.in("status",["active","on_leave"])
          const result=await query.range(offset,offset+499)
          if(result.error)return result
          total=result.count??0
          if(!result.data.length && offset<total)return{data:null,error:{message:"Driver list changed. Close and reopen the form."}}
          driverRows.push(...result.data);offset+=result.data.length
        }
        return{data:driverRows,error:null}
      }
      const readPlatforms=async()=>{
        let offset=0,total=Infinity
        while(offset<total){
          let query=supabase.from("delivery_platforms").select("id,name_ar,name_en",{count:"exact"}).is("deleted_at",null).order("id")
          query=entry?.platform_id?query.or("is_active.eq.true,id.eq."+entry.platform_id):query.eq("is_active",true)
          const result=await query.range(offset,offset+499)
          if(result.error)return result
          total=result.count??0
          if(!result.data.length && offset<total)return{data:null,error:{message:"Platform list changed. Close and reopen the form."}}
          platformRows.push(...result.data);offset+=result.data.length
        }
        return{data:platformRows,error:null}
      }
      const [drvRes,platRes]=await Promise.all([readDrivers(),readPlatforms()])
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
  }, [open,entry?.driver_id,entry?.platform_id])

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    setSaveError(null)
    const payload = {
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
    }
    const result = entry?.id && entry.updated_at ? await updateOrderEntry(entry.id,entry.updated_at,payload) : await createOrderEntry(payload)
    setSubmitting(false)

    if (result.success) {
      toast.success(isAr ? "تم تسجيل الطلبات بنجاح" : "Orders recorded successfully")
      reset()
      onOpenChange(false)
      onCreated()
    } else {
      setSaveError(result.error ?? "Could not save the entry. Try again.")
      toast.error(result.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"

  return (
    <Dialog open={open} onOpenChange={(next) => {if(!submitting)onOpenChange(next)}}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? (isAr ? "تعديل طلبات اليوم" : "Edit Daily Orders") : (isAr ? "تسجيل طلبات اليوم" : "Record Daily Orders")}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "اختر السائق والمنصة وأدخل أعداد الطلبات والإيرادات. تصبح البيانات للقراءة فقط بعد إقفال فترة الرواتب."
              : "Choose the driver and platform, then record order counts and revenue. Entries become read-only after payroll preparation is locked."}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {loadError}
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6" noValidate>
            {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
              <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
                {isAr ? "السائق والمنصة" : "Driver & platform"}
              </legend>
              <Field htmlFor="driver_id" label={isAr ? "السائق" : "Driver"} required error={errors.driver_id?.message}>
                <Controller
                  control={control}
                  name="driver_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={field.name} className="w-full">
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
              <Field htmlFor="platform_id" label={isAr ? "المنصة" : "Platform"} required error={errors.platform_id?.message}>
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
              <Field htmlFor="entry_date" label={isAr ? "التاريخ" : "Date"} required error={errors.entry_date?.message}>
                <Input id="entry_date" {...register("entry_date")} type="date" className={inputClass} />
              </Field>
              <Field htmlFor="shift_label" label={isAr ? "الوردية" : "Shift"} error={errors.shift_label?.message}>
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
              <Field htmlFor="orders_delivered" label={isAr ? "طلبات مُسلّمة" : "Delivered"}>
                <Input id="orders_delivered" {...register("orders_delivered")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
              <Field htmlFor="orders_failed" label={isAr ? "طلبات فاشلة" : "Failed"}>
                <Input id="orders_failed" {...register("orders_failed")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
              <Field htmlFor="orders_returned" label={isAr ? "طلبات مُرجَعة" : "Returned"}>
                <Input id="orders_returned" {...register("orders_returned")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
              <Field htmlFor="orders_cancelled" label={isAr ? "طلبات ملغاة" : "Cancelled"}>
                <Input id="orders_cancelled" {...register("orders_cancelled")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
            </fieldset>

            <fieldset className="grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-2">
              <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
                {isAr ? "المسافة والإيرادات" : "Distance & revenue"}
              </legend>
              <Field htmlFor="total_distance_km" label={isAr ? "المسافة الإجمالية (كم)" : "Total distance (km)"}>
                <Input id="total_distance_km" {...register("total_distance_km")} inputMode="decimal" className={inputClass} dir="ltr" />
              </Field>
              <Field htmlFor="avg_order_distance_km" label={isAr ? "متوسط مسافة الطلب (كم)" : "Avg order distance (km)"}>
                <Input id="avg_order_distance_km" {...register("avg_order_distance_km")} inputMode="decimal" className={inputClass} dir="ltr" />
              </Field>
              <Field htmlFor="multi_order_batches" label={isAr ? "دفعات متعددة الطلبات" : "Multi-order batches"}>
                <Input id="multi_order_batches" {...register("multi_order_batches")} inputMode="numeric" className={inputClass} dir="ltr" />
              </Field>
              <Field htmlFor="gross_revenue" label={isAr ? "الإيرادات الإجمالية (ر.س)" : "Gross revenue (SAR)"}>
                <Input id="gross_revenue" {...register("gross_revenue")} inputMode="decimal" className={inputClass} dir="ltr" />
              </Field>
              <Field htmlFor="platform_reported_revenue" label={isAr ? "إيرادات المنصة المبلّغة (ر.س)" : "Platform-reported revenue (SAR)"}>
                <Input id="platform_reported_revenue" {...register("platform_reported_revenue")} inputMode="decimal" className={inputClass} dir="ltr" />
              </Field>
            </fieldset>

            <fieldset className="grid gap-2 rounded-2xl border border-border/50 bg-muted/20 p-4">
              <legend className="px-2 text-xs font-bold uppercase tracking-wide text-elite-blue-600 dark:text-elite-blue-300">
                {isAr ? "ملاحظات" : "Notes"}
              </legend>
              <Textarea id="notes" {...register("notes")} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" />
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
