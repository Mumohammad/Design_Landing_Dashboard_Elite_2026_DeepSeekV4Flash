"use client"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Send, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { createTelegramLinkCode, getTelegramStatus, unlinkTelegram, type TelegramStatus } from "@/lib/expense-claims/actions"
import { Notice, useBi } from "./shared"

export function TelegramLinkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useBi()
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [code, setCode] = useState<{ code: string; expiresAt: string; deepLink: string | null; botUsername: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    void getTelegramStatus().then((v) => { if (alive) setStatus(v) })
    return () => { alive = false }
  }, [open])

  async function generate() {
    setBusy(true)
    const r = await createTelegramLinkCode()
    setBusy(false)
    if (!r.ok) { toast.error(t(r.error, r.errorAr)); return }
    setCode(r)
  }
  async function unlink() {
    setBusy(true)
    const r = await unlinkTelegram()
    setBusy(false)
    if (!r.ok) { toast.error(t(r.error, r.errorAr)); return }
    toast.success(t("Telegram unlinked.", "تم إلغاء ربط تيليجرام."))
    void getTelegramStatus().then(setStatus)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setCode(null); onOpenChange(v) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Send receipts from Telegram", "إرسال الإيصالات من تيليجرام")}</DialogTitle>
          <DialogDescription>{t("Link your Telegram account once with a one-time code. Receipts you send to the bot become pending claims for review.", "اربط حساب تيليجرام مرة واحدة برمز لمرة واحدة. الإيصالات التي ترسلها للبوت تصبح مطالبات بانتظار المراجعة.")}</DialogDescription>
        </DialogHeader>
        {!status ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…", "جارٍ التحميل…")}</div>
          : !status.configured.token ? <Notice tone="warn">{t("The Telegram bot is not configured on the server yet. Ask an administrator to set it up.", "لم يتم إعداد بوت تيليجرام على الخادم بعد. اطلب من المسؤول إعداده.")}</Notice>
          : !status.enabled ? <Notice tone="warn">{t("Telegram receipts are turned off for your company. An administrator can enable them in Expense claim settings.", "إرسال الإيصالات عبر تيليجرام معطل لشركتك. يمكن للمسؤول تفعيله من إعدادات مطالبات المصروفات.")}</Notice>
          : status.myLink ? (
            <div className="space-y-3 text-sm">
              <p>{t("Linked to Telegram", "مربوط بتيليجرام")} {status.myLink.username ? `@${status.myLink.username}` : ""}. {status.botUsername && <a className="underline" href={`https://t.me/${status.botUsername}`} target="_blank" rel="noreferrer">@{status.botUsername}</a>}</p>
              <Button variant="outline" size="sm" disabled={busy} onClick={unlink}><Unlink className="size-4" />{t("Unlink", "إلغاء الربط")}</Button>
            </div>
          ) : code ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-muted/40 p-3 text-center font-mono text-2xl tracking-[0.3em]" dir="ltr">{code.code}</div>
              <p className="text-xs text-muted-foreground">{t("Valid for 10 minutes, single use. Never share it.", "صالح لمدة 10 دقائق ولمرة واحدة. لا تشاركه مع أحد.")}</p>
              {code.deepLink ? <Button asChild className="w-full"><a href={code.deepLink} target="_blank" rel="noreferrer"><Send className="size-4" />{t("Open the bot in Telegram", "فتح البوت في تيليجرام")}</a></Button> : null}
              <p className="text-xs">{t("Or send this code to the bot as a message:", "أو أرسل هذا الرمز إلى البوت كرسالة:")} <code dir="ltr">{code.code}</code>{code.botUsername ? ` → @${code.botUsername}` : ""}</p>
            </div>
          ) : (
            <Button disabled={busy} onClick={generate}>{busy && <Loader2 className="size-4 animate-spin" />}{t("Generate one-time code", "إنشاء رمز لمرة واحدة")}</Button>
          )}
        <Notice>{t("Only linked company users can submit. Files from unknown Telegram accounts are rejected and not stored.", "يمكن للمستخدمين المربوطين فقط التقديم. تُرفض الملفات من حسابات تيليجرام غير المعروفة ولا تُحفظ.")}</Notice>
      </DialogContent>
    </Dialog>
  )
}
