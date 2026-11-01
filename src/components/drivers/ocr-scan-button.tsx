"use client"

import { useState } from "react"
import { Loader2, ScanText } from "lucide-react"
import { toast } from "@/lib/toast"
import { ocrKindFor, type OcrSuggestion } from "@/lib/ocr/extract"

/** "Read details from image" — local OCR that suggests number + expiry for the chosen file. */
export function OcrScanButton({ file, docType, isAr, disabled, onResult }: { file: File | null; docType: string; isAr: boolean; disabled?: boolean; onResult: (s: OcrSuggestion) => void }) {
  const [busy, setBusy] = useState(false)
  const kind = ocrKindFor(docType)
  if (!kind || !file || !file.type.startsWith("image/")) return null
  const run = async () => {
    setBusy(true)
    try {
      const { scanDocument } = await import("@/lib/ocr/run")
      const r = await scanDocument(file, kind)
      if (!r.docNumber && !r.expiryDate) { toast.error(isAr ? "تعذرت قراءة البيانات. أدخلها يدوياً أو استخدم صورة أوضح." : "Couldn't read the details. Enter them manually or use a clearer photo."); return }
      onResult(r)
      toast.success(isAr ? "تمت قراءة البيانات — راجعها قبل الحفظ" : "Details read — please review before saving")
    } catch (e) {
      toast.error(isAr ? "القراءة الآلية غير متاحة على هذا المتصفح." : e instanceof Error ? e.message : "OCR unavailable")
    } finally { setBusy(false) }
  }
  return (
    <button type="button" onClick={() => void run()} disabled={busy || disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />}
      {busy ? (isAr ? "جارٍ القراءة…" : "Reading…") : (isAr ? "قراءة البيانات من الصورة (OCR)" : "Read details from image (OCR)")}
    </button>
  )
}
