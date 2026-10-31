"use client"

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { expensesQuery, expensesSummary, expenseDependencies, type ExpenseRow } from "@/lib/expenses/overview-queries"
import { useTablePage } from "@/hooks/use-table-page"
import { useReadSummary } from "@/hooks/use-read-summary"
import { useTranslation } from "@/hooks/use-translation"
import { correctPendingExpense } from "@/lib/expenses/correction-actions"
import { round2 } from "@/lib/accounting/invoice-math"
import { calculateVat, sumMoney } from "@/lib/accounting/decimal"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import {
  approveExpense,
  createExpense,
} from "@/lib/expenses/actions"
import {
  EXPENSE_TYPES,
  type ExpenseType,
  type ExpenseVatRecoverability,
} from "@/lib/expenses/constants"
import {
  Wallet, Clock, DollarSign, CheckCircle2, BadgeCheck, Loader2, AlertTriangle, ReceiptText, Plus, Save, X, Pencil, Ban,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const TYPE_META: Record<string, { ar: string; en: string; className: string }> = {
  fuel: { ar: "وقود", en: "Fuel", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  advance: { ar: "سلفة", en: "Advance", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  operational: { ar: "تشغيلي", en: "Operational", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  platform_commission: { ar: "عمولة", en: "Commission", className: "bg-teal-500/15 text-teal-600 border-teal-500/20" },
  maintenance: { ar: "صيانة", en: "Maintenance", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  other: { ar: "أخرى", en: "Other", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

const RECOVER_META: Record<string, { ar: string; en: string; className: string }> = {
  recoverable: { ar: "قابل للاسترداد", en: "Recoverable", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  non_recoverable: { ar: "غير قابل للاسترداد", en: "Non-recoverable", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  pending_review: { ar: "قيد المراجعة", en: "Pending review", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
}

function fmtDate(date: string): string {
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ExpensesPage() {
  const { t, locale } = useTranslation()
  const ui = useUiText()
  const buildQuery = useCallback((term: string) => expensesQuery(createClient(), term), [])
  const { rows, loading, error, search, setSearch, pagination, reload } = useTablePage<ExpenseRow>(buildQuery)
  const readSummary = useCallback((signal: AbortSignal) => expensesSummary(createClient(), signal), [])
  const summary = useReadSummary(readSummary)
  const reloadSummary = summary.reload
  const [dependencyState, setDependencyState] = useState({ loading: true, error: false })
  const [dependencyRevision, setDependencyRevision] = useState(0)
  const [feedback, setFeedback] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null)

  // Category → CoA mapping preview (expense_type → account_code → name)
  const [coaNames, setCoaNames] = useState<Record<string, string>>({})
  const [mappingByType, setMappingByType] = useState<Record<string, string>>({})
  const [mappingRecoverability, setMappingRecoverability] = useState<Record<string, ExpenseVatRecoverability>>({})

  const [approveTarget, setApproveTarget] = useState<ExpenseRow | null>(null)
  const [approveVatRate, setApproveVatRate] = useState("15")
  const [approveRecoverability, setApproveRecoverability] = useState<ExpenseVatRecoverability>("recoverable")
  const [isApproving, setIsApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const [authActor, setAuthActor] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<ExpenseRow | null>(null)
  const [changeReason, setChangeReason] = useState("")
  const [cancelTarget, setCancelTarget] = useState<ExpenseRow | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelRequestId, setCancelRequestId] = useState("")
  const [cancelError, setCancelError] = useState("")
  const [isCancelling, setIsCancelling] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createRequestId, setCreateRequestId] = useState("")
  const [formType, setFormType] = useState<ExpenseType>("fuel")
  const [formCategory, setFormCategory] = useState("")
  const [formAmount, setFormAmount] = useState("")
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [formVendor, setFormVendor] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formVatRate, setFormVatRate] = useState("15")
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void createClient().auth.getUser().then(({data}) => { if(active) setAuthActor(data.user?.id ?? null) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const result = await expenseDependencies(createClient(), controller.signal)
        if (controller.signal.aborted) return
        setMappingByType(result.byType); setCoaNames(result.names); setMappingRecoverability(result.recoverabilityByType)
        setDependencyState({ loading: false, error: false })
      } catch {
        if (!controller.signal.aborted) {
          setMappingByType({}); setCoaNames({}); setMappingRecoverability({})
          setDependencyState({ loading: false, error: true })
        }
      }
    })()
    return () => controller.abort()
  }, [dependencyRevision])

  const load = useCallback(async () => {
    reload(); reloadSummary()
    setDependencyState({ loading: true, error: false })
    setDependencyRevision(value => value + 1)
  }, [reload, reloadSummary])

  const flash = (type: "ok" | "err" | "info", text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 6000)
  }

  const kpiCards: KpiCardData[] = [
    { label: t.nav.expenses, value: summary.value?.count ?? "—", icon: Wallet, color: "#1E5A99" },
    { label: t.common.pending, value: summary.value?.pending ?? "—", icon: Clock, color: "#F59E0B" },
    { label: locale === "ar" ? "صافي المبالغ المسجلة (ر.س)" : "Recorded net (SAR)", value: summary.value ? fmtMoney(summary.value.net) : "—", icon: DollarSign, color: "#EF4444" },
    { label: locale === "ar" ? "الضريبة المسجلة (ر.س)" : "Recorded VAT (SAR)", value: summary.value ? fmtMoney(summary.value.vat) : "—", icon: ReceiptText, color: "#10B981" },
  ]

  const columns: TableColumn<ExpenseRow>[] = [
    { key: "expense_code", header: "Code", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.expense_code ?? "—"}</span> },
    {
      key: "expense_type", header: "Type",
      render: (r) => {
        const m = TYPE_META[r.expense_type] ?? TYPE_META.other
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>{locale === "ar" ? m.ar : m.en}</span>
      },
    },
    { key: "amount", header: "Net", render: (r) => <span dir="ltr" className="tabular-nums font-medium">{fmtMoney(r.amount)} {r.currency === "SAR" ? <LocalizedText text="SAR" /> : r.currency}</span> },
    {
      key: "vat_amount", header: "VAT",
      render: (r) => (
        <span dir="ltr" className="tabular-nums text-xs text-muted-foreground">
          {r.is_approved ? `${fmtMoney(r.vat_amount)} (${Number(r.vat_rate)}%)` : "—"}
        </span>
      ),
    },
    { key: "expense_date", header: "Date", render: (r) => <span dir="ltr">{fmtDate(r.expense_date)}</span> },
    { key: "driver", header: t.nav.drivers, render: (r) => <span>{r.driver?.full_name_ar ?? "—"}</span> },
    { key: "vendor", header: "Vendor", render: (r) => <span className="text-muted-foreground">{r.vendor ?? "—"}</span> },
    {
      key: "vat_recoverability", header: "VAT class",
      render: (r) => {
        const m = RECOVER_META[r.vat_recoverability] ?? RECOVER_META.pending_review
        return r.is_approved
          ? <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${m.className}`}>{locale === "ar" ? m.ar : m.en}</span>
          : <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      key: "is_approved", header: t.common.status,
      render: (r) => r.cancelled_at
        ? <div className="space-y-1"><span className="text-xs font-medium text-muted-foreground">{locale === "ar" ? "ملغى" : "Cancelled"}</span><details className="max-w-52 text-xs"><summary className="cursor-pointer underline underline-offset-2">{locale === "ar" ? "سبب الإلغاء" : "Cancellation reason"}</summary><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{r.cancellation_reason}</p></details></div>
        : r.is_approved
        ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600"><BadgeCheck className="h-3 w-3" />{t.common.approved}</span>
        : r.rejected_at
          ? <div className="space-y-1">
              <span className="inline-flex items-center rounded-full border border-red-700/20 bg-red-700/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400">{locale === "ar" ? "مرفوض" : "Rejected"}</span>
              <details className="max-w-52 text-xs">
                <summary className="cursor-pointer font-medium text-foreground/80 underline underline-offset-2">{locale === "ar" ? "سبب الرفض" : "Rejection reason"}</summary>
                <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{r.rejection_reason ?? (locale === "ar" ? "تعذر تحميل سبب الرفض." : "Rejection reason unavailable.")}</p>
              </details>
            </div>
          : <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">{t.common.pending}</span>,
    },
  ]

  const openCreate = () => {
    if (isSaving) return
    setEditTarget(null)
    setChangeReason("")
    setCreateRequestId(crypto.randomUUID())
    setFormType("fuel")
    setFormCategory("")
    setFormAmount("")
    setFormDate(new Date().toISOString().slice(0, 10))
    setFormVendor("")
    setFormDescription("")
    setFormVatRate("15")
    setFormError(null)
    setCreateOpen(true)
  }

  function openEdit(row: ExpenseRow) {
    setEditTarget(row); setCreateRequestId(crypto.randomUUID()); setChangeReason(""); setFormError(null)
    setFormType(row.expense_type as ExpenseType); setFormCategory(row.category ?? ""); setFormAmount(String(row.amount)); setFormDate(row.expense_date)
    setFormVendor(row.vendor ?? ""); setFormDescription(row.description ?? ""); setFormVatRate(String(row.vat_rate)); setCreateOpen(true)
  }
  async function handleCancel() {
    if(!cancelTarget || isCancelling) return
    setIsCancelling(true); setCancelError("")
    try {
      const result = await correctPendingExpense({id:cancelTarget.id,expectedVersion:cancelTarget.correction_version,requestId:cancelRequestId,operation:"cancel",reason:cancelReason})
      if(result.success) { setCancelTarget(null); flash("ok",locale === "ar" ? "أُلغي المصروف المعلق وحُفظ سجله ومرفقاته." : "Pending expense cancelled; history and attachments retained."); await load() }
      else setCancelError((locale === "ar" ? result.errorAr : result.error) ?? t.auth.genericError)
    } catch { setCancelError(locale === "ar" ? "تعذر تأكيد الإلغاء. أعد المحاولة بالتفاصيل نفسها." : "Unable to confirm cancellation. Retry with unchanged details.") }
    finally { setIsCancelling(false) }
  }

  async function handleCreate() {
    if (isSaving) return
    setIsSaving(true)
    setFormError(null)
    try {
      const details = { expense_type:formType,category:formCategory || undefined,amount:Number(formAmount || 0),expense_date:formDate,vendor:formVendor || null,description:formDescription || null,vat_rate:Number(formVatRate || 0) }
      const res = editTarget
        ? await correctPendingExpense({id:editTarget.id,expectedVersion:editTarget.correction_version,requestId:createRequestId,operation:"update",reason:changeReason,details})
        : await createExpense({request_id:createRequestId,...details})
      if (res.success) {
        flash(res.replayed ? "info" : "ok", editTarget ? (locale === "ar" ? "تم حفظ تصحيح المصروف المعلق." : "Pending expense correction saved.") : res.replayed
          ? locale === "ar" ? "حُفظ هذا المصروف مسبقاً. راجع حالته الحالية." : "This expense was already saved. Review its current status."
          : locale === "ar" ? "تم إنشاء المصروف (قيد الاعتماد)." : "Expense created (pending).")
        setCreateOpen(false)
        await load()
      } else {
        setFormError((locale === "ar" ? res.errorAr ?? res.error : res.error) ?? (locale === "ar" ? "تعذر الحفظ." : "Save failed."))
      }
    } catch {
      setFormError(locale === "ar" ? "تعذر تأكيد حفظ المصروف. أعد المحاولة بالتفاصيل نفسها." : "Unable to confirm this expense. Retry with unchanged details.")
    } finally { setIsSaving(false) }
  }

  async function handleApprove() {
    if (!approveTarget || isApproving) return
    setIsApproving(true)
    setApproveError(null)
    try {
      const res = await approveExpense({
        id: approveTarget.id,
        expectedVersion: approveTarget.correction_version,
        vat_rate: Number(approveVatRate),
        vat_recoverability: approveRecoverability,
      })
      if (res.success || res.alreadyApproved || res.alreadyDecided) {
        if (res.alreadyDecided) flash("info", (locale === "ar" ? res.errorAr : res.error) ?? (locale === "ar" ? "تم البت في المصروف. راجع القرار بعد تحديث القائمة." : "Expense already decided. Review the refreshed decision."))
        else if (res.alreadyApproved) flash("info", locale === "ar" ? "تم اعتماد المصروف مسبقاً. راجع بياناته بعد تحديث القائمة." : "This expense is already approved. Review the refreshed record.")
        else if (res.postingPending) flash("info", locale === "ar" ? "تم اعتماد المصروف وإنشاء الذمة الدائنة. الترحيل المحاسبي قيد المراجعة؛ راجع أحداث المحاسبة." : "Expense approved; payable created. Accounting posting needs review in Accounting events.")
        else flash("ok", locale === "ar" ? "تم اعتماد المصروف وإنشاء الذمة الدائنة ومعالجة الحدث المحاسبي." : "Expense approved; payable created and accounting event processed.")
        setApproveTarget(null)
        await load()
      } else setApproveError((locale === "ar" ? res.errorAr ?? res.error : res.error) ?? t.auth.genericError)
    } catch {
      setApproveError(locale === "ar" ? "تعذر تأكيد اعتماد المصروف. أعد تحميله وراجعه قبل المحاولة مجدداً." : "Unable to confirm expense approval. Reload and review before retrying.")
    } finally { setIsApproving(false) }
  }

  const previewCode = approveTarget ? mappingByType[approveTarget.expense_type] : null
  const approvalRate = Number(approveVatRate)
  const validApprovalRate = approveVatRate.trim() !== "" && Number.isFinite(approvalRate) && approvalRate >= 0 && approvalRate <= 100
  const approvalVat = approveTarget && validApprovalRate ? calculateVat(Number(approveTarget.amount), round2(approvalRate)) : null
  const approvalTotal = approveTarget && approvalVat !== null ? sumMoney(Number(approveTarget.amount), approvalVat) : null

  return (
    <div className="px-4 lg:px-6 py-4">
      {feedback && (
        <div className={`mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
          feedback.type === "ok"
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
            : feedback.type === "info" ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-red-500/20 bg-red-500/10 text-red-500"
        }`}>
          {feedback.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {ui(feedback.text)}
        </div>
      )}

      <EnterpriseModulePage
        title={t.nav.expenses}
        subtitle={locale === "ar" ? "تسجيل واعتماد المصروفات. الملخص لجميع المصروفات ولا يتغير مع البحث." : "Record and approve expenses. Summary covers all expenses, independently of search."}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel="مصروف جديد / New expense"
        onPrimaryCta={openCreate}
        primaryCtaIcon={Plus}
        columns={columns}
        data={rows}
        isLoading={loading || dependencyState.loading}
        pagination={pagination}
        loadError={error || summary.error || dependencyState.error ? (locale === "ar" ? "تعذر تحميل المصروفات أو ملخصها أو حساباتها. أعد المحاولة." : "Could not load expenses, their totals or account mappings. Try again.") : undefined}
        onRetry={() => { void load() }}
        emptyStateMessage={t.common.noData}
        rowActions={(r) =>
          r.is_approved || r.rejected_at || r.cancelled_at ? null : (
            <div className="flex flex-wrap items-center gap-1">
              {authActor && r.created_by === authActor && <><button onClick={() => openEdit(r)} className="inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-xs font-medium hover:bg-muted"><Pencil className="h-3 w-3" />{locale === "ar" ? "تعديل المصروف" : "Edit expense"}</button><button onClick={() => { setCancelTarget(r);setCancelReason("");setCancelRequestId(crypto.randomUUID());setCancelError("") }} className="inline-flex h-7 items-center gap-1 rounded-lg border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/5"><Ban className="h-3 w-3" />{locale === "ar" ? "إلغاء المصروف" : "Cancel expense"}</button></>}
              <button
                onClick={() => { setApproveTarget(r); setApproveError(null); setApproveVatRate(String(r.vat_rate)); setApproveRecoverability(mappingRecoverability[r.expense_type] ?? "pending_review") }}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20"
              >
                <BadgeCheck className="h-3 w-3" />
                {locale === "ar" ? "اعتماد المصروف" : "Approve expense"}
              </button>
            </div>
          )
        }
      />

      {/* ── New expense dialog ────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!isSaving && !o) setCreateOpen(false) }}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? (locale === "ar" ? "تعديل المصروف المعلق" : "Edit pending expense") : <LocalizedText text="New expense" />}</DialogTitle>
            <DialogDescription>
              {editTarget ? (locale === "ar" ? "يمكن تصحيح بيانات المصروف قبل البت فيه. تبقى المرفقات والروابط الحالية محفوظة." : "Correct the expense before its final decision. Existing attachments and linked records are retained.") : <LocalizedText text="Created pending with an automatic code; approval captures VAT" />}
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={isSaving} className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-type"><LocalizedText text="Type" /></Label>
                <select
                  id="exp-type"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as ExpenseType)}
                  className="h-10 w-full rounded-xl border border-input bg-background shadow-xs px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {EXPENSE_TYPES.map((tp) => (
                    <option key={tp} value={tp}>{locale === "ar" ? (TYPE_META[tp] ?? TYPE_META.other).ar : (TYPE_META[tp] ?? TYPE_META.other).en}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-category"><LocalizedText text="Category" /></Label>
                <Input id="exp-category" maxLength={200} value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="h-10" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="exp-amount"><LocalizedText text="Net amount" /></Label>
                <Input id="exp-amount" type="number" dir="ltr" min="0.01" max="99999999.99" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="h-10 text-end tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-date"><LocalizedText text="Date" /></Label>
                <Input id="exp-date" type="date" dir="ltr" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="h-10" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-vat"><LocalizedText text="VAT %" /></Label>
                <Input id="exp-vat" type="number" dir="ltr" min="0" max="100" step="0.01" value={formVatRate} onChange={(e) => setFormVatRate(e.target.value)} className="h-10 text-end tabular-nums" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-vendor"><LocalizedText text="Vendor" /></Label>
                <Input id="exp-vendor" maxLength={200} value={formVendor} onChange={(e) => setFormVendor(e.target.value)} className="h-10" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-desc"><LocalizedText text="Description" /></Label>
                <Input id="exp-desc" maxLength={2000} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="h-10" />
              </div>
            </div>

            {formType && (
              <p className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {mappingByType[formType]
                  ? <><LocalizedText text="Will post to account" /> <b dir="ltr">{mappingByType[formType]}</b> — {coaNames[mappingByType[formType]] ?? ""}</>
                  : ui("لا يوجد ربط لهذه الفئة بعد / No CoA mapping for this category yet")}
              </p>
            )}

            {editTarget && <div className="space-y-1.5"><Label htmlFor="exp-change-reason">{locale === "ar" ? "سبب التعديل" : "Change reason"}</Label><Input id="exp-change-reason" value={changeReason} onChange={e=>setChangeReason(e.target.value)} minLength={5} maxLength={500} /></div>}
            {formError && <p role="alert" className="text-xs text-red-500">{ui(formError)}</p>}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleCreate()}
                disabled={isSaving || Number(formAmount || 0) <= 0 || !formDate || (!!editTarget && changeReason.trim().length < 5)}
                className="bg-elite-blue-600 hover:bg-elite-blue-700"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<LocalizedText text="Save expense" /></Button>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                <X className="h-4 w-4" /><LocalizedText text="Cancel" /></Button>
            </div>
          </fieldset>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelTarget} onOpenChange={open => { if(!open && !isCancelling) setCancelTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl"><DialogHeader><DialogTitle>{locale === "ar" ? "إلغاء المصروف المعلق" : "Cancel pending expense"}</DialogTitle><DialogDescription>{locale === "ar" ? "يُحفظ سجل المصروف ومرفقاته ولا يُنشأ قيد محاسبي أو ذمة دائنة. أدخل سبب الإلغاء." : "The expense history and attachments remain available. No accounting entry or payable is created. Enter the cancellation reason."}</DialogDescription></DialogHeader>
          <fieldset disabled={isCancelling} className="min-w-0 space-y-4"><div className="space-y-1.5"><Label htmlFor="exp-cancel-reason">{locale === "ar" ? "سبب الإلغاء" : "Cancellation reason"}</Label><Input id="exp-cancel-reason" value={cancelReason} onChange={e=>setCancelReason(e.target.value)} minLength={5} maxLength={500} /></div>{cancelError && <p role="alert" className="text-sm text-destructive">{cancelError}</p>}<div className="flex flex-wrap gap-2"><Button variant="destructive" onClick={()=>void handleCancel()} disabled={isCancelling || cancelReason.trim().length<5}>{isCancelling && <Loader2 className="size-4 animate-spin" />}{locale === "ar" ? "تأكيد إلغاء المصروف" : "Confirm expense cancellation"}</Button><Button variant="ghost" onClick={()=>setCancelTarget(null)}>{locale === "ar" ? "الاحتفاظ بالمصروف" : "Keep expense"}</Button></div></fieldset>
        </DialogContent>
      </Dialog>

      {/* ── Approve dialog ────────────────────────────────────────────── */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!isApproving && !o) setApproveTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle><LocalizedText text="Approve expense" /></DialogTitle>
            <DialogDescription>
              {approveTarget && (
                <span dir="ltr" className="font-mono">{approveTarget.expense_code ?? approveTarget.id.slice(0, 8)}</span>
              )}
              {" — "}<LocalizedText text="Computes VAT, creates a payable and emits the approval event" /></DialogDescription>
          </DialogHeader>
          <fieldset disabled={isApproving} className="min-w-0 space-y-4">
            {previewCode && (
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400"><LocalizedText text="سيُرحّل إلى حساب" /><b dir="ltr">{previewCode}</b> — {coaNames[previewCode] ?? ""}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-vat-rate"><LocalizedText text="VAT %" /></Label>
                <Input id="exp-vat-rate" type="number" dir="ltr" min="0" max="100" step="0.01" value={approveVatRate} onChange={(e) => setApproveVatRate(e.target.value)} className="h-10 text-end tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-recover"><LocalizedText text="Recoverability" /></Label>
                <select
                  id="exp-recover"
                  value={approveRecoverability}
                  onChange={(e) => setApproveRecoverability(e.target.value as ExpenseVatRecoverability)}
                  className="h-10 w-full rounded-xl border border-input bg-background shadow-xs px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="recoverable"><LocalizedText text="Recoverable" /></option>
                  <option value="non_recoverable"><LocalizedText text="Non-recoverable" /></option>
                  <option value="pending_review"><LocalizedText text="Pending review" /></option>
                </select>
              </div>
            </div>

            {approveTarget && approvalVat !== null && approvalTotal !== null && (
              <p data-testid="expense-approval-preview" className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground" dir="ltr"><LocalizedText text="Net:" />{fmtMoney(approveTarget.amount)} <LocalizedText text="· VAT:" /> {fmtMoney(approvalVat)} <LocalizedText text="· Total:" /> {fmtMoney(approvalTotal)}<LocalizedText text="SAR" /></p>
            )}
            <p className="text-xs text-muted-foreground">{locale === "ar" ? "تُحفظ نسبة الضريبة بمنزلتين عشريتين." : "The VAT rate is saved with two decimal places."}</p>
            {approveError && <p role="alert" className="text-sm text-destructive">{approveError}</p>}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleApprove()}
                disabled={isApproving || !validApprovalRate}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}<LocalizedText text="Approve" /></Button>
              <Button variant="ghost" onClick={() => setApproveTarget(null)}><LocalizedText text="Cancel" /></Button>
            </div>
          </fieldset>
        </DialogContent>
      </Dialog>
    </div>
  )
}
