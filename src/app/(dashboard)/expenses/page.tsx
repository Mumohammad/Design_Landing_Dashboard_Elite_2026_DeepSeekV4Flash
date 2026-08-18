"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import {
  approveExpense,
  createExpense,
  EXPENSE_TYPES,
  type ExpenseType,
  type ExpenseVatRecoverability,
} from "@/lib/expenses/actions"
import {
  Wallet, Clock, DollarSign, CheckCircle2, BadgeCheck, Loader2, AlertTriangle, ReceiptText, Plus, Save, X,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface ExpenseRow {
  id: string
  expense_code: string | null
  expense_type: string
  category: string | null
  amount: number
  currency: string
  expense_date: string
  description: string | null
  is_approved: boolean
  vendor: string | null
  vat_rate: number
  vat_amount: number
  vat_recoverability: string
  coa_account_code: string | null
  driver: { full_name_ar: string; driver_code: string } | null
}

const TYPE_META: Record<string, { ar: string; className: string }> = {
  fuel: { ar: "وقود", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  advance: { ar: "سلفة", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  operational: { ar: "تشغيلي", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  platform_commission: { ar: "عمولة", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  maintenance: { ar: "صيانة", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  other: { ar: "أخرى", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

const RECOVER_META: Record<string, { ar: string; className: string }> = {
  recoverable: { ar: "قابل للاسترداد", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  non_recoverable: { ar: "غير قابل للاسترداد", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  pending_review: { ar: "قيد المراجعة", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
}

function fmtDate(date: string): string {
  try { return new Date(date).toLocaleDateString("en-GB") } catch { return date }
}

function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const EXPENSE_SELECT = "id,expense_code,expense_type,category,amount,currency,expense_date,description,is_approved,vendor,vat_rate,vat_amount,vat_recoverability,coa_account_code,driver:drivers(full_name_ar,driver_code)"

export default function ExpensesPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<ExpenseRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  // Category → CoA mapping preview (expense_type → account_code → name)
  const [coaNames, setCoaNames] = useState<Record<string, string>>({})
  const [mappingByType, setMappingByType] = useState<Record<string, string>>({})

  const [approveTarget, setApproveTarget] = useState<ExpenseRow | null>(null)
  const [approveVatRate, setApproveVatRate] = useState("15")
  const [approveRecoverability, setApproveRecoverability] = useState<ExpenseVatRecoverability>("recoverable")
  const [isApproving, setIsApproving] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [formType, setFormType] = useState<ExpenseType>("fuel")
  const [formCategory, setFormCategory] = useState("")
  const [formAmount, setFormAmount] = useState("")
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [formVendor, setFormVendor] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formVatRate, setFormVatRate] = useState("15")
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [expRes, mapRes, coaRes] = await Promise.all([
      supabase
        .from("expenses")
        .select(EXPENSE_SELECT)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .limit(100),
      supabase.from("expense_category_mappings").select("expense_type,coa_account_code"),
      supabase
        .from("chart_of_accounts")
        .select("account_code,name_ar")
        .is("deleted_at", null)
        .limit(100),
    ])
    if (expRes.error) { console.error(expRes.error); setData([]) }
    else { setData((expRes.data as unknown as ExpenseRow[]) ?? []) }
    if (mapRes.data) {
      const m: Record<string, string> = {}
      for (const r of mapRes.data as { expense_type: string; coa_account_code: string }[]) m[r.expense_type] = r.coa_account_code
      setMappingByType(m)
    }
    if (coaRes.data) {
      const n: Record<string, string> = {}
      for (const r of coaRes.data as { account_code: string; name_ar: string }[]) n[r.account_code] = r.name_ar
      setCoaNames(n)
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void (async () => { await load() })()
  }, [load])

  const flash = (type: "ok" | "err", text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 6000)
  }

  const filtered = search
    ? data.filter(r => r.expense_code?.includes(search) || r.driver?.full_name_ar?.includes(search) || r.vendor?.includes(search) || r.expense_type?.includes(search))
    : data

  const totalAmount = data.reduce((s, r) => s + (r.amount ?? 0), 0)
  const totalVat = data.reduce((s, r) => s + (r.vat_amount ?? 0), 0)

  const kpiCards: KpiCardData[] = [
    { label: t.nav.expenses, value: data.length, icon: Wallet, color: "#1E5A99" },
    { label: t.common.pending, value: data.filter(r => !r.is_approved).length, icon: Clock, color: "#F59E0B" },
    { label: "Total (SAR)", value: fmtMoney(totalAmount), icon: DollarSign, color: "#EF4444" },
    { label: "Input VAT", value: fmtMoney(totalVat), icon: ReceiptText, color: "#10B981" },
  ]

  const columns: TableColumn<ExpenseRow>[] = [
    { key: "expense_code", header: "Code", render: (r) => <span dir="ltr" className="font-mono text-xs">{r.expense_code ?? "—"}</span> },
    {
      key: "expense_type", header: "Type",
      render: (r) => {
        const m = TYPE_META[r.expense_type] ?? TYPE_META.other
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>{m.ar}</span>
      },
    },
    { key: "amount", header: "Net", render: (r) => <span dir="ltr" className="tabular-nums font-medium">{fmtMoney(r.amount)} SAR</span> },
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
          ? <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${m.className}`}>{m.ar}</span>
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
    setIsSaving(true)
    setFormError(null)
    const res = await createExpense({
      expense_type: formType,
      category: formCategory || undefined,
      amount: Number(formAmount || 0),
      expense_date: formDate,
      vendor: formVendor || null,
      description: formDescription || null,
      vat_rate: Number(formVatRate || 0),
    })
    setIsSaving(false)
    if (res.success) {
      flash("ok", "تم إنشاء المصروف (قيد الاعتماد). / Expense created (pending).")
      setCreateOpen(false)
      await load()
    } else {
      setFormError(res.error ?? "Failed")
    }
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
          {feedback.text}
        </div>
      )}

      <EnterpriseModulePage
        title={t.nav.expenses}
        subtitle="تسجيل واعتماد المصاريف مع التقاط ضريبة المدخلات وربطها بدليل الحسابات / Record and approve expenses with input VAT capture + CoA mapping"
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel="مصروف جديد / New expense"
        onPrimaryCta={openCreate}
        primaryCtaIcon={Plus}
        columns={columns}
        data={filtered}
        isLoading={isLoading}
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
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false) }}>
        <DialogContent className="max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>مصروف جديد / New expense</DialogTitle>
            <DialogDescription>
              يُنشأ كقيد انتظار (غير معتمد) برمز تلقائي EXP-…؛ يُعتمد لاحقاً مع احتساب الضريبة / Created pending with an auto code; approval captures VAT
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-type">النوع / Type</Label>
                <select
                  id="exp-type"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as ExpenseType)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {EXPENSE_TYPES.map((tp) => (
                    <option key={tp} value={tp}>{(TYPE_META[tp] ?? TYPE_META.other).ar} / {tp}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-category">التصنيف / Category</Label>
                <Input id="exp-category" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="h-9" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="exp-amount">المبلغ (قبل الضريبة) / Net amount</Label>
                <Input id="exp-amount" type="number" dir="ltr" min="0" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} className="h-9 text-end tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-date">التاريخ / Date</Label>
                <Input id="exp-date" type="date" dir="ltr" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-vat">الضريبة % / VAT %</Label>
                <Input id="exp-vat" type="number" dir="ltr" min="0" max="100" step="0.01" value={formVatRate} onChange={(e) => setFormVatRate(e.target.value)} className="h-9 text-end tabular-nums" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-vendor">المورد / Vendor</Label>
                <Input id="exp-vendor" value={formVendor} onChange={(e) => setFormVendor(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-desc">الوصف / Description</Label>
                <Input id="exp-desc" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="h-9" />
              </div>
            </div>

            {formType && (
              <p className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {mappingByType[formType]
                  ? <>سيُرحّل الاعتماد لاحقاً إلى حساب <b dir="ltr">{mappingByType[formType]}</b> — {coaNames[mappingByType[formType]] ?? ""}</>
                  : "لا يوجد ربط لهذه الفئة بعد / No CoA mapping for this category yet"}
              </p>
            )}

            {formError && <p className="text-xs text-red-500">{formError}</p>}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleCreate()}
                disabled={isSaving || Number(formAmount || 0) <= 0 || !formDate}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                حفظ المصروف / Save expense
              </Button>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                <X className="h-4 w-4" />
                إلغاء / Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Approve dialog ────────────────────────────────────────────── */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => { if (!o) setApproveTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>اعتماد المصروف / Approve expense</DialogTitle>
            <DialogDescription>
              {approveTarget && (
                <span dir="ltr" className="font-mono">{approveTarget.expense_code ?? approveTarget.id.slice(0, 8)}</span>
              )}
              {" — "}
              يحسب مبلغ الضريبة، ينشئ ذمماً دائنة ويصدر حدث الاعتماد / Computes VAT, creates a payable and emits the approval event
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {previewCode && (
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                سيُرحّل إلى حساب <b dir="ltr">{previewCode}</b> — {coaNames[previewCode] ?? ""}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exp-vat-rate">الضريبة % / VAT %</Label>
                <Input id="exp-vat-rate" type="number" dir="ltr" min="0" max="100" step="0.01" value={approveVatRate} onChange={(e) => setApproveVatRate(e.target.value)} className="h-9 text-end tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-recover">تصنيف الاسترداد / Recoverability</Label>
                <select
                  id="exp-recover"
                  value={approveRecoverability}
                  onChange={(e) => setApproveRecoverability(e.target.value as ExpenseVatRecoverability)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="recoverable">قابل للاسترداد / Recoverable</option>
                  <option value="non_recoverable">غير قابل للاسترداد / Non-recoverable</option>
                  <option value="pending_review">قيد المراجعة / Pending review</option>
                </select>
              </div>
            </div>

            {approveTarget && Number(approveVatRate || 0) >= 0 && (
              <p className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground" dir="ltr">
                Net: {fmtMoney(approveTarget.amount)} · VAT: {fmtMoney((Number(approveTarget.amount) * Number(approveVatRate || 0)) / 100)} · Total: {fmtMoney(Number(approveTarget.amount) + (Number(approveTarget.amount) * Number(approveVatRate || 0)) / 100)} SAR
              </p>
            )}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleApprove()}
                disabled={isApproving || Number(approveVatRate) < 0 || Number(approveVatRate) > 100}
                className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
              >
                {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                اعتماد / Approve
              </Button>
              <Button variant="ghost" onClick={() => setApproveTarget(null)}>
                إلغاء / Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
