"use client"

// Confirm-destructive dialog for the Users module status lifecycle
// (suspend/lock/terminate) — CRUD principles: destructive actions require an
// explicit reason (min 5 chars, echoed into audit_log).

import { useState } from "react"
import { Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { updateUserStatus } from "@/lib/users/actions"
import { STATUS_META, type UserStatus } from "@/lib/users/user-utils"
import { useTranslation } from "@/hooks/use-translation"

export function UserStatusDialog({
  userId,
  userName,
  target,
  open,
  onOpenChange,
  onDone,
}: {
  userId: string | null
  userName: string
  target: UserStatus | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [lastClosed, setLastClosed] = useState(true)

  // Reset the reason field when the dialog transitions from closed → open
  // (deferred via requestAnimationFrame to avoid setState-in-effect).
  if (lastClosed && open) {
    setLastClosed(false)
    setReason("")
  } else if (!lastClosed && !open) {
    setLastClosed(true)
  }

  const destructive = target === "locked" || target === "terminated" || target === "inactive"

  async function submit() {
    if (!userId || !target) return
    if (reason.trim().length < 5) {
      toast.error(
        isAr ? "السبب مطلوب (٥ أحرف على الأقل)" : "A reason (min 5 characters) is required"
      )
      return
    }
    setSubmitting(true)
    const result = await updateUserStatus({ userId, status: target, reason: reason.trim() })
    setSubmitting(false)
    if (result.success) {
      toast.success(isAr ? "تم تحديث حالة المستخدم" : "User status updated")
      onOpenChange(false)
      onDone()
    } else {
      toast.error(result.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
    }
  }

  const targetLabel =
    target && (isAr ? STATUS_META[target].ar : STATUS_META[target].en)

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive && <TriangleAlert className="h-5 w-5 text-destructive" />}
            {isAr ? `تغيير الحالة إلى: ${targetLabel}` : `Change status to: ${targetLabel}`}
          </DialogTitle>
          <DialogDescription>
            {isAr
              ? `سيتم تطبيق هذا التغيير على حساب ${userName} وتسجيله في سجل التدقيق مع السبب.`
              : `This change applies to ${userName}'s account and is written to the audit log with the reason.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="status-reason">{isAr ? "السبب" : "Reason"}</Label>
          <Textarea
            id="status-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            placeholder={
              isAr ? "اذكر سبب تغيير الحالة (مطلوب)" : "Why is this status change needed? (required)"
            }
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={submit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isAr ? "تأكيد التغيير" : "Confirm change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
