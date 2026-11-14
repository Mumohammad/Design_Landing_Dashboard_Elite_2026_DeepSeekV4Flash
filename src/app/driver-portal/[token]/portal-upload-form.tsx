"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { docTypeLabel } from "@/lib/drivers/documents"
import { OcrScanButton } from "@/components/drivers/ocr-scan-button"
import { finishPortalUpload, startPortalUpload } from "../actions"

const field = "min-h-11 min-w-0 w-full max-w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
type UploadInput = { token: string; docType: string; file: File; docNumber: string; expiry: string; note: string }
type UploadResult = { kind: "success" } | { kind: "error" | "unconfirmed"; error: string; errorAr: string }
type UploadDependencies = {
  start: typeof startPortalUpload
  finish: typeof finishPortalUpload
  upload: (path: string, uploadToken: string, file: File, mime: string) => Promise<{ error: unknown }>
}
const mimeByExtension: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" }

/** One explicit attempt; a response loss never automatically repeats a write. */
export async function performPortalUpload(input: UploadInput, dependencies: UploadDependencies): Promise<UploadResult> {
  const mime = input.file.type || mimeByExtension[input.file.name.split(".").pop()?.toLowerCase() ?? ""] || ""
  if (!Object.values(mimeByExtension).includes(mime) || input.file.size <= 0 || input.file.size > 10 * 1024 * 1024) {
    return { kind: "error", error: "Choose a JPG, PNG, WebP, HEIC or PDF file up to 10 MB.", errorAr: "اختر صورة JPG أو PNG أو WebP أو HEIC أو ملف PDF بحجم لا يتجاوز 10 ميجابايت." }
  }
  let phase: "start" | "upload" | "finish" = "start"
  try {
    const started = await dependencies.start({ token: input.token, docType: input.docType, size: input.file.size, mime })
    if (!started.ok) return { kind: "error", error: started.error, errorAr: started.errorAr }
    phase = "upload"
    const uploaded = await dependencies.upload(started.path, started.uploadToken, input.file, mime)
    if (uploaded.error) return { kind: "error", error: "The file could not be uploaded. Check your connection and try again.", errorAr: "تعذر رفع الملف. تحقق من الاتصال وحاول مجددًا." }
    phase = "finish"
    const finished = await dependencies.finish({ token: input.token, path: started.path, docType: input.docType, docNumber: input.docNumber || undefined, expiryDate: input.expiry || undefined, note: input.note || undefined })
    if (!finished.ok) return { kind: "unconfirmed", error: finished.error, errorAr: finished.errorAr }
    return { kind: "success" }
  } catch {
    return phase === "finish"
      ? { kind: "unconfirmed", error: "We could not confirm that your document was sent for review.", errorAr: "تعذر تأكيد إرسال مستندك للمراجعة." }
      : { kind: "error", error: "The upload was interrupted. Check your connection and try again.", errorAr: "انقطع الرفع. تحقق من الاتصال وحاول مجددًا." }
  }
}

export function PortalUploadForm({ token, docTypes }: { token: string; docTypes: string[] }) {
  const { locale } = useTranslation()
  const isAr = locale === "ar"
  const text = (en: string, ar: string) => isAr ? ar : en
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const [docType, setDocType] = useState(docTypes[0] ?? "other")
  const [file, setFile] = useState<File | null>(null)
  const [docNumber, setDocNumber] = useState("")
  const [expiry, setExpiry] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const unconfirmed = result?.kind === "unconfirmed"

  async function submit() {
    if (!file || submitting.current || unconfirmed) return
    submitting.current = true
    setBusy(true)
    setResult(null)
    try {
      const outcome = await performPortalUpload({ token, docType, file, docNumber, expiry, note }, {
        start: startPortalUpload,
        finish: finishPortalUpload,
        upload: (path, uploadToken, selected, mime) => createClient().storage.from("driver-portal-uploads").uploadToSignedUrl(path, uploadToken, selected, { contentType: mime }),
      })
      setResult(outcome)
      if (outcome.kind === "success") {
        setFile(null); setDocNumber(""); setExpiry(""); setNote("")
        if (fileInput.current) fileInput.current.value = ""
        router.refresh()
      }
    } catch {
      setResult({ kind: "unconfirmed", error: "The result could not be confirmed.", errorAr: "تعذر تأكيد النتيجة." })
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <section id="portal-upload" className="scroll-mt-4 rounded-lg border bg-card p-4 sm:p-5" aria-labelledby="portal-upload-title">
    <h2 id="portal-upload-title" className="text-base font-semibold">{text("Upload a renewed document", "رفع مستند مجدد")}</h2>
    <p id="portal-upload-help" className="mt-2 text-sm leading-6 text-muted-foreground">{text("Take a clear photo or attach a PDF. Your supervisor reviews it before it replaces the current copy.", "التقط صورة واضحة أو أرفق ملف PDF. يراجع المشرف المستند قبل استبدال النسخة الحالية.")}</p>
    <form className="mt-5 space-y-4" aria-describedby="portal-upload-help" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <div className="space-y-2">
          <label htmlFor="portal-doc-type" className="block text-sm font-medium">{text("Document type", "نوع المستند")}</label>
          <select id="portal-doc-type" name="docType" className={field} value={docType} onChange={(event) => setDocType(event.target.value)}>
            {docTypes.map((type) => <option key={type} value={type}>{docTypeLabel(type, isAr)}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <span className="block text-sm font-medium">{text("Photo or PDF", "صورة أو ملف PDF")}</span>
          <label htmlFor="portal-file" className="flex min-h-20 cursor-pointer flex-col justify-center gap-2 rounded-md border bg-background p-3 text-sm focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40">
            <span className="font-medium">{text("Take a photo or choose a file", "التقاط صورة أو اختيار ملف")}</span>
            {file && <span dir="auto" className="break-all text-muted-foreground">{file.name}</span>}
            <input ref={fileInput} id="portal-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" className="sr-only" aria-describedby="portal-file-help" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <p id="portal-file-help" className="text-xs leading-5 text-muted-foreground">{text("JPG, PNG, WebP, HEIC or PDF, up to 10 MB.", "JPG أو PNG أو WebP أو HEIC أو PDF، بحد أقصى 10 ميجابايت.")}</p>
        </div>
        <div className="[&_button]:min-h-11 [&_button]:border-border [&_button]:bg-background [&_button]:text-foreground [&_button:hover]:bg-muted">
          <OcrScanButton file={file} docType={docType} isAr={isAr} disabled={busy} onResult={(suggestion) => { if (suggestion.docNumber) setDocNumber(suggestion.docNumber); if (suggestion.expiryDate) setExpiry(suggestion.expiryDate) }} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="portal-doc-number" className="block text-sm font-medium">{text("Document number (optional)", "رقم المستند (اختياري)")}</label>
            <input id="portal-doc-number" name="docNumber" className={field} maxLength={100} value={docNumber} onChange={(event) => setDocNumber(event.target.value)} dir="ltr" />
          </div>
          <div className="space-y-2">
            <label htmlFor="portal-expiry" className="block text-sm font-medium">{text("Expiry date (optional)", "تاريخ الانتهاء (اختياري)")}</label>
            <input id="portal-expiry" name="expiry" className={field} type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} dir="ltr" />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="portal-note" className="block text-sm font-medium">{text("Note for your supervisor (optional)", "ملاحظة للمشرف (اختياري)")}</label>
          <textarea id="portal-note" name="note" className={`${field} min-h-24 py-3`} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
      </fieldset>
      {!file && !unconfirmed && <p className="text-xs text-muted-foreground">{text("Choose a file to enable sending.", "اختر ملفًا لتتمكن من الإرسال.")}</p>}
      <button type="submit" disabled={!file || busy || unconfirmed} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-semibold text-background outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
        {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
        {busy ? text("Sending…", "جارٍ الإرسال…") : result?.kind === "error" ? text("Try sending again", "إعادة محاولة الإرسال") : text("Send for review", "إرسال للمراجعة")}
      </button>
      {result && <div className="space-y-3 text-sm leading-6" role={result.kind === "success" ? "status" : "alert"}>
        <p className={result.kind === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>{result.kind === "success" ? text("Sent for review. Your supervisor will review the document.", "تم الإرسال للمراجعة. سيراجع المشرف المستند.") : isAr ? result.errorAr : result.error}</p>
        {unconfirmed && <>
          <p className="text-muted-foreground">{text("Do not send the document again yet. Reload and check My uploads, or ask your supervisor to confirm receipt.", "لا تُعد إرسال المستند الآن. أعد تحميل الصفحة وتحقق من مستنداتك المرسلة، أو اطلب من المشرف تأكيد الاستلام.")}</p>
          <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-md border bg-background px-3 font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{text("Reload and check uploads", "إعادة التحميل والتحقق من المستندات المرسلة")}</button>
        </>}
      </div>}
    </form>
  </section>
}
