"use client"

// Decision dialog for the approvals inbox — approve / reject with a mandatory
// reason on reject (zod-validated, min 5 chars — the users-module confirm-
// destructive pattern). Reject is destructive-variant; approve keeps default.
// The same zod rules re-run server-side in the decision actions (parity).

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
import { useTranslation } from "@/hooks/use-translation"
import {
  decisionErrorText,
  maskRequesterName,
  subjectLine,
  type ApprovalQueueRow,
} from "@/lib/approvals/approvals-utils"

export type DecisionTarget = {
  row: ApprovalQueueRow
  /** Applicant-name consent (PDPL gate) resolved server-side. */
  consent: boolean
}

export function DecisionDialog({
  target,
  decision,
  onOpenChange,
  onDone,
}: {
  target: DecisionTarget | null
  decision: "approved" | "rejected" | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [lastClosed, setLastClosed] = useState(true)

  // Reset the reason field when the dialog transitions from closed → open
  // (deferred state-sync per the users-module dialog pattern).
  if (lastClosed && target !== null) {
    setLastClosed(false)
    setReason("")
  } else if (!lastClosed && target === null) {
    setLastClosed(true)
  }

  if (!target || !decision) return null

  const { row, consent } = target
  const subject = subjectLine(row, isAr)
  const requester = maskRequesterName(row.item_type, row.requester, row.subject_meta?.full_name ?? null, consent)

  async function submit() {
    if (reason.trim().length < 5) {
      toast.error(isAr ? "السبب مطلوب (٥ أحرف على الأقل)" : "A reason (min 5 characters) is required")
      return
    }
    setSubmitting(true)

    // One server action per decision type; dynamic import keeps the inbox
    // bundle free of the write path until a dialog actually opens.
    const { decideExpense, decideLeaveRequest, decideApplication } = await import(
      "@/lib/approvals/actions"
    )
    const res =
      row.item_type === "expense"
        ? await decideExpense({ expenseId: row.item_id, decision, reason: reason.trim() })
        : row.item_type === "leave_request"
          ? await decideLeaveRequest({ requestId: row.item_id, decision, reason: reason.trim() })
          : await decideApplication({ applicationId: row.item_id, decision, reason: reason.trim() })

    setSubmitting(false)
    if (res.success) {
      toast.success(
        isAr
          ? decision === "approved"
            ? "تمت الموافقة"
            : "تم الرفض"
          : decision === "approved"
            ? "Approved"
            : "Rejected"
      )
      onOpenChange(false)
      onDone()
    } else {
      toast.error(decisionErrorText(res.error ?? "", isAr))
    }
  }

  const typeLabel =
    row.item_type === "expense"
      ? isAr ? "المصروف" : "expense"
      : row.item_type === "leave_request"
        ? isAr ? "طلب الإجازة" : "leave request"
        : isAr ? "طلب التوظيف" : "application"

  return (
    <Dialog open onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {decision === "rejected" && <TriangleAlert className="h-5 w-5 text-destructive" />}
            {isAr
              ? decision === "approved"
                ? `الموافقة على ${typeLabel}`
                : `رفض ${typeLabel}`
              : decision === "approved"
                ? `Approve ${typeLabel}`
                : `Reject ${typeLabel}`}
          </DialogTitle>
          <DialogDescription>
            {isAr
              ? `سيتم تطبيق القرار على «${subject}»${requester !== "—" ? ` من ${requester}` : ""} وتسجيله في سجل التدقيق مع السبب.`
              : `This decision applies to "${subject}"${requester !== "—" ? ` from ${requester}` : ""} and is written to the audit log with the reason.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="decision-reason">
            {isAr
              ? decision === "rejected" ? "سبب الرفض (مطلوب)" : "السبب"
              : decision === "rejected" ? "Rejection reason (required)" : "Reason"}
          </Label>
          <Textarea
            id="decision-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            placeholder={
              isAr
                ? decision === "rejected"
                  ? "اذكر سبب الرفض (مطلوب)"
                  : "اذكر سبب القرار"
                : decision === "rejected"
                  ? "Why is this being rejected? (required)"
                  : "Why is this decision being made?"
            }
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            variant={decision === "rejected" ? "destructive" : "default"}
            onClick={submit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isAr
              ? decision === "approved" ? "تأكيد الموافقة" : "تأكيد الرفض"
              : decision === "approved" ? "Confirm approval" : "Confirm rejection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
