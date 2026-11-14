"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Loader2, Plus, Save, ShieldCheck, Trash2, Webhook } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { CHECKLIST_NOTICE, categoryLabel, type ChecklistItem, type ClaimSettings } from "@/lib/expense-claims/constants"
import { riyadhTimestamp } from "@/lib/expense-claims/format"
import {
  getClaimSettings, getExpenseAccess, getTelegramStatus, getTelegramWebhookInfo, listTelegramLinks, registerTelegramWebhook, saveClaimSettings, unlinkTelegram,
  type ExpenseAccess, type TelegramStatus,
} from "@/lib/expense-claims/actions"
import { Notice, selectClass, useBi } from "./shared"

export function ClaimSettingsPage() {
  const { L, t } = useBi()
  const [access, setAccess] = useState<ExpenseAccess | null | undefined>(undefined)
  const [s, setS] = useState<ClaimSettings | null>(null)
  const [newCat, setNewCat] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [tg, setTg] = useState<TelegramStatus | null>(null)
  const [hook, setHook] = useState<{ expectedUrl: string | null; registered: boolean; pending: number; lastError: string | null } | null>(null)
  const [links, setLinks] = useState<Array<{ userId: string; name: string; username: string | null; linkedAt: string }>>([])
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)
  const readEpoch = useRef({ value: 0 })

  const load = useCallback(async () => {
    const epoch = ++readEpoch.current.value
    try {
      setLoading(true)
      const permissions = await getExpenseAccess()
      if (epoch !== readEpoch.current.value) return
      setAccess(permissions)
      if (!permissions?.manage) { setLoadError(false); return }
      const [settings, telegram, accounts, webhook] = await Promise.all([getClaimSettings(), getTelegramStatus(), listTelegramLinks(), getTelegramWebhookInfo()])
      if (epoch !== readEpoch.current.value) return
      setS(settings); setTg(telegram); setLinks(accounts); setHook(webhook.ok ? webhook : null); setLoadError(false)
    } catch { if (epoch === readEpoch.current.value) setLoadError(true) }
    finally { if (epoch === readEpoch.current.value) setLoading(false) }
  }, [])
  useEffect(() => { const epoch = readEpoch.current; void Promise.resolve().then(load); return () => { epoch.value++ } }, [load])

  if (loadError) return <div role="alert" className="space-y-3 p-6"><p>{t("Could not load expense settings. Retry before making changes.", "تعذر تحميل إعدادات المصروفات. أعد المحاولة قبل إجراء التغييرات.")}</p><Button variant="outline" onClick={load}>{t("Try again", "أعد المحاولة")}</Button></div>
  if (!loading && !access?.manage) return <div className="p-6"><Notice tone="warn">{t("Only administrators can change expense claim settings.", "يمكن للمسؤولين فقط تغيير إعدادات مطالبات المصروفات.")}</Notice></div>
  if (loading || !access || !s) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…", "جارٍ التحميل…")}</div>

  const upd = (p: Partial<ClaimSettings>) => setS((x) => (x ? { ...x, ...p } : x))
  const updItem = (i: number, p: Partial<ChecklistItem>) => upd({ checklist: s.checklist.map((c, n) => (n === i ? { ...c, ...p } : c)) })

  async function save(extra: { confirm_checklist?: boolean } = {}) {
    setBusy(extra.confirm_checklist ? "confirm" : "save")
    const r = await saveClaimSettings({ ...s!, ...extra, confirmation_note: note })
    setBusy(null)
    if (!r.ok) { toast.error(t(r.error, r.errorAr)); return }
    toast.success(t("Settings saved.", "تم حفظ الإعدادات."))
    setNote(""); load()
  }

  async function webhook() {
    setBusy("hook")
    const r = await registerTelegramWebhook()
    setBusy(null)
    if (!r.ok) toast.error(t(r.error, r.errorAr)); else { toast.success(t("Webhook registered.", "تم تسجيل الـ webhook.")); load() }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm"><Link href="/expenses/claims"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Claims", "المطالبات")}</Link></Button>
        <h1 className="text-xl font-semibold">{t("Expense claim settings", "إعدادات مطالبات المصروفات")}</h1>
      </div>

      <section className="grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold sm:col-span-3">{t("Export & amounts", "التصدير والمبالغ")}</h2>
        <div className="space-y-1.5"><Label className="text-xs">{t("Export labels", "لغة التصدير")}</Label>
          <select className={selectClass} value={s.export_language} onChange={(e) => upd({ export_language: e.target.value as ClaimSettings["export_language"] })}>
            <option value="en">English</option><option value="ar">العربية</option><option value="both">English + العربية</option></select></div>
        <div className="space-y-1.5"><Label className="text-xs">{t("Amount format", "تنسيق المبالغ")}</Label>
          <select className={selectClass} value={s.amount_locale} onChange={(e) => upd({ amount_locale: e.target.value as ClaimSettings["amount_locale"] })}>
            <option value="en-US">1,234.50 (en-US)</option><option value="ar-SA">١٬٢٣٤٫٥٠ (ar-SA)</option></select></div>
        <div className="space-y-1.5"><Label className="text-xs">{t("Default currency", "العملة الافتراضية")}</Label>
          <Input value={s.default_currency} maxLength={3} className="uppercase" onChange={(e) => upd({ default_currency: e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase() })} /></div>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">{t("Approval", "الاعتماد")}</h2>
        <label className="flex items-start justify-between gap-3 text-sm">
          <span>{t("Allow reviewers to approve their own claims", "السماح للمراجعين باعتماد مطالباتهم الخاصة")}<span className="block text-xs text-muted-foreground">{t("Off by default: a different reviewer must approve. Turning this on weakens segregation of duties.", "معطل افتراضياً: يجب أن يعتمد مراجع آخر. تفعيله يُضعف الفصل بين المهام.")}</span></span>
          <Switch checked={s.allow_self_approval} onCheckedChange={(v) => upd({ allow_self_approval: v })} />
        </label>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">{t("Categories", "الفئات")}</h2>
        <div className="flex flex-wrap gap-2">
          {s.categories.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">{L(categoryLabel(c))}
              <button type="button" aria-label={t("Remove", "إزالة")} onClick={() => upd({ categories: s.categories.filter((x) => x !== c) })}><Trash2 className="size-3" /></button></span>
          ))}
        </div>
        <div className="flex gap-2"><Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t("New category key, e.g. training", "مفتاح فئة جديدة، مثل training")} className="max-w-xs" dir="ltr" />
          <Button type="button" variant="outline" size="sm" onClick={() => { const k = newCat.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_"); if (k && !s.categories.includes(k)) upd({ categories: [...s.categories, k] }); setNewCat("") }}><Plus className="size-4" />{t("Add", "إضافة")}</Button></div>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4" />{t("Reviewer checklist (internal review aid)", "قائمة تحقق المراجع (أداة مراجعة داخلية)")}</h2>
        <Notice tone="warn">{L(CHECKLIST_NOTICE)} {t("Receipts are supporting documents only; this checklist does not validate e-invoices or submit anything to ZATCA.", "الإيصالات مستندات داعمة فقط؛ هذه القائمة لا تتحقق من الفواتير الإلكترونية ولا ترسل شيئاً للهيئة.")}</Notice>
        <ul className="space-y-2">
          {s.checklist.map((c, i) => (
            <li key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[auto_1fr_1fr_auto]">
              <Switch checked={c.enabled} onCheckedChange={(v) => updItem(i, { enabled: v })} aria-label={t("Enabled", "مفعل")} />
              <Input value={c.en} onChange={(e) => updItem(i, { en: e.target.value })} placeholder="English" dir="ltr" />
              <Input value={c.ar} onChange={(e) => updItem(i, { ar: e.target.value })} placeholder="العربية" dir="rtl" />
              <Button type="button" variant="ghost" size="icon" aria-label={t("Remove", "إزالة")} onClick={() => upd({ checklist: s.checklist.filter((_, n) => n !== i) })}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={() => upd({ checklist: [...s.checklist, { key: `custom_${Date.now().toString(36)}`, en: "", ar: "", enabled: true }] })}><Plus className="size-4" />{t("Add item", "إضافة بند")}</Button>
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <div>{s.checklist_confirmed_at
            ? t(`Confirmed ${riyadhTimestamp(s.checklist_confirmed_at)}${s.checklist_confirmation_note ? ` — ${s.checklist_confirmation_note}` : ""}. Any change to the checklist clears this confirmation.`, `تم التأكيد في ${riyadhTimestamp(s.checklist_confirmed_at)}${s.checklist_confirmation_note ? ` — ${s.checklist_confirmation_note}` : ""}. أي تعديل على القائمة يلغي هذا التأكيد.`)
            : t("Not confirmed. Before relying on this checklist in production, an administrator or tax professional must review the rules and confirm them here.", "غير مؤكد. قبل الاعتماد على هذه القائمة فعلياً، يجب أن يراجع المسؤول أو مختص ضريبي القواعد ويؤكدها هنا.")}</div>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Confirmation note: who reviewed the rules (name, role / tax adviser) and reference", "ملاحظة التأكيد: من راجع القواعد (الاسم والدور / المستشار الضريبي) والمرجع")} />
          <Button type="button" size="sm" variant="outline" disabled={busy !== null || !note.trim()} onClick={() => save({ confirm_checklist: true })}>{busy === "confirm" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{t("Save & confirm checklist rules", "حفظ وتأكيد قواعد القائمة")}</Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Webhook className="size-4" />{t("Telegram receipt bot", "بوت إيصالات تيليجرام")}</h2>
        <label className="flex items-center justify-between gap-3 text-sm"><span>{t("Accept receipts from linked Telegram accounts", "قبول الإيصالات من حسابات تيليجرام المربوطة")}</span><Switch checked={s.telegram_enabled} onCheckedChange={(v) => upd({ telegram_enabled: v })} /></label>
        <ul className="space-y-1 text-xs">
          <li>{tg?.configured.token ? "✅" : "⛔"} TELEGRAM_BOT_TOKEN {tg?.botUsername ? `(@${tg.botUsername})` : ""}</li>
          <li>{tg?.configured.secret ? "✅" : "⛔"} TELEGRAM_WEBHOOK_SECRET {t("(24+ random characters)", "(24 حرفاً عشوائياً أو أكثر)")}</li>
          <li>{tg?.configured.url ? "✅" : "⛔"} NEXT_PUBLIC_APP_URL (https)</li>
          <li>{hook?.registered ? "✅" : "⛔"} {t("Webhook registered", "تم تسجيل الـ webhook")} {hook?.expectedUrl ? <code dir="ltr">{hook.expectedUrl}</code> : null}{hook?.lastError ? ` — ${t("last error", "آخر خطأ")}: ${hook.lastError}` : ""}</li>
        </ul>
        <p className="text-xs text-muted-foreground">{t("Tokens are server environment variables only — never stored in the database or shown here. Create the bot with @BotFather, set the variables in Vercel, redeploy, then register the webhook.", "الرموز متغيرات بيئة على الخادم فقط — لا تُخزن في قاعدة البيانات ولا تُعرض هنا. أنشئ البوت عبر @BotFather، واضبط المتغيرات في Vercel، وأعد النشر، ثم سجّل الـ webhook.")}</p>
        <Button type="button" variant="outline" size="sm" disabled={busy !== null || !tg?.configured.token || !tg.configured.secret || !tg.configured.url} onClick={webhook}>{busy === "hook" ? <Loader2 className="size-4 animate-spin" /> : <Webhook className="size-4" />}{t("Register webhook", "تسجيل الـ webhook")}</Button>
        {links.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium">{t("Linked users", "المستخدمون المربوطون")}</div>
            <ul className="divide-y rounded-lg border text-xs">{links.map((l) => (
              <li key={l.userId} className="flex items-center gap-2 p-2"><span className="flex-1">{l.name} {l.username ? `· @${l.username}` : ""} · {riyadhTimestamp(l.linkedAt)}</span>
                <Button size="sm" variant="ghost" onClick={async () => { const r = await unlinkTelegram(l.userId); if (!r.ok) toast.error(t(r.error, r.errorAr)); else load() }}>{t("Unlink", "إلغاء الربط")}</Button></li>
            ))}</ul>
          </div>
        )}
      </section>

      <div className="flex gap-2"><Button disabled={busy !== null} onClick={() => save()}>{busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{t("Save settings", "حفظ الإعدادات")}</Button></div>
    </div>
  )
}
