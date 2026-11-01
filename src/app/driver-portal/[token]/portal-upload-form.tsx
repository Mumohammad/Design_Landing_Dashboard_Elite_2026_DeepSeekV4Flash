"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { docTypeLabel } from "@/lib/drivers/documents"
import { OcrScanButton } from "@/components/drivers/ocr-scan-button"
import { finishPortalUpload, startPortalUpload } from "../actions"

const field = "h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"

export function PortalUploadForm({ token, docTypes }: { token: string; docTypes: string[] }) {
  const router = useRouter()
  const [docType, setDocType] = useState(docTypes[0] ?? "other")
  const [file, setFile] = useState<File | null>(null)
  const [docNumber, setDocNumber] = useState("")
  const [expiry, setExpiry] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit() {
    if (!file || busy) return
    setBusy(true); setMsg(null)
    try {
      const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "")
      const s = await startPortalUpload({ token, docType, size: file.size, mime })
      if (!s.ok) { setMsg({ ok: false, text: `${s.error} · ${s.errorAr}` }); return }
      const up = await createClient().storage.from("driver-portal-uploads").uploadToSignedUrl(s.path, s.uploadToken, file, { contentType: mime })
      if (up.error) { setMsg({ ok: false, text: "Upload failed. Check your connection and try again. · فشل الرفع، حاول مجدداً." }); return }
      const f = await finishPortalUpload({ token, path: s.path, docType, docNumber: docNumber || undefined, expiryDate: expiry || undefined, note: note || undefined })
      if (!f.ok) { setMsg({ ok: false, text: `${f.error} · ${f.errorAr}` }); return }
      setMsg({ ok: true, text: "Sent for review. Thank you! · تم الإرسال للمراجعة، شكراً لك!" })
      setFile(null); setDocNumber(""); setExpiry(""); setNote("")
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Upload className="h-4 w-4 text-primary" />Upload a renewed document · <span dir="rtl">رفع مستند مجدد</span></h2>
      <p className="mb-3 text-xs text-muted-foreground">Take a clear photo or attach a PDF. Your supervisor reviews it before it replaces the old copy. · <span dir="rtl">التقط صورة واضحة أو أرفق PDF، وسيراجعها المشرف.</span></p>
      <div className="space-y-3">
        <select className={field} value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy}>
          {docTypes.map((t) => <option key={t} value={t}>{docTypeLabel(t, false)} · {docTypeLabel(t, true)}</option>)}
        </select>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 text-center text-sm hover:bg-muted/50">
          <Upload className="h-5 w-5 text-primary" />
          {file ? <span className="max-w-full truncate font-medium">{file.name}</span> : <span>Tap to take a photo or choose a file · <span dir="rtl">اضغط للتصوير أو اختيار ملف</span></span>}
          <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMsg(null) }} />
        </label>
        <OcrScanButton file={file} docType={docType} isAr={false} disabled={busy} onResult={(r) => { if (r.docNumber) setDocNumber(r.docNumber); if (r.expiryDate) setExpiry(r.expiryDate) }} />
        <div className="grid grid-cols-2 gap-2">
          <input className={field} placeholder="Document no. · رقم المستند" maxLength={100} value={docNumber} onChange={(e) => setDocNumber(e.target.value)} disabled={busy} dir="ltr" />
          <input className={field} type="date" aria-label="Expiry date" value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={busy} />
        </div>
        <input className={field} placeholder="Note (optional) · ملاحظة" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        <button type="button" onClick={() => void submit()} disabled={!file || busy}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Send · إرسال
        </button>
        {msg && <p className={`flex items-center gap-2 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok && <CheckCircle2 className="h-4 w-4" />}{msg.text}</p>}
      </div>
    </section>
  )
}
