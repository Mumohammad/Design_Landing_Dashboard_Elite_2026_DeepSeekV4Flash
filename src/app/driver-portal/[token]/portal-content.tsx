"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Logo } from "@/components/logo"
import { useTranslation } from "@/hooks/use-translation"
import type { PortalView } from "@/lib/driver-portal/server"
import { docTypeLabel, docTypeMeta, DOC_UPLOAD_TYPES } from "@/lib/drivers/documents"
import { platformLabel } from "@/lib/drivers/platforms"
import { PortalUploadForm } from "./portal-upload-form"

const panel = "rounded-lg border bg-card p-4 sm:p-5"
const control = "inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"

export type PortalDisplayView = Omit<PortalView, "link" | "driver" | "documents"> & {
  link: Pick<PortalView["link"], "expires_at">
  driver: Pick<PortalView["driver"], "full_name_ar" | "full_name_en" | "driver_code" | "iqama_last4" | "photo_url">
  documents: Omit<PortalView["documents"][number], "doc_number">[]
}

export function daysUntilExpiry(date: string | null, now: number): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const expiry = Date.parse(date + "T00:00:00+03:00")
  return Number.isFinite(expiry) ? Math.ceil((expiry - now) / 86400000) : null
}

function ExpiryBadge({ date, now, isAr }: { date: string | null; now: number; isAr: boolean }) {
  const days = daysUntilExpiry(date, now)
  if (days === null) return <span className="text-xs text-muted-foreground">{isAr ? "الصلاحية غير مسجلة" : "Expiry not recorded"}</span>
  const cls = days < 0 ? "text-red-700 dark:text-red-400" : days <= 30 ? "text-amber-800 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
  const label = days < 0 ? (isAr ? "منتهي" : "Expired") : days <= 30 ? (isAr ? `متبقي ${days} يوم` : `${days} days left`) : (isAr ? "ساري" : "Valid")
  return <span className={`shrink-0 text-xs font-medium ${cls}`}>{label}</span>
}

export function PortalContent({ token, view, loadFailed = false, now }: {
  token: string; view: PortalDisplayView | null; loadFailed?: boolean; now: number
}) {
  const { locale, setLocale } = useTranslation()
  const isAr = locale === "ar"
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const text = (en: string, ar: string) => isAr ? ar : en
  const refresh = () => startRefresh(() => router.refresh())
  const companyName = view && (isAr ? view.company.name_ar || view.company.name_en : view.company.name_en || view.company.name_ar)
  const docs = view?.documents.filter((doc) => doc.doc_type !== "photo") ?? []
  const urgent = docs.filter((doc) => docTypeMeta(doc.doc_type)?.expires !== false && (daysUntilExpiry(doc.expiry_date, now) ?? Infinity) <= 30)
  const uploadTypes = Array.from(new Set([...urgent.map((doc) => doc.doc_type).filter((type) => (DOC_UPLOAD_TYPES as readonly string[]).includes(type)), "iqama", "driving_license", "passport", "health_certificate", "medical_insurance", "work_permit", "home_delivery_permit", "other"]))
  const statuses: Record<string, string> = { pending: text("Under review", "قيد المراجعة"), accepted: text("Accepted", "مقبول"), rejected: text("Rejected", "مرفوض") }
  const statusLabel = (status: string) => statuses[status] ?? text("Status unavailable", "الحالة غير متاحة")

  return <div lang={locale} dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-muted/20 text-foreground">
    <header className="border-b bg-background">
      <div className="mx-auto flex min-h-16 max-w-2xl items-center justify-between gap-4 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3"><Logo size={36} /><div className="min-w-0">
          <p className="break-words text-sm font-semibold">{companyName || text("Elite Development", "نخبة التطوير")}</p>
          <p className="text-xs text-muted-foreground">{text("Driver portal", "بوابة السائق")}</p>
        </div></div>
        <button type="button" className={`${control} shrink-0`} lang={isAr ? "en" : "ar"} aria-label={text("Switch to Arabic", "التبديل إلى الإنجليزية")} onClick={() => setLocale(isAr ? "en" : "ar")}>{isAr ? "English" : "العربية"}</button>
      </div>
    </header>
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      {!view ? <section className={panel} aria-labelledby="portal-unavailable-title">
        <h1 id="portal-unavailable-title" className="text-2xl font-semibold">{loadFailed ? text("Portal unavailable", "البوابة غير متاحة") : text("Link expired or invalid", "الرابط منتهي أو غير صالح")}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground" role={loadFailed ? "alert" : undefined}>{loadFailed ? text("We could not load your details. Check your connection and try again.", "تعذر تحميل بياناتك. تحقق من الاتصال وحاول مجددًا.") : text("Ask your supervisor to send you a new portal link.", "اطلب من المشرف إرسال رابط جديد للبوابة.")}</p>
        {loadFailed && <button type="button" className={`${control} mt-4`} onClick={refresh} disabled={refreshing}>{refreshing ? text("Retrying…", "جارٍ إعادة المحاولة…") : text("Try again", "حاول مجددًا")}</button>}
      </section> : <>
        <section className="flex items-start gap-4 py-1" aria-labelledby="driver-name">
          {view.driver.photo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={view.driver.photo_url} alt="" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
            : <div aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted text-2xl font-medium">{(isAr ? view.driver.full_name_ar : view.driver.full_name_en || view.driver.full_name_ar).slice(0, 1)}</div>}
          <div className="min-w-0">
            <h1 id="driver-name" dir="auto" className="break-words text-2xl font-semibold">{isAr ? view.driver.full_name_ar : view.driver.full_name_en || view.driver.full_name_ar}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{text("Driver code", "رمز السائق")}: <bdi>{view.driver.driver_code ?? "—"}</bdi></p>
            {view.driver.iqama_last4 && <p className="mt-1 text-xs text-muted-foreground">{text("Iqama", "الإقامة")}: <bdi>•••• {view.driver.iqama_last4}</bdi></p>}
          </div>
        </section>
        {urgent.length > 0 && <section className="rounded-lg border p-4" aria-labelledby="portal-action-title">
          <h2 id="portal-action-title" className="text-sm font-semibold text-amber-800 dark:text-amber-400">{text("Documents need attention", "مستندات تحتاج إلى متابعة")}</h2>
          <p className="mt-2 text-sm leading-6">{urgent.map((doc) => docTypeLabel(doc.doc_type, isAr)).join(isAr ? "، " : ", ")}</p>
          <a href="#portal-upload" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{text("Upload a renewed copy", "رفع نسخة مجددة")}</a>
        </section>}
        <section className={panel} aria-labelledby="portal-platforms-title">
          <h2 id="portal-platforms-title" className="text-base font-semibold">{text("Platform IDs", "معرّفات المنصات")}</h2>
          {view.platforms.length ? <ul className="mt-3 divide-y">{view.platforms.map((platform) => <li key={platform.platform_code + platform.platform_driver_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{platformLabel(platform.platform_code, isAr)}</span><bdi className="break-all font-mono tabular-nums">{platform.platform_driver_id}</bdi></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{text("No active platform accounts.", "لا توجد حسابات منصات نشطة.")}</p>}
          {view.cards.length > 0 && <p className="mt-3 break-words text-xs leading-6 text-muted-foreground">{text("Company card", "بطاقة الشركة")}: <bdi>{view.cards[0].card_serial}</bdi>{view.cards[0].expires_at && <> · {text("Valid until", "صالحة حتى")} <bdi>{view.cards[0].expires_at.slice(0, 10)}</bdi></>}</p>}
        </section>
        {view.vehicle && <section className={panel} aria-labelledby="portal-vehicle-title"><h2 id="portal-vehicle-title" className="text-base font-semibold">{text("Assigned vehicle", "المركبة المسندة")}</h2><p className="mt-3 break-words text-sm">{[view.vehicle.make, view.vehicle.model].filter(Boolean).join(" ") || "—"} · <bdi>{view.vehicle.plate_number || "—"}</bdi></p></section>}
        <section className={panel} aria-labelledby="portal-documents-title">
          <h2 id="portal-documents-title" className="text-base font-semibold">{text("My documents", "مستنداتي")}</h2>
          {docs.length ? <ul className="mt-3 divide-y">{docs.map((doc) => <li key={doc.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 space-y-1"><p className="break-words text-sm font-medium">{docTypeLabel(doc.doc_type, isAr)}</p>{docTypeMeta(doc.doc_type)?.expires !== false && <p className="text-xs text-muted-foreground">{text("Expiry date", "تاريخ الانتهاء")}: <bdi>{doc.expiry_date ?? "—"}</bdi></p>}{doc.is_verified && <p className="text-xs text-muted-foreground">{text("Verified", "تم التحقق")}</p>}</div>
            {docTypeMeta(doc.doc_type)?.expires !== false && <ExpiryBadge date={doc.expiry_date} now={now} isAr={isAr} />}
          </li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{text("No documents on file yet.", "لا توجد مستندات محفوظة بعد.")}</p>}
        </section>
        <PortalUploadForm token={token} docTypes={uploadTypes} />
        <section id="portal-uploads" className={panel} aria-labelledby="portal-uploads-title">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="portal-uploads-title" className="text-base font-semibold">{text("My uploads", "مستنداتي المرسلة")}</h2><button type="button" className={control} onClick={refresh} disabled={refreshing}>{refreshing ? text("Refreshing…", "جارٍ التحديث…") : text("Refresh status", "تحديث الحالة")}</button></div>
          {view.submissions.length ? <ul className="mt-3 divide-y">{view.submissions.map((submission) => <li key={submission.id} className="space-y-2 py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2"><p>{docTypeLabel(submission.doc_type, isAr)} <bdi className="ms-1 text-xs text-muted-foreground">{submission.created_at.slice(0, 10)}</bdi></p><span className={`shrink-0 text-xs font-medium ${submission.status === "accepted" ? "text-emerald-700 dark:text-emerald-400" : submission.status === "rejected" ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>{statusLabel(submission.status)}</span></div>
            {submission.review_note && <p dir="auto" className="break-words text-sm leading-6 text-muted-foreground">{submission.review_note}</p>}
          </li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{text("No documents sent for review yet.", "لم ترسل مستندات للمراجعة بعد.")}</p>}
        </section>
        <p className="pb-4 text-xs leading-6 text-muted-foreground">{text("Link valid until", "الرابط صالح حتى")} <bdi>{view.link.expires_at.slice(0, 10)}</bdi>. {text("Keep this link private.", "احتفظ بخصوصية هذا الرابط.")}</p>
      </>}
    </main>
  </div>
}
