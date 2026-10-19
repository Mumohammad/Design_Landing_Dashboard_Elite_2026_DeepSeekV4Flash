"use client"

import { LocalizedText, useUiText } from "@/components/localized-text"
import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { expensesQuery, expensesSummary, expenseDependencies, type ExpenseRow } from "@/lib/expenses/overview-queries"
import { useTablePage } from "@/hooks/use-table-page"
import { useReadSummary } from "@/hooks/use-read-summary"
import { useTranslation } from "@/hooks/use-translation"
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
  Wallet, Clock, DollarSign, CheckCircle2, BadgeCheck, Loader2, AlertTriangle, ReceiptText, Plus, Save, X,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const TYPE_META: Record<string, { ar: string; en: string; className: string }> = {
  fuel: { ar: "وقود", en: "Fuel", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  advance: { ar: "سلفة", en: "Advance", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  operational: { ar: "تشغيلي", en: "Operational", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  platform_commission: { ar: "عمولة", en: "Commission", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
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
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  // Category → CoA mapping preview (expense_type → account_code → name)
  const [coaNames, setCoaNames] = useState<Record<string, string>>({})
  const [mappingByType, setMappingByType] = useState<Record<string, string>>({})

  const [approveTarget, setApproveTarget] = useState<ExpenseRow | null>(null)
  const [approveVatRate, setApproveVatRate] = useState("15")
  const [approveRecoverability, setApproveRecoverability] = useState<ExpenseVatRecoverability>("recoverable")
  const [isApproving, setIsApproving] = useState(false)

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
    const controller = new AbortController()
    void (async () => {
      try {
        const result = await expenseDependencies(createClient(), controller.signal)
        if (controller.signal.aborted) return
        setMappingByType(result.byType); setCoaNames(result.names)
        setDependencyState({ loading: false, error: false })
      } catch {
        if (!controller.signal.aborted) {
          setMappingByType({}); setCoaNames({})
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

  const flash = (type: "ok" | "err", text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 6000)
  }

  const kpiCards: KpiCardData[] = [
    { label: t.nav.expenses, value: summary.value?.count ?? "—", icon: Wallet, color: "#1E5A99" },
    { label: t.common.pending, value: summary.value?.pending ?? "—", icon: Clock, color: "#F59E0B" },
    { label: locale === "ar" ? "صافي المصروفات (ر.س)" : "Net expenses (SAR)", value: summary.value ? fmtMoney(summary.value.net) : "—", icon: DollarSign, color: "#EF4444" },
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
      render: (r) => r.is_approved
        ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600"><BadgeCheck className="h-3 w-3" />{t.common.approved}</span>
        : <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">{t.common.pending}</span>,
    },
  ]

  const openCreate = () => {
    if (isSaving) return
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

  async function handleCreate() {
    if (isSaving) return
    setIsSaving(true)
    setFormError(null)
    try {
      const res = await createExpense({
        request_id: createRequestId,
        expense_type: formType,
        category: formCategory || undefined,
        amount: Number(formAmount || 0),
        expense_date: formDate,
        vendor: formVendor || null,
        description: formDescription || null,
        vat_rate: Number(formVatRate || 0),
      })
      if (res.success) {
        flash("ok", "تم إنشاء المصروف (قيد الاعتماد). / Expense created (pending).")
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
    if (!approveTarget) return
    setIsApproving(true)
    const res = await approveExpense({
      id: approveTarget.id,
      vat_rate: Number(approveVatRate || 0),
      vat_recoverability: approveRecoverability,
    })
    setIsApproving(false)
    if (res.success) {
      flash("ok", "تم اعتماد المصروف وإنشاء ذمم دائنة. / Expense approved; payable created.")
      setApproveTarget(null)
      setApproveVatRate("15")
      setApproveRecoverability("recoverable")
      await load()
    } else {
      flash("err", res.error ?? "Approval failed")
    }
  }

  const previewCode = approveTarget ? mappingByType[approveTarget.expense_type] : null

  return (
    <div className="px-4 lg:px-6 py-4">
      {feedback && (
        <div className={`mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
          feedback.type === "ok"
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
            : "border-red-500/20 bg-red-500/10 text-red-500"
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
          r.is_approved ? null : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setApproveTarget(r); setApproveVatRate("15"); setApproveRecoverability("recoverable") }}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20"
              >
                <BadgeCheck className="h-3 w-3" />
                {t.common.approved}
              </button>
            </div>
          )
        }
      />

      {/* ── New expense dialog ────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!isSaving && !o) setCreateOpen(false) }}>
        <DialogContent className="max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle><LocalizedText text="New expense" /></DialogTitle>
            <DialogDescription>
              <LocalizedText text="Created pending with an automatic code; approval captures VAT" />
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
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {EXPENSE_TYPES.map((tp) => (
                    <option key={tp} value={tp}>{locale === "ar" ? (TYPE_META[tp] ?? TYPE_META.other).ar : (TYPE_META[tp] ?? TYPE_META.other).en}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-category"><LocalizedText text="Category" /></Label>
                <Input id="exp-category" maxLength={200} value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="h-9" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="exp-amount"><LocalizedText text="Net amount" /></Label>
                <Input id="exp-amount" type="number" dir="ltr" min="0.01" max="99999999.99" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="h-9 text-end tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-date"><LocalizedText text="Date" /></Label>
                <Input id="exp-date" type="date" dir="ltr" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-vat"><LocalizedText text="VAT %" /></Label>
                <Input id="exp-vat" type="number" dir="ltr" min="0" max="100" step="0.01" value={formVatRate} onChange={(e) => setFormVatRate(e.target.value)} className="h-9 text-end tabular-nums" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-vendor"><LocalizedText text="Vendor" /></Label>
                <Input id="exp-vendor" maxLength={200} value={formVendor} onChange={(e) => setFormVendor(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-desc"><LocalizedText text="Description" /></Label>
                <Input id="exp-desc" maxLength={2000} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="h-9" />
              </div>
            </div>

            {formType && (
              <p className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {mappingByType[formType]
                  ? <><LocalizedText text="Will post to account" /> <b dir="ltr">{mappingByType[formType]}</b> — {coaNames[mappingByType[formType]] ?? ""}</>
                  : ui("لا يوجد ربط لهذه الفئة بعد / No CoA mapping for this category yet")}
              </p>
            )}

            {formError && <p role="alert" className="text-xs text-red-500">{ui(formError)}</p>}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleCreate()}
                disabled={isSaving || Number(formAmount || 0) <= 0 || !formDate}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<LocalizedText text="Save expense" /></Button>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                <X className="h-4 w-4" /><LocalizedText text="Cancel" /></Button>
            </div>
          </fieldset>
        </DialogContent>
      </Dialog>

      {/* ── Approve dialog ────────────────────────────────────────────── */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!o) setApproveTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle><LocalizedText text="Approve expense" /></DialogTitle>
            <DialogDescription>
              {approveTarget && (
                <span dir="ltr" className="font-mono">{approveTarget.expense_code ?? approveTarget.id.slice(0, 8)}</span>
              )}
              {" — "}<LocalizedText text="Computes VAT, creates a payable and emits the approval event" /></DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {previewCode && (
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400"><LocalizedText text="سيُرحّل إلى حساب" /><b dir="ltr">{previewCode}</b> — {coaNames[previewCode] ?? ""}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-vat-rate"><LocalizedText text="VAT %" /></Label>
                <Input id="exp-vat-rate" type="number" dir="ltr" min="0" max="100" step="0.01" value={approveVatRate} onChange={(e) => setApproveVatRate(e.target.value)} className="h-9 text-end tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-recover"><LocalizedText text="Recoverability" /></Label>
                <select
                  id="exp-recover"
                  value={approveRecoverability}
                  onChange={(e) => setApproveRecoverability(e.target.value as ExpenseVatRecoverability)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="recoverable"><LocalizedText text="Recoverable" /></option>
                  <option value="non_recoverable"><LocalizedText text="Non-recoverable" /></option>
                  <option value="pending_review"><LocalizedText text="Pending review" /></option>
                </select>
              </div>
            </div>

            {approveTarget && Number(approveVatRate || 0) >= 0 && (
              <p className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground" dir="ltr"><LocalizedText text="Net:" />{fmtMoney(approveTarget.amount)} <LocalizedText text="· VAT:" /> {fmtMoney((Number(approveTarget.amount) * Number(approveVatRate || 0)) / 100)} <LocalizedText text="· Total:" /> {fmtMoney(Number(approveTarget.amount) + (Number(approveTarget.amount) * Number(approveVatRate || 0)) / 100)}<LocalizedText text="SAR" /></p>
            )}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleApprove()}
                disabled={isApproving || Number(approveVatRate) < 0 || Number(approveVatRate) > 100}
                className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
              >
                {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}<LocalizedText text="Approve" /></Button>
              <Button variant="ghost" onClick={() => setApproveTarget(null)}><LocalizedText text="Cancel" /></Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
