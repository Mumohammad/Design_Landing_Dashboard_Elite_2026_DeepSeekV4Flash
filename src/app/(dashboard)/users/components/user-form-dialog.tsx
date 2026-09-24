"use client"

// Create-user dialog — invite-based, per the existing auth architecture.
// There is no direct user INSERT in this app (058 removed authenticated
// provisioning): the GM issues a hashed-token invite and the invitee accepts
// at /auth/accept-invite. createInvite() is GM-only (`users.manage`).

import { useState, useTransition } from "react"
import { Loader2, Mail } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createInvite } from "@/lib/auth/invites"
import { USER_ROLES, ROLE_META } from "@/lib/users/user-utils"
import { useTranslation } from "@/hooks/use-translation"

export function InviteUserDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: () => void
}) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<string>("readonly_auditor")
  const [submitting, setSubmitting] = useState(false)
  const [isPending, startTransition] = useTransition()

  const busy = submitting || isPending

  function submit() {
    const value = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error(isAr ? "أدخل بريدًا إلكترونيًا صالحًا" : "Enter a valid email address")
      return
    }
    setSubmitting(true)
    startTransition(async () => {
      const result = await createInvite(value, role)
      setSubmitting(false)
      if (result.success) {
        toast.success(
          isAr ? "تم إرسال الدعوة بنجاح" : "Invite sent successfully"
        )
        setEmail("")
        setRole("readonly_auditor")
        onOpenChange(false)
        onInvited()
      } else {
        toast.error(result.error ?? (isAr ? "حدث خطأ" : "Something went wrong"))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isAr ? "دعوة مستخدم جديد" : "Invite a new user"}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "يصل للمدعو رابط قبول صالح لمدة ٧ أيام — يُنشئ حسابه بنفسه عبر رابط الدعوة."
              : "The invitee receives an acceptance link valid for 7 days and sets up their own account."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="invite-email">{isAr ? "البريد الإلكتروني" : "Email"}</Label>
            <Input
              id="invite-email"
              type="email"
              dir="ltr"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-role">{isAr ? "الدور" : "Role"}</Label>
            <Select value={role} onValueChange={setRole} disabled={busy}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {isAr ? ROLE_META[r].ar : ROLE_META[r].en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            onClick={submit}
            disabled={busy}
            className="bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white hover:from-elite-blue-600 hover:to-elite-blue-700"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {isAr ? "إرسال الدعوة" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
