"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, ExternalLink, Inbox, Link2, Loader2, MessageCircle, ShieldOff, X } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { issueDriverPortalLink, reviewPortalSubmission, revokeDriverPortalLinks } from "@/app/actions/drivers/portal"
import { registerDriverDocument } from "@/app/actions/drivers/documents"
import { docTypeLabel } from "@/lib/drivers/documents"
import { emitDriverChanged } from "@/lib/drivers/driver-events"
import type { Driver } from "@/types/drivers"

type Link = { id: string; expires_at: string; revoked_at: string | null; last_used_at: string | null; created_at: string }
type Submission = { id: string; doc_type: string; doc_number: string | null; expiry_date: string | null; file_path: string; mime_type: string; file_size: number; driver_note: string | null; created_at: string }
const field = "h-8 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"

function waNumber(mobile: string | null | undefined): string | null {
  const d = (mobile ?? "").replace(/\D/g, "")
  if (/^05\d{8}$/.test(d)) return "966" + d.slice(1)
  if (/^9665\d{8}$/.test(d)) return d
  return null
}

export function DriverPortalPanel({ driver, isAr }: { driver: Driver; isAr: boolean }) {
  const L = (en: string, ar: string) => (isAr ? ar : en)
  const [link, setLink] = useState<Link | null>(null)
  const [subs, setSubs] = useState<Submission[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [edits, setEdits] = useState<Record<string, { docNumber: string; expiry: string; note: string }>>({})
  const [fresh, setFresh] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const db = createClient()
    const [l, s] = await Promise.all([
      db.from("driver_portal_links").select("id, expires_at, revoked_at, last_used_at, created_at").eq("driver_id", driver.id).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("driver_portal_submissions").select("id, doc_type, doc_number, expiry_date, file_path, mime_type, file_size, driver_note, created_at").eq("driver_id", driver.id).eq("status", "pending").order("created_at"),
    ])
    const rows = (s.data ?? []) as Submission[]
    const signed = rows.length ? (await db.storage.from("driver-portal-uploads").createSignedUrls(rows.map((r) => r.file_path), 900)).data ?? [] : []
    return { link: (l.data as Link | null) ?? null, rows, urls: Object.fromEntries(signed.filter((x) => x.path && x.signedUrl).map((x) => [x.path as string, x.signedUrl as string])) }
  }, [driver.id])
  const apply = useCallback((d: Awaited<ReturnType<typeof fetchData>>) => {
    setLink(d.link && new Date(d.link.expires_at).getTime() > Date.now() ? d.link : null)
    setSubs(d.rows); setPreviews(d.urls)
    setEdits(Object.fromEntries(d.rows.map((r) => [r.id, { docNumber: r.doc_number ?? "", expiry: r.expiry_date ?? "", note: "" }])))
  }, [])
  const refresh = useCallback(() => fetchData().then(apply), [fetchData, apply])
  useEffect(() => {
    let cancelled = false
    void fetchData().then((d) => { if (!cancelled) apply(d) })
    return () => { cancelled = true }
  }, [fetchData, apply])

  async function issue() {
    setBusy("issue")
    const r = await issueDriverPortalLink({ driverId: driver.id, days })
    setBusy(null)
    if (!r.ok) { toast.error(isAr ? r.errorAr : r.error); return }
    setFresh(window.location.origin + r.path)
    void refresh()
  }
  async function revoke() {
    setBusy("revoke")
    const r = await revokeDriverPortalLinks({ driverId: driver.id })
    setBusy(null)
    if (!r.ok) { toast.error(isAr ? r.errorAr : r.error); return }
    setFresh(null); toast.success(L("Portal link revoked", "تم إلغاء رابط البوابة")); void refresh()
  }
  const message = (url: string) => `${L("Your driver portal (ID cards, documents, renewals):", "بوابة السائق الخاصة بك (البطاقات والمستندات والتجديد):")} ${url}`

  async function accept(s: Submission) {
    const e = edits[s.id]
    setBusy(s.id)
    try {
      const db = createClient()
      const { data: d } = await db.from("drivers").select("tenant_id, profile_version").eq("id", driver.id).single()
      if (!d) throw new Error("driver")
      const blob = (await db.storage.from("driver-portal-uploads").download(s.file_path)).data
      if (!blob) throw new Error("download")
      const ext = s.file_path.split(".").pop() ?? "bin"
      const path = `${d.tenant_id}/${driver.id}/${s.doc_type}-${crypto.randomUUID()}.${ext}`
      const up = await db.storage.from("driver-documents").upload(path, blob, { upsert: false, contentType: s.mime_type })
      if (up.error) throw new Error("upload")
      const reg = await registerDriverDocument({ driverId: driver.id, expectedDriverVersion: d.profile_version, docType: s.doc_type, filePath: path, ...(e.docNumber.trim() ? { docNumber: e.docNumber.trim() } : {}), ...(e.expiry ? { expiryDate: e.expiry } : {}), fileSize: blob.size, mimeType: s.mime_type })
      if (!reg.ok) { toast.error(isAr ? reg.errorAr : reg.error); return }
      const r = await reviewPortalSubmission({ id: s.id, action: "accept", documentId: reg.id, note: e.note || undefined })
      if (!r.ok) { toast.error(isAr ? r.errorAr : r.error); return }
      toast.success(L("Added to the document vault", "تمت الإضافة إلى خزنة المستندات"))
      emitDriverChanged("documents")
      void refresh()
    } catch { toast.error(L("Could not accept the document. Try again.", "تعذر قبول المستند. حاول مجدداً.")) } finally { setBusy(null) }
  }
  async function reject(s: Submission) {
    setBusy(s.id)
    const r = await reviewPortalSubmission({ id: s.id, action: "reject", note: edits[s.id]?.note || undefined })
    setBusy(null)
    if (!r.ok) { toast.error(isAr ? r.errorAr : r.error); return }
    toast.success(L("Rejected — the driver will see your note", "تم الرفض — سيظهر السبب للسائق")); void refresh()
  }

  const wa = waNumber(driver.primary_mobile)
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Link2 className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold">{L("Driver self-service portal", "بوابة السائق الذاتية")}</h3>
            <p className="text-xs text-muted-foreground">
              {link ? L(`Active link · expires ${link.expires_at.slice(0, 10)}${link.last_used_at ? ` · last opened ${link.last_used_at.slice(0, 10)}` : " · not opened yet"}`, `رابط فعّال · ينتهي ${link.expires_at.slice(0, 10)}${link.last_used_at ? ` · آخر فتح ${link.last_used_at.slice(0, 10)}` : " · لم يُفتح بعد"}`)
                : L("Send the driver a secure link to view their platform IDs and documents and upload renewals — no login needed.", "أرسل للسائق رابطاً آمناً لعرض معرفات المنصات والمستندات ورفع التجديدات دون تسجيل دخول.")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-8 rounded-lg border bg-background px-2 text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={L("Validity", "الصلاحية")}>
            {[7, 30, 90].map((d) => <option key={d} value={d}>{d} {L("days", "يوم")}</option>)}
          </select>
          <Button size="sm" disabled={!!busy} onClick={() => void issue()}>{busy === "issue" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{link ? L("New link", "رابط جديد") : L("Create link", "إنشاء رابط")}</Button>
          {link && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void revoke()}><ShieldOff className="h-3.5 w-3.5" />{L("Revoke", "إلغاء")}</Button>}
        </div>
      </div>

      {fresh && (
        <div className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium text-emerald-700">{L("Copy or send it now — for security the full link is shown only once.", "انسخه أو أرسله الآن — يظهر الرابط كاملاً مرة واحدة فقط لدواعي الأمان.")}</p>
          <code className="block truncate rounded bg-background px-2 py-1 text-[11px]" dir="ltr">{fresh}</code>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(fresh).then(() => toast.success(L("Copied", "تم النسخ")))}><Copy className="h-3.5 w-3.5" />{L("Copy", "نسخ")}</Button>
            <Button size="sm" variant="outline" asChild><a href={`https://wa.me/${wa ?? ""}?text=${encodeURIComponent(message(fresh))}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a></Button>
            <Button size="sm" variant="outline" asChild><a href={fresh} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />{L("Preview", "معاينة")}</a></Button>
          </div>
        </div>
      )}

      {subs.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold"><Inbox className="h-3.5 w-3.5 text-amber-600" />{L(`${subs.length} upload(s) from the driver awaiting review`, `${subs.length} مستند من السائق بانتظار المراجعة`)}</p>
          {subs.map((s) => {
            const e = edits[s.id] ?? { docNumber: "", expiry: "", note: "" }
            const set = (k: keyof typeof e, v: string) => setEdits((x) => ({ ...x, [s.id]: { ...e, [k]: v } }))
            const url = previews[s.file_path]
            return (
              <div key={s.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[96px_1fr]">
                <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border bg-muted text-[10px] text-muted-foreground">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url && s.mime_type.startsWith("image/") && !s.mime_type.includes("hei") ? <img src={url} alt="" className="h-full w-full object-cover" /> : "PDF / HEIC"}
                </a>
                <div className="space-y-2">
                  <p className="text-sm font-medium">{docTypeLabel(s.doc_type, isAr)} <span className="text-xs text-muted-foreground">· {s.created_at.slice(0, 10)} · {(s.file_size / 1048576).toFixed(1)} MB</span></p>
                  {s.driver_note && <p className="text-xs text-muted-foreground">“{s.driver_note}”</p>}
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input className={field} placeholder={L("Document no.", "رقم المستند")} value={e.docNumber} onChange={(ev) => set("docNumber", ev.target.value)} dir="ltr" />
                    <input className={field} type="date" value={e.expiry} onChange={(ev) => set("expiry", ev.target.value)} aria-label={L("Expiry", "الانتهاء")} />
                    <input className={field} placeholder={L("Note to driver", "ملاحظة للسائق")} value={e.note} onChange={(ev) => set("note", ev.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!!busy} onClick={() => void accept(s)}>{busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{L("Accept to vault", "قبول وإضافة للخزنة")}</Button>
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void reject(s)}><X className="h-3.5 w-3.5" />{L("Reject", "رفض")}</Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
