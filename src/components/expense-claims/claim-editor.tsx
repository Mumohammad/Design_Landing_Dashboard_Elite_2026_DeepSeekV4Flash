"use client"
import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Camera, FileUp, Loader2, ScanText, Send, Save, X, FileText, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { createClient } from "@/lib/supabase/client"
import { recognizeText, ocrSupported } from "@/lib/ocr/run"
import { parseReceiptText, type ReceiptSuggestion } from "@/lib/expense-claims/receipt-parse"
import { RECEIPT_ACCEPT, precheckFile } from "@/lib/expense-claims/file-check"
import { amountsMismatch } from "@/lib/expense-claims/dashboard"
import {
  FIELD_LABELS, MAX_ATTACHMENTS, PAYMENT_LABELS, PAYMENT_METHODS, RECEIPT_BUCKET, SUPPORTING_DOC_NOTICE, categoryLabel,
  type ClaimSettings, type EditableField, type ExpenseClaim,
} from "@/lib/expense-claims/constants"
import { registerClaimAttachment, saveExpenseClaim, transitionExpenseClaim } from "@/lib/expense-claims/actions"
import { Notice, UnverifiedTag, selectClass, useBi } from "./shared"

type Form = Record<EditableField, string>
const EMPTY: Form = {
  department: "", expense_date: "", supplier_name: "", supplier_vat_number: "", receipt_number: "", category: "", business_purpose: "", currency: "",
  amount_before_vat: "", vat_rate: "", vat_amount: "", total_amount: "", payment_method: "", project: "", cost_center: "", customer: "", notes: "",
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf", "application/xml": "xml", "text/xml": "xml" }
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf", xml: "application/xml" }
function extOf(f: File): string | null {
  const byName = /\.([a-z0-9]{2,5})$/i.exec(f.name)?.[1]?.toLowerCase()
  const ext = byName === "jpeg" ? "jpg" : byName
  if (ext && MIME[ext]) return ext
  return EXT[f.type] ?? null
}

interface Picked { key: string; file: File; error: string | null; preview: string | null }

export function ClaimEditor({ claim, settings, tenantId, existingAttachments = 0, onDone }: {
  claim?: ExpenseClaim; settings: ClaimSettings; tenantId: string; existingAttachments?: number; onDone?: () => void
}) {
  const { L, t } = useBi()
  const router = useRouter()
  const [form, setForm] = useState<Form>(() => {
    const f = { ...EMPTY, currency: settings.default_currency }
    if (claim) for (const k of Object.keys(EMPTY) as EditableField[]) { const v = claim[k]; f[k] = v === null || v === undefined ? "" : String(v) }
    if (!claim?.expense_date && !claim) f.expense_date = new Date().toISOString().slice(0, 10)
    return f
  })
  const [unverified, setUnverified] = useState<Set<string>>(() => new Set(claim?.unverified_fields ?? []))
  const [suggestions, setSuggestions] = useState<ReceiptSuggestion>((claim?.ocr_suggestions?.parsed as ReceiptSuggestion) ?? {})
  const [files, setFiles] = useState<Picked[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<null | "ocr" | "save" | "submit">(null)
  const [ocrNote, setOcrNote] = useState<string | null>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (k: EditableField, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setUnverified((u) => { if (!u.has(k)) return u; const n = new Set(u); n.delete(k); return n })
  }

  function addFiles(list: FileList | null) {
    if (!list) return
    const room = MAX_ATTACHMENTS - existingAttachments - files.length
    const picked = Array.from(list).slice(0, Math.max(0, room)).map((file) => {
      const pre = precheckFile(file)
      return { key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, error: pre ? L(pre) : extOf(file) ? null : t("Unsupported file type.", "نوع ملف غير مدعوم."), preview: file.type.startsWith("image/") && !/hei[cf]/.test(file.type) ? URL.createObjectURL(file) : null }
    })
    if (list.length > room) toast.warning(t(`Up to ${MAX_ATTACHMENTS} attachments per claim.`, `الحد الأقصى ${MAX_ATTACHMENTS} مرفقات لكل مطالبة.`))
    setFiles((f) => [...f, ...picked])
  }

  async function runOcr() {
    const img = files.find((f) => !f.error && f.file.type.startsWith("image/") && !/hei[cf]/.test(f.file.type))
    if (!img) { setOcrNote(t("Reading works on JPG/PNG/WEBP photos. For PDFs, enter the details manually.", "القراءة تعمل على صور JPG/PNG/WEBP. لملفات PDF أدخل البيانات يدوياً.")); return }
    setBusy("ocr"); setOcrNote(null)
    try {
      const { text } = await recognizeText(img.file)
      const { fields, amountsConsistent } = parseReceiptText(text)
      const filled: string[] = []
      setForm((f) => {
        const n = { ...f }
        for (const [k, v] of Object.entries(fields) as Array<[EditableField, string]>) {
          if (v && k in n && (!n[k] || (k === "currency" && n[k] === settings.default_currency) || (k === "expense_date" && !claim))) {
            if (k === "category" && !settings.categories.includes(v)) continue
            n[k] = v; filled.push(k)
          }
        }
        return n
      })
      setUnverified((u) => new Set([...u, ...filled]))
      setSuggestions(fields)
      setOcrNote(filled.length
        ? t(`Suggested ${filled.length} field(s) from the receipt. They are marked "Unverified" — check each one against the receipt.`, `تم اقتراح ${filled.length} حقل/حقول من الإيصال، وهي معلّمة "غير متحقق" — راجع كل حقل مقابل الإيصال.`)
          + (amountsConsistent === false ? t(" The amounts read do not add up.", " المبالغ المقروءة غير متطابقة.") : "")
        : t("No details could be read. Enter them manually.", "تعذرت قراءة البيانات. أدخلها يدوياً."))
    } catch { setOcrNote(t("On-device reading is not available on this browser. Enter the details manually.", "القراءة على الجهاز غير متاحة في هذا المتصفح. أدخل البيانات يدوياً.")) }
    finally { setBusy(null) }
  }

  const mismatch = useMemo(() => amountsMismatch({ amount_before_vat: form.amount_before_vat || null, vat_amount: form.vat_amount || null, total_amount: form.total_amount || null }), [form])
  const canEditFields = !claim || ["draft", "needs_info", "submitted"].includes(claim.status)
  const isOwnDraft = !claim || claim.status === "draft" || claim.status === "needs_info"

  async function uploadAll(claimId: string): Promise<number> {
    const supabase = createClient()
    let okCount = 0
    for (const p of files.filter((f) => !f.error)) {
      const ext = extOf(p.file)!
      const path = `${tenantId}/${claimId}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from(RECEIPT_BUCKET).upload(path, p.file, { contentType: MIME[ext] ?? p.file.type, upsert: false })
      if (up.error) { toast.error(`${p.file.name}: ${t("upload failed", "فشل الرفع")}`); continue }
      const r = await registerClaimAttachment(claimId, path, p.file.name)
      if (!r.ok) toast.error(`${p.file.name}: ${t(r.error, r.errorAr)}`)
      else { okCount++; if (r.duplicateStatus === "possible") toast.warning(t("Possible duplicate detected — a reviewer will check it.", "تم اكتشاف تكرار محتمل — سيتحقق منه المراجع.")) }
    }
    return okCount
  }

  async function save(submit: boolean) {
    if (submit && !confirmed) { toast.error(t("Confirm that you checked the details against the receipt.", "أكّد أنك راجعت البيانات مقابل الإيصال.")); return }
    if (submit && !form.total_amount) { toast.error(t("Total amount is required.", "المبلغ الإجمالي مطلوب.")); return }
    if (submit && !form.expense_date) { toast.error(t("Expense date is required.", "تاريخ المصروف مطلوب.")); return }
    const good = files.filter((f) => !f.error).length
    if (submit && existingAttachments + good === 0 && !window.confirm(t("No receipt is attached. Submit without a supporting document?", "لا يوجد إيصال مرفق. هل تريد التقديم بدون مستند داعم؟"))) return
    setBusy(submit ? "submit" : "save")
    try {
      const payload: Record<string, unknown> = { ...form, currency: form.currency.toUpperCase(), unverified_fields: [...unverified], ...(Object.keys(suggestions).length ? { ocr_suggestions: { parsed: suggestions, source: "on_device_ocr" } } : {}) }
      const saved = await saveExpenseClaim(claim?.id ?? null, canEditFields ? payload : {}, claim?.version ?? null)
      if (!saved.ok) { toast.error(t(saved.error, saved.errorAr)); return }
      await uploadAll(saved.id)
      setFiles([])
      if (submit && isOwnDraft) {
        const tr = await transitionExpenseClaim(saved.id, "submit")
        if (!tr.ok) { toast.error(t(tr.error, tr.errorAr)); router.push(`/expenses/claims/${saved.id}`); return }
        toast.success(t(`Claim ${saved.claimNo} submitted for review.`, `تم تقديم المطالبة ${saved.claimNo} للمراجعة.`))
      } else toast.success(t("Saved.", "تم الحفظ."))
      if (onDone) onDone()
      else router.push(`/expenses/claims/${saved.id}`)
    } finally { setBusy(null) }
  }

  const field = (k: EditableField, input: React.ReactNode, wide = false) => (
    <div className={wide ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label htmlFor={`f-${k}`} className="flex items-center gap-1.5 text-xs">{L(FIELD_LABELS[k])}{unverified.has(k) && <UnverifiedTag />}</Label>
      {input}
    </div>
  )
  const text = (k: EditableField, props: React.ComponentProps<typeof Input> = {}) => (
    <Input id={`f-${k}`} value={form[k]} onChange={(e) => set(k, e.target.value)} disabled={!canEditFields} className={unverified.has(k) ? "border-amber-500/60" : undefined} {...props} />
  )
  const money = (k: EditableField) => text(k, { inputMode: "decimal", placeholder: "0.00", onChange: (e) => set(k, e.target.value.replace(/[^\d.]/g, "")) })

  return (
    <div className="space-y-5">
      {!claim || isOwnDraft ? (
        <section className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("Receipt files", "ملفات الإيصال")}</h2>
            <span className="text-xs text-muted-foreground">{t("JPG, PNG, WEBP, HEIC, PDF (CamScanner OK) or supplier XML e-invoice · max 10 MB each", "JPG وPNG وWEBP وHEIC وPDF (يدعم CamScanner) أو ملف XML من المورد · حتى 10 ميجابايت لكل ملف")}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button type="button" variant="default" className="h-12 sm:h-9" onClick={() => camRef.current?.click()}><Camera className="size-4" />{t("Take photo", "التقاط صورة")}</Button>
            <Button type="button" variant="outline" className="h-12 sm:h-9" onClick={() => fileRef.current?.click()}><FileUp className="size-4" />{t("Upload files", "رفع ملفات")}</Button>
            <Button type="button" variant="outline" className="col-span-2 h-11 sm:h-9" disabled={busy !== null || !files.length || !ocrSupported()} onClick={runOcr}>
              {busy === "ocr" ? <Loader2 className="size-4 animate-spin" /> : <ScanText className="size-4" />}{t("Read receipt (on this device)", "قراءة الإيصال (على هذا الجهاز)")}
            </Button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = "" }} />
          <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = "" }} />
          {files.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {files.map((p) => (
                <li key={p.key} className={`relative overflow-hidden rounded-lg border ${p.error ? "border-red-500/50" : ""}`}>
                  {p.preview ? <img src={p.preview} alt="" className="h-24 w-full object-cover" /> : <div className="flex h-24 items-center justify-center bg-muted"><FileText className="size-8 text-muted-foreground" /></div>}
                  <div className="truncate px-2 py-1 text-[11px]" title={p.file.name}>{p.file.name}</div>
                  {p.error && <div className="px-2 pb-1 text-[11px] text-red-600">{p.error}</div>}
                  <button type="button" aria-label={t("Remove", "إزالة")} className="absolute end-1 top-1 rounded-full bg-background/90 p-1 shadow" onClick={() => setFiles((f) => f.filter((x) => x.key !== p.key))}><X className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
          {ocrNote && <Notice tone="warn">{ocrNote}</Notice>}
          <Notice>{L(SUPPORTING_DOC_NOTICE)} {t("Original files are stored unchanged.", "تُحفظ الملفات الأصلية دون تعديل.")}</Notice>
        </section>
      ) : null}

      <section className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
        <h2 className="text-sm font-semibold sm:col-span-2">{t("Expense details", "تفاصيل المصروف")}</h2>
        {field("expense_date", text("expense_date", { type: "date", max: new Date().toISOString().slice(0, 10) }))}
        {field("category", (
          <select id="f-category" className={selectClass} value={form.category} disabled={!canEditFields} onChange={(e) => set("category", e.target.value)}>
            <option value="">{t("Select…", "اختر…")}</option>
            {settings.categories.map((c) => <option key={c} value={c}>{L(categoryLabel(c))}</option>)}
          </select>
        ))}
        {field("supplier_name", text("supplier_name", { maxLength: 200 }))}
        {field("supplier_vat_number", text("supplier_vat_number", { maxLength: 30, inputMode: "numeric" }))}
        {field("receipt_number", text("receipt_number", { maxLength: 100 }))}
        {field("payment_method", (
          <select id="f-payment_method" className={selectClass} value={form.payment_method} disabled={!canEditFields} onChange={(e) => set("payment_method", e.target.value)}>
            <option value="">{t("Select…", "اختر…")}</option>
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{L(PAYMENT_LABELS[p])}</option>)}
          </select>
        ))}
        {field("business_purpose", <Textarea id="f-business_purpose" value={form.business_purpose} maxLength={1000} disabled={!canEditFields} onChange={(e) => set("business_purpose", e.target.value)} rows={2} />, true)}
      </section>

      <section className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold sm:col-span-3">{t("Amounts (as shown on the receipt)", "المبالغ (كما تظهر في الإيصال)")}</h2>
        {field("currency", text("currency", { maxLength: 3, className: "uppercase", onChange: (e) => set("currency", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase()) }))}
        {field("amount_before_vat", money("amount_before_vat"))}
        {field("vat_rate", money("vat_rate"))}
        {field("vat_amount", money("vat_amount"))}
        {field("total_amount", money("total_amount"))}
        {mismatch && <div className="flex items-center gap-2 text-xs text-amber-700 sm:col-span-3 dark:text-amber-300"><AlertTriangle className="size-4" />{t("Amount before VAT + VAT does not equal the total. Check the receipt.", "المبلغ قبل الضريبة + الضريبة لا يساوي الإجمالي. راجع الإيصال.")}</div>}
        <p className="text-[11px] text-muted-foreground sm:col-span-3">{t("VAT is recorded as printed on the receipt and stays unverified until a reviewer checks it. It is not a determination of recoverable VAT.", "تُسجل الضريبة كما هي مطبوعة في الإيصال وتبقى غير متحقق منها حتى يراجعها المراجع، وليست تحديداً للضريبة القابلة للاسترداد.")}</p>
      </section>

      <section className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
        <h2 className="text-sm font-semibold sm:col-span-2">{t("Allocation", "التوزيع")}</h2>
        {field("department", text("department", { maxLength: 120 }))}
        {field("project", text("project", { maxLength: 120 }))}
        {field("cost_center", text("cost_center", { maxLength: 120 }))}
        {field("customer", text("customer", { maxLength: 200 }))}
        {field("notes", <Textarea id="f-notes" value={form.notes} maxLength={2000} disabled={!canEditFields} onChange={(e) => set("notes", e.target.value)} rows={2} />, true)}
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 space-y-3 border-t bg-background/95 p-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        {isOwnDraft && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
            <span>{t("I checked these details against the original receipt. Suggested values marked “Unverified” were reviewed.", "راجعت هذه البيانات مقابل الإيصال الأصلي، وتمت مراجعة القيم المقترحة المعلّمة \"غير متحقق\".")}</span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => save(false)}>{busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{isOwnDraft ? t("Save draft", "حفظ كمسودة") : t("Save changes", "حفظ التغييرات")}</Button>
          {isOwnDraft && <Button type="button" disabled={busy !== null} onClick={() => save(true)}>{busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{t("Submit for review", "تقديم للمراجعة")}</Button>}
          {onDone && <Button type="button" variant="ghost" disabled={busy !== null} onClick={onDone}>{t("Cancel", "إلغاء")}</Button>}
        </div>
      </div>
    </div>
  )
}
