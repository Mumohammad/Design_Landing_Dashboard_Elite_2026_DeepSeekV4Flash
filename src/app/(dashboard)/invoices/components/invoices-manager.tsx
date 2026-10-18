"use client"

// Phase 5 — Invoice Engine manager: list + create draft (with lines editor) +
// detail + lifecycle (issue / finalize / cancel) + credit & debit notes.
// Bilingual (AR/EN, RTL-aware), reuses EnterpriseModulePage like the other
// financial managers. Rendered from the /invoices page.

import { LocalizedText } from "@/components/localized-text"
import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import {
  createInvoiceDraft,
  updateInvoiceDraft,
  deleteInvoiceDraft,
  issueInvoice,
  finalizeInvoice,
  cancelInvoice,
  issueCreditNote,
  issueDebitNote,
  exportInvoicesCsv,
  type InvoiceType,
} from "@/lib/accounting/invoices"
import { computeInvoiceTotals, round2 } from "@/lib/accounting/invoice-math"
import { generateInvoiceDocument } from "@/lib/accounting/invoice-docs"
import {
  MoreHorizontal, Pencil, Trash2, FileText, Plus, Send, Check, Ban, RotateCcw, Download, Save, X, Printer,
  Loader2, CheckCircle2, AlertTriangle, ReceiptText, BadgeDollarSign, CircleDollarSign,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BankAccountPicker } from "@/components/accounting/bank-account-picker"
import { printDocument } from "@/lib/print-document"

// ── Row shapes ────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  invoice_number: string
  invoice_type: InvoiceType
  issue_date: string
  due_date: string
  status: string
  subtotal: number
  discount: number
  vat_amount: number
  total: number
  currency: string
  customer_name: string | null
  supplier_name: string | null
  updated_at: string
  customer_id: string | null
  supplier_id: string | null
  vat_rate: number
  notes: string | null
}

interface InvoiceLineRow {
  line_no: number
  description: string
  quantity: number
  unit_price: number
  discount: number
  amount: number
  vat_rate: number
  vat_amount: number
}

interface PartyOption {
  id: string
  name: string
  code: string
}

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  draft: { ar: "مسودة", en: "Draft", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  issued: { ar: "صادرة", en: "Issued", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  finalized: { ar: "معتمدة", en: "Finalized", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  paid: { ar: "مدفوعة", en: "Paid", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  partially_paid: { ar: "مدفوعة جزئياً", en: "Partially paid", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  overdue: { ar: "متأخرة", en: "Overdue", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  cancelled: { ar: "ملغاة", en: "Cancelled", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  credited: { ar: "معتمدة بإشعار", en: "Credited", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
}

function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return d
  }
}

// ── Lines editor state ────────────────────────────────────────────────────

interface LineDraft {
  key: number
  description: string
  quantity: string
  unit_price: string
  discount: string
  vat_rate: string
}

function emptyLine(key: number): LineDraft {
  return { key, description: "", quantity: "1", unit_price: "", discount: "0", vat_rate: "15" }
}

function lineInputs(lines: LineDraft[], defaultVatRate = "15") {
  return lines.map((l) => ({
    description: l.description.trim(), quantity: Number(l.quantity || NaN),
    unit_price: Number(l.unit_price || NaN), discount: Number(l.discount || 0),
    vat_rate: Number(l.vat_rate || defaultVatRate),
  }))
}

function computeLineTotals(lines: LineDraft[]) {
  try { return computeInvoiceTotals(lineInputs(lines)) }
  catch { return null }
}

// ── Main component ────────────────────────────────────────────────────────

export function InvoicesManager() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [statusFilter, setStatusFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const [customers, setCustomers] = useState<PartyOption[]>([])
  const [suppliers, setSuppliers] = useState<PartyOption[]>([])

  const [editTarget, setEditTarget] = useState<InvoiceRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<InvoiceRow | null>(null)
  const [detailLines, setDetailLines] = useState<InvoiceLineRow[]>([])
  const [detailNotes, setDetailNotes] = useState<{ id: string; kind: "credit" | "debit"; number: string; total: number; reason: string; issue_date: string }[]>([])
  const [cancelTarget, setCancelTarget] = useState<InvoiceRow | null>(null)
  const [creditTarget, setCreditTarget] = useState<InvoiceRow | null>(null)
  const [debitTarget, setDebitTarget] = useState<InvoiceRow | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    setIsLoading(true)
    setLoadError(false)
    const { data, error, count } = await supabase
      .from("invoices")
      .select(
        "id,invoice_number,invoice_type,issue_date,due_date,status,subtotal,discount,vat_amount,total,currency,updated_at,customer_id,supplier_id,vat_rate,notes,customers(name_ar),suppliers(name_ar)", { count: "exact" }
      )
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * 50, page * 50 - 1)
    if (error) {
      setLoadError(true)
    } else {
      setTotalCount(count ?? 0)
      setRows(
        (data as unknown as (Omit<InvoiceRow, "customer_name" | "supplier_name"> & {
          customers?: { name_ar: string | null } | null
          suppliers?: { name_ar: string | null } | null
        })[] ?? []).map((r) => ({
          id: r.id,
          invoice_number: r.invoice_number,
          invoice_type: r.invoice_type,
          issue_date: r.issue_date,
          due_date: r.due_date,
          status: r.status,
          subtotal: Number(r.subtotal),
          discount: Number(r.discount),
          vat_amount: Number(r.vat_amount),
          total: Number(r.total),
          currency: r.currency,
          updated_at: r.updated_at,
          customer_id: r.customer_id,
          supplier_id: r.supplier_id,
          vat_rate: Number(r.vat_rate),
          notes: r.notes,
          customer_name: r.customers?.name_ar ?? null,
          supplier_name: r.suppliers?.name_ar ?? null,
        }))
      )
    }
    setIsLoading(false)
  }, [page])

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const [custRes, suppRes] = await Promise.all([
        supabase.from("customers").select("id,customer_code,name_ar").is("deleted_at", null).eq("is_active", true).order("customer_code", { ascending: true }).limit(200),
        supabase.from("suppliers").select("id,supplier_code,name_ar").is("deleted_at", null).eq("is_active", true).order("supplier_code", { ascending: true }).limit(200),
      ])
      setCustomers(
        ((custRes.data ?? []) as { id: string; customer_code: string; name_ar: string }[]).map((c) => ({
          id: c.id,
          code: c.customer_code,
          name: c.name_ar,
        }))
      )
      setSuppliers(
        ((suppRes.data ?? []) as { id: string; supplier_code: string; name_ar: string }[]).map((s) => ({
          id: s.id,
          code: s.supplier_code,
          name: s.name_ar,
        }))
      )
      await load()
    })()
  }, [load])

  const flash = (type: "ok" | "err", text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 6000)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byStatus = rows.filter((r) => statusFilter === "all" || r.status === statusFilter)
    if (!q) return byStatus
    return byStatus.filter(
      (r) =>
        r.invoice_number.toLowerCase().includes(q) ||
        (r.customer_name ?? "").toLowerCase().includes(q) ||
        (r.supplier_name ?? "").toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    )
  }, [rows, search, statusFilter])

  const totalValue = rows
    .filter((r) => r.currency === "SAR" && r.status !== "cancelled" && r.status !== "credited")
    .reduce((s, r) => s + r.total, 0)

  const kpiCards: KpiCardData[] = [
    { label: ar ? "الفواتير المحملة" : "Loaded invoices", value: rows.length, icon: FileText, color: "#1E5A99" },
    { label: ar ? "مسودات" : "Drafts", value: rows.filter((r) => r.status === "draft").length, icon: ReceiptText, color: "#64748B" },
    { label: ar ? "معتمدة" : "Finalized", value: rows.filter((r) => r.status === "finalized").length, icon: CheckCircle2, color: "#10B981" },
    {
      label: ar ? "قيمة الفواتير (ر.س)" : "Loaded value (SAR)",
      value: fmtMoney(totalValue),
      icon: CircleDollarSign,
      color: "#8B5CF6",
    },
  ]

  const columns: TableColumn<InvoiceRow>[] = [
    {
      key: "invoice_number",
      header: ar ? "الرقم" : "Number",
      render: (r) => <span dir="ltr" className="font-mono text-xs font-medium">{r.invoice_number}</span>,
    },
    {
      key: "invoice_type",
      header: ar ? "النوع" : "Type",
      render: (r) => (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
          r.invoice_type === "sales"
            ? "border-blue-500/20 bg-blue-500/10 text-blue-600"
            : "border-orange-500/20 bg-orange-500/10 text-orange-600"
        }`}>
          {r.invoice_type === "sales" ? (ar ? "بيعية" : "Sales") : ar ? "شرائية" : "Purchase"}
        </span>
      ),
    },
    {
      key: "party",
      header: ar ? "الطرف" : "Party",
      render: (r) => (
        <span className="font-medium">{r.customer_name ?? r.supplier_name ?? "—"}</span>
      ),
    },
    {
      key: "issue_date",
      header: ar ? "التاريخ" : "Date",
      render: (r) => <span dir="ltr" className="text-xs">{fmtDate(r.issue_date)}</span>,
    },
    {
      key: "due_date",
      header: ar ? "الاستحقاق" : "Due",
      render: (r) => (
        <span dir="ltr" className={`text-xs ${r.status !== "paid" && r.status !== "cancelled" && new Date(r.due_date) < new Date() ? "text-red-600 font-medium" : ""}`}>
          {fmtDate(r.due_date)}
        </span>
      ),
    },
    {
      key: "status",
      header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.draft
        return (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>
            {ar ? s.ar : s.en}
          </span>
        )
      },
    },
    {
      key: "total",
      header: ar ? "الإجمالي" : "Total",
      render: (r) => (
        <span dir="ltr" className="text-xs font-medium tabular-nums">{fmtMoney(r.total)} {r.currency}</span>
      ),
    },
  ]

  // ── Export ──────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false)
  async function handleExport() {
    setIsExporting(true)
    const res = await exportInvoicesCsv()
    setIsExporting(false)
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "invoices.csv"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      flash("ok", ar ? "تم تصدير الفواتير." : "Invoices exported.")
    } else {
      flash("err", res.error ?? "Export failed")
    }
  }

  // ── Create form ─────────────────────────────────────────────────────────
  const [formType, setFormType] = useState<InvoiceType>("sales")
  const [formPartyId, setFormPartyId] = useState("")
  const [formIssue, setFormIssue] = useState(() => new Date().toISOString().slice(0, 10))
  const [formDue, setFormDue] = useState(() => new Date().toISOString().slice(0, 10))
  const [formVatRate, setFormVatRate] = useState("15")
  const [formCurrency, setFormCurrency] = useState("SAR")
  const [formNotes, setFormNotes] = useState("")
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(1)])
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const lineTotals = computeLineTotals(lines)
  const hasLineInput = lines.some((line) => line.description || line.unit_price)


  const openCreate = () => {
    setEditTarget(null)
    setFormCurrency("SAR")
    setFormType("sales")
    setFormPartyId("")
    setFormIssue(new Date().toISOString().slice(0, 10))
    setFormDue(new Date().toISOString().slice(0, 10))
    setFormVatRate("15")
    setFormNotes("")
    setLines([emptyLine(1)])
    setFormError(null)
    setCreateOpen(true)
  }

  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, emptyLine(Date.now())])
  const removeLine = (key: number) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))

  async function openEdit(row: InvoiceRow) {
    setBusyId(row.id)
    const client = createClient()
    const { data, error } = await client.from("invoice_lines")
      .select("line_no,description,quantity,unit_price,discount,vat_rate")
      .eq("invoice_id", row.id).order("line_no")
    setBusyId(null)
    if (error || !data?.length) { flash("err", ar ? "تعذر تحميل البنود. حاول مجدداً." : "Could not load invoice lines. Retry."); return }
    setEditTarget(row)
    setFormType(row.invoice_type)
    setFormPartyId(row.customer_id ?? row.supplier_id ?? "")
    setFormIssue(row.issue_date)
    setFormDue(row.due_date)
    setFormVatRate(String(row.vat_rate))
    setFormCurrency(row.currency)
    setFormNotes(row.notes ?? "")
    setLines(data.map((l) => ({ key: l.line_no, description: l.description,
      quantity: String(l.quantity), unit_price: String(l.unit_price),
      discount: String(l.discount), vat_rate: String(l.vat_rate) })))
    setFormError(null)
    setCreateOpen(true)
  }

  async function handleCreate() {
    setIsSaving(true)
    setFormError(null)
    try {
      const input = { invoice_type: formType,
        customer_id: formType === "sales" ? formPartyId || null : null,
        supplier_id: formType === "purchase" ? formPartyId || null : null,
        issue_date: formIssue, due_date: formDue, currency: formCurrency,
        vat_rate: Number(formVatRate || 0), notes: formNotes || null,
        lines: lineInputs(lines, formVatRate) }
      const res = editTarget
        ? await updateInvoiceDraft({ ...input, id: editTarget.id, expected_updated_at: editTarget.updated_at })
        : await createInvoiceDraft(input)
      if (!res.success) { setFormError(res.error ?? "Save failed"); return }
      flash("ok", ar ? "تم حفظ مسودة الفاتورة." : "Invoice draft saved.")
      setCreateOpen(false)
      await load()
    } catch { setFormError(ar ? "تعذر الحفظ. حاول مجدداً." : "Could not save. Please retry.") }
    finally { setIsSaving(false) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const res = await deleteInvoiceDraft({ id: deleteTarget.id, expected_updated_at: deleteTarget.updated_at })
      if (!res.success) { flash("err", res.error ?? "Delete failed"); return }
      setDeleteTarget(null)
      flash("ok", ar ? "تم حذف المسودة." : "Draft deleted.")
      await load()
    } catch { flash("err", ar ? "تعذر الحذف. حاول مجدداً." : "Could not delete. Please retry.") }
    finally { setIsDeleting(false) }
  }

  // ── Detail ──────────────────────────────────────────────────────────────
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  async function openDetail(r: InvoiceRow) {
    setDetailTarget(r)
    setDetailLines([])
    setDetailNotes([])
    setIsDetailLoading(true)
    const supabase = createClient()
    const [linesRes, cnRes, dnRes] = await Promise.all([
      supabase
        .from("invoice_lines")
        .select("line_no,description,quantity,unit_price,discount,amount,vat_rate,vat_amount")
        .eq("invoice_id", r.id)
        .order("line_no", { ascending: true }),
      supabase
        .from("credit_notes")
        .select("id,credit_note_number,total,reason,issue_date")
        .eq("reference_invoice_id", r.id),
      supabase
        .from("debit_notes")
        .select("id,debit_note_number,total,reason,issue_date")
        .eq("reference_invoice_id", r.id),
    ])
    if (linesRes.data) setDetailLines(linesRes.data as InvoiceLineRow[])
    setDetailNotes([
      ...((cnRes.data ?? []).map((n) => ({
        id: n.id,
        kind: "credit" as const,
        number: n.credit_note_number,
        total: Number(n.total),
        reason: n.reason,
        issue_date: n.issue_date,
      }))),
      ...((dnRes.data ?? []).map((n) => ({
        id: n.id,
        kind: "debit" as const,
        number: n.debit_note_number,
        total: Number(n.total),
        reason: n.reason,
        issue_date: n.issue_date,
      }))),
    ])
    setIsDetailLoading(false)
  }

  // ── Print / PDF (Phase 6) ───────────────────────────────────────────────
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [printTarget, setPrintTarget] = useState<InvoiceRow | null>(null)
  const [printBank, setPrintBank] = useState("")
  const [printError, setPrintError] = useState("")
  async function handlePrint(r: InvoiceRow) {
    const win = window.open("", "_blank")
    if (!win) {
      setPrintError(ar ? "اسمح بالنوافذ المنبثقة للطباعة وحفظ PDF." : "Allow pop-ups to print or save a PDF.")
      return
    }
    win.opener = null
    win.document.body.textContent = ar ? "جارٍ تجهيز الفاتورة…" : "Preparing invoice…"
    setPrintingId(r.id)
    setPrintError("")
    try {
      const res = await generateInvoiceDocument(r.id, printBank || undefined)
      if (!res.success || !res.html) throw new Error(res.error ?? "Print failed")
      await printDocument(win, res.html)
      setPrintTarget(null)
    } catch (error) {
      win.close()
      setPrintError(error instanceof Error ? error.message : "Print failed")
    } finally { setPrintingId(null) }
  }

  // ── Lifecycle actions ───────────────────────────────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null)
  async function runAction(action: "issue" | "finalize", r: InvoiceRow) {
    setBusyId(r.id)
    const res = action === "issue" ? await issueInvoice({ id: r.id }) : await finalizeInvoice({ id: r.id })
    setBusyId(null)
    if (res.success) {
      const finalizeMsg = r.invoice_type === "purchase"
        ? (ar ? "تم اعتماد فاتورة الشراء وإنشاء ذمم دائنة." : "Purchase invoice approved; payable created.")
        : (ar ? "تم اعتماد الفاتورة نهائياً." : "Invoice finalized.")
      flash("ok", action === "issue" ? (ar ? "تم إصدار الفاتورة." : "Invoice issued.") : finalizeMsg)
      setDetailTarget(null)
      await load()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // Cancel
  const [cancelReason, setCancelReason] = useState("")
  const [isCancelling, setIsCancelling] = useState(false)
  async function handleCancel() {
    if (!cancelTarget) return
    setIsCancelling(true)
    const res = await cancelInvoice({ id: cancelTarget.id, reason: cancelReason })
    setIsCancelling(false)
    setCancelTarget(null)
    setCancelReason("")
    if (res.success) {
      flash("ok", ar ? "تم إلغاء الفاتورة." : "Invoice cancelled.")
      await load()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // Credit note
  const [creditReason, setCreditReason] = useState("")
  const [isCrediting, setIsCrediting] = useState(false)
  async function handleCredit() {
    if (!creditTarget) return
    setIsCrediting(true)
    const res = await issueCreditNote({ reference_invoice_id: creditTarget.id, reason: creditReason })
    setIsCrediting(false)
    setCreditTarget(null)
    setCreditReason("")
    if (res.success) {
      flash("ok", ar ? "تم إصدار الإشعار الدائن." : "Credit note issued.")
      await load()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // Debit note
  const [debitAmount, setDebitAmount] = useState("")
  const [debitReason, setDebitReason] = useState("")
  const [isDebiting, setIsDebiting] = useState(false)
  async function handleDebit() {
    if (!debitTarget) return
    setIsDebiting(true)
    const res = await issueDebitNote({
      reference_invoice_id: debitTarget.id,
      reason: debitReason,
      amount: Number(debitAmount || 0),
      vat_rate: Number(formVatRate || 15),
    })
    setIsDebiting(false)
    setDebitTarget(null)
    setDebitAmount("")
    setDebitReason("")
    if (res.success) {
      flash("ok", ar ? "تم إصدار الإشعار المدين." : "Debit note issued.")
      await load()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  const parties = formType === "sales" ? customers : suppliers

  return (
    <div className="space-y-4">
      {loadError && <div role="alert" className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <span>{ar ? "تعذر تحديث الفواتير. قد تكون البيانات المعروضة قديمة." : "Invoices could not refresh. Displayed data may be stale."}</span>
        <Button variant="outline" onClick={() => void load()}>{ar ? "إعادة المحاولة" : "Retry"}</Button>
      </div>}
      {feedback && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
            feedback.type === "ok"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
              : "border-red-500/20 bg-red-500/10 text-red-500"
          }`}
        >
          {feedback.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {feedback.text}
        </div>
      )}

      <EnterpriseModulePage
        title={ar ? "الفواتير" : "Invoices"}
        subtitle={ar
          ? "دورة حياة الفاتورة: مسودة ← صادرة ← معتمدة (نهائية)، مع الإشعارات الدائنة والمدينة"
          : "Invoice lifecycle: draft → issued → finalized (immutable), plus credit & debit notes"}
        kpiCards={kpiCards}
        searchPlaceholder={ar ? "بحث في الفواتير المحملة…" : "Search loaded invoices…"}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel={ar ? "فاتورة جديدة" : "New invoice"}
        onPrimaryCta={openCreate}
        primaryCtaIcon={Plus}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
          <select aria-label={ar ? "حالة الفاتورة" : "Invoice status"} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-xl border bg-background px-3 text-xs">
            <option value="all">{ar ? "جميع الحالات" : "All statuses"}</option>
            {Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{ar ? meta.ar : meta.en}</option>)}
          </select>
          <button
            onClick={() => void handleExport()}
            disabled={isExporting}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 disabled:opacity-50"
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {ar ? "تصدير CSV" : "Export CSV"}
          </button>
          </div>
        }
        columns={columns}
        data={filtered}
        rowActions={(r) => {
          const canIssue = r.status === "draft"
          const canFinalize = r.status === "issued"
          const canCancel = r.status === "draft" || r.status === "issued" || r.status === "finalized"
          const canCredit = r.status === "finalized"
          const canDebit = r.status === "finalized"
          return (
            <DropdownMenu dir={ar ? "rtl" : "ltr"}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={busyId === r.id || printingId === r.id} aria-label={`${ar ? "إجراءات الفاتورة" : "Invoice actions"} ${r.invoice_number}`}>
                  {busyId === r.id || printingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44 rounded-xl">
                <DropdownMenuItem onSelect={() => void openDetail(r)}><FileText className="h-4 w-4" />{ar ? "تفاصيل" : "Details"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setPrintTarget(r); setPrintBank(""); setPrintError("") }}><Printer className="h-4 w-4" />{ar ? "طباعة / حفظ PDF" : "Print / Save PDF"}</DropdownMenuItem>
                {canIssue && <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void openEdit(r)}><Pencil className="h-4 w-4" />{ar ? "تعديل" : "Edit"}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void runAction("issue", r)}><Send className="h-4 w-4" />{ar ? "إصدار" : "Issue"}</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(r)}><Trash2 className="h-4 w-4" />{ar ? "حذف" : "Delete"}</DropdownMenuItem>
                </>}
                {canFinalize && <DropdownMenuItem onSelect={() => void runAction("finalize", r)}><Check className="h-4 w-4" />{ar ? "اعتماد" : "Finalize"}</DropdownMenuItem>}
                {canCredit && <DropdownMenuItem onSelect={() => { setCreditTarget(r); setCreditReason("") }}><RotateCcw className="h-4 w-4" />{ar ? "دائن" : "Credit"}</DropdownMenuItem>}
                {canDebit && <DropdownMenuItem onSelect={() => { setDebitTarget(r); setDebitAmount(""); setDebitReason("") }}><BadgeDollarSign className="h-4 w-4" />{ar ? "مدين" : "Debit"}</DropdownMenuItem>}
                {canCancel && <DropdownMenuItem className="text-destructive" onSelect={() => { setCancelTarget(r); setCancelReason("") }}><Ban className="h-4 w-4" />{ar ? "إلغاء" : "Cancel"}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }}
        isLoading={isLoading}
        emptyStateMessage={ar ? "لا توجد فواتير بعد. أنشئ أول فاتورة." : "No invoices yet. Create your first invoice."}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <span>{ar ? `تم تحميل ${rows.length} من ${totalCount} فاتورة — البحث والمؤشرات للصفوف المحملة` : `Page ${page} of ${Math.max(1, Math.ceil(totalCount / 50))} · ${totalCount} invoices — search and metrics cover this page`}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={isLoading || page <= 1} onClick={() => setPage((n) => n - 1)}>{ar ? "السابق" : "Previous"}</Button>
          <Button variant="outline" disabled={isLoading || page * 50 >= totalCount} onClick={() => setPage((n) => n + 1)}>{ar ? "التالي" : "Next"}</Button>
        </div>
      </div>
      <Dialog open={!!printTarget} onOpenChange={(open) => { if (!open && !printingId) setPrintTarget(null) }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle>{ar ? "طباعة / حفظ PDF" : "Print / Save PDF"}</DialogTitle>
            <DialogDescription>{ar ? "اختر حساب التحويل إن لزم. للحفظ اختر Save as PDF من نافذة الطباعة، بحجم Letter ومقياس 100% وبدون رؤوس وتذييلات المتصفح." : "Optionally select the receiving bank. Choose Save as PDF in the print dialog, with Letter paper, 100% scale, and browser headers/footers off."}</DialogDescription>
          </DialogHeader>
          <BankAccountPicker key={printTarget?.id} value={printBank} onChange={setPrintBank} ar={ar} disabled={!!printingId} />
          <p role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            {ar ? "الرمز الحالي داخلي. لم يكتمل ربط ZATCA، ولا تعد هذه النسخة دليلاً على اعتماد أو إرسال الفاتورة لدى الهيئة." : "The current QR is internal. ZATCA integration is incomplete; this copy is not evidence of ZATCA clearance or reporting."}
          </p>
          {printError && <p role="alert" className="text-sm text-destructive">{printError}</p>}
          <Button disabled={!!printingId} onClick={() => printTarget && void handlePrint(printTarget)}>
            {printingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {ar ? "فتح الفاتورة للطباعة" : "Open invoice for printing"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null) }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>{ar ? "حذف مسودة الفاتورة؟" : "Delete invoice draft?"}</DialogTitle>
            <DialogDescription>{deleteTarget?.invoice_number} — {ar ? "ستُحفظ البنود وسجل التدقيق. لا يمكن حذف الفواتير الصادرة." : "Line items and audit history are retained. Issued invoices cannot be deleted."}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={isDeleting} onClick={() => setDeleteTarget(null)}>{ar ? "رجوع" : "Back"}</Button>
            <Button variant="destructive" disabled={isDeleting} onClick={() => void handleDelete()}>{isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}{ar ? "حذف المسودة" : "Delete draft"}</Button></div>
        </DialogContent>
      </Dialog>

      {/* ── Create draft dialog ───────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o && !isSaving) setCreateOpen(false) }}>
        <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? (ar ? "تعديل مسودة الفاتورة" : "Edit invoice draft") : (ar ? "فاتورة جديدة (مسودة)" : "New invoice (draft)")}</DialogTitle>
            <DialogDescription>
              {ar
                ? "تُحسب الإجماليات في الخادم بقيم عشرية دقيقة؛ الفاتورة المعتمدة غير قابلة للتعديل"
                : "Save a draft, review the amounts, then issue it when ready. Finalized invoices cannot be edited."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{ar ? "النوع" : "Type"}</Label>
                <div className="flex gap-2">
                  {(["sales", "purchase"] as InvoiceType[]).map((tp) => (
                    <button
                      key={tp}
                      disabled={Boolean(editTarget) || isSaving}
                      type="button"
                      onClick={() => { setFormType(tp); setFormPartyId("") }}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        formType === tp
                          ? tp === "sales"
                            ? "border-blue-500/60 bg-blue-500/10 text-blue-600"
                            : "border-orange-500/60 bg-orange-500/10 text-orange-600"
                          : "border-border/50 text-muted-foreground"
                      }`}
                    >
                      {ar ? (tp === "sales" ? "بيعية" : "شرائية") : tp === "sales" ? "Sales" : "Purchase"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-party">
                  {formType === "sales" ? (ar ? "العميل" : "Customer") : ar ? "المورد" : "Supplier"}
                </Label>
                <select
                  id="inv-party"
                  value={formPartyId}
                  onChange={(e) => setFormPartyId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">—</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="inv-issue">{ar ? "تاريخ الإصدار" : "Issue date"}</Label>
                <Input id="inv-issue" type="date" dir="ltr" value={formIssue} onChange={(e) => setFormIssue(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-due">{ar ? "تاريخ الاستحقاق" : "Due date"}</Label>
                <Input id="inv-due" type="date" dir="ltr" value={formDue} onChange={(e) => setFormDue(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-vat">{ar ? "الضريبة الافتراضية %" : "Default VAT %"}</Label>
                <Input id="inv-vat" type="number" dir="ltr" min="0" max="100" step="0.01" value={formVatRate} onChange={(e) => setFormVatRate(e.target.value)} className="h-9 text-end tabular-nums" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-currency">{ar ? "العملة" : "Currency"}</Label>
              <Input id="inv-currency" value={formCurrency} readOnly className="h-9 max-w-32" dir="ltr" />
              <p className="text-xs text-muted-foreground">{ar ? "تدعم المحاسبة الريال السعودي فقط. تبقى السجلات القديمة بعملتها الأصلية للمراجعة." : "Accounting supports SAR. Existing foreign-currency records retain their original currency for review."}</p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/50">
              <div className="grid min-w-[560px] grid-cols-[1fr_80px_90px_70px_70px_32px] gap-2 border-b border-border/50 bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                <span>{ar ? "الوصف" : "Description"}</span>
                <span>{ar ? "الكمية" : "Qty"}</span>
                <span>{ar ? "السعر" : "Price"}</span>
                <span>{ar ? "الخصم" : "Disc."}</span>
                <span><LocalizedText text="VAT %" /></span>
                <span />
              </div>
              {lines.map((l) => (
                <div key={l.key} className="grid min-w-[560px] grid-cols-[1fr_80px_90px_70px_70px_32px] items-center gap-2 px-3 py-2">
                  <Input
                    aria-label={ar ? "وصف البند" : "Line description"}
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    placeholder={ar ? "وصف البند" : "Line description"}
                    className="h-9"
                  />
                  <Input aria-label={ar ? "الكمية" : "Quantity"} type="number" dir="ltr" min="0.001" step="0.001" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} className="h-9 text-end tabular-nums" />
                  <Input aria-label={ar ? "سعر الوحدة" : "Unit price"} type="number" dir="ltr" min="0" step="0.01" value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: e.target.value })} className="h-9 text-end tabular-nums" />
                  <Input aria-label={ar ? "الخصم" : "Discount"} type="number" dir="ltr" min="0" step="0.01" value={l.discount} onChange={(e) => updateLine(l.key, { discount: e.target.value })} className="h-9 text-end tabular-nums" />
                  <Input aria-label={ar ? "ضريبة البند" : "Line VAT rate"} type="number" dir="ltr" min="0" max="100" step="0.01" value={l.vat_rate} onChange={(e) => updateLine(l.key, { vat_rate: e.target.value })} className="h-9 text-end tabular-nums" />
                  <button
                    type="button"
                    aria-label={ar ? "حذف البند" : "Remove line"}
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length <= 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="px-3 py-2">
                <button type="button" onClick={addLine} disabled={lines.length >= 200} className="text-xs font-medium text-elite-blue-600 hover:text-elite-blue-700">
                  + {ar ? "إضافة سطر" : "Add line"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-4 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-sm">
              <span className="text-muted-foreground">{ar ? "المجموع الفرعي" : "Subtotal"}: <b dir="ltr" className="tabular-nums">{lineTotals ? fmtMoney(lineTotals.subtotal) : "—"}</b></span>
              <span className="text-muted-foreground"><LocalizedText text="VAT:" /> <b dir="ltr" className="tabular-nums">{lineTotals ? fmtMoney(lineTotals.vat_amount) : "—"}</b></span>
              <span className="font-medium">{ar ? "الإجمالي" : "Total"}: <b dir="ltr" className="tabular-nums text-emerald-600">{lineTotals ? fmtMoney(lineTotals.total) : "—"}</b></span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-notes">{ar ? "ملاحظات" : "Notes"}</Label>
              <Input id="inv-notes" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="h-9" />
            </div>

            {!lineTotals && hasLineInput && <p role="status" className="text-xs text-amber-700">{ar ? "أكمل كل بند: وصف، كمية موجبة حتى ٣ منازل عشرية، ومبالغ حتى منزلتين. يجب ألا يتجاوز الخصم قيمة البند." : "Complete every line: description, a positive quantity with up to 3 decimals, and amounts with up to 2 decimals. Discounts cannot exceed the line value."}</p>}
            {formError && <p role="alert" className="text-xs text-red-500">{formError}</p>}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleCreate()}
                disabled={isSaving || !formPartyId || !lineTotals}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {ar ? "حفظ المسودة" : "Save draft"}
              </Button>
              <Button variant="ghost" disabled={isSaving} onClick={() => setCreateOpen(false)}>
                <X className="h-4 w-4" />
                {ar ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Detail dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!detailTarget} onOpenChange={(o) => { if (!o) setDetailTarget(null) }}>
        <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <span dir="ltr" className="font-mono">{detailTarget?.invoice_number ?? ""}</span>
              {" — "}
              {detailTarget ? (detailTarget.customer_name ?? detailTarget.supplier_name ?? "") : ""}
            </DialogTitle>
            <DialogDescription>
              {detailTarget && (
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                    (STATUS_META[detailTarget.status] ?? STATUS_META.draft).className
                  }`}>
                    {ar ? (STATUS_META[detailTarget.status] ?? STATUS_META.draft).ar : (STATUS_META[detailTarget.status] ?? STATUS_META.draft).en}
                  </span>
                  <span dir="ltr" className="text-xs text-muted-foreground">{fmtDate(detailTarget.issue_date)} → {fmtDate(detailTarget.due_date)}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-elite-blue-600" /></div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-border/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-start text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-start font-medium">#</th>
                      <th className="px-3 py-2 text-start font-medium">{ar ? "الوصف" : "Description"}</th>
                      <th className="px-3 py-2 text-start font-medium">{ar ? "الكمية" : "Qty"}</th>
                      <th className="px-3 py-2 text-start font-medium">{ar ? "السعر" : "Price"}</th>
                      <th className="px-3 py-2 text-start font-medium">{ar ? "المبلغ" : "Amount"}</th>
                      <th className="px-3 py-2 text-start font-medium"><LocalizedText text="VAT" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailLines.map((l) => (
                      <tr key={l.line_no} className="border-b border-border/40 last:border-0">
                        <td className="px-3 py-2 text-xs text-muted-foreground">{l.line_no}</td>
                        <td className="px-3 py-2">{l.description}</td>
                        <td className="px-3 py-2 text-xs tabular-nums" dir="ltr">{l.quantity}</td>
                        <td className="px-3 py-2 text-xs tabular-nums" dir="ltr">{fmtMoney(l.unit_price)}</td>
                        <td className="px-3 py-2 text-xs tabular-nums" dir="ltr">{fmtMoney(l.amount)}</td>
                        <td className="px-3 py-2 text-xs tabular-nums" dir="ltr">{fmtMoney(l.vat_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-4 text-sm">
                <span className="text-muted-foreground">{ar ? "المجموع الفرعي" : "Subtotal"}: <b dir="ltr" className="tabular-nums">{fmtMoney(detailTarget?.subtotal)}</b></span>
                <span className="text-muted-foreground"><LocalizedText text="VAT:" /> <b dir="ltr" className="tabular-nums">{fmtMoney(detailTarget?.vat_amount)}</b></span>
                <span className="font-medium">{ar ? "الإجمالي" : "Total"}: <b dir="ltr" className="tabular-nums text-emerald-600">{fmtMoney(detailTarget?.total)} {detailTarget?.currency}</b></span>
              </div>

              {detailNotes.length > 0 && (
                <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{ar ? "الإشعارات المرتبطة" : "Related notes"}</p>
                  <div className="space-y-1.5">
                    {detailNotes.map((n) => (
                      <div key={n.id} className="flex items-center justify-between text-xs">
                        <span dir="ltr" className="font-mono">{n.number}</span>
                        <span className={n.kind === "credit" ? "text-purple-600" : "text-orange-600"}>
                          {ar ? (n.kind === "credit" ? "إشعار دائن" : "إشعار مدين") : n.kind === "credit" ? "Credit note" : "Debit note"}
                        </span>
                        <span dir="ltr" className="tabular-nums font-medium">{fmtMoney(n.total)}</span>
                        <span className="text-muted-foreground">{n.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detailTarget && detailTarget.status === "issued" && (
                <div className="flex items-center gap-2 border-t border-border/50 pt-3">
                  <Button
                    onClick={() => void runAction("finalize", detailTarget)}
                    disabled={busyId === detailTarget.id}
                    className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
                  >
                    {busyId === detailTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {ar ? "اعتماد نهائي (إصدار حدث)" : "Finalize (emits event)"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Cancel dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "إلغاء الفاتورة" : "Cancel invoice"}</DialogTitle>
            <DialogDescription>
              <span dir="ltr" className="font-mono">{cancelTarget?.invoice_number ?? ""}</span>
              {" — "}
              {ar ? "يمكن إلغاء الفواتير غير المدفوعة فقط. السبب مطلوب." : "Only unpaid invoices can be cancelled. A reason is required."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              dir="rtl"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={ar ? "سبب الإلغاء" : "Cancellation reason"}
              className="h-9"
            />
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleCancel()}
                disabled={isCancelling || !cancelReason.trim()}
                className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
              >
                {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                {ar ? "إلغاء الفاتورة" : "Cancel invoice"}
              </Button>
              <Button variant="ghost" onClick={() => setCancelTarget(null)}>
                <X className="h-4 w-4" />
                {ar ? "تراجع" : "Back"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Credit note dialog ────────────────────────────────────────── */}
      <Dialog open={!!creditTarget} onOpenChange={(o) => { if (!o) setCreditTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "إشعار دائن" : "Credit note"}</DialogTitle>
            <DialogDescription>
              <span dir="ltr" className="font-mono">{creditTarget?.invoice_number ?? ""}</span>
              {" — "}
              {ar
                ? "عكس كامل للفاتورة؛ يُصدر إشعاراً دائناً نهائياً ويحوّل الفاتورة إلى \"معتمدة بإشعار\"."
                : "Full reversal of the invoice; issues a finalized credit note and marks the invoice as credited."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              dir="rtl"
              value={creditReason}
              onChange={(e) => setCreditReason(e.target.value)}
              placeholder={ar ? "سبب الإشعار الدائن" : "Credit note reason"}
              className="h-9"
            />
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleCredit()}
                disabled={isCrediting || !creditReason.trim()}
                className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
              >
                {isCrediting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {ar ? "إصدار الإشعار الدائن" : "Issue credit note"}
              </Button>
              <Button variant="ghost" onClick={() => setCreditTarget(null)}>
                <X className="h-4 w-4" />
                {ar ? "تراجع" : "Back"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Debit note dialog ─────────────────────────────────────────── */}
      <Dialog open={!!debitTarget} onOpenChange={(o) => { if (!o) setDebitTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "إشعار مدين" : "Debit note"}</DialogTitle>
            <DialogDescription>
              <span dir="ltr" className="font-mono">{debitTarget?.invoice_number ?? ""}</span>
              {" — "}
              {ar ? "رسوم إضافية على فاتورة معتمدة، مع احتساب الضريبة." : "Additional charge against a finalized invoice, with VAT applied."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dn-amount">{ar ? "المبلغ (قبل الضريبة)" : "Amount (excl. VAT)"}</Label>
                <Input
                  id="dn-amount"
                  type="number"
                  dir="ltr"
                  min="0"
                  step="0.01"
                  value={debitAmount}
                  onChange={(e) => setDebitAmount(e.target.value)}
                  className="h-9 text-end tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{ar ? "الضريبة %" : "VAT %"}</Label>
                <Input type="number" dir="ltr" min="0" max="100" step="0.01" value={formVatRate} onChange={(e) => setFormVatRate(e.target.value)} className="h-9 text-end tabular-nums" />
              </div>
            </div>
            {Number(debitAmount || 0) > 0 && (
              <p className="text-xs text-muted-foreground" dir="ltr"><LocalizedText text="VAT:" />{fmtMoney(round2((Number(debitAmount) * Number(formVatRate || 0)) / 100))} <LocalizedText text="· Total:" /> {fmtMoney(round2(Number(debitAmount) + (Number(debitAmount) * Number(formVatRate || 0)) / 100))}<LocalizedText text="SAR" /></p>
            )}
            <Input
              dir="rtl"
              value={debitReason}
              onChange={(e) => setDebitReason(e.target.value)}
              placeholder={ar ? "سبب الإشعار المدين" : "Debit note reason"}
              className="h-9"
            />
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleDebit()}
                disabled={isDebiting || !debitReason.trim() || Number(debitAmount || 0) <= 0}
                className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800"
              >
                {isDebiting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeDollarSign className="h-4 w-4" />}
                {ar ? "إصدار الإشعار المدين" : "Issue debit note"}
              </Button>
              <Button variant="ghost" onClick={() => setDebitTarget(null)}>
                <X className="h-4 w-4" />
                {ar ? "تراجع" : "Back"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
