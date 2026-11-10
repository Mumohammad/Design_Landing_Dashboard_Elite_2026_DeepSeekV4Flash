"use client"

import * as React from "react"
import { BellRing, Mail, Send, Save, AlertTriangle, CheckCircle2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/hooks/use-translation"
import { CATEGORY_COPY, NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notifications/feed-utils"
import { DIGEST_ROLE_COPY, DIGEST_ROLES, WEEKDAY_COPY, digestSettingsSchema, type DigestRole, type DigestSettings } from "@/lib/notifications/digest-schema"
import { getDigestSettings, saveDigestSettings, sendTestDigest, type DigestSettingsView } from "@/lib/notifications/settings-actions"
import { cn } from "@/lib/utils"

const CATEGORY_HINT: Record<NotificationCategory, { ar: string; en: string }> = {
  drivers: { ar: "الإقامة، الرخصة، الجواز، العقد، الشهادة الصحية وكل وثائق السائق", en: "Iqama, license, passport, contract, health certificate and all driver documents" },
  vehicles: { ar: "التأمين، الاستمارة، بطاقة التشغيل، الفحص الدوري، عقد الإيجار ووثائق المركبة", en: "Insurance, registration, operating card, inspection, rental contract and vehicle documents" },
  maintenance: { ar: "مواعيد الصيانة المجدولة والمتأخرة", en: "Scheduled and overdue services" },
  finance: { ar: "فواتير العملاء المتأخرة ومستحقات الموردين", en: "Overdue customer invoices and supplier bills due" },
  approvals: { ar: "المصروفات والإجازات وطلبات التوظيف المعلقة", en: "Pending expenses, leave and job applications" },
  violations: { ar: "المخالفات المفتوحة التي تحتاج معالجة", en: "Open violations needing action" },
}

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  skipped: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
}

export default function NotificationSettingsPage() {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const [view, setView] = React.useState<DigestSettingsView | null>(null)
  const [form, setForm] = React.useState<DigestSettings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [emailDraft, setEmailDraft] = React.useState("")
  const [emailError, setEmailError] = React.useState("")

  const load = React.useCallback(async () => {
    try {
      const v = await getDigestSettings()
      setView(v)
      setForm(v?.settings ?? null)
      setLoadError(!v)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingSpinner className="h-6 w-6 text-elite-blue-600" />
      </div>
    )
  }

  if (loadError || !view || !form) {
    return (
      <div className="px-4 py-12 text-center text-sm text-muted-foreground lg:px-6">
        {ar ? "تعذر تحميل إعدادات الإشعارات أو لا تملك صلاحية عرضها." : "Couldn't load notification settings, or you don't have access."}
      </div>
    )
  }

  const disabled = !view.canManage || saving
  const set = <K extends keyof DigestSettings>(key: K, value: DigestSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))
  const toggleIn = <T extends string>(list: T[], value: T, on: boolean): T[] => (on ? [...new Set([...list, value])] : list.filter((x) => x !== value))

  const addEmail = () => {
    const value = emailDraft.trim().toLowerCase()
    if (!value) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError(ar ? "بريد إلكتروني غير صالح" : "Invalid email address")
      return
    }
    if (form.extra_recipients.length >= 20) {
      setEmailError(ar ? "الحد الأقصى 20 بريداً" : "Maximum 20 addresses")
      return
    }
    set("extra_recipients", [...new Set([...form.extra_recipients, value])])
    setEmailDraft("")
    setEmailError("")
  }

  const save = async () => {
    const parsed = digestSettingsSchema.safeParse(form)
    if (!parsed.success) {
      toast.error(ar ? "أضف مستلماً واحداً على الأقل (دور أو بريد) وفئة واحدة على الأقل." : "Add at least one recipient (role or email) and one category.")
      return
    }
    setSaving(true)
    const res = await saveDigestSettings(parsed.data).catch(() => ({ success: false as const, error: "Save failed", errorAr: "تعذر الحفظ" }))
    setSaving(false)
    if (res.success) {
      toast.success(ar ? "تم حفظ إعدادات الإشعارات" : "Notification settings saved")
      void load()
    } else toast.error(ar ? res.errorAr : res.error)
  }

  const test = async () => {
    setTesting(true)
    const res = await sendTestDigest().catch(() => ({ success: false as const, error: "Send failed", errorAr: "تعذر الإرسال" }))
    setTesting(false)
    if (res.success) toast.success(ar ? `أُرسلت رسالة تجربة إلى ${res.message}` : `Test digest sent to ${res.message}`)
    else toast.error(ar ? res.errorAr : res.error)
    void load()
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(ar ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" })

  return (
    <div className="page-enter space-y-6 px-4 py-4 lg:px-6" data-testid="notification-settings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BellRing className="h-6 w-6 text-red-500" />
            {ar ? "الإشعارات والتنبيهات" : "Notifications"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ar
              ? "ملخص بريدي دوري للإدارة يشمل كل الوثائق والمواعيد في اللوحة، إضافة إلى جرس التنبيهات داخل التطبيق."
              : "A periodic email digest for management covering every document and deadline in the dashboard, plus the in-app bell."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={test} disabled={!view.canManage || testing || !view.emailConfigured} className="gap-2">
            {testing ? <LoadingSpinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {ar ? "إرسال تجربة لي" : "Send me a test"}
          </Button>
          <Button type="button" onClick={save} disabled={disabled} className="gap-2" data-testid="notification-settings-save">
            {saving ? <LoadingSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {ar ? "حفظ" : "Save"}
          </Button>
        </div>
      </div>

      {!view.emailConfigured && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {ar
              ? "خدمة البريد غير مفعّلة بعد على الخادم. تُحفظ الإعدادات ويعمل جرس التنبيهات، وتبدأ الرسائل فور تفعيل مزود البريد."
              : "Email delivery isn't configured on the server yet. Settings are saved and the in-app bell works; emails start once the provider is configured."}
          </p>
        </div>
      )}
      {!view.canManage && (
        <p className="text-sm text-muted-foreground">{ar ? "عرض فقط — تعديل الإعدادات يتطلب صلاحية تعديل الإعدادات." : "View only — changing these requires settings update permission."}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ar ? "الجدولة" : "Schedule"}</CardTitle>
            <CardDescription>{ar ? "يُرسل الملخص الساعة 7:00 صباحاً بتوقيت الرياض." : "Sent at 07:00 Riyadh time."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="digest-enabled">{ar ? "تفعيل الملخص البريدي" : "Enable email digest"}</Label>
              <Switch id="digest-enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={disabled} />
            </div>
            <div className="space-y-2">
              <Label>{ar ? "التكرار" : "Frequency"}</Label>
              <div className="flex gap-2" role="radiogroup">
                {(["daily", "weekly"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={form.frequency === f}
                    disabled={disabled}
                    onClick={() => set("frequency", f)}
                    className={cn("rounded-lg border px-4 py-2 text-sm", form.frequency === f ? "border-sky-500 bg-sky-50 font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-200" : "hover:bg-muted")}
                  >
                    {f === "daily" ? (ar ? "يومي" : "Daily") : ar ? "أسبوعي" : "Weekly"}
                  </button>
                ))}
              </div>
            </div>
            {form.frequency === "weekly" && (
              <div className="space-y-2">
                <Label htmlFor="digest-day">{ar ? "يوم الإرسال" : "Send on"}</Label>
                <select
                  id="digest-day"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.weekly_day}
                  disabled={disabled}
                  onChange={(e) => set("weekly_day", Number(e.target.value))}
                >
                  {WEEKDAY_COPY.map((d, i) => (
                    <option key={i} value={i}>{ar ? d.ar : d.en}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="digest-horizon">{ar ? "التنبيه قبل الانتهاء بـ (يوم)" : "Alert this many days before expiry"}</Label>
              <select
                id="digest-horizon"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.horizon_days}
                disabled={disabled}
                onChange={(e) => set("horizon_days", Number(e.target.value))}
              >
                {[7, 14, 30, 45, 60, 90].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="digest-only-alerts" className="leading-snug">
                {ar ? "لا ترسل إذا لم توجد تنبيهات" : "Skip the email when there is nothing to report"}
              </Label>
              <Switch id="digest-only-alerts" checked={form.only_when_alerts} onCheckedChange={(v) => set("only_when_alerts", v)} disabled={disabled} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ar ? "المستلمون" : "Recipients"}</CardTitle>
            <CardDescription>{ar ? "المستخدمون النشطون بهذه الأدوار، إضافة إلى عناوين إضافية." : "Active users with these roles, plus extra addresses."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {DIGEST_ROLES.map((role: DigestRole) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.recipient_roles.includes(role)}
                    disabled={disabled}
                    onCheckedChange={(v) => set("recipient_roles", toggleIn(form.recipient_roles, role, v === true))}
                  />
                  {ar ? DIGEST_ROLE_COPY[role].ar : DIGEST_ROLE_COPY[role].en}
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="digest-email">{ar ? "بريد إضافي (مثل المالك أو المدير المالي)" : "Extra email (e.g. owner or CFO)"}</Label>
              <div className="flex gap-2">
                <Input
                  id="digest-email"
                  type="email"
                  dir="ltr"
                  value={emailDraft}
                  disabled={disabled}
                  placeholder="cfo@company.sa"
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addEmail()
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addEmail} disabled={disabled} className="gap-1">
                  <Mail className="h-4 w-4" />
                  {ar ? "إضافة" : "Add"}
                </Button>
              </div>
              {emailError && <p className="text-xs text-red-600">{emailError}</p>}
              <div className="flex flex-wrap gap-2">
                {form.extra_recipients.map((e) => (
                  <Badge key={e} variant="secondary" className="gap-1 pe-1" dir="ltr">
                    {e}
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={ar ? `إزالة ${e}` : `Remove ${e}`}
                      onClick={() => set("extra_recipients", form.extra_recipients.filter((x) => x !== e))}
                      className="rounded p-0.5 hover:bg-muted"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ar ? "ما يشمله الملخص" : "What the digest covers"}</CardTitle>
          <CardDescription>{ar ? "اختر أقسام اللوحة المضمّنة في الرسالة." : "Choose the dashboard areas included in the email."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NOTIFICATION_CATEGORIES.map((cat) => {
            const on = form.categories.includes(cat)
            return (
              <label key={cat} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", on && "border-sky-400 bg-sky-50/60 dark:bg-sky-950/30")}>
                <Checkbox checked={on} disabled={disabled} onCheckedChange={(v) => set("categories", toggleIn(form.categories, cat, v === true))} />
                <span>
                  <span className="block text-sm font-medium">{ar ? CATEGORY_COPY[cat].ar : CATEGORY_COPY[cat].en}</span>
                  <span className="block text-xs text-muted-foreground">{ar ? CATEGORY_HINT[cat].ar : CATEGORY_HINT[cat].en}</span>
                </span>
              </label>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ar ? "سجل الإرسال" : "Delivery history"}</CardTitle>
          <CardDescription>
            {view.lastSentAt ? (ar ? `آخر إرسال: ${fmt(view.lastSentAt)}` : `Last sent: ${fmt(view.lastSentAt)}`) : ar ? "لم يُرسل أي ملخص بعد." : "No digest sent yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ar ? "لا يوجد سجل بعد." : "No history yet."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-start font-medium">{ar ? "التاريخ" : "Date"}</th>
                    <th className="py-2 text-start font-medium">{ar ? "النوع" : "Type"}</th>
                    <th className="py-2 text-start font-medium">{ar ? "الحالة" : "Status"}</th>
                    <th className="py-2 text-start font-medium">{ar ? "المستلمون" : "Recipients"}</th>
                    <th className="py-2 text-start font-medium">{ar ? "التنبيهات" : "Alerts"}</th>
                    <th className="py-2 text-start font-medium">{ar ? "ملاحظة" : "Note"}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.history.map((h) => (
                    <tr key={h.id} className="border-b last:border-0">
                      <td className="py-2">{fmt(h.created_at)}</td>
                      <td className="py-2">{h.kind === "test" ? (ar ? "تجربة" : "Test") : ar ? "مجدول" : "Scheduled"}</td>
                      <td className="py-2">
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[h.status])}>
                          {h.status === "sent" && <CheckCircle2 className="h-3 w-3" />}
                          {{ sent: ar ? "أُرسل" : "Sent", skipped: ar ? "تُخطي" : "Skipped", failed: ar ? "فشل" : "Failed", pending: ar ? "جارٍ" : "Pending" }[h.status]}
                        </span>
                      </td>
                      <td className="py-2">{h.recipients}</td>
                      <td className="py-2">{h.items}{h.critical > 0 && <span className="text-red-600"> ({h.critical} {ar ? "عاجل" : "critical"})</span>}</td>
                      <td className="max-w-[260px] truncate py-2 text-xs text-muted-foreground" title={h.detail ?? ""}>{h.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
