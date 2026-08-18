"use client"

// Phase 5 — Invoice Engine manager: list + create draft (with lines editor) +
// detail + lifecycle (issue / finalize / cancel) + credit & debit notes.
// Bilingual (AR/EN, RTL-aware), reuses EnterpriseModulePage like the other
// financial managers. Rendered from the /invoices page.

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
  issueInvoice,
  finalizeInvoice,
  cancelInvoice,
  issueCreditNote,
  issueDebitNote,
  exportInvoicesCsv,
  type InvoiceType,
} from "@/lib/accounting/invoices"
import { generateInvoiceDocument } from "@/lib/accounting/invoice-docs"
import {
  FileText, Plus, Send, Check, Ban, RotateCcw, ChevronDown, Download, Save, X, Printer,
  Loader2, CheckCircle2, AlertTriangle, ReceiptText, BadgeDollarSign, CircleDollarSign,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
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

function computeLineTotals(lines: LineDraft[]) {
  let subtotal = 0
  let discount = 0
  let vat = 0
  const valid = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0)
  for (const l of valid) {
    const gross = round2(Number(l.quantity) * Number(l.unit_price || 0))
    const disc = round2(Number(l.discount || 0))
    const amount = round2(gross - disc)
    const vatAmount = round2((amount * Number(l.vat_rate || 0)) / 100)
    subtotal += amount
    discount += disc
    vat += vatAmount
  }
  const s = round2(subtotal)
  const v = round2(vat)
  return { subtotal: s, discount: round2(discount), vat_amount: v, total: round2(s + v) }
}

// ── Main component ────────────────────────────────────────────────────────

export function InvoicesManager() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const [customers, setCustomers] = useState<PartyOption[]>([])
  const [suppliers, setSuppliers] = useState<PartyOption[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<InvoiceRow | null>(null)
  const [detailLines, setDetailLines] = useState<InvoiceLineRow[]>([])
  const [detailNotes, setDetailNotes] = useState<{ id: string; kind: "credit" | "debit"; number: string; total: number; reason: string; issue_date: string }[]>([])
  const [cancelTarget, setCancelTarget] = useState<InvoiceRow | null>(null)
  const [creditTarget, setCreditTarget] = useState<InvoiceRow | null>(null)
  const [debitTarget, setDebitTarget] = useState<InvoiceRow | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id,invoice_number,invoice_type,issue_date,due_date,status,subtotal,discount,vat_amount,total,currency,customers(name_ar),suppliers(name_ar)"
      )
      .is("deleted_at", null)
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200)
    if (error) {
      console.error(error)
      setRows([])
    } else {
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
          customer_name: r.customers?.name_ar ?? null,
          supplier_name: r.suppliers?.name_ar ?? null,
        }))
      )
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const [custRes, suppRes] = await Promise.all([
        supabase.from("customers").select("id,customer_code,name_ar").is("deleted_at", null).order("customer_code", { ascending: true }).limit(200),
        supabase.from("suppliers").select("id,supplier_code,name_ar").is("deleted_at", null).order("supplier_code", { ascending: true }).limit(200),
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
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.invoice_number.toLowerCase().includes(q) ||
        (r.customer_name ?? "").toLowerCase().includes(q) ||
        (r.supplier_name ?? "").toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    )
  }, [rows, search])

  const totalValue = rows
    .filter((r) => r.status !== "cancelled" && r.status !== "credited")
    .reduce((s, r) => s + r.total, 0)

  const kpiCards: KpiCardData[] = [
    { label: ar ? "الفواتير" : "Invoices", value: rows.length, icon: FileText, color: "#1E5A99" },
    { label: ar ? "مسودات" : "Drafts", value: rows.filter((r) => r.status === "draft").length, icon: ReceiptText, color: "#64748B" },
    { label: ar ? "معتمدة" : "Finalized", value: rows.filter((r) => r.status === "finalized").length, icon: CheckCircle2, color: "#10B981" },
    {
      label: ar ? "قيمة الفواتير (ر.س)" : "Total value (SAR)",
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
  const [formNotes, setFormNotes] = useState("")
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(1)])
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const lineTotals = computeLineTotals(lines)

  const openCreate = () => {
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

  async function handleCreate() {
    setIsSaving(true)
    setFormError(null)
    const res = await createInvoiceDraft({
      invoice_type: formType,
      customer_id: formType === "sales" ? formPartyId || null : null,
      supplier_id: formType === "purchase" ? formPartyId || null : null,
      issue_date: formIssue,
      due_date: formDue,
      vat_rate: Number(formVatRate || 0),
      notes: formNotes || null,
      lines: lines
        .filter((l) => l.description.trim() && Number(l.quantity) > 0)
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price || 0),
          discount: Number(l.discount || 0),
          vat_rate: Number(l.vat_rate || formVatRate || 0),
        })),
    })
    setIsSaving(false)
    if (res.success) {
      flash("ok", ar ? "تم إنشاء مسودة الفاتورة." : "Invoice draft created.")
      setCreateOpen(false)
      await load()
    } else {
      setFormError(res.error ?? "Failed")
    }
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
  async function handlePrint(r: InvoiceRow) {
    setPrintingId(r.id)
    const res = await generateInvoiceDocument(r.id)
    setPrintingId(null)
    if (res.success && res.html) {
      const win = window.open("", "_blank")
      if (win) {
        win.document.write(res.html)
        win.document.close()
        setTimeout(() => win.print(), 300)
      }
      flash("ok", ar ? `تم إنشاء مستند ${res.docNumber}` : `Document ${res.docNumber} generated`)
    } else {
      flash("err", res.error ?? "Print failed")
    }
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
      {feedback && (
        <div
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
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel={ar ? "فاتورة جديدة" : "New invoice"}
        onPrimaryCta={openCreate}
        primaryCtaIcon={Plus}
        toolbarActions={
          <button
            onClick={() => void handleExport()}
            disabled={isExporting}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 disabled:opacity-50"
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {ar ? "تصدير CSV" : "Export CSV"}
          </button>
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
            <div className="flex items-center gap-1">
              {canIssue && (
                <button
                  onClick={() => void runAction("issue", r)}
                  disabled={busyId === r.id}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-blue-500/25 bg-blue-500/10 px-2 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/20 disabled:opacity-50"
                >
                  {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {ar ? "إصدار" : "Issue"}
                </button>
              )}
              {canFinalize && (
                <button
                  onClick={() => void runAction("finalize", r)}
                  disabled={busyId === r.id}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  {ar ? "اعتماد" : "Finalize"}
                </button>
              )}
              {canCredit && (
                <button
                  onClick={() => { setCreditTarget(r); setCreditReason("") }}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-purple-500/25 bg-purple-500/10 px-2 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-500/20"
                  title={ar ? "إشعار دائن" : "Credit note"}
                >
                  <RotateCcw className="h-3 w-3" />
                  {ar ? "دائن" : "Credit"}
                </button>
              )}
              {canDebit && (
                <button
                  onClick={() => { setDebitTarget(r); setDebitAmount(""); setDebitReason("") }}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-orange-500/25 bg-orange-500/10 px-2 text-xs font-medium text-orange-600 transition-colors hover:bg-orange-500/20"
                  title={ar ? "إشعار مدين" : "Debit note"}
                >
                  <BadgeDollarSign className="h-3 w-3" />
                  {ar ? "مدين" : "Debit"}
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => { setCancelTarget(r); setCancelReason("") }}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20"
                >
                  <Ban className="h-3 w-3" />
                  {ar ? "إلغاء" : "Cancel"}
                </button>
              )}
              <button
                onClick={() => void handlePrint(r)}
                disabled={printingId === r.id}
                title={ar ? "طباعة / PDF مع رمز التحقق" : "Print / PDF with verification QR"}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-500/25 bg-slate-500/10 px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-500/20 disabled:opacity-50"
              >
                {printingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3" />}
                {ar ? "طباعة" : "Print"}
              </button>
              <button
                onClick={() => void openDetail(r)}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/50 bg-muted/30 px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60"
              >
                <ChevronDown className="h-3 w-3" />
                {ar ? "تفاصيل" : "Details"}
              </button>
            </div>
          )
        }}
        isLoading={isLoading}
        emptyStateMessage={ar ? "لا توجد فواتير بعد. أنشئ أول فاتورة." : "No invoices yet. Create your first invoice."}
      />

      {/* ── Create draft dialog ───────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false) }}>
        <DialogContent className="max-w-2xl rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{ar ? "فاتورة جديدة (مسودة)" : "New invoice (draft)"}</DialogTitle>
            <DialogDescription>
              {ar
                ? "تُحسب الإجماليات في الخادم بقيم عشرية دقيقة؛ الفاتورة المعتمدة غير قابلة للتعديل"
                : "Totals are computed server-side with exact decimal math; finalized invoices are immutable"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{ar ? "النوع" : "Type"}</Label>
                <div className="flex gap-2">
                  {(["sales", "purchase"] as InvoiceType[]).map((tp) => (
                    <button
                      key={tp}
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

            <div className="rounded-xl border border-border/50">
              <div className="grid grid-cols-[1fr_80px_90px_70px_70px_32px] gap-2 border-b border-border/50 bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                <span>{ar ? "الوصف" : "Description"}</span>
                <span>{ar ? "الكمية" : "Qty"}</span>
                <span>{ar ? "السعر" : "Price"}</span>
                <span>{ar ? "الخصم" : "Disc."}</span>
                <span>VAT %</span>
                <span />
              </div>
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-[1fr_80px_90px_70px_70px_32px] items-center gap-2 px-3 py-2">
                  <Input
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    placeholder={ar ? "وصف البند" : "Line description"}
                    className="h-9"
                  />
                  <Input type="number" dir="ltr" min="0" step="1" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} className="h-9 text-end tabular-nums" />
                  <Input type="number" dir="ltr" min="0" step="0.01" value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: e.target.value })} className="h-9 text-end tabular-nums" />
                  <Input type="number" dir="ltr" min="0" step="0.01" value={l.discount} onChange={(e) => updateLine(l.key, { discount: e.target.value })} className="h-9 text-end tabular-nums" />
                  <Input type="number" dir="ltr" min="0" max="100" step="0.01" value={l.vat_rate} onChange={(e) => updateLine(l.key, { vat_rate: e.target.value })} className="h-9 text-end tabular-nums" />
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length <= 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="px-3 py-2">
                <button type="button" onClick={addLine} className="text-xs font-medium text-elite-blue-600 hover:text-elite-blue-700">
                  + {ar ? "إضافة سطر" : "Add line"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-4 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-sm">
              <span className="text-muted-foreground">{ar ? "المجموع الفرعي" : "Subtotal"}: <b dir="ltr" className="tabular-nums">{fmtMoney(lineTotals.subtotal)}</b></span>
              <span className="text-muted-foreground">VAT: <b dir="ltr" className="tabular-nums">{fmtMoney(lineTotals.vat_amount)}</b></span>
              <span className="font-medium">{ar ? "الإجمالي" : "Total"}: <b dir="ltr" className="tabular-nums text-emerald-600">{fmtMoney(lineTotals.total)}</b></span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-notes">{ar ? "ملاحظات" : "Notes"}</Label>
              <Input id="inv-notes" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="h-9" />
            </div>

            {formError && <p className="text-xs text-red-500">{formError}</p>}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleCreate()}
                disabled={isSaving || !formPartyId || lines.filter((l) => l.description.trim() && Number(l.quantity) > 0).length === 0}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {ar ? "حفظ المسودة" : "Save draft"}
              </Button>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                <X className="h-4 w-4" />
                {ar ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Detail dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!detailTarget} onOpenChange={(o) => { if (!o) setDetailTarget(null) }}>
        <DialogContent className="max-w-2xl rounded-2xl max-h-[85vh] overflow-y-auto">
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
                      <th className="px-3 py-2 text-start font-medium">VAT</th>
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
                <span className="text-muted-foreground">VAT: <b dir="ltr" className="tabular-nums">{fmtMoney(detailTarget?.vat_amount)}</b></span>
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
              <p className="text-xs text-muted-foreground" dir="ltr">
                VAT: {fmtMoney(round2((Number(debitAmount) * Number(formVatRate || 0)) / 100))} · Total: {fmtMoney(round2(Number(debitAmount) + (Number(debitAmount) * Number(formVatRate || 0)) / 100))} SAR
              </p>
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
