"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Check, Download, FileText, Loader2, MessageSquareWarning, Pencil, Send, ShieldAlert, Trash2, X, Banknote, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import {
  CHECKLIST_NOTICE, DOC_KIND_LABELS, DUPLICATE_REASON_LABELS, FIELD_LABELS, PAYMENT_LABELS, STATUS_LABELS, SUPPORTING_DOC_NOTICE, categoryLabel, num,
  type ClaimAttachment, type ClaimSettings, type EditableField, type ExpenseClaim, type ClaimStatus,
} from "@/lib/expense-claims/constants"
import { amountsMismatch, formatMoney } from "@/lib/expense-claims/dashboard"
import { riyadhTimestamp } from "@/lib/expense-claims/format"
import {
  deleteDraftClaim, getAttachmentDownloadUrl, getClaimSettings, getExpenseAccess, getTenantUserNames, resolveClaimDuplicate, saveClaimChecklist,
  transitionExpenseClaim, type ExpenseAccess, type TransitionAction,
} from "@/lib/expense-claims/actions"
import { ClaimEditor } from "./claim-editor"
import { Notice, StatusBadge, UnverifiedTag, useBi } from "./shared"

interface ClaimEvent { id: number; actor_id: string | null; action: string; from_status: string | null; to_status: string | null; changes: Record<string, unknown>; comment: string | null; source: string; created_at: string }

const EVENT_LABELS: Record<string, { en: string; ar: string }> = {
  created: { en: "Created", ar: "إنشاء" }, edited: { en: "Edited", ar: "تعديل" }, attachment_added: { en: "Attachment added", ar: "إضافة مرفق" },
  submitted: { en: "Submitted", ar: "تقديم" }, needs_info: { en: "More information requested", ar: "طلب معلومات إضافية" }, approved: { en: "Approved", ar: "اعتماد" },
  rejected: { en: "Rejected", ar: "رفض" }, exported: { en: "Exported", ar: "تصدير" }, reimbursed: { en: "Reimbursed", ar: "سداد" },
  duplicate_resolved: { en: "Duplicate check resolved", ar: "حسم فحص التكرار" }, deleted: { en: "Deleted", ar: "حذف" }, checklist_saved: { en: "Review checklist saved", ar: "حفظ قائمة المراجعة" },
}

export function ClaimDetail({ id }: { id: string }) {
  const { L, t, ar } = useBi()
  const router = useRouter()
  const [claim, setClaim] = useState<ExpenseClaim | null>(null)
  const [missing, setMissing] = useState(false)
  const [atts, setAtts] = useState<ClaimAttachment[]>([])
  const [events, setEvents] = useState<ClaimEvent[]>([])
  const [dupes, setDupes] = useState<Array<Pick<ExpenseClaim, "id" | "claim_no" | "status" | "supplier_name" | "total_amount" | "currency" | "expense_date">>>([])
  const [access, setAccess] = useState<ExpenseAccess | null>(null)
  const [settings, setSettings] = useState<ClaimSettings | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [comment, setComment] = useState("")
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [checklist, setChecklist] = useState<Record<string, "yes" | "no" | "na">>({})

  const load = useCallback(async () => {
    const supabase = createClient()
    const [c, a, e] = await Promise.all([
      supabase.from("expense_claims").select("*").eq("id", id).maybeSingle(),
      supabase.from("expense_claim_attachments").select("id,claim_id,original_filename,mime_type,size_bytes,sha256,doc_kind,source,uploaded_at").eq("claim_id", id).order("uploaded_at"),
      supabase.from("expense_claim_events").select("id,actor_id,action,from_status,to_status,changes,comment,source,created_at").eq("claim_id", id).order("created_at", { ascending: false }).limit(200),
    ])
    if (!c.data) { setMissing(true); return }
    const cl = c.data as ExpenseClaim
    setClaim(cl); setAtts((a.data ?? []) as ClaimAttachment[]); setEvents((e.data ?? []) as ClaimEvent[])
    setChecklist((cl.review_checklist ?? {}) as Record<string, "yes" | "no" | "na">)
    if (cl.duplicate_of?.length) {
      const d = await supabase.from("expense_claims").select("id,claim_no,status,supplier_name,total_amount,currency,expense_date").in("id", cl.duplicate_of)
      setDupes((d.data ?? []) as typeof dupes)
    } else setDupes([])
  }, [id])

  useEffect(() => {
    void Promise.resolve().then(load)
    void getExpenseAccess().then(setAccess)
    void getClaimSettings().then(setSettings)
    void getTenantUserNames().then(setNames)
  }, [load])

  if (missing) return <div className="space-y-3 p-6"><p>{t("This claim was not found or you do not have access.", "المطالبة غير موجودة أو ليس لديك صلاحية الوصول.")}</p><Button asChild variant="outline"><Link href="/expenses/claims">{t("Back to claims", "العودة للمطالبات")}</Link></Button></div>
  if (!claim || !access || !settings) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…", "جارٍ التحميل…")}</div>

  const mine = claim.submitter_id === access.userId
  const reviewer = access.approve
  const selfBlocked = mine && !settings.allow_self_approval
  const canEditOwn = mine && access.create && (claim.status === "draft" || claim.status === "needs_info")
  const canEditAsReviewer = reviewer && claim.status === "submitted" && !selfBlocked
  const canReview = reviewer && (claim.status === "submitted" || claim.status === "needs_info") && !selfBlocked
  const name = (uid: string | null) => (uid ? names[uid] ?? "—" : "—")
  const amt = (v: number | string | null) => formatMoney(num(v), claim.currency, settings.amount_locale)

  async function act(action: TransitionAction) {
    if ((action === "reject" || action === "request_info") && !comment.trim()) { toast.error(t("Add a comment for the submitter.", "أضف تعليقاً لمقدم الطلب.")); return }
    setBusy(action)
    const r = await transitionExpenseClaim(claim!.id, action, { comment: comment.trim() || undefined, expectedVersion: claim!.version, reference: reference.trim() || undefined })
    setBusy(null)
    if (!r.ok) { toast.error(t(r.error, r.errorAr)); return }
    toast.success(L(STATUS_LABELS[r.status as ClaimStatus] ?? { en: r.status, ar: r.status }))
    setComment(""); setReference(""); void load()
  }

  async function resolve(resolution: "not_duplicate" | "duplicate") {
    if (!comment.trim()) { toast.error(t("Add a short comment explaining the decision.", "أضف تعليقاً قصيراً يوضح القرار.")); return }
    setBusy(resolution)
    const r = await resolveClaimDuplicate(claim!.id, resolution, comment.trim())
    setBusy(null)
    if (!r.ok) { toast.error(t(r.error, r.errorAr)); return }
    setComment(""); void load()
  }

  async function download(a: ClaimAttachment) {
    setBusy(a.id)
    const r = await getAttachmentDownloadUrl(a.id)
    setBusy(null)
    if (!r.ok) { toast.error(t(r.error, r.errorAr)); return }
    window.location.assign(r.url)
  }

  async function remove() {
    if (!window.confirm(t("Delete this draft?", "حذف هذه المسودة؟"))) return
    const r = await deleteDraftClaim(claim!.id)
    if (!r.ok) { toast.error(t(r.error, r.errorAr)); return }
    router.push("/expenses/claims")
  }

  async function saveChecklist() {
    setBusy("checklist")
    const r = await saveClaimChecklist(claim!.id, checklist)
    setBusy(null)
    if (!r.ok) toast.error(t(r.error, r.errorAr)); else { toast.success(t("Checklist saved.", "تم حفظ القائمة.")); void load() }
  }

  if (editing) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <h1 className="text-lg font-semibold">{t("Edit claim", "تعديل المطالبة")} {claim.claim_no}</h1>
        <ClaimEditor claim={claim} settings={settings} tenantId={access.tenantId} existingAttachments={atts.length} onDone={() => { setEditing(false); void load() }} />
      </div>
    )
  }

  const rows: Array<[EditableField, string]> = [
    ["expense_date", claim.expense_date ?? "—"], ["supplier_name", claim.supplier_name ?? "—"], ["supplier_vat_number", claim.supplier_vat_number ?? "—"],
    ["receipt_number", claim.receipt_number ?? "—"], ["category", claim.category ? L(categoryLabel(claim.category)) : "—"],
    ["payment_method", claim.payment_method ? L(PAYMENT_LABELS[claim.payment_method]) : "—"], ["amount_before_vat", amt(claim.amount_before_vat)],
    ["vat_rate", num(claim.vat_rate) !== null ? `${num(claim.vat_rate)}%` : "—"], ["vat_amount", amt(claim.vat_amount)], ["total_amount", amt(claim.total_amount)],
    ["department", claim.department ?? "—"], ["project", claim.project ?? "—"], ["cost_center", claim.cost_center ?? "—"], ["customer", claim.customer ?? "—"],
    ["business_purpose", claim.business_purpose ?? "—"], ["notes", claim.notes ?? "—"],
  ]
  const enabledChecklist = settings.checklist.filter((i) => i.enabled)

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link href="/expenses/claims"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Claims", "المطالبات")}</Link></Button>
        <h1 className="text-xl font-semibold">{claim.claim_no}</h1>
        <StatusBadge status={claim.status} />
        <span className="text-xs text-muted-foreground">{claim.source === "telegram" ? t("via Telegram", "عبر تيليجرام") : t("via web / mobile", "عبر الويب / الجوال")}</span>
        <div className="ms-auto flex flex-wrap gap-2">
          {(canEditOwn || canEditAsReviewer) && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" />{t("Edit", "تعديل")}</Button>}
          {canEditOwn && <Button size="sm" disabled={busy !== null} onClick={() => act("submit")}>{busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{t("Submit", "تقديم")}</Button>}
          {mine && claim.status === "draft" && <Button size="sm" variant="ghost" className="text-red-600" onClick={remove}><Trash2 className="size-4" />{t("Delete draft", "حذف المسودة")}</Button>}
        </div>
      </div>

      {claim.duplicate_status === "possible" && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200"><Copy className="size-4" />{t("Possible duplicate", "تكرار محتمل")}</div>
          <ul className="mt-1 list-disc ps-5 text-xs">{claim.duplicate_reasons.map((r) => <li key={r}>{DUPLICATE_REASON_LABELS[r] ? L(DUPLICATE_REASON_LABELS[r]) : r}</li>)}</ul>
          {dupes.length > 0 && <div className="mt-2 flex flex-wrap gap-2 text-xs">{dupes.map((d) => <Link key={d.id} href={`/expenses/claims/${d.id}`} className="rounded border bg-background px-2 py-1 hover:underline">{d.claim_no} · {d.supplier_name ?? "—"} · {formatMoney(num(d.total_amount), d.currency)} · {L(STATUS_LABELS[d.status])}</Link>)}</div>}
          {reviewer && !selfBlocked ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => resolve("not_duplicate")}>{t("Not a duplicate", "ليست مكررة")}</Button>
              <Button size="sm" variant="outline" className="text-red-600" disabled={busy !== null} onClick={() => resolve("duplicate")}>{t("Mark as duplicate", "تعليم كمكررة")}</Button>
              <span className="self-center text-xs text-muted-foreground">{t("Uses the comment box below.", "يستخدم مربع التعليق أدناه.")}</span>
            </div>
          ) : <p className="mt-2 text-xs">{t("A reviewer must resolve this before the claim can be approved.", "يجب أن يحسم المراجع ذلك قبل اعتماد المطالبة.")}</p>}
        </div>
      )}
      {claim.duplicate_status === "duplicate" && <Notice tone="warn">{t("A reviewer marked this claim as a duplicate.", "علّم المراجع هذه المطالبة كمكررة.")}</Notice>}
      {claim.unverified_fields.length > 0 && (
        <Notice tone="warn">{t("Some details were suggested automatically (on-device OCR or Telegram caption) and are unverified until a reviewer approves the claim: ", "بعض البيانات اقتُرحت تلقائياً (قراءة على الجهاز أو وصف تيليجرام) وهي غير متحقق منها حتى يعتمد المراجع المطالبة: ")}
          {claim.unverified_fields.map((f) => (FIELD_LABELS as Record<string, { en: string; ar: string }>)[f] ? L((FIELD_LABELS as Record<string, { en: string; ar: string }>)[f]) : f).join(ar ? "، " : ", ")}</Notice>
      )}
      {claim.status === "needs_info" && claim.reviewer_comment && <Notice tone="warn"><MessageSquareWarning className="me-1 inline size-4" />{t("Reviewer asked for more information: ", "طلب المراجع معلومات إضافية: ")}{claim.reviewer_comment}</Notice>}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="space-y-3 rounded-xl border p-4 lg:col-span-2">
          <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><div className="text-xs text-muted-foreground">{L(FIELD_LABELS.submitter)}</div><div>{name(claim.submitter_id)}</div></div>
            <div><div className="text-xs text-muted-foreground">{L(FIELD_LABELS.submitted_at)}</div><div>{riyadhTimestamp(claim.submitted_at) || "—"}</div></div>
            {rows.map(([k, v]) => (
              <div key={k} className={k === "business_purpose" || k === "notes" ? "sm:col-span-2" : undefined}>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{L(FIELD_LABELS[k])}{claim.unverified_fields.includes(k) && <UnverifiedTag />}</div>
                <div className="whitespace-pre-wrap break-words">{v}</div>
              </div>
            ))}
          </div>
          {amountsMismatch(claim) && <p className="text-xs text-amber-700 dark:text-amber-300">{t("Amount before VAT + VAT does not equal the total.", "المبلغ قبل الضريبة + الضريبة لا يساوي الإجمالي.")}</p>}
          <div className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-3">
            <div><div className="text-xs text-muted-foreground">{L(FIELD_LABELS.verification)}</div><div>{claim.verified_at ? `${t("Reviewed by", "راجعه")} ${name(claim.verified_by)} · ${riyadhTimestamp(claim.verified_at)}` : t("Unverified", "غير متحقق منه")}</div></div>
            <div><div className="text-xs text-muted-foreground">{L(FIELD_LABELS.reviewer)}</div><div>{claim.reviewer_id ? `${name(claim.reviewer_id)} · ${riyadhTimestamp(claim.reviewed_at)}` : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">{L(FIELD_LABELS.reviewer_comment)}</div><div className="whitespace-pre-wrap">{claim.reviewer_comment ?? "—"}</div></div>
            {claim.exported_at && <div><div className="text-xs text-muted-foreground">{L(FIELD_LABELS.exported_at)}</div><div>{riyadhTimestamp(claim.exported_at)}</div></div>}
            {claim.reimbursed_at && <div><div className="text-xs text-muted-foreground">{L(FIELD_LABELS.reimbursed_at)}</div><div>{riyadhTimestamp(claim.reimbursed_at)}{claim.reimbursement_ref ? ` · ${claim.reimbursement_ref}` : ""}</div></div>}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">{L(FIELD_LABELS.attachments)} ({atts.length})</h2>
          {atts.length === 0 ? <Notice tone="warn">{t("No supporting document attached.", "لا يوجد مستند داعم مرفق.")}</Notice> : (
            <ul className="space-y-2">
              {atts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-lg border p-2 text-xs">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium" title={a.original_filename}>{a.original_filename}</div><div className="text-muted-foreground">{L(DOC_KIND_LABELS[a.doc_kind])} · {Math.max(1, Math.round(a.size_bytes / 1024))} KB</div></div>
                  <Button size="icon" variant="ghost" className="size-8" aria-label={t("Download original", "تنزيل الأصل")} disabled={busy === a.id} onClick={() => download(a)}>{busy === a.id ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">{L(SUPPORTING_DOC_NOTICE)}</p>
        </section>
      </div>

      {(canReview || (reviewer && (claim.status === "approved" || claim.status === "exported"))) && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">{t("Review", "المراجعة")}</h2>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={2} placeholder={t("Comment to the submitter (required to reject, request info or resolve duplicates)", "تعليق لمقدم الطلب (مطلوب للرفض أو طلب المعلومات أو حسم التكرار)")} />
          <div className="flex flex-wrap gap-2">
            {canReview && claim.status === "submitted" && <Button size="sm" disabled={busy !== null || claim.duplicate_status === "possible" || claim.duplicate_status === "duplicate"} onClick={() => act("approve")}>{busy === "approve" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t("Approve", "اعتماد")}</Button>}
            {canReview && claim.status === "submitted" && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("request_info")}><MessageSquareWarning className="size-4" />{t("Request info", "طلب معلومات")}</Button>}
            {canReview && <Button size="sm" variant="outline" className="text-red-600" disabled={busy !== null} onClick={() => act("reject")}><X className="size-4" />{t("Reject", "رفض")}</Button>}
            {reviewer && (claim.status === "approved" || claim.status === "exported") && (
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-8 w-48" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder={t("Payment reference (optional)", "مرجع الدفع (اختياري)")} />
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("reimburse")}><Banknote className="size-4" />{t("Mark reimbursed", "تعليم كمُسدَّدة")}</Button>
              </div>
            )}
          </div>
          {claim.status === "submitted" && atts.length === 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{t("No supporting document is attached to this claim.", "لا يوجد مستند داعم مرفق بهذه المطالبة.")}</p>}
        </section>
      )}
      {reviewer && selfBlocked && (claim.status === "submitted" || claim.status === "needs_info") && <Notice><ShieldAlert className="me-1 inline size-4" />{t("You submitted this claim, so another reviewer must review it (self-approval is disabled in settings).", "أنت مقدم هذه المطالبة، لذا يجب أن يراجعها مراجع آخر (الاعتماد الذاتي معطل في الإعدادات).")}</Notice>}

      {reviewer && enabledChecklist.length > 0 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">{t("Reviewer checklist", "قائمة تحقق المراجع")}</h2>
          <Notice tone={settings.checklist_confirmed_at ? "info" : "warn"}>
            {L(CHECKLIST_NOTICE)}{" "}
            {settings.checklist_confirmed_at
              ? t(`Rules confirmed on ${riyadhTimestamp(settings.checklist_confirmed_at)}${settings.checklist_confirmation_note ? ` — ${settings.checklist_confirmation_note}` : ""}.`, `تم تأكيد القواعد في ${riyadhTimestamp(settings.checklist_confirmed_at)}${settings.checklist_confirmation_note ? ` — ${settings.checklist_confirmation_note}` : ""}.`)
              : t("These rules have NOT been confirmed by an administrator or tax professional yet.", "لم يؤكد المسؤول أو مختص ضريبي هذه القواعد بعد.")}
          </Notice>
          <ul className="divide-y rounded-lg border">
            {enabledChecklist.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                <span>{ar ? i.ar || i.en : i.en || i.ar}</span>
                <div className="flex gap-1">
                  {(["yes", "no", "na"] as const).map((v) => (
                    <button key={v} type="button" disabled={!canReview && claim.status !== "approved"} onClick={() => setChecklist((c) => ({ ...c, [i.key]: v }))}
                      className={`rounded border px-2 py-0.5 text-xs ${checklist[i.key] === v ? (v === "yes" ? "border-emerald-500 bg-emerald-500/15" : v === "no" ? "border-red-500 bg-red-500/15" : "border-foreground/40 bg-muted") : "opacity-70"}`}>
                      {v === "yes" ? t("Yes", "نعم") : v === "no" ? t("No", "لا") : t("N/A", "لا ينطبق")}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" disabled={busy !== null || selfBlocked} onClick={saveChecklist}>{busy === "checklist" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t("Save checklist", "حفظ القائمة")}</Button>
        </section>
      )}

      <section className="space-y-2 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">{t("Audit trail", "سجل التدقيق")}</h2>
        <ol className="space-y-2 text-xs">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{L(EVENT_LABELS[e.action] ?? { en: e.action, ar: e.action })}</span>
                {e.from_status && e.to_status && e.from_status !== e.to_status && <span className="text-muted-foreground">{L(STATUS_LABELS[e.from_status as ClaimStatus] ?? { en: e.from_status, ar: e.from_status })} → {L(STATUS_LABELS[e.to_status as ClaimStatus] ?? { en: e.to_status, ar: e.to_status })}</span>}
                <span className="text-muted-foreground">· {name(e.actor_id)} · {riyadhTimestamp(e.created_at)}{e.source === "telegram" ? " · Telegram" : ""}</span>
              </div>
              {e.comment && <div className="mt-1 whitespace-pre-wrap">{e.comment}</div>}
              {e.action === "edited" && <div className="mt-1 text-muted-foreground">{Object.entries(e.changes).map(([k, v]) => { const c = v as { from: unknown; to: unknown }; const lb = (FIELD_LABELS as Record<string, { en: string; ar: string }>)[k]; return `${lb ? L(lb) : k}: ${c?.from ?? "—"} → ${c?.to ?? "—"}` }).join(" · ")}</div>}
              {e.action === "attachment_added" && <div className="mt-1 text-muted-foreground">{String(e.changes.file ?? "")}</div>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
