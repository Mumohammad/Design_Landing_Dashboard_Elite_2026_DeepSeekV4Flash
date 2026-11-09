"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { MessageSquarePlus, Bug, Lightbulb, HelpCircle, Heart } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useTranslation } from "@/hooks/use-translation"
import { submitFeedback, type FeedbackInput } from "@/lib/feedback/actions"
import { cn } from "@/lib/utils"

const KINDS: { key: FeedbackInput["kind"]; ar: string; en: string; icon: typeof Bug }[] = [
  { key: "bug", ar: "مشكلة", en: "Bug", icon: Bug },
  { key: "idea", ar: "اقتراح", en: "Idea", icon: Lightbulb },
  { key: "question", ar: "سؤال", en: "Question", icon: HelpCircle },
  { key: "praise", ar: "إشادة", en: "Praise", icon: Heart },
]

export function FeedbackButton() {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<FeedbackInput["kind"]>("idea")
  const [message, setMessage] = React.useState("")
  const [sending, setSending] = React.useState(false)

  const send = async () => {
    if (message.trim().length < 5) {
      toast.error(ar ? "اكتب 5 أحرف على الأقل." : "Write at least 5 characters.")
      return
    }
    setSending(true)
    const res = await submitFeedback({ kind, message, pagePath: pathname }).catch(() => ({ success: false as const, error: "Couldn't send feedback.", errorAr: "تعذر الإرسال." }))
    setSending(false)
    if (res.success) {
      toast.success(ar ? "شكراً! وصلتنا ملاحظتك." : "Thanks! We received your feedback.")
      setMessage("")
      setOpen(false)
    } else toast.error(ar ? res.errorAr : res.error)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        className="hidden h-10 w-10 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:inline-flex"
        aria-label={ar ? "أرسل ملاحظات" : "Send feedback"}
        data-testid="feedback-trigger"
      >
        <MessageSquarePlus className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir={ar ? "rtl" : "ltr"} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ar ? "أرسل ملاحظاتك" : "Send feedback"}</DialogTitle>
            <DialogDescription>
              {ar ? "أبلغ عن مشكلة أو اقترح ميزة — تصل مباشرة لفريق الدعم." : "Report a problem or suggest a feature — it goes straight to support."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2" role="radiogroup">
            {KINDS.map((k) => {
              const Icon = k.icon
              return (
                <button
                  key={k.key}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.key}
                  onClick={() => setKind(k.key)}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border p-2 text-xs", kind === k.key ? "border-sky-500 bg-sky-50 font-semibold dark:bg-sky-950" : "hover:bg-muted")}
                >
                  <Icon className="h-4 w-4" />
                  {ar ? k.ar : k.en}
                </button>
              )
            })}
          </div>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 4000))}
            rows={5}
            placeholder={ar ? "صف ما حدث أو ما تقترحه…" : "Describe what happened or what you'd like…"}
            aria-label={ar ? "الرسالة" : "Message"}
          />
          <p className="text-xs text-muted-foreground">
            {ar ? "تُرفق الصفحة الحالية تلقائياً لمساعدتنا." : "The current page is attached automatically."} <span dir="ltr">{pathname}</span>
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{ar ? "إلغاء" : "Cancel"}</Button>
            <Button type="button" onClick={send} disabled={sending}>{sending ? (ar ? "جارٍ الإرسال…" : "Sending…") : ar ? "إرسال" : "Send"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
