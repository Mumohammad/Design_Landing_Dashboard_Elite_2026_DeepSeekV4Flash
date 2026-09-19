"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"

type ViolationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  driverId: string
  onCreated: () => void
}

type ViolationType = {
  id: string
  code: string | null
  name_ar: string | null
  name_en: string | null
  default_deduction: number | null
}

const INITIAL_FORM = {
  violation_type_id: "",
  incident_date: "",
  incident_location: "",
  deduction_amount: "",
  incident_description: "",
}

const todayISO = () => new Date().toISOString().slice(0, 10)

const freshForm = () => ({ ...INITIAL_FORM, incident_date: todayISO() })

export function ViolationDialog({ open, onOpenChange, driverId, onCreated }: ViolationDialogProps) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const [form, setForm] = useState(freshForm)
  const [types, setTypes] = useState<ViolationType[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Load active violation types whenever the dialog opens (async fetch → setState in callback is fine).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("violation_types")
        .select("id, code, name_ar, name_en, default_deduction")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("code", { ascending: true })
      if (!cancelled && !error) setTypes((data ?? []) as unknown as ViolationType[])
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset the form in the event handler (not an effect) so the next open starts fresh.
  const handleOpenChange = (next: boolean) => {
    if (!next) setForm(freshForm())
    onOpenChange(next)
  }

  const onTypeChange = (id: string) => {
    const t = types.find((x) => x.id === id)
    setForm((prev) => ({
      ...prev,
      violation_type_id: id,
      deduction_amount:
        prev.deduction_amount || (t?.default_deduction != null ? String(t.default_deduction) : ""),
    }))
  }

  const submit = async () => {
    if (!form.violation_type_id || !form.incident_date) {
      toast.error(isAr ? "اختر نوع المخالفة وتاريخها" : "Violation type and date are required")
      return
    }
    setIsSubmitting(true)
    const supabase = createClient()
    const { error } = await supabase.from("violations").insert({
      driver_id: driverId,
      violation_type_id: form.violation_type_id,
      incident_date: form.incident_date,
      incident_location: form.incident_location.trim() || null,
      incident_description: form.incident_description.trim() || null,
      deduction_amount: form.deduction_amount ? Number(form.deduction_amount) : null,
      source: "manual",
      status: "pending",
    })
    setIsSubmitting(false)
    if (error) {
      console.error("Failed to create violation:", error)
      toast.error(isAr ? "فشل حفظ المخالفة" : "Failed to save violation")
      return
    }
    toast.success(isAr ? "تمت إضافة المخالفة" : "Violation added")
    handleOpenChange(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isAr ? "إضافة مخالفة" : "Add violation"}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "سجّل مخالفة على ملف السائق — ستبقى قيد الانتظار حتى المراجعة"
              : "Record a violation on this driver's file — it stays pending until reviewed"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{isAr ? "نوع المخالفة" : "Violation type"} *</Label>
            <Select value={form.violation_type_id} onValueChange={onTypeChange}>
              <SelectTrigger>
                <SelectValue placeholder={isAr ? "اختر النوع…" : "Select type…"} />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {isAr ? (t.name_ar ?? t.name_en ?? t.code) : (t.name_en ?? t.name_ar ?? t.code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="incident_date">{isAr ? "التاريخ" : "Date"} *</Label>
            <Input
              id="incident_date"
              type="date"
              dir="ltr"
              value={form.incident_date}
              onChange={(e) => setForm((p) => ({ ...p, incident_date: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deduction_amount">{isAr ? "الخصم (ر.س)" : "Deduction (SAR)"}</Label>
            <Input
              id="deduction_amount"
              type="number"
              min="0"
              dir="ltr"
              value={form.deduction_amount}
              onChange={(e) => setForm((p) => ({ ...p, deduction_amount: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="incident_location">{isAr ? "الموقع" : "Location"}</Label>
            <Input
              id="incident_location"
              value={form.incident_location}
              onChange={(e) => setForm((p) => ({ ...p, incident_location: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="incident_description">{isAr ? "الوصف" : "Description"}</Label>
            <Textarea
              id="incident_description"
              rows={3}
              value={form.incident_description}
              onChange={(e) => setForm((p) => ({ ...p, incident_description: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? (isAr ? "جارٍ الحفظ…" : "Saving…") : isAr ? "حفظ" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
