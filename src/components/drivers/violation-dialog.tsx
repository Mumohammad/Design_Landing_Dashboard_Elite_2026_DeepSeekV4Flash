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
import { Textarea } from "@/components/ui/textarea"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"

type ViolationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  driverId: string
  onCreated: () => void
}

const INITIAL_FORM = {
  violation_type: "",
  violation_date: "",
  location: "",
  fine_amount: "",
  points: "",
  description: "",
  notes: "",
}

export function ViolationDialog({ open, onOpenChange, driverId, onCreated }: ViolationDialogProps) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const [form, setForm] = useState(INITIAL_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ ...INITIAL_FORM, violation_date: new Date().toISOString().slice(0, 10) })
    }
  }, [open])

  const set = (key: keyof typeof INITIAL_FORM) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async () => {
    if (!form.violation_type.trim() || !form.violation_date) {
      toast.error(isAr ? "أدخل نوع المخالفة وتاريخها" : "Violation type and date are required")
      return
    }
    setIsSubmitting(true)
    const supabase = createClient()
    const { error } = await supabase.from("driver_violations").insert({
      driver_id: driverId,
      violation_type: form.violation_type.trim(),
      violation_date: form.violation_date,
      location: form.location.trim() || null,
      fine_amount: form.fine_amount ? Number(form.fine_amount) : null,
      points: form.points ? Number(form.points) : null,
      description: form.description.trim() || null,
      notes: form.notes.trim() || null,
      status: "pending",
    })
    setIsSubmitting(false)
    if (error) {
      console.error("Failed to create violation:", error)
      toast.error(isAr ? "فشل حفظ المخالفة" : "Failed to save violation")
      return
    }
    toast.success(isAr ? "تمت إضافة المخالفة" : "Violation added")
    onOpenChange(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isAr ? "إضافة مخالفة" : "Add violation"}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "سجّل مخالفة مرورية أو تشغيلية على ملف السائق"
              : "Record a traffic or operational violation on this driver's file"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="violation_type">{isAr ? "النوع" : "Type"} *</Label>
            <Input
              id="violation_type"
              value={form.violation_type}
              onChange={(e) => set("violation_type")(e.target.value)}
              placeholder={isAr ? "تجاوز سرعة…" : "Speeding…"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="violation_date">{isAr ? "التاريخ" : "Date"} *</Label>
            <Input
              id="violation_date"
              type="date"
              dir="ltr"
              value={form.violation_date}
              onChange={(e) => set("violation_date")(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="violation_location">{isAr ? "الموقع" : "Location"}</Label>
            <Input
              id="violation_location"
              value={form.location}
              onChange={(e) => set("location")(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fine_amount">{isAr ? "الغرامة (ر.س)" : "Fine (SAR)"}</Label>
              <Input
                id="fine_amount"
                type="number"
                min="0"
                dir="ltr"
                value={form.fine_amount}
                onChange={(e) => set("fine_amount")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="points">{isAr ? "النقاط" : "Points"}</Label>
              <Input
                id="points"
                type="number"
                min="0"
                dir="ltr"
                value={form.points}
                onChange={(e) => set("points")(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="violation_description">{isAr ? "الوصف" : "Description"}</Label>
            <Textarea
              id="violation_description"
              rows={2}
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="violation_notes">{isAr ? "ملاحظات" : "Notes"}</Label>
            <Textarea
              id="violation_notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes")(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
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
