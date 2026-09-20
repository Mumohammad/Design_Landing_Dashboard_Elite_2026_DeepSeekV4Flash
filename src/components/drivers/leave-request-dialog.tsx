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
import { emitDriverChanged } from "@/lib/driver-events"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

type LeaveRequestDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  driverId: string
  isAr: boolean
  onCreated: () => void
}

type LeaveType = {
  id: string
  code: string | null
  name_ar: string | null
  name_en: string | null
  days_per_year: number | null
}

const INITIAL_FORM = {
  leaveTypeId: "",
  startDate: "",
  endDate: "",
  reason: "",
}

function daysInclusive(start: string, end: string): number | null {
  if (!start || !end) return null
  const s = new Date(start)
  const e = new Date(end)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null
  const diff = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1
  return diff > 0 ? diff : null
}

export function LeaveRequestDialog({
  open,
  onOpenChange,
  driverId,
  isAr,
  onCreated,
}: LeaveRequestDialogProps) {
  const [form, setForm] = useState(INITIAL_FORM)
  const [types, setTypes] = useState<LeaveType[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Load leave types when the dialog opens (async fetch → setState in callback is fine).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("leave_types")
        .select("id, code, name_ar, name_en, days_per_year")
        .is("deleted_at", null)
        .order("name_en", { ascending: true })
      if (!cancelled && !error) setTypes((data ?? []) as unknown as LeaveType[])
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset in the event handler (not an effect) so the next open starts fresh.
  const handleOpenChange = (next: boolean) => {
    if (!next) setForm(INITIAL_FORM)
    onOpenChange(next)
  }

  const days = daysInclusive(form.startDate, form.endDate)

  const submit = async () => {
    if (!form.leaveTypeId) {
      toast.error(isAr ? "اختر نوع الإجازة" : "Select a leave type")
      return
    }
    if (!form.startDate || !form.endDate || days === null) {
      toast.error(
        isAr ? "تحقق من تاريخي البداية والنهاية" : "Check the start and end dates",
      )
      return
    }
    setSubmitting(true)
    try {
      const supabase = createClient()

      const { data: driverRow } = await supabase
        .from("drivers")
        .select("tenant_id")
        .eq("id", driverId)
        .maybeSingle()
      const tenantId = (driverRow?.tenant_id as string | undefined) ?? null

      const {
        data: { user },
      } = await supabase.auth.getUser()
      let requestedBy: string | null = null
      if (user) {
        const { data: me } = await supabase
          .from("users")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle()
        requestedBy = (me?.id as string | undefined) ?? null
      }

      const { error } = await supabase.from("driver_leave_requests").insert({
        tenant_id: tenantId,
        driver_id: driverId,
        leave_type_id: form.leaveTypeId,
        start_date: form.startDate,
        end_date: form.endDate,
        days_requested: days,
        reason: form.reason.trim() || null,
        status: "pending",
        requested_by: requestedBy,
      })
      if (error) {
        console.error("Failed to create leave request:", error)
        toast.error(isAr ? "فشل إرسال الطلب" : "Failed to submit the request")
        return
      }
      toast.success(isAr ? "تم إرسال طلب الإجازة" : "Leave request submitted")
      emitDriverChanged(driverId)
      onCreated()
      handleOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "فشل الإرسال" : "Submit failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isAr ? "طلب إجازة جديد" : "New leave request"}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "سيُرسَل الطلب بحالة قيد الانتظار حتى المراجعة"
              : "The request is submitted as pending until reviewed"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{isAr ? "نوع الإجازة" : "Leave type"} *</Label>
            <Select
              value={form.leaveTypeId}
              onValueChange={(v) => setForm((p) => ({ ...p, leaveTypeId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder={isAr ? "اختر النوع…" : "Select type…"} />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {isAr ? (t.name_ar ?? t.name_en ?? t.code) : (t.name_en ?? t.name_ar ?? t.code)}
                    {t.days_per_year != null ? ` (${t.days_per_year})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="leave-start">{isAr ? "من" : "From"} *</Label>
            <Input
              id="leave-start"
              type="date"
              dir="ltr"
              value={form.startDate}
              onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="leave-end">{isAr ? "إلى" : "To"} *</Label>
            <Input
              id="leave-end"
              type="date"
              dir="ltr"
              value={form.endDate}
              onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2 rounded-xl bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {isAr ? "عدد الأيام: " : "Days: "}
            <span className="font-semibold tabular-nums text-foreground" dir="ltr">
              {days ?? "—"}
            </span>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="leave-reason">{isAr ? "السبب" : "Reason"}</Label>
            <Textarea
              id="leave-reason"
              rows={3}
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={() => void submit()} disabled={submitting} className="gap-1.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isAr ? "إرسال الطلب" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
