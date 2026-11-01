import type { Metadata } from "next"
import { BadgeCheck, CalendarClock, Car, FileText, IdCard, ShieldAlert, Smartphone } from "lucide-react"
import { LogoMark } from "@/components/logo"
import { loadPortalView } from "@/lib/driver-portal/server"
import { docTypeLabel, docTypeMeta } from "@/lib/drivers/documents"
import { platformLabel } from "@/lib/drivers/platforms"
import { PortalUploadForm } from "./portal-upload-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Driver portal | بوابة السائق",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

function daysLeft(date: string | null): number | null {
  if (!date) return null
  return Math.ceil((new Date(date + "T00:00:00+03:00").getTime() - Date.now()) / 86400000)
}
function ExpiryBadge({ date }: { date: string | null }) {
  const d = daysLeft(date)
  if (d === null) return <span className="text-xs text-muted-foreground">—</span>
  const cls = d < 0 ? "bg-red-500/10 text-red-600" : d <= 30 ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700"
  const label = d < 0 ? `Expired · منتهي` : d <= 30 ? `${d} days left · متبقي ${d} يوم` : `Valid · ساري`
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
}

const STATUS_STATES: Record<string, string> = { pending: "Under review · قيد المراجعة", accepted: "Accepted · مقبول", rejected: "Rejected · مرفوض" }

export default async function DriverPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const view = await loadPortalView(decodeURIComponent(token))

  if (!view) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <LogoMark size={44} />
        <ShieldAlert className="h-10 w-10 text-amber-500" />
        <h1 className="text-xl font-bold">Link expired or invalid</h1>
        <p dir="rtl" className="text-lg font-semibold">الرابط منتهي أو غير صالح</p>
        <p className="max-w-sm text-sm text-muted-foreground">Ask your supervisor to send you a new portal link. · اطلب من المشرف إرسال رابط جديد.</p>
      </div>
    )
  }

  const { driver, company } = view
  const docs = view.documents.filter((d) => d.doc_type !== "photo")
  const urgent = docs.filter((d) => { const n = daysLeft(d.expiry_date); return n !== null && n <= 30 })
  const uploadTypes = Array.from(new Set([...urgent.map((d) => d.doc_type), "iqama", "driving_license", "passport", "health_certificate", "medical_insurance", "work_permit", "home_delivery_permit", "other"]))

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
          <LogoMark size={32} />
          <div className="leading-tight">
            <p className="text-sm font-bold">{company.name_en || company.name_ar || "EliteDev"}</p>
            <p className="text-[11px] text-muted-foreground">Driver portal · <span dir="rtl">بوابة السائق</span></p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 py-5">
        <section className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm">
          {driver.photo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={driver.photo_url} alt="" className="h-16 w-16 rounded-xl object-cover" />
            : <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary">{driver.full_name_ar.slice(0, 1)}</div>}
          <div className="min-w-0">
            <p dir="rtl" className="truncate text-lg font-bold">{driver.full_name_ar}</p>
            {driver.full_name_en && <p className="truncate text-sm text-muted-foreground">{driver.full_name_en}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {driver.driver_code ?? "—"}{driver.iqama_last4 ? ` · Iqama •••• ${driver.iqama_last4}` : ""}
            </p>
          </div>
        </section>

        {urgent.length > 0 && (
          <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold text-amber-800">Action needed · <span dir="rtl">مطلوب إجراء</span></p>
            <p className="mt-1 text-amber-900">{urgent.map((d) => docTypeLabel(d.doc_type, false)).join(", ")} — please upload the renewed copy below. · <span dir="rtl">يرجى رفع النسخة المجددة بالأسفل.</span></p>
          </section>
        )}

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Smartphone className="h-4 w-4 text-primary" />Platform IDs · <span dir="rtl">معرفات المنصات</span></h2>
          {view.platforms.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {view.platforms.map((p) => (
                <li key={p.platform_code + p.platform_driver_id} className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">{platformLabel(p.platform_code, false)} · <span dir="rtl">{platformLabel(p.platform_code, true)}</span></p>
                  <p className="font-mono text-lg font-bold tracking-wide" dir="ltr">{p.platform_driver_id}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No active platform accounts · لا توجد حسابات نشطة</p>}
          {view.cards.length > 0 && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><IdCard className="h-3.5 w-3.5" />Company card {view.cards[0].card_serial}{view.cards[0].expires_at ? ` · until ${view.cards[0].expires_at.slice(0, 10)}` : ""}</p>
          )}
        </section>

        {view.vehicle && (
          <section className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
            <Car className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Assigned vehicle · <span dir="rtl">المركبة المسندة</span></p>
              <p className="font-semibold">{[view.vehicle.make, view.vehicle.model].filter(Boolean).join(" ")} · <span dir="ltr">{view.vehicle.plate_number}</span></p>
            </div>
          </section>
        )}

        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" />My documents · <span dir="rtl">مستنداتي</span></h2>
          {docs.length ? (
            <ul className="divide-y">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{docTypeLabel(d.doc_type, false)} · <span dir="rtl">{docTypeLabel(d.doc_type, true)}</span></p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {d.is_verified && <BadgeCheck className="h-3 w-3 text-emerald-600" />}
                      {docTypeMeta(d.doc_type)?.expires !== false && <><CalendarClock className="h-3 w-3" />{d.expiry_date ?? "—"}</>}
                    </p>
                  </div>
                  {docTypeMeta(d.doc_type)?.expires !== false && <ExpiryBadge date={d.expiry_date} />}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No documents on file yet · لا توجد مستندات بعد</p>}
        </section>

        <PortalUploadForm token={decodeURIComponent(token)} docTypes={uploadTypes} />

        {view.submissions.length > 0 && (
          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">My uploads · <span dir="rtl">ما قمت برفعه</span></h2>
            <ul className="divide-y text-sm">
              {view.submissions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <span>{docTypeLabel(s.doc_type, false)} · {s.created_at.slice(0, 10)}</span>
                  <span className="text-xs text-muted-foreground">{STATUS_STATES[s.status] ?? s.status}{s.review_note ? ` — ${s.review_note}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="pb-6 text-center text-[11px] text-muted-foreground">Link valid until {view.link.expires_at.slice(0, 10)} · Do not share this link · <span dir="rtl">لا تشارك هذا الرابط</span></p>
      </main>
    </div>
  )
}
