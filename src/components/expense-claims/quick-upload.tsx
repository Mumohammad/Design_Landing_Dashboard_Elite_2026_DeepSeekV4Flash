"use client"
import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Camera, CheckCircle2, FileUp, Loader2, Pencil, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { RECEIPT_ACCEPT, precheckFile } from "@/lib/expense-claims/file-check"
import { RECEIPT_BUCKET } from "@/lib/expense-claims/constants"
import { autofillClaimFromReceipt, registerClaimAttachment, saveExpenseClaim, transitionExpenseClaim } from "@/lib/expense-claims/actions"
import { zatcaPurchaseCheck } from "@/lib/expense-claims/zatca-check"
import { MIME, extOf } from "./claim-editor"
import { Notice, UnverifiedTag, ZatcaCheckPanel, useBi } from "./shared"

type Step = "pick" | "working" | "done" | "error"
interface Outcome { id: string; claimNo: string; submitted: boolean; fields: Record<string, string>; summary: string; duplicate: boolean }

/**
 * One tap: photo/PDF → draft claim → upload → server reads the ZATCA QR / text →
 * submitted for review when date and total were found, otherwise left as a draft to complete.
 * Read values are always shown as unverified.
 */
export function QuickUpload({ tenantId }: { tenantId: string }) {
  const { t } = useBi()
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("pick")
  const [msg, setMsg] = useState("")
  const [out, setOut] = useState<Outcome | null>(null)

  async function run(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, 5)
    if (!files.length) return
    for (const f of files) { const p = precheckFile(f); if (p || !extOf(f)) { setStep("error"); setMsg(p ? t(p.en, p.ar) : t("Unsupported file type.", "نوع الملف غير مدعوم.")); return } }
    setStep("working")
    try {
      setMsg(t("Creating claim…", "جارٍ إنشاء المطالبة…"))
      const created = await saveExpenseClaim(null, {})
      if (!created.ok) throw new Error(t(created.error, created.errorAr))
      setMsg(t("Uploading…", "جارٍ الرفع…"))
      const supabase = createClient()
      let duplicate = false, uploaded = 0
      for (const f of files) {
        const ext = extOf(f)!
        const path = `${tenantId}/${created.id}/${crypto.randomUUID()}.${ext}`
        const up = await supabase.storage.from(RECEIPT_BUCKET).upload(path, f, { contentType: MIME[ext] ?? f.type, upsert: false })
        if (up.error) continue
        const r = await registerClaimAttachment(created.id, path, f.name)
        if (r.ok) { uploaded++; if (r.duplicateStatus === "possible") duplicate = true }
      }
      if (!uploaded) throw new Error(t("Upload failed. Please try again.", "فشل الرفع. حاول مرة أخرى."))
      setMsg(t("Reading the receipt (ZATCA QR, PDF text)…", "جارٍ قراءة الإيصال (رمز QR الضريبي، نص الملف)…"))
      const filled = await autofillClaimFromReceipt(created.id)
      const fields = filled.ok ? filled.fields : {}
      let submitted = false
      if (fields.total_amount && fields.expense_date) {
        const tr = await transitionExpenseClaim(created.id, "submit", { expectedVersion: filled.ok ? filled.version : undefined })
        submitted = tr.ok
      }
      setOut({ id: created.id, claimNo: created.claimNo, submitted, fields, summary: filled.ok ? filled.summary : "", duplicate })
      setStep("done")
    } catch (e) {
      setStep("error"); setMsg(e instanceof Error ? e.message : t("Something went wrong.", "حدث خطأ ما."))
    }
  }

  const zatca = useMemo(() => {
    const f = out?.fields ?? {}
    return zatcaPurchaseCheck({ currency: f.currency ?? "SAR", supplier_name: f.supplier_name ?? null, supplier_vat_number: f.supplier_vat_number ?? null, receipt_number: f.receipt_number ?? null, expense_date: f.expense_date ?? null, amount_before_vat: f.amount_before_vat ?? null, vat_rate: f.vat_rate ?? null, vat_amount: f.vat_amount ?? null, total_amount: f.total_amount ?? null })
  }, [out])

  const reset = () => { setStep("pick"); setOut(null); setMsg("") }

  return (
    <div className="space-y-4">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void run(e.target.files); e.target.value = "" }} />
      <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} multiple className="hidden" onChange={(e) => { void run(e.target.files); e.target.value = "" }} />

      {step === "pick" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" className="h-28 flex-col gap-2 text-base" onClick={() => camRef.current?.click()}><Camera className="size-7" />{t("Take photo", "التقط صورة")}</Button>
          <Button size="lg" variant="outline" className="h-28 flex-col gap-2 text-base" onClick={() => fileRef.current?.click()}><FileUp className="size-7" />{t("Upload PDF / image", "ارفع PDF / صورة")}</Button>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("The claim is created and submitted automatically. Details are read from the ZATCA QR code or PDF text and stay unverified until a reviewer checks them.", "تُنشأ المطالبة وتُرسل تلقائياً. تُقرأ البيانات من رمز QR الضريبي أو نص الملف وتبقى غير متحقق منها حتى يراجعها المراجع.")}</p>
        </div>
      )}

      {step === "working" && <div className="flex items-center gap-2 rounded-lg border p-6 text-sm"><Loader2 className="size-5 animate-spin" />{msg}</div>}

      {step === "error" && (
        <div className="space-y-3"><Notice tone="warn">{msg}</Notice><Button variant="outline" onClick={reset}><RotateCcw className="size-4" />{t("Try again", "حاول مرة أخرى")}</Button></div>
      )}

      {step === "done" && out && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-5 text-emerald-600" />
            {out.submitted ? t(`Claim ${out.claimNo} submitted for review`, `تم إرسال المطالبة ${out.claimNo} للمراجعة`) : t(`Claim ${out.claimNo} saved as draft — add the date and total to submit`, `حُفظت المطالبة ${out.claimNo} كمسودة — أضف التاريخ والإجمالي للإرسال`)}
          </div>
          {out.duplicate && <Notice tone="warn">{t("Possible duplicate — a reviewer will check it.", "تكرار محتمل — سيتحقق منه المراجع.")}</Notice>}
          {Object.keys(out.fields).length ? <div className="space-y-1 text-sm"><div className="flex items-center gap-2"><UnverifiedTag />{t("Read from the file", "مقروءة من الملف")}</div><pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">{out.summary}</pre></div>
            : <Notice>{t("No details could be read from the file — please complete them.", "لم نتمكن من قراءة البيانات من الملف — يرجى إكمالها.")}</Notice>}
          <ZatcaCheckPanel check={zatca} />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant={out.submitted ? "outline" : "default"}><Link href={`/expenses/claims/${out.id}`}><Pencil className="size-4" />{out.submitted ? t("View / edit", "عرض / تعديل") : t("Complete details", "أكمل البيانات")}</Link></Button>
            <Button variant="outline" onClick={reset}><Camera className="size-4" />{t("Another receipt", "إيصال آخر")}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
