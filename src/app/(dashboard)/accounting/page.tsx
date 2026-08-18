"use client"

import { useEffect, useState } from "react"
import { useActionState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import {
  BookOpenText, ListTree, Scale, HandCoins, Wallet, Plus, Save, X, CheckCircle2, AlertTriangle, Percent, Landmark,
  RotateCcw, Send, Check, Ban, CalendarRange, Lock, Unlock, Loader2, Users, Store, ListChecks, Zap,
  ArrowDownLeft, ArrowUpRight, Building2, FileCheck2, KeyRound,
} from "lucide-react"
import {
  postJournalEntry,
  createReceivable,
  createJournalDraft,
  submitJournalEntry,
  approveJournalEntry,
  rejectJournalEntry,
  reverseJournalEntry,
  closeAccountingPeriod,
  reopenAccountingPeriod,
} from "@/lib/accounting/actions"
import { ChartOfAccountsManager } from "./components/chart-of-accounts-manager"
import { PartiesManager } from "./components/parties-manager"
import { StatementsManager } from "./components/statements-manager"
import { runEventDispatcher } from "@/lib/accounting/dispatcher"
import { runZatcaAdapter, getZatcaTransmission } from "@/lib/accounting/zatca"
import {
  listZatcaCsids,
  onboardZatcaCsids,
  type ZatcaCsidSummary,
  type ZatcaCsidEnvironment,
} from "@/lib/accounting/zatca-csid"
import { computeVatNetPosition } from "@/lib/accounting/vat-math"
import { recordPayment, voidPayment, createBankAccount } from "@/lib/accounting/payments"
import {
  resolveVatReviewItem,
  exportVatReconciliationCsv,
  generateVatReconciliationReport,
  getVatReturn,
  exportVatReturnCsv,
  generateVatReturnReport,
  type VatReturnData,
} from "@/lib/accounting/vat"

// ── Row shapes ────────────────────────────────────────────────────────────
interface JournalRow {
  id: string
  entry_ref: string
  entry_date: string
  entry_type: string
  status: string
  description_ar: string | null
  description_en: string | null
  posted_at: string | null
  journal_approvals?: { status: string } | null
}

interface PeriodRow {
  id: string
  period_year: number
  period_month: number
  status: string
  opened_at: string | null
  closed_at: string | null
  reopen_reason: string | null
}

interface AccountRow {
  id: string
  account_code: string
  name_ar: string
  name_en: string
  account_type: string
  normal_balance: string
}

interface ArApRow {
  id: string
  invoice_ref: string
  invoice_date: string
  due_date: string
  amount: number
  vat_amount: number
  total_amount: number
  paid_amount: number
  status: string
}

interface TrialRow {
  account_code: string
  name_ar: string
  name_en: string
  account_type: string
  normal_balance: string
  total_debit: number | null
  total_credit: number | null
  net_balance: number | null
}

interface VatLedgerRow {
  id: string
  period_year: number
  period_month: number
  invoice_ref: string
  invoice_date: string
  vat_base_amount: number
  vat_rate: number
  vat_amount: number
  vat_recoverability?: string
}

interface VatAdjustmentRow {
  id: string
  period_year: number
  period_month: number
  adjustment_type: string
  direction: string
  base_amount: number
  vat_amount: number
  reason: string | null
  status: string
}

interface VatPeriodRow {
  id: string
  period_year: number
  period_month: number
  status: string
}

interface PaymentRow {
  id: string
  payment_ref: string
  direction: string
  payment_date: string
  amount: number
  method: string
  reference: string | null
  status: string
  payment_allocations?: { id: string }[] | null
  customers?: { name_ar: string | null; name_en: string | null } | null
  suppliers?: { name_ar: string | null; name_en: string | null } | null
  bank_accounts?: { bank_name: string } | null
}

interface BankAccountRow {
  id: string
  bank_name: string
  account_name: string
  iban: string
  currency: string
  opening_balance: number
  is_active: boolean
  coa_account_code?: string | null
}

interface OpenArApRow extends ArApRow {
  party_name?: string | null
  customer_id?: string | null
  supplier_id?: string | null
}

interface PayAllocDraft {
  key: number
  id: string
  receivable_id: string | null
  payable_id: string | null
  label: string
  party: string
  outstanding: number
  amount: string
  selected: boolean
}

interface EventRow {
  id: string
  idempotency_key: string
  source_type: string
  event_type: string
  processing_status: string
  event_date: string
  created_at: string
  processed_at: string | null
  error_message: string | null
}

interface VatReviewItem {
  id: string
  invoice_ref: string
  invoice_date: string
  vat_base_amount: number
  vat_rate: number
  vat_amount: number
  supplier_id: string | null
}

interface ZatcaTransmissionRow {
  id: string
  doc_ref: string
  doc_type: string
  status: string
  zatca_uuid: string | null
  error_message: string | null
  transmitted_at: string | null
  created_at: string
}

interface ZatcaDetail {
  doc_ref: string
  doc_type: string
  status: string
  zatca_uuid: string | null
  payload_xml: string
  response: Record<string, unknown> | null
  transmitted_at: string | null
  error_message: string | null
}

interface VatReconRow {
  period_id: string | null
  period_year: number
  period_month: number
  period_status: string | null
  output_vat: number
  recoverable_input_vat: number
  non_recoverable_vat: number
  pending_review_vat: number
  adjustments_output: number
  adjustments_input: number
  pending_review_rows: number
  net_position: number
}

const TYPE_AR: Record<string, string> = {
  asset: "أصل",
  liability: "التزام",
  equity: "حقوق ملكية",
  income: "إيراد",
  expense: "مصروف",
}

const JOURNAL_STATUS: Record<string, { ar: string; en: string; className: string }> = {
  draft: { ar: "مسودة", en: "Draft", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  posted: { ar: "مرحّلة", en: "Posted", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  reversed: { ar: "معكوسة", en: "Reversed", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

const APPROVAL_STATUS: Record<string, { ar: string; en: string; className: string }> = {
  submitted: { ar: "قيد المراجعة", en: "In review", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  approved: { ar: "معتمد", en: "Approved", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  rejected: { ar: "مرفوض", en: "Rejected", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

const EVENT_STATUS: Record<string, { ar: string; en: string; className: string }> = {
  pending: { ar: "قيد الانتظار", en: "Pending", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  processed: { ar: "تمت المعالجة", en: "Processed", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  failed: { ar: "فشل", en: "Failed", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  skipped_duplicate: { ar: "مكرر", en: "Duplicate", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

const PERIOD_STATUS: Record<string, { ar: string; en: string; className: string }> = {
  open: { ar: "مفتوحة", en: "Open", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  closing: { ar: "قيد الإغلاق", en: "Closing", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  closed: { ar: "مغلقة", en: "Closed", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  reopened: { ar: "أعيد فتحها", en: "Reopened", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
}

const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const ZATCA_STATUS: Record<string, { ar: string; en: string; className: string }> = {
  not_transmitted: { ar: "غير مُرسلة", en: "Not transmitted", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  pending: { ar: "قيد الإرسال", en: "Pending", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  reported: { ar: "مُبلَّغ عنها", en: "Reported", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  cleared: { ar: "مُخلصة", en: "Cleared", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  rejected: { ar: "مرفوضة", en: "Rejected", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  failed: { ar: "فشل الإرسال", en: "Failed", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

const ZATCA_DOC_TYPE: Record<string, { ar: string; en: string }> = {
  invoice: { ar: "فاتورة", en: "Invoice" },
  credit_note: { ar: "إشعار دائن", en: "Credit note" },
  debit_note: { ar: "إشعار مدين", en: "Debit note" },
}

const ARAP_STATUS: Record<string, { ar: string; en: string; className: string }> = {
  open: { ar: "مفتوحة", en: "Open", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  partially_paid: { ar: "مدفوعة جزئياً", en: "Partially paid", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  paid: { ar: "مدفوعة", en: "Paid", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  overdue: { ar: "متأخرة", en: "Overdue", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  written_off: { ar: "مشطوبة", en: "Written off", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

function fmtDate(d: string | null): string {
  if (!d) return "—"
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return d
  }
}

function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-start font-medium">{children}</th>
}

function TableShell({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-start text-xs text-muted-foreground">
            {headers.map((h) => <Th key={h}>{h}</Th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-muted-foreground">{text}</td>
    </tr>
  )
}

// ── Journal entry line editor state ───────────────────────────────────────
interface LineDraft {
  key: number
  account_id: string
  description: string
  debit: string
  credit: string
}

export default function AccountingPage() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [tab, setTab] = useState("journal")
  const [isLoading, setIsLoading] = useState(true)

  const [journals, setJournals] = useState<JournalRow[]>([])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [trial, setTrial] = useState<TrialRow[]>([])
  const [receivables, setReceivables] = useState<ArApRow[]>([])
  const [payables, setPayables] = useState<ArApRow[]>([])
  const [vatOutput, setVatOutput] = useState<VatLedgerRow[]>([])
  const [vatInput, setVatInput] = useState<VatLedgerRow[]>([])
  const [vatAdjustments, setVatAdjustments] = useState<VatAdjustmentRow[]>([])
  const [vatPeriods, setVatPeriods] = useState<VatPeriodRow[]>([])
  const [vatRecon, setVatRecon] = useState<VatReconRow[]>([])
  const [vatReviewItems, setVatReviewItems] = useState<VatReviewItem[]>([])
  const [reconExporting, setReconExporting] = useState(false)
  const [reconPrinting, setReconPrinting] = useState(false)
  const [vatReturn, setVatReturn] = useState<VatReturnData | null>(null)
  const [vatReturnPeriod, setVatReturnPeriod] = useState<string>("")
  const [returnExporting, setReturnExporting] = useState(false)
  const [returnPrinting, setReturnPrinting] = useState(false)
  const [returnLoading, setReturnLoading] = useState(false)
  const [resolveTarget, setResolveTarget] = useState<VatReviewItem | null>(null)
  const [resolveRecoverability, setResolveRecoverability] = useState<"recoverable" | "non_recoverable">("recoverable")
  const [resolveBusy, setResolveBusy] = useState(false)
  const [vatRefresh, setVatRefresh] = useState(0)
  const [events, setEvents] = useState<EventRow[]>([])
  const [dispatchBusy, setDispatchBusy] = useState(false)
  const [zatcaRows, setZatcaRows] = useState<ZatcaTransmissionRow[]>([])
  const [zatcaCsids, setZatcaCsids] = useState<ZatcaCsidSummary[]>([])
  const [zatcaBusy, setZatcaBusy] = useState(false)
  const [zatcaDetail, setZatcaDetail] = useState<ZatcaDetail | null>(null)
  const [zatcaDetailBusy, setZatcaDetailBusy] = useState(false)
  const [onboardOpen, setOnboardOpen] = useState(false)
  const [onboardEnv, setOnboardEnv] = useState<ZatcaCsidEnvironment>("sandbox")
  const [onboardOtp, setOnboardOtp] = useState("")
  const [onboardBusy, setOnboardBusy] = useState(false)
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([])
  const [openAr, setOpenAr] = useState<OpenArApRow[]>([])
  const [openAp, setOpenAp] = useState<OpenArApRow[]>([])
  const [custOptions, setCustOptions] = useState<{ id: string; name: string }[]>([])
  const [suppOptions, setSuppOptions] = useState<{ id: string; name: string }[]>([])
  const [payRefresh, setPayRefresh] = useState(0)
  const [periods, setPeriods] = useState<PeriodRow[]>([])

  useEffect(() => {
    void (async () => {
      setIsLoading(true)
      const supabase = createClient()

      if (tab === "journal") {
        const { data } = await supabase
          .from("chart_of_accounts")
          .select("id,account_code,name_ar,name_en,account_type,normal_balance")
          .is("deleted_at", null)
          .order("account_code", { ascending: true })
        if (data) setAccounts(data as AccountRow[])
      }

      if (tab === "journal") {
        const { data } = await supabase
          .from("journal_entries")
          .select("id,entry_ref,entry_date,entry_type,status,description_ar,description_en,posted_at,journal_approvals(status)")
          .is("deleted_at", null)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(100)
        if (data) setJournals(data as unknown as JournalRow[])
      } else if (tab === "trial") {
        const { data } = await supabase.from("trial_balance").select("*")
        if (data) setTrial(data as TrialRow[])
      } else if (tab === "receivables") {
        const { data } = await supabase
          .from("receivables")
          .select("id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status")
          .is("deleted_at", null)
          .order("due_date", { ascending: true })
          .limit(200)
        if (data) setReceivables(data as ArApRow[])
      } else if (tab === "payables") {
        const { data } = await supabase
          .from("payables")
          .select("id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status")
          .is("deleted_at", null)
          .order("due_date", { ascending: true })
          .limit(200)
        if (data) setPayables(data as ArApRow[])
      } else if (tab === "vat") {
        const [outRes, inRes, adjRes, perRes, reconRes, reviewRes] = await Promise.all([
          supabase
            .from("vat_output_ledger")
            .select("id,period_year,period_month,invoice_ref,invoice_date,vat_base_amount,vat_rate,vat_amount")
            .order("invoice_date", { ascending: false })
            .limit(200),
          supabase
            .from("vat_input_ledger")
            .select("id,period_year,period_month,invoice_ref,invoice_date,vat_base_amount,vat_rate,vat_amount,vat_recoverability")
            .order("invoice_date", { ascending: false })
            .limit(200),
          supabase
            .from("vat_adjustments")
            .select("id,period_year,period_month,adjustment_type,direction,base_amount,vat_amount,reason,status")
            .is("deleted_at", null)
            .order("period_year", { ascending: false })
            .order("period_month", { ascending: false })
            .limit(100),
          supabase
            .from("vat_periods")
            .select("id,period_year,period_month,status")
            .is("deleted_at", null)
            .order("period_year", { ascending: false })
            .order("period_month", { ascending: false })
            .limit(24),
          supabase
            .from("vat_reconciliation")
            .select("*")
            .order("period_year", { ascending: false })
            .order("period_month", { ascending: false }),
          supabase
            .from("vat_input_ledger")
            .select("id,invoice_ref,invoice_date,vat_base_amount,vat_rate,vat_amount,supplier_id")
            .eq("vat_recoverability", "pending_review")
            .order("invoice_date", { ascending: true })
            .limit(200),
        ])
        if (outRes.data) setVatOutput(outRes.data as VatLedgerRow[])
        if (inRes.data) setVatInput(inRes.data as VatLedgerRow[])
        if (adjRes.data) setVatAdjustments(adjRes.data as VatAdjustmentRow[])
        if (perRes.data) setVatPeriods(perRes.data as VatPeriodRow[])
        if (reconRes.data) setVatRecon(reconRes.data as VatReconRow[])
        if (reviewRes.data) setVatReviewItems(reviewRes.data as unknown as VatReviewItem[])
      } else if (tab === "payments") {
        const [payRes, bankRes, arRes, apRes, custRes, suppRes] = await Promise.all([
          supabase
            .from("finance_payments")
            .select("id,payment_ref,direction,payment_date,amount,method,reference,status,payment_allocations(id),bank_accounts(bank_name),customers(name_ar,name_en),suppliers(name_ar,name_en)")
            .is("deleted_at", null)
            .order("payment_date", { ascending: false })
            .limit(200),
          supabase
            .from("bank_accounts")
            .select("id,bank_name,account_name,iban,currency,opening_balance,is_active,coa_account_code")
            .is("deleted_at", null)
            .order("bank_name", { ascending: true })
            .limit(50),
          supabase
            .from("receivables")
            .select("id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status,customer_id,customers(name_ar,name_en)")
            .is("deleted_at", null)
            .in("status", ["open", "partially_paid", "overdue"])
            .order("due_date", { ascending: true })
            .limit(100),
          supabase
            .from("payables")
            .select("id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status,supplier_id,suppliers(name_ar,name_en)")
            .is("deleted_at", null)
            .in("status", ["open", "partially_paid", "overdue"])
            .order("due_date", { ascending: true })
            .limit(100),
          supabase
            .from("customers")
            .select("id,name_ar,name_en")
            .is("deleted_at", null)
            .order("name_ar", { ascending: true })
            .limit(200),
          supabase
            .from("suppliers")
            .select("id,name_ar,name_en")
            .is("deleted_at", null)
            .order("name_ar", { ascending: true })
            .limit(200),
        ])
        if (payRes.data) setPayments(payRes.data as unknown as PaymentRow[])
        if (bankRes.data) setBankAccounts(bankRes.data as BankAccountRow[])
        if (arRes.data) {
          setOpenAr(
            (arRes.data as unknown as (ArApRow & { customers?: { name_ar: string | null; name_en: string | null } | null })[]).map((r) => ({
              ...r,
              party_name: r.customers ? (r.customers.name_ar ?? r.customers.name_en ?? null) : null,
            }))
          )
        }
        if (apRes.data) {
          setOpenAp(
            (apRes.data as unknown as (ArApRow & { suppliers?: { name_ar: string | null; name_en: string | null } | null })[]).map((r) => ({
              ...r,
              party_name: r.suppliers ? (r.suppliers.name_ar ?? r.suppliers.name_en ?? null) : null,
            }))
          )
        }
        if (custRes.data) {
          setCustOptions((custRes.data as { id: string; name_ar: string | null; name_en: string | null }[]).map((c) => ({ id: c.id, name: c.name_ar ?? c.name_en ?? "" })))
        }
        if (suppRes.data) {
          setSuppOptions((suppRes.data as { id: string; name_ar: string | null; name_en: string | null }[]).map((s) => ({ id: s.id, name: s.name_ar ?? s.name_en ?? "" })))
        }
      } else if (tab === "periods") {
        const { data } = await supabase
          .from("accounting_periods")
          .select("id,period_year,period_month,status,opened_at,closed_at,reopen_reason")
          .is("deleted_at", null)
          .order("period_year", { ascending: false })
          .order("period_month", { ascending: false })
          .limit(60)
        if (data) setPeriods(data as PeriodRow[])
      } else if (tab === "events") {
        const { data } = await supabase
          .from("financial_events")
          .select("id,idempotency_key,source_type,event_type,processing_status,event_date,created_at,processed_at,error_message")
          .order("created_at", { ascending: false })
          .limit(100)
        if (data) setEvents(data as EventRow[])
      } else if (tab === "zatca") {
        const { data } = await supabase
          .from("zatca_transmissions")
          .select("id,doc_ref,doc_type,status,zatca_uuid,error_message,transmitted_at,created_at")
          .order("created_at", { ascending: false })
          .limit(100)
        if (data) setZatcaRows(data as ZatcaTransmissionRow[])
        const csids = await listZatcaCsids()
        if (csids.success && csids.csids) setZatcaCsids(csids.csids)
      }

      setIsLoading(false)
    })()
  }, [tab, payRefresh, vatRefresh])

  // ── VAT return (Phase 12) — auto-select the latest period once the
  // reconciliation list is loaded, then fetch its return summary. Mirror the
  // main loader's `void (async () => {})()` pattern so state updates happen
  // inside the async context (lint react-hooks/set-state-in-effect).
  useEffect(() => {
    if (tab !== "vat" || vatRecon.length === 0) return
    void (async () => {
      const latest = `${vatRecon[0].period_year}-${String(vatRecon[0].period_month).padStart(2, "0")}`
      const period = vatReturnPeriod || latest
      setVatReturnPeriod((p) => (p || latest))
      if (!period) return
      const [year, month] = period.split("-").map(Number)
      if (!year || !month) return
      setReturnLoading(true)
      const res = await getVatReturn({ period_year: year, period_month: month })
      setReturnLoading(false)
      if (res.success && res.data) setVatReturn(res.data)
      else setVatReturn(null)
    })()
  }, [tab, vatRecon, vatReturnPeriod, vatRefresh])

  // ── Create forms ────────────────────────────────────────────────────────
  const [openDialogs, setOpenDialogs] = useState<Record<string, boolean>>({})
  const openDialog = (key: string) => setOpenDialogs((p) => ({ ...p, [key]: true }))
  const closeDialog = (key: string) => setOpenDialogs((p) => ({ ...p, [key]: false }))

  // Journal entry form
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [entryDesc, setEntryDesc] = useState("")
  const [lines, setLines] = useState<LineDraft[]>([
    { key: 1, account_id: "", description: "", debit: "", credit: "" },
    { key: 2, account_id: "", description: "", debit: "", credit: "" },
  ])
  const [journalState, journalAction, isPosting] = useActionState(
    async (_prev: { success: boolean; error?: string } | null, _form: FormData) => {
      const payload = {
        entry_date: entryDate,
        description_ar: entryDesc,
        lines: lines.map((l) => ({
          account_id: l.account_id,
          description: l.description,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
        })),
      }
      const res = asDraft ? await createJournalDraft(payload) : await postJournalEntry(payload)
      if (res.success) closeDialog("journal")
      return res
    },
    null
  )
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0
  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () =>
    setLines((prev) => [...prev, { key: Date.now(), account_id: "", description: "", debit: "", credit: "" }])
  const removeLine = (key: number) => setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.key !== key) : prev))

  // Draft mode: save as draft (unbalanced allowed) vs post directly.
  const [asDraft, setAsDraft] = useState(false)

  // ── Phase 3 action handlers ────────────────────────────────────────────
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null)
  const [reversalTarget, setReversalTarget] = useState<JournalRow | null>(null)
  const [reversalDesc, setReversalDesc] = useState("")
  const [reversalDate, setReversalDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [isReversing, setIsReversing] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<JournalRow | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [isRejecting, setIsRejecting] = useState(false)

  async function reloadJournal() {
    const supabase = createClient()
    const { data } = await supabase
      .from("journal_entries")
      .select("id,entry_ref,entry_date,entry_type,status,description_ar,description_en,posted_at,journal_approvals(status)")
      .is("deleted_at", null)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100)
    if (data) setJournals(data as unknown as JournalRow[])
  }

  const flash = (type: "ok" | "err", text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 6000)
  }

  async function handleJournalAction(action: "submit" | "approve", entry: JournalRow) {
    setBusyEntryId(entry.id)
    const res = action === "submit"
      ? await submitJournalEntry({ entry_id: entry.id })
      : await approveJournalEntry({ entry_id: entry.id })
    setBusyEntryId(null)
    if (res.success) {
      flash("ok", action === "submit"
        ? (ar ? "أُرسل القيد للمراجعة." : "Entry submitted for review.")
        : (ar ? "تم اعتماد القيد وترحيله." : "Entry approved and posted."))
      await reloadJournal()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  async function handleReverse() {
    if (!reversalTarget) return
    setIsReversing(true)
    const res = await reverseJournalEntry({
      entry_id: reversalTarget.id,
      description_ar: reversalDesc || null,
      reversal_date: reversalDate || null,
    })
    setIsReversing(false)
    setReversalTarget(null)
    if (res.success) {
      flash("ok", ar ? "تم عكس القيد بنجاح." : "Entry reversed successfully.")
      await reloadJournal()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  async function handleReject() {
    if (!rejectTarget) return
    setIsRejecting(true)
    const res = await rejectJournalEntry({ entry_id: rejectTarget.id, reason: rejectReason })
    setIsRejecting(false)
    setRejectTarget(null)
    setRejectReason("")
    if (res.success) {
      flash("ok", ar ? "تم رفض القيد." : "Entry rejected.")
      await reloadJournal()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // ── Period actions ──────────────────────────────────────────────────────
  const [busyPeriodId, setBusyPeriodId] = useState<string | null>(null)
  const [reopenTarget, setReopenTarget] = useState<PeriodRow | null>(null)
  const [reopenReason, setReopenReason] = useState("")
  const [isReopening, setIsReopening] = useState(false)

  async function handleClosePeriod(p: PeriodRow) {
    setBusyPeriodId(p.id)
    const res = await closeAccountingPeriod({ period_id: p.id })
    setBusyPeriodId(null)
    if (res.success) {
      flash("ok", ar ? "تم إغلاق الفترة." : "Period closed.")
      setPeriods((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "closed" } : x)))
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  async function handleReopen() {
    if (!reopenTarget) return
    setIsReopening(true)
    const res = await reopenAccountingPeriod({ period_id: reopenTarget.id, reason: reopenReason })
    setIsReopening(false)
    setReopenTarget(null)
    setReopenReason("")
    if (res.success) {
      flash("ok", ar ? "أعيد فتح الفترة." : "Period reopened.")
      setPeriods((prev) => prev.map((x) => (x.id === reopenTarget.id ? { ...x, status: "reopened", reopen_reason: reopenReason } : x)))
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // ── Event dispatcher (Phase 9) ──────────────────────────────────────────
  async function reloadEvents() {
    const supabase = createClient()
    const { data } = await supabase
      .from("financial_events")
      .select("id,idempotency_key,source_type,event_type,processing_status,event_date,created_at,processed_at,error_message")
      .order("created_at", { ascending: false })
      .limit(100)
    if (data) setEvents(data as EventRow[])
  }

  async function handleRunDispatcher() {
    setDispatchBusy(true)
    const res = await runEventDispatcher()
    setDispatchBusy(false)
    if (res.success) {
      flash(
        "ok",
        ar
          ? `تمت المعالجة: ${res.processed ?? 0} · مكرر: ${res.skipped ?? 0} · فشل: ${res.failed ?? 0}`
          : `Dispatched: ${res.processed ?? 0} processed · ${res.skipped ?? 0} skipped · ${res.failed ?? 0} failed`
      )
      await reloadEvents()
    } else {
      flash("err", res.error ?? "Dispatcher failed")
    }
  }

  // ── ZATCA adapter (Phase 15) ──────────────────────────────────────────
  async function reloadZatca() {
    const supabase = createClient()
    const { data } = await supabase
      .from("zatca_transmissions")
      .select("id,doc_ref,doc_type,status,zatca_uuid,error_message,transmitted_at,created_at")
      .order("created_at", { ascending: false })
      .limit(100)
    if (data) setZatcaRows(data as ZatcaTransmissionRow[])
    const csids = await listZatcaCsids()
    if (csids.success && csids.csids) setZatcaCsids(csids.csids)
  }

  async function handleRunZatca() {
    setZatcaBusy(true)
    const res = await runZatcaAdapter()
    setZatcaBusy(false)
    if (res.success) {
      flash(
        "ok",
        ar
          ? `ZATCA: أُرسلت ${res.processed ?? 0} · تخطّي ${res.skipped ?? 0} · فشل ${res.failed ?? 0}${res.sandbox ? " (وضع تجريبي)" : ""}`
          : `ZATCA: ${res.processed ?? 0} transmitted · ${res.skipped ?? 0} skipped · ${res.failed ?? 0} failed${res.sandbox ? " (sandbox)" : ""}`
      )
      await reloadZatca()
    } else {
      flash("err", res.error ?? "ZATCA adapter failed")
    }
  }

  async function handleViewZatca(id: string) {
    setZatcaDetailBusy(true)
    const res = await getZatcaTransmission(id)
    setZatcaDetailBusy(false)
    if (res.success && res.transmission) setZatcaDetail(res.transmission)
    else flash("err", res.error ?? "Failed to load transmission")
  }

  async function handleOnboardZatca() {
    setOnboardBusy(true)
    const res = await onboardZatcaCsids({ environment: onboardEnv, otp: onboardOtp.trim() })
    setOnboardBusy(false)
    if (res.success) {
      flash(
        "ok",
        ar
          ? `تم الإعداد (${onboardEnv}) — compliance ✓ · production ✓${res.sandbox ? " (وضع تجريبي)" : ""}`
          : `Onboarding complete (${onboardEnv}) — compliance ✓ · production ✓${res.sandbox ? " (sandbox)" : ""}`
      )
      setOnboardOpen(false)
      setOnboardOtp("")
      await reloadZatca()
    } else {
      flash("err", res.error ?? "Onboarding failed")
    }
  }

  // ── VAT reconciliation (Phase 11) ──────────────────────────────────────
  async function handleExportVatRecon() {
    setReconExporting(true)
    const res = await exportVatReconciliationCsv()
    setReconExporting(false)
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `vat-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      flash("ok", ar ? "تم تصدير التسوية الضريبية." : "VAT reconciliation exported.")
    } else {
      flash("err", res.error ?? "Export failed")
    }
  }

  async function handlePrintVatRecon() {
    setReconPrinting(true)
    const res = await generateVatReconciliationReport()
    setReconPrinting(false)
    if (res.success && res.html) {
      const win = window.open("", "_blank")
      if (win) {
        win.document.write(res.html)
        win.document.close()
        setTimeout(() => win.print(), 300)
      }
    } else {
      flash("err", res.error ?? "Report failed")
    }
  }

  async function handleResolveReview() {
    if (!resolveTarget) return
    setResolveBusy(true)
    const res = await resolveVatReviewItem({ id: resolveTarget.id, recoverability: resolveRecoverability })
    setResolveBusy(false)
    if (res.success) {
      flash("ok", ar ? "تم تصنيف البند." : "Review item classified.")
      setResolveTarget(null)
      setVatRefresh((k) => k + 1)
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // ── VAT return (Phase 12) handlers ──────────────────────────────────────
  async function handleExportVatReturn() {
    if (!vatReturnPeriod) return
    setReturnExporting(true)
    const [year, month] = vatReturnPeriod.split("-").map(Number)
    const res = await exportVatReturnCsv({ period_year: year, period_month: month })
    setReturnExporting(false)
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `vat-return-${vatReturnPeriod}.csv`
      a.click()
      URL.revokeObjectURL(url)
      flash("ok", ar ? "تم تصدير الإقرار الضريبي." : "VAT return exported.")
    } else {
      flash("err", res.error ?? "Export failed")
    }
  }

  async function handlePrintVatReturn() {
    if (!vatReturnPeriod) return
    setReturnPrinting(true)
    const [year, month] = vatReturnPeriod.split("-").map(Number)
    const res = await generateVatReturnReport({ period_year: year, period_month: month })
    setReturnPrinting(false)
    if (res.success && res.html) {
      const win = window.open("", "_blank")
      if (win) {
        win.document.write(res.html)
        win.document.close()
        setTimeout(() => win.print(), 300)
      }
      flash("ok", ar ? `تم إنشاء مستند ${res.docNumber}` : `Document ${res.docNumber} generated`)
    } else {
      flash("err", res.error ?? "Report failed")
    }
  }

  // ── Payments ───────────────────────────────────────────────────────────
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [payBusy, setPayBusy] = useState(false)
  const [voidBusyId, setVoidBusyId] = useState<string | null>(null)
  const [voidArmedId, setVoidArmedId] = useState<string | null>(null)
  const [payDirection, setPayDirection] = useState<"in" | "out">("in")
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [payAmount, setPayAmount] = useState("")
  const [payMethod, setPayMethod] = useState("transfer")
  const [payBank, setPayBank] = useState("")
  const [payCustomer, setPayCustomer] = useState("")
  const [paySupplier, setPaySupplier] = useState("")
  const [payReference, setPayReference] = useState("")
  const [payAllocs, setPayAllocs] = useState<PayAllocDraft[]>([])

  function syncAllocList(dir: "in" | "out", partyId?: string) {
    const rows = (dir === "in" ? openAr : openAp).filter((r) => {
      if (!partyId) return true
      return dir === "in" ? r.customer_id === partyId : r.supplier_id === partyId
    })
    setPayAllocs(
      rows.map((r, i) => ({
        key: i,
        id: r.id,
        receivable_id: dir === "in" ? r.id : null,
        payable_id: dir === "out" ? r.id : null,
        label: r.invoice_ref,
        party: r.party_name ?? "",
        outstanding: r.total_amount - r.paid_amount,
        amount: "",
        selected: false,
      }))
    )
  }

  function openPayDialog() {
    setPayDirection("in")
    setPayDate(new Date().toISOString().slice(0, 10))
    setPayAmount("")
    setPayMethod("transfer")
    setPayBank("")
    setPayCustomer("")
    setPaySupplier("")
    setPayReference("")
    syncAllocList("in")
    setPayDialogOpen(true)
  }

  async function handleRecordPayment() {
    setPayBusy(true)
    const res = await recordPayment({
      direction: payDirection,
      payment_date: payDate,
      amount: Number(payAmount || 0),
      method: payMethod as "cash" | "transfer" | "cheque" | "wps" | "card",
      bank_account_id: payMethod === "cash" ? null : payBank || null,
      customer_id: payDirection === "in" ? payCustomer || null : null,
      supplier_id: payDirection === "out" ? paySupplier || null : null,
      reference: payReference || null,
      allocations: payAllocs
        .filter((a) => a.selected && Number(a.amount) > 0)
        .map((a) => ({ receivable_id: a.receivable_id, payable_id: a.payable_id, amount: Number(a.amount) })),
    })
    setPayBusy(false)
    if (res.success) {
      flash("ok", ar ? "تم تسجيل الدفعة وترحيلها." : "Payment recorded and posted.")
      setPayDialogOpen(false)
      setPayRefresh((k) => k + 1)
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  async function handleVoidPayment(p: PaymentRow) {
    setVoidBusyId(p.id)
    const res = await voidPayment({ id: p.id })
    setVoidBusyId(null)
    setVoidArmedId(null)
    if (res.success) {
      flash("ok", ar ? `تم إلغاء الدفعة ${p.payment_ref}.` : `Payment ${p.payment_ref} voided.`)
      setPayRefresh((k) => k + 1)
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // ── Bank accounts ──────────────────────────────────────────────────────
  const [bankDialogOpen, setBankDialogOpen] = useState(false)
  const [bankBusy, setBankBusy] = useState(false)
  const [bankName, setBankName] = useState("")
  const [bankAccName, setBankAccName] = useState("")
  const [bankIban, setBankIban] = useState("")
  const [bankAccNum, setBankAccNum] = useState("")
  const [bankOpening, setBankOpening] = useState("")
  const [bankCoa, setBankCoa] = useState("1100")

  async function handleCreateBank() {
    setBankBusy(true)
    const res = await createBankAccount({
      bank_name: bankName,
      account_name: bankAccName,
      iban: bankIban,
      account_number: bankAccNum || null,
      currency: "SAR",
      opening_balance: Number(bankOpening || 0),
      coa_account_code: bankCoa || "1100",
    })
    setBankBusy(false)
    if (res.success) {
      flash("ok", ar ? "تمت إضافة الحساب البنكي." : "Bank account added.")
      setBankDialogOpen(false)
      setBankName("")
      setBankAccName("")
      setBankIban("")
      setBankAccNum("")
      setBankOpening("")
      setPayRefresh((k) => k + 1)
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // Receivable form
  const [rcvRef, setRcvRef] = useState("")
  const [rcvDate, setRcvDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rcvDue, setRcvDue] = useState(() => new Date().toISOString().slice(0, 10))
  const [rcvAmount, setRcvAmount] = useState("")
  const [rcvVat, setRcvVat] = useState("15")
  const [rcvState, rcvAction, isSavingRcv] = useActionState(
    async (_prev: { success: boolean; error?: string } | null, _form: FormData) => {
      const res = await createReceivable({
        invoice_ref: rcvRef,
        invoice_date: rcvDate,
        due_date: rcvDue,
        amount: Number(rcvAmount || 0),
        vat_rate: Number(rcvVat || 0),
      })
      if (res.success) closeDialog("receivable")
      return res
    },
    null
  )

  const dialogBtn = "inline-flex h-8 items-center gap-1.5 rounded-xl bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 px-3 text-xs font-medium text-white shadow-sm transition-all hover:from-elite-blue-700 hover:to-elite-blue-800"

  return (
    <div className="px-4 lg:px-6 py-4 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {ar ? "المحاسبة والمالية" : "Accounting & Finance"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ar ? "قيود اليومية، دليل الحسابات، الذمم، وضريبة القيمة المضافة" : "Journal entries, chart of accounts, AR/AP, and VAT"}
          </p>
        </div>
        {feedback && (
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
              feedback.type === "ok"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
                : "border-red-500/20 bg-red-500/10 text-red-500"
            }`}
          >
            {feedback.type === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {feedback.text}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Dialog open={openDialogs["journal"]} onOpenChange={(o) => setOpenDialogs((p) => ({ ...p, journal: o }))}>
            <DialogTrigger asChild>
              <button className={dialogBtn} onClick={() => openDialog("journal")}>
                <BookOpenText className="h-3.5 w-3.5" />
                {ar ? "قييد جديد" : "New entry"}
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl rounded-2xl">
              <DialogHeader>
                <DialogTitle>{ar ? "قيد يومية يدوي" : "Manual journal entry"}</DialogTitle>
                <DialogDescription>
                  {ar ? "يُتحقق من توازن القيد قبل الترحيل؛ القيود المرحّلة غير قابلة للتعديل" : "Entries are balance-checked before posting; posted entries are immutable"}
                </DialogDescription>
              </DialogHeader>
              <form action={journalAction} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="entryDate">{ar ? "التاريخ" : "Date"}</Label>
                    <Input id="entryDate" type="date" dir="ltr" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="entryDesc">{ar ? "الوصف" : "Description"}</Label>
                    <Input id="entryDesc" value={entryDesc} onChange={(e) => setEntryDesc(e.target.value)} className="h-9" />
                  </div>
                </div>

                <div className="rounded-xl border border-border/50">
                  <div className="grid grid-cols-[1fr_90px_90px_32px] gap-2 border-b border-border/50 bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                    <span>{ar ? "الحساب" : "Account"}</span>
                    <span>{ar ? "مدين" : "Debit"}</span>
                    <span>{ar ? "دائن" : "Credit"}</span>
                    <span />
                  </div>
                  {lines.map((l) => (
                    <div key={l.key} className="grid grid-cols-[1fr_90px_90px_32px] items-center gap-2 px-3 py-2">
                      <select
                        value={l.account_id}
                        onChange={(e) => updateLine(l.key, { account_id: e.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">—</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.account_code} · {a.name_ar}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        dir="ltr"
                        min="0"
                        step="0.01"
                        value={l.debit}
                        onChange={(e) => updateLine(l.key, { debit: e.target.value })}
                        className="h-9 text-end tabular-nums"
                      />
                      <Input
                        type="number"
                        dir="ltr"
                        min="0"
                        step="0.01"
                        value={l.credit}
                        onChange={(e) => updateLine(l.key, { credit: e.target.value })}
                        className="h-9 text-end tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        disabled={lines.length <= 2}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-xs font-medium text-elite-blue-600 hover:text-elite-blue-700"
                  >
                    + {ar ? "إضافة سطر" : "Add line"}
                  </button>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">{ar ? "المجموع" : "Totals"}:</span>
                    <span dir="ltr" className="tabular-nums font-medium">{fmtMoney(totalDebit)}</span>
                    <span dir="ltr" className="tabular-nums font-medium">{fmtMoney(totalCredit)}</span>
                    {isBalanced ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {ar ? "متوازن" : "Balanced"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-500">
                        <AlertTriangle className="h-3.5 w-3.5" /> {ar ? "غير متوازن" : "Not balanced"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={asDraft}
                      onChange={(e) => setAsDraft(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border accent-elite-blue-600"
                    />
                    {ar ? "حفظ كمسودة (قيد مراجعة لاحقاً)" : "Save as draft (approve later)"}
                  </label>
                  <div className="flex items-center gap-3">
                    <Button
                      type="submit"
                      disabled={isPosting || lines.some((l) => !l.account_id) || (!asDraft && !isBalanced)}
                      className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
                    >
                      {isPosting ? <LoadingSpinner className="h-4 w-4" /> : asDraft ? <Send className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                      {asDraft ? (ar ? "حفظ كمسودة" : "Save draft") : (ar ? "ترحيل القيد" : "Post entry")}
                    </Button>
                    {journalState?.error && <span className="text-xs text-red-500">{journalState.error}</span>}
                  </div>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="journal" className="gap-2"><BookOpenText className="h-4 w-4" />{ar ? "قيود اليومية" : "Journal"}</TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2"><ListTree className="h-4 w-4" />{ar ? "دليل الحسابات" : "Accounts"}</TabsTrigger>
          <TabsTrigger value="trial" className="gap-2"><Scale className="h-4 w-4" />{ar ? "ميزان المراجعة" : "Trial balance"}</TabsTrigger>
          <TabsTrigger value="receivables" className="gap-2"><HandCoins className="h-4 w-4" />{ar ? "الذمم المدينة" : "Receivables"}</TabsTrigger>
          <TabsTrigger value="payables" className="gap-2"><Wallet className="h-4 w-4" />{ar ? "الذمم الدائنة" : "Payables"}</TabsTrigger>
          <TabsTrigger value="customers" className="gap-2"><Users className="h-4 w-4" />{ar ? "العملاء" : "Customers"}</TabsTrigger>
          <TabsTrigger value="suppliers" className="gap-2"><Store className="h-4 w-4" />{ar ? "الموردون" : "Suppliers"}</TabsTrigger>
          <TabsTrigger value="vat" className="gap-2"><Percent className="h-4 w-4" />{ar ? "الضريبة (VAT)" : "VAT"}</TabsTrigger>
          <TabsTrigger value="payments" className="gap-2"><Landmark className="h-4 w-4" />{ar ? "المدفوعات والبنوك" : "Payments"}</TabsTrigger>
          <TabsTrigger value="periods" className="gap-2"><CalendarRange className="h-4 w-4" />{ar ? "الفترات" : "Periods"}</TabsTrigger>
          <TabsTrigger value="events" className="gap-2"><ListChecks className="h-4 w-4" />{ar ? "الأحداث" : "Events"}</TabsTrigger>
          <TabsTrigger value="statements" className="gap-2"><BookOpenText className="h-4 w-4" />{ar ? "القوائم المالية" : "Statements"}</TabsTrigger>
          <TabsTrigger value="zatca" className="gap-2"><FileCheck2 className="h-4 w-4" />{ar ? "إشعارات ZATCA" : "ZATCA"}</TabsTrigger>
        </TabsList>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <LoadingSpinner className="h-6 w-6 text-elite-blue-600" />
          </div>
        ) : (
          <>
            <TabsContent value="journal" className="mt-4">
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <TableShell headers={["Ref", ar ? "التاريخ" : "Date", ar ? "الوصف" : "Description", ar ? "النوع" : "Type", ar ? "الحالة" : "Status", ar ? "إجراء" : "Action"]}>
                  {journals.length === 0 && <EmptyRow colSpan={6} text={ar ? "لا توجد قيود بعد. أنشئ قيداً جديداً." : "No journal entries yet. Create one."} />}
                  {journals.map((j) => {
                    const s = JOURNAL_STATUS[j.status] ?? JOURNAL_STATUS.draft
                    const approval = j.journal_approvals?.status
                    const ap = APPROVAL_STATUS[approval ?? ""]
                    const canSubmit = j.status === "draft" && approval !== "submitted"
                    const canApprove = j.status === "draft" && approval === "submitted"
                    const canReject = canApprove
                    const canReverse = j.status === "posted"
                    return (
                      <tr key={j.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">{j.entry_ref}</td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{fmtDate(j.entry_date)}</td>
                        <td className="px-4 py-3">{j.description_ar ?? j.description_en ?? "—"}</td>
                        <td className="px-4 py-3 text-xs uppercase" dir="ltr">{j.entry_type}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge className={s.className}>{ar ? s.ar : s.en}</Badge>
                            {ap && <Badge className={ap.className}>{ar ? ap.ar : ap.en}</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {canSubmit && (
                              <button
                                onClick={() => handleJournalAction("submit", j)}
                                disabled={busyEntryId === j.id}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                              >
                                {busyEntryId === j.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                {ar ? "إرسال للمراجعة" : "Submit"}
                              </button>
                            )}
                            {canApprove && (
                              <button
                                onClick={() => handleJournalAction("approve", j)}
                                disabled={busyEntryId === j.id}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                              >
                                {busyEntryId === j.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                {ar ? "اعتماد وترحيل" : "Approve"}
                              </button>
                            )}
                            {canReject && (
                              <button
                                onClick={() => setRejectTarget(j)}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20"
                              >
                                <Ban className="h-3 w-3" />
                                {ar ? "رفض" : "Reject"}
                              </button>
                            )}
                            {canReverse && (
                              <button
                                onClick={() => { setReversalTarget(j); setReversalDesc(""); setReversalDate(new Date().toISOString().slice(0, 10)) }}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-purple-500/25 bg-purple-500/10 px-2 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-500/20"
                              >
                                <RotateCcw className="h-3 w-3" />
                                {ar ? "عكس" : "Reverse"}
                              </button>
                            )}
                            {!canSubmit && !canApprove && !canReject && !canReverse && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </TableShell>
              </Card>
            </TabsContent>

            <TabsContent value="accounts" className="mt-4">
              <ChartOfAccountsManager />
            </TabsContent>

            <TabsContent value="trial" className="mt-4">
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <TableShell headers={[ar ? "الرمز" : "Code", ar ? "الاسم" : "Name", ar ? "النوع" : "Type", ar ? "مدين" : "Debit", ar ? "دائن" : "Credit", ar ? "الرصيد" : "Balance"]}>
                  {trial.length === 0 && <EmptyRow colSpan={6} text={ar ? "لا توجد قيود مرحّلة بعد." : "No posted entries yet."} />}
                  {trial.map((r) => (
                    <tr key={r.account_code} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs" dir="ltr">{r.account_code}</td>
                      <td className="px-4 py-3 font-medium">{r.name_ar}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{ar ? TYPE_AR[r.account_type] ?? r.account_type : r.account_type}</td>
                      <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.total_debit)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.total_credit)}</td>
                      <td className={`px-4 py-3 text-xs font-medium tabular-nums ${(r.net_balance ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}`} dir="ltr">{fmtMoney(r.net_balance)}</td>
                    </tr>
                  ))}
                </TableShell>
              </Card>
            </TabsContent>

            <TabsContent value="receivables" className="mt-4">
              <div className="space-y-4">
                <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                  <CardHeader className="pb-3 flex-row items-center justify-between">
                    <CardTitle className="text-base">{ar ? "الذمم المدينة" : "Receivables"}</CardTitle>
                    <Dialog open={openDialogs["receivable"]} onOpenChange={(o) => setOpenDialogs((p) => ({ ...p, receivable: o }))}>
                      <DialogTrigger asChild>
                        <button className={dialogBtn} onClick={() => openDialog("receivable")}>
                          <Plus className="h-3.5 w-3.5" />{ar ? "فاتورة جديدة" : "New invoice"}
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md rounded-2xl">
                        <DialogHeader>
                          <DialogTitle>{ar ? "إنشاء ذمم مدينة" : "Create receivable"}</DialogTitle>
                          <DialogDescription>{ar ? "فاتورة عميل مع ضريبة القيمة المضافة" : "Customer invoice with VAT"}</DialogDescription>
                        </DialogHeader>
                        <form action={rcvAction} className="space-y-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="rcvRef">{ar ? "رقم الفاتورة" : "Invoice ref"}</Label>
                            <Input id="rcvRef" dir="ltr" value={rcvRef} onChange={(e) => setRcvRef(e.target.value)} className="h-9" />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="rcvDate">{ar ? "تاريخ الفاتورة" : "Invoice date"}</Label>
                              <Input id="rcvDate" type="date" dir="ltr" value={rcvDate} onChange={(e) => setRcvDate(e.target.value)} className="h-9" />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="rcvDue">{ar ? "تاريخ الاستحقاق" : "Due date"}</Label>
                              <Input id="rcvDue" type="date" dir="ltr" value={rcvDue} onChange={(e) => setRcvDue(e.target.value)} className="h-9" />
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="rcvAmount">{ar ? "المبلغ (قبل الضريبة)" : "Amount (excl. VAT)"}</Label>
                              <Input id="rcvAmount" type="number" dir="ltr" min="0" step="0.01" value={rcvAmount} onChange={(e) => setRcvAmount(e.target.value)} className="h-9 text-end tabular-nums" />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="rcvVat">{ar ? "نسبة الضريبة %" : "VAT rate %"}</Label>
                              <Input id="rcvVat" type="number" dir="ltr" min="0" max="100" step="0.01" value={rcvVat} onChange={(e) => setRcvVat(e.target.value)} className="h-9 text-end tabular-nums" />
                            </div>
                          </div>
                          {Number(rcvAmount || 0) > 0 && (
                            <p className="text-xs text-muted-foreground" dir="ltr">
                              VAT: {fmtMoney((Number(rcvAmount) * Number(rcvVat || 0)) / 100)} · Total: {fmtMoney(Number(rcvAmount) + (Number(rcvAmount) * Number(rcvVat || 0)) / 100)} SAR
                            </p>
                          )}
                          <div className="flex items-center gap-3">
                            <Button type="submit" disabled={isSavingRcv} className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800">
                              {isSavingRcv ? <LoadingSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                              {t.common.save}
                            </Button>
                            {rcvState?.error && <span className="text-xs text-red-500">{rcvState.error}</span>}
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <TableShell headers={[ar ? "الفاتورة" : "Invoice", ar ? "التاريخ" : "Date", ar ? "الاستحقاق" : "Due", ar ? "المبلغ" : "Amount", "VAT", ar ? "الإجمالي" : "Total", ar ? "المدفوع" : "Paid", ar ? "الحالة" : "Status"]}>
                    {receivables.length === 0 && <EmptyRow colSpan={8} text={ar ? "لا توجد ذمم مدينة." : "No receivables."} />}
                    {receivables.map((r) => {
                      const s = ARAP_STATUS[r.status] ?? ARAP_STATUS.open
                      const overdue = r.status !== "paid" && new Date(r.due_date) < new Date()
                      return (
                        <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs" dir="ltr">{r.invoice_ref}</td>
                          <td className="px-4 py-3 text-xs" dir="ltr">{fmtDate(r.invoice_date)}</td>
                          <td className={`px-4 py-3 text-xs ${overdue ? "text-red-600 font-medium" : ""}`} dir="ltr">{fmtDate(r.due_date)}</td>
                          <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.amount)}</td>
                          <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.vat_amount)}</td>
                          <td className="px-4 py-3 text-xs font-medium tabular-nums" dir="ltr">{fmtMoney(r.total_amount)}</td>
                          <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.paid_amount)}</td>
                          <td className="px-4 py-3"><Badge className={overdue && r.status === "open" ? ARAP_STATUS.overdue.className : s.className}>{ar ? (overdue && r.status === "open" ? ARAP_STATUS.overdue.ar : s.ar) : s.en}</Badge></td>
                        </tr>
                      )
                    })}
                  </TableShell>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="payables" className="mt-4">
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <TableShell headers={[ar ? "الفاتورة" : "Invoice", ar ? "التاريخ" : "Date", ar ? "الاستحقاق" : "Due", ar ? "المبلغ" : "Amount", "VAT", ar ? "الإجمالي" : "Total", ar ? "المدفوع" : "Paid", ar ? "الحالة" : "Status"]}>
                  {payables.length === 0 && <EmptyRow colSpan={8} text={ar ? "لا توجد ذمم دائنة." : "No payables."} />}
                  {payables.map((r) => {
                    const s = ARAP_STATUS[r.status] ?? ARAP_STATUS.open
                    const overdue = r.status !== "paid" && new Date(r.due_date) < new Date()
                    return (
                      <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">{r.invoice_ref}</td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{fmtDate(r.invoice_date)}</td>
                        <td className={`px-4 py-3 text-xs ${overdue ? "text-red-600 font-medium" : ""}`} dir="ltr">{fmtDate(r.due_date)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.amount)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.vat_amount)}</td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" dir="ltr">{fmtMoney(r.total_amount)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.paid_amount)}</td>
                        <td className="px-4 py-3"><Badge className={overdue && r.status === "open" ? ARAP_STATUS.overdue.className : s.className}>{ar ? (overdue && r.status === "open" ? ARAP_STATUS.overdue.ar : s.ar) : s.en}</Badge></td>
                      </tr>
                    )
                  })}
                </TableShell>
              </Card>
            </TabsContent>

            <TabsContent value="customers" className="mt-4">
              <PartiesManager kind="customers" />
            </TabsContent>

            <TabsContent value="suppliers" className="mt-4">
              <PartiesManager kind="suppliers" />
            </TabsContent>

            <TabsContent value="vat" className="mt-4 space-y-4">
              {/* Net position strip */}
              {(() => {
                const out = vatOutput.reduce((s, r) => s + Number(r.vat_amount), 0)
                const rec = vatInput.filter((r) => (r.vat_recoverability ?? "recoverable") === "recoverable").reduce((s, r) => s + Number(r.vat_amount), 0)
                const adjOut = vatAdjustments.filter((a) => a.direction === "output").reduce((s, a) => s + Number(a.vat_amount), 0)
                const adjIn = vatAdjustments.filter((a) => a.direction === "input").reduce((s, a) => s + Number(a.vat_amount), 0)
                const net = computeVatNetPosition(out, adjOut, rec, adjIn)
                const items = [
                  { label: ar ? "مخرجات" : "Output", value: fmtMoney(out), cls: "text-blue-600" },
                  { label: ar ? "مدخلات قابلة للاسترداد" : "Recoverable input", value: fmtMoney(rec), cls: "text-emerald-600" },
                  { label: ar ? "تسويات" : "Adjustments", value: fmtMoney(adjOut + adjIn), cls: "text-amber-600" },
                  {
                    label: ar ? "صافي المركز" : "Net position",
                    value: fmtMoney(net),
                    cls: net > 0 ? "text-red-600" : net < 0 ? "text-emerald-600" : "text-foreground",
                  },
                ]
                return (
                  <div className="grid gap-3 sm:grid-cols-4">
                    {items.map((it) => (
                      <div key={it.label} className="rounded-2xl border border-border/50 bg-card/80 px-4 py-3 shadow-sm">
                        <p className="text-[11px] font-medium text-muted-foreground">{it.label}</p>
                        <p dir="ltr" className={`mt-0.5 text-lg font-bold tabular-nums ${it.cls}`}>{it.value}</p>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Per-period reconciliation (Phase 11) */}
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-base">{ar ? "التسوية حسب الفترة" : "Reconciliation by period"}</CardTitle>
                    <CardDescription>{ar ? "المخرجات − المدخلات القابلة للاسترداد ± التسويات = صافي المركز" : "Output − recoverable input ± adjustments = net position"}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleExportVatRecon} disabled={reconExporting} className={dialogBtn}>
                      {reconExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
                      {ar ? "تصدير CSV" : "CSV"}
                    </button>
                    <button onClick={handlePrintVatRecon} disabled={reconPrinting} className={dialogBtn}>
                      {reconPrinting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      {ar ? "طباعة التقرير" : "Print"}
                    </button>
                  </div>
                </CardHeader>
                <TableShell headers={[ar ? "الفترة" : "Period", ar ? "الحالة" : "Status", ar ? "المخرجات" : "Output", ar ? "مدخلات قابلة للاسترداد" : "Rec. input", ar ? "غير قابلة للاسترداد" : "Non-rec.", ar ? "قيد المراجعة" : "Pending", ar ? "تسويات" : "Adjustments", ar ? "صافي المركز" : "Net position"]}>
                  {vatRecon.length === 0 && <EmptyRow colSpan={8} text={ar ? "لا توجد بيانات تسوية." : "No reconciliation data."} />}
                  {vatRecon.map((r) => (
                    <tr key={`${r.period_year}-${r.period_month}`} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" dir="ltr">{r.period_year}-{String(r.period_month).padStart(2, "0")}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-foreground/70">{r.period_status ?? "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.output_vat)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-emerald-600" dir="ltr">{fmtMoney(r.recoverable_input_vat)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground" dir="ltr">{fmtMoney(r.non_recoverable_vat)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-amber-600" dir="ltr">
                        {r.pending_review_rows > 0 ? `${fmtMoney(r.pending_review_vat)} (${r.pending_review_rows})` : fmtMoney(r.pending_review_vat)}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">
                        {fmtMoney(r.adjustments_output + r.adjustments_input)}
                      </td>
                      <td className={`px-4 py-3 text-xs font-bold tabular-nums ${r.net_position > 0 ? "text-red-600" : r.net_position < 0 ? "text-emerald-600" : "text-foreground"}`} dir="ltr">
                        {fmtMoney(r.net_position)}
                      </td>
                    </tr>
                  ))}
                </TableShell>
              </Card>

              {/* VAT return (Phase 12) */}
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-base">{ar ? "إقرار ضريبة القيمة المضافة" : "VAT Return"}</CardTitle>
                    <CardDescription>
                      {ar
                        ? "ملخص الفترة للتحضير للإقرار — بلا إرسال إلكتروني (حتى مرحلة ZATCA)"
                        : "Per-period return summary for preparation — no electronic submission (until the ZATCA phase)"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={vatReturnPeriod}
                      onChange={(e) => setVatReturnPeriod(e.target.value)}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {vatRecon.length === 0 && <option value="">—</option>}
                      {vatRecon.map((r) => (
                        <option key={`${r.period_year}-${r.period_month}`} value={`${r.period_year}-${String(r.period_month).padStart(2, "0")}`}>
                          {r.period_year}-{String(r.period_month).padStart(2, "0")} · {r.period_status ?? "—"}
                        </option>
                      ))}
                    </select>
                    <button onClick={handleExportVatReturn} disabled={returnExporting} className={dialogBtn}>
                      {returnExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
                      {ar ? "تصدير CSV" : "CSV"}
                    </button>
                    <button onClick={handlePrintVatReturn} disabled={returnPrinting} className={dialogBtn}>
                      {returnPrinting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      {ar ? "طباعة الإقرار" : "Print"}
                    </button>
                  </div>
                </CardHeader>
                {returnLoading ? (
                  <div className="flex items-center justify-center px-4 pb-6 pt-2">
                    <LoadingSpinner className="h-5 w-5" />
                  </div>
                ) : vatReturn ? (
                  <div className="px-4 pb-4">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground">{ar ? "ضريبة المخرجات (مبيعات)" : "Output VAT (sales)"}</p>
                        <p dir="ltr" className="mt-0.5 text-lg font-bold tabular-nums text-blue-600">{fmtMoney(vatReturn.output_vat)}</p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground">{ar ? "مدخلات قابلة للاسترداد" : "Recoverable input"}</p>
                        <p dir="ltr" className="mt-0.5 text-lg font-bold tabular-nums text-emerald-600">{fmtMoney(vatReturn.recoverable_input_vat)}</p>
                      </div>
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground">{ar ? "غير قابلة للاسترداد" : "Non-recoverable"}</p>
                        <p dir="ltr" className="mt-0.5 text-lg font-bold tabular-nums text-muted-foreground">{fmtMoney(vatReturn.non_recoverable_vat)}</p>
                      </div>
                      <div className={`rounded-xl border p-3 ${vatReturn.net_position > 0 ? "border-red-500/25 bg-red-500/10" : vatReturn.net_position < 0 ? "border-emerald-500/25 bg-emerald-500/10" : "border-border/50 bg-muted/20"}`}>
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {vatReturn.net_position > 0
                            ? (ar ? "صافي مستحق الدفع" : "Net payable")
                            : vatReturn.net_position < 0
                              ? (ar ? "صافي مستحق الاسترداد" : "Net receivable")
                              : (ar ? "صافي المركز" : "Net position")}
                        </p>
                        <p dir="ltr" className={`mt-0.5 text-lg font-bold tabular-nums ${vatReturn.net_position > 0 ? "text-red-600" : vatReturn.net_position < 0 ? "text-emerald-600" : "text-foreground"}`}>
                          {fmtMoney(Math.abs(vatReturn.net_position))}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                      <span dir="ltr" className="tabular-nums">
                        {ar ? "تسويات مخرجات" : "Adj. out"}: {fmtMoney(vatReturn.adjustments_output)}
                      </span>
                      <span dir="ltr" className="tabular-nums">
                        {ar ? "تسويات مدخلات" : "Adj. in"}: {fmtMoney(vatReturn.adjustments_input)}
                      </span>
                      {vatReturn.pending_review_rows > 0 && (
                        <span dir="ltr" className="tabular-nums text-amber-600">
                          {ar ? "قيد المراجعة" : "Pending"}: {fmtMoney(vatReturn.pending_review_vat)} ({vatReturn.pending_review_rows})
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 pb-6 text-sm text-muted-foreground">
                    {ar ? "لا توجد بيانات إقرار لهذه الفترة." : "No VAT return data for this period."}
                  </div>
                )}
              </Card>

              {/* Review items (pending_review) — Phase 11 */}
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{ar ? "عناصر قيد المراجعة" : "Items awaiting review"}</CardTitle>
                  <CardDescription>
                    {ar
                      ? "مدخلات ضريبة بانتظار تصنيف يدوي — تُستبعد من صافي المركز حتى تُصنَّف"
                      : "Input VAT awaiting manual classification — excluded from the net until classified"}
                  </CardDescription>
                </CardHeader>
                <TableShell headers={[ar ? "المرجع" : "Ref", ar ? "التاريخ" : "Date", ar ? "الأساس" : "Base", ar ? "النسبة" : "Rate", "VAT", ar ? "إجراء" : "Action"]}>
                  {vatReviewItems.length === 0 && <EmptyRow colSpan={6} text={ar ? "لا توجد عناصر قيد المراجعة." : "No items awaiting review."} />}
                  {vatReviewItems.map((it) => (
                    <tr key={it.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs" dir="ltr">{it.invoice_ref}</td>
                      <td className="px-4 py-3 text-xs" dir="ltr">{fmtDate(it.invoice_date)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(it.vat_base_amount)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{it.vat_rate}%</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" dir="ltr">{fmtMoney(it.vat_amount)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setResolveTarget(it); setResolveRecoverability("recoverable") }}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/20"
                        >
                          {ar ? "تصنيف" : "Classify"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </TableShell>
              </Card>

              <Dialog open={!!resolveTarget} onOpenChange={(o) => { if (!o) setResolveTarget(null) }}>
                <DialogContent className="max-w-md rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>{ar ? "تصنيف بند قيد المراجعة" : "Classify review item"}</DialogTitle>
                    <DialogDescription>
                      {ar
                        ? "حدد ما إذا كانت ضريبة المدخلات هذه قابلة للاسترداد أم لا. لا يمكن التغيير لاحقاً."
                        : "Choose whether this input VAT is recoverable or not. The choice is locked afterwards."}
                    </DialogDescription>
                  </DialogHeader>
                  {resolveTarget && (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-border/50 bg-muted/20 p-3 text-sm">
                        <p className="font-mono text-xs" dir="ltr">{resolveTarget.invoice_ref}</p>
                        <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                          {fmtDate(resolveTarget.invoice_date)} · VAT {fmtMoney(resolveTarget.vat_amount)} SAR
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setResolveRecoverability("recoverable")}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                            resolveRecoverability === "recoverable"
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600"
                              : "border-border/60 text-foreground/70 hover:bg-muted/40"
                          }`}
                        >
                          {ar ? "قابل للاسترداد" : "Recoverable"}
                        </button>
                        <button
                          onClick={() => setResolveRecoverability("non_recoverable")}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                            resolveRecoverability === "non_recoverable"
                              ? "border-red-500/40 bg-red-500/15 text-red-600"
                              : "border-border/60 text-foreground/70 hover:bg-muted/40"
                          }`}
                        >
                          {ar ? "غير قابل للاسترداد" : "Non-recoverable"}
                        </button>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button onClick={() => void handleResolveReview()} disabled={resolveBusy} className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800">
                          {resolveBusy ? <LoadingSpinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                          {ar ? "تأكيد التصنيف" : "Confirm"}
                        </Button>
                        <Button variant="ghost" onClick={() => setResolveTarget(null)}>{ar ? "إلغاء" : "Cancel"}</Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{ar ? "ضريبة المخرجات (مبيعات)" : "Output VAT (Sales)"}</CardTitle>
                    <CardDescription>{ar ? "لا تُقابل مع المدخلات في نفس الدفتر" : "Never netted against input in the same ledger"}</CardDescription>
                  </CardHeader>
                  <TableShell headers={[ar ? "الفترة" : "Period", ar ? "الفاتورة" : "Invoice", ar ? "الأساس" : "Base", ar ? "النسبة" : "Rate", "VAT"]}>
                    {vatOutput.length === 0 && <EmptyRow colSpan={5} text={ar ? "لا توجد ضريبة مخرجات." : "No output VAT."} />}
                    {vatOutput.map((r) => (
                      <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{r.period_year}-{String(r.period_month).padStart(2, "0")}</td>
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">{r.invoice_ref}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.vat_base_amount)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{r.vat_rate}%</td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" dir="ltr">{fmtMoney(r.vat_amount)}</td>
                      </tr>
                    ))}
                  </TableShell>
                </Card>

                <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{ar ? "ضريبة المدخلات (مشتريات ومصروفات)" : "Input VAT (Purchases & Expenses)"}</CardTitle>
                    <CardDescription>{ar ? "يُحتسب في صافي المركز ما كان قابلاً للاسترداد فقط" : "Only recoverable input counts toward the net position"}</CardDescription>
                  </CardHeader>
                  <TableShell headers={[ar ? "الفترة" : "Period", ar ? "المرجع" : "Ref", ar ? "الأساس" : "Base", ar ? "النسبة" : "Rate", "VAT", ar ? "التصنيف" : "Class"]}>
                    {vatInput.length === 0 && <EmptyRow colSpan={6} text={ar ? "لا توجد ضريبة مدخلات." : "No input VAT."} />}
                    {vatInput.map((r) => (
                      <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{r.period_year}-{String(r.period_month).padStart(2, "0")}</td>
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">{r.invoice_ref}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(r.vat_base_amount)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{r.vat_rate}%</td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" dir="ltr">{fmtMoney(r.vat_amount)}</td>
                        <td className="px-4 py-3">
                          {(r.vat_recoverability ?? "recoverable") === "recoverable" ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600">{ar ? "قابل للاسترداد" : "Recoverable"}</span>
                          ) : (r.vat_recoverability === "non_recoverable" ? (
                            <span className="inline-flex items-center rounded-full border border-red-500/20 bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-600">{ar ? "غير قابل للاسترداد" : "Non-recoverable"}</span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600">{ar ? "قيد المراجعة" : "Pending review"}</span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </TableShell>
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{ar ? "التسويات الضريبية" : "VAT Adjustments"}</CardTitle>
                    <CardDescription>{ar ? "إشعارات دائنة/مدينة وتصحيحات — نهائية وغير قابلة للتعديل" : "Credit/debit notes & corrections — finalized, immutable"}</CardDescription>
                  </CardHeader>
                  <TableShell headers={[ar ? "الفترة" : "Period", ar ? "النوع" : "Type", ar ? "الاتجاه" : "Direction", ar ? "الأساس" : "Base", "VAT", ar ? "السبب" : "Reason"]}>
                    {vatAdjustments.length === 0 && <EmptyRow colSpan={6} text={ar ? "لا توجد تسويات." : "No adjustments."} />}
                    {vatAdjustments.map((a) => (
                      <tr key={a.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{a.period_year}-{String(a.period_month).padStart(2, "0")}</td>
                        <td className="px-4 py-3 text-xs">{ar ? (a.adjustment_type === "credit_note" ? "إشعار دائن" : a.adjustment_type === "debit_note" ? "إشعار مدين" : a.adjustment_type === "correction" ? "تصحيح" : "أخرى") : a.adjustment_type}</td>
                        <td className="px-4 py-3 text-xs">{ar ? (a.direction === "output" ? "مخرجات" : "مدخلات") : a.direction}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtMoney(a.base_amount)}</td>
                        <td className={`px-4 py-3 text-xs font-medium tabular-nums ${Number(a.vat_amount) < 0 ? "text-red-600" : "text-emerald-600"}`} dir="ltr">{fmtMoney(a.vat_amount)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{a.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </TableShell>
                </Card>

                <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{ar ? "فترات ضريبة القيمة المضافة" : "VAT Periods"}</CardTitle>
                    <CardDescription>{ar ? "فترة مفتوحة واحدة لكل شهر" : "One open period per month"}</CardDescription>
                  </CardHeader>
                  <TableShell headers={[ar ? "الفترة" : "Period", ar ? "الحالة" : "Status"]}>
                    {vatPeriods.length === 0 && <EmptyRow colSpan={2} text={ar ? "لا توجد فترات." : "No periods."} />}
                    {vatPeriods.map((p) => (
                      <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 text-xs tabular-nums font-medium" dir="ltr">{p.period_year}-{String(p.period_month).padStart(2, "0")}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            p.status === "open" ? "border-emerald-500/20 bg-emerald-500/15 text-emerald-600"
                            : p.status === "closing" ? "border-amber-500/20 bg-amber-500/15 text-amber-600"
                            : p.status === "reopened" ? "border-blue-500/20 bg-blue-500/15 text-blue-600"
                            : "border-gray-500/20 bg-gray-500/15 text-gray-600"
                          }`}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </TableShell>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="events" className="mt-4">
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{ar ? "قائمة الأحداث المالية" : "Financial event queue"}</CardTitle>
                    <CardDescription>
                      {ar
                        ? "أحداث منتجة تستهلكها المحاسبة (قيود + ضريبة + ذمم) — كل حدث يُعالج مرة واحدة"
                        : "Produced events consumed by Accounting (journal + VAT + AR/AP) — each processed exactly once"}
                    </CardDescription>
                  </div>
                  <button onClick={handleRunDispatcher} disabled={dispatchBusy} className={dialogBtn}>
                    {dispatchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {ar ? "تشغيل المعالج" : "Run dispatcher"}
                  </button>
                </CardHeader>
                <TableShell headers={[ar ? "المفتاح" : "Key", ar ? "النوع" : "Type", ar ? "التاريخ" : "Date", ar ? "الحالة" : "Status", ar ? "الخطأ" : "Error"]}>
                  {events.length === 0 && <EmptyRow colSpan={5} text={ar ? "لا توجد أحداث." : "No events."} />}
                  {events.map((e) => {
                    const s = EVENT_STATUS[e.processing_status] ?? EVENT_STATUS.pending
                    return (
                      <tr key={e.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-[11px]" dir="ltr">{e.idempotency_key}</td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{e.event_type}</td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{fmtDate(e.event_date)}</td>
                        <td className="px-4 py-3">
                          <Badge className={s.className}>{ar ? s.ar : s.en}</Badge>
                        </td>
                        <td className="max-w-64 truncate px-4 py-3 text-xs text-red-600" dir="ltr" title={e.error_message ?? undefined}>
                          {e.error_message ?? "—"}
                        </td>
                      </tr>
                    )
                  })}
                </TableShell>
              </Card>
            </TabsContent>

            <TabsContent value="statements" className="mt-4">
              <StatementsManager />
            </TabsContent>

            <TabsContent value="zatca" className="mt-4 space-y-4">
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{ar ? "شهادات CSID المخزّنة" : "Stored CSID credentials"}</CardTitle>
                    <CardDescription>
                      {ar
                        ? "أوراق اعتماد الإعداد (شهادة + سر) لكل بيئة — السر لا يظهر أبداً في المتصفح"
                        : "Onboarding credentials (certificate + secret) per environment — the secret never reaches the browser"}
                    </CardDescription>
                  </div>
                  <Dialog open={onboardOpen} onOpenChange={setOnboardOpen}>
                    <DialogTrigger asChild>
                      <button className={dialogBtn}>
                        <KeyRound className="h-3.5 w-3.5" />{ar ? "إعداد جديد" : "Onboard"}
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md rounded-2xl">
                      <DialogHeader>
                        <DialogTitle>{ar ? "إعداد CSID (compliance → production)" : "CSID onboarding (compliance → production)"}</DialogTitle>
                        <DialogDescription>
                          {ar
                            ? "يُنشئ مفتاحاً ومفتاح عام CSR حسب البيئة، ثم يخزّن شهادتَي compliance وproduction مع المفتاح الخاص — لا يصل السر إلى المتصفح أبداً"
                            : "Generates a keypair + CSR for the environment, then stores both compliance & production CSIDs with the private key — the secret never reaches the browser"}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="onboardEnv">{ar ? "البيئة" : "Environment"}</Label>
                          <select
                            id="onboardEnv"
                            value={onboardEnv}
                            onChange={(e) => setOnboardEnv(e.target.value as ZatcaCsidEnvironment)}
                            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="sandbox">sandbox · TSTZATCA</option>
                            <option value="simulation">simulation · PREZATCA</option>
                            <option value="production">production · ZATCA</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="onboardOtp">{ar ? "رمز الدخول لمرة واحدة (OTP) من بوابة Fatoora" : "One-time password (OTP) from the Fatoora portal"}</Label>
                          <Input id="onboardOtp" dir="ltr" placeholder="••••••" value={onboardOtp} onChange={(e) => setOnboardOtp(e.target.value)} className="h-9 font-mono" />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {ar
                            ? "وضع sandbox التجريبي لا يحتاج بوابة؛ محاكاة/إنتاج تتطلب OTP حقيقياً (صلاحيته ~ساعة)."
                            : "The offline sandbox mock needs no portal; simulation/production require a real OTP (valid ~1 hour)."}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button onClick={() => void handleOnboardZatca()} disabled={onboardBusy || !onboardOtp.trim()} className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800">
                          {onboardBusy ? <LoadingSpinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                          {ar ? "بدء الإعداد" : "Start onboarding"}
                        </Button>
                        <Button variant="outline" onClick={() => setOnboardOpen(false)}>
                          {ar ? "إلغاء" : "Cancel"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                {zatcaCsids.length === 0 ? (
                  <div className="px-4 pb-4 text-xs text-muted-foreground">
                    {ar
                      ? "لا توجد شهادات مخزّنة بعد. تُحفظ تلقائياً عند اكتمال الإعداد (compliance/production CSID)."
                      : "No stored CSIDs yet. They are saved automatically once onboarding (compliance/production CSID) completes."}
                  </div>
                ) : (
                  <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2">
                    {zatcaCsids.map((c) => (
                      <div key={c.id} className="rounded-xl border border-border/50 bg-muted/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium capitalize" dir="ltr">{c.environment} · {c.kind}</span>
                          <Badge className={c.status === "issued" ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}>
                            {ar ? "صادرة" : c.status}
                          </Badge>
                        </div>
                        <div className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground" dir="ltr">
                          <div>{ar ? "السر:" : "Secret:"} {c.secretPreview}</div>
                          <div>{ar ? "الإصدار:" : "Issued:"} {fmtDate(c.issuedAt)}</div>
                          {c.expiresAt && <div>{ar ? "الانتهاء:" : "Expires:"} {fmtDate(c.expiresAt)}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="pb-3 flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{ar ? "سجل إرسال ZATCA" : "ZATCA transmission log"}</CardTitle>
                    <CardDescription>
                      {ar
                        ? "الفواتير المبيعة المُرسلة كوثائق UBL 2.1 — وضع تجريبي افتراضياً، دون ادعاء امتثال"
                        : "Finalized sales documents transmitted as UBL 2.1 — sandbox by default, no compliance claimed"}
                    </CardDescription>
                  </div>
                  <button onClick={handleRunZatca} disabled={zatcaBusy} className={dialogBtn}>
                    {zatcaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {ar ? "تشغيل المحوّل" : "Run adapter"}
                  </button>
                </CardHeader>
                <TableShell headers={[ar ? "المستند" : "Doc", ar ? "النوع" : "Type", ar ? "الحالة" : "Status", "UUID", ar ? "التاريخ" : "Date", ar ? "الخطأ" : "Error", ""]}>
                  {zatcaRows.length === 0 && <EmptyRow colSpan={7} text={ar ? "لا توجد إرسالات بعد. رحّل فاتورة بيع ثم شغّل المحوّل." : "No transmissions yet. Finalize a sales invoice, then run the adapter."} />}
                  {zatcaRows.map((t) => {
                    const s = ZATCA_STATUS[t.status] ?? ZATCA_STATUS.not_transmitted
                    const dt = ZATCA_DOC_TYPE[t.doc_type] ?? { ar: t.doc_type, en: t.doc_type }
                    return (
                      <tr key={t.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">{t.doc_ref}</td>
                        <td className="px-4 py-3 text-xs">{ar ? dt.ar : dt.en}</td>
                        <td className="px-4 py-3">
                          <Badge className={s.className}>{ar ? s.ar : s.en}</Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground" dir="ltr">{t.zatca_uuid ?? "—"}</td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{fmtDate(t.transmitted_at ?? t.created_at)}</td>
                        <td className="max-w-56 truncate px-4 py-3 text-xs text-red-600" dir="ltr" title={t.error_message ?? undefined}>
                          {t.error_message ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleViewZatca(t.id)}
                            disabled={zatcaDetailBusy}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-elite-blue-500/25 bg-elite-blue-500/10 px-2 text-xs font-medium text-elite-blue-600 transition-colors hover:bg-elite-blue-500/20 disabled:opacity-50"
                          >
                            {ar ? "عرض" : "View"}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </TableShell>
              </Card>

              <Dialog open={!!zatcaDetail} onOpenChange={(o) => { if (!o) setZatcaDetail(null) }}>
                <DialogContent className="max-w-3xl rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>
                      {ar ? `وثيقة UBL — ${zatcaDetail?.doc_ref ?? ""}` : `UBL document — ${zatcaDetail?.doc_ref ?? ""}`}
                    </DialogTitle>
                    <DialogDescription>
                      {zatcaDetail
                        ? `${ar ? "الحالة" : "Status"}: ${zatcaDetail.status} · UUID: ${zatcaDetail.zatca_uuid ?? "—"}`
                        : ""}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="max-h-96 overflow-auto rounded-xl border border-border/50 bg-muted/30 p-4">
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground" dir="ltr">
                      {zatcaDetail?.payload_xml ?? ""}
                    </pre>
                  </div>
                </DialogContent>
              </Dialog>
            </TabsContent>

            <TabsContent value="periods" className="mt-4">
              <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{ar ? "الفترات المحاسبية" : "Accounting periods"}</CardTitle>
                  <CardDescription>
                    {ar ? "إغلاق الفترة يمنع أي ترحيلات جديدة؛ إعادة الفتح تتطلب سبباً" : "Closing a period blocks new postings; reopening requires a reason"}
                  </CardDescription>
                </CardHeader>
                <TableShell headers={[ar ? "الفترة" : "Period", ar ? "الحالة" : "Status", ar ? "تاريخ الفتح" : "Opened", ar ? "تاريخ الإغلاق" : "Closed", ar ? "السبب" : "Reason", ar ? "إجراء" : "Action"]}>
                  {periods.length === 0 && <EmptyRow colSpan={6} text={ar ? "لا توجد فترات." : "No periods."} />}
                  {periods.map((p) => {
                    const s = PERIOD_STATUS[p.status] ?? PERIOD_STATUS.open
                    const monthName = ar ? MONTH_NAMES_AR[(p.period_month ?? 1) - 1] : MONTH_NAMES_EN[(p.period_month ?? 1) - 1]
                    return (
                      <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-medium tabular-nums" dir="ltr">{monthName} {p.period_year}</td>
                        <td className="px-4 py-3"><Badge className={s.className}>{ar ? s.ar : s.en}</Badge></td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{fmtDate(p.opened_at)}</td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{p.closed_at ? fmtDate(p.closed_at) : "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate" title={p.reopen_reason ?? ""}>
                          {p.reopen_reason ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {(p.status === "open" || p.status === "closing") && (
                              <button
                                onClick={() => handleClosePeriod(p)}
                                disabled={busyPeriodId === p.id}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-500/25 bg-gray-500/10 px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-gray-500/20 disabled:opacity-50"
                              >
                                {busyPeriodId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                                {ar ? "إغلاق" : "Close"}
                              </button>
                            )}
                            {p.status === "closed" && (
                              <button
                                onClick={() => { setReopenTarget(p); setReopenReason("") }}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-purple-500/25 bg-purple-500/10 px-2 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-500/20"
                              >
                                <Unlock className="h-3 w-3" />
                                {ar ? "إعادة فتح" : "Reopen"}
                              </button>
                            )}
                            {(p.status === "reopened" || p.status === "closed") && <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </TableShell>
              </Card>
            </TabsContent>

            <TabsContent value="payments" className="mt-4">
              <div className="space-y-4">
                {/* Summary strip */}
                {(() => {
                  const inTotal = payments.filter((p) => p.direction === "in" && p.status !== "void").reduce((s, p) => s + Number(p.amount), 0)
                  const outTotal = payments.filter((p) => p.direction === "out" && p.status !== "void").reduce((s, p) => s + Number(p.amount), 0)
                  const arOut = openAr.reduce((s, r) => s + (r.total_amount - r.paid_amount), 0)
                  const apOut = openAp.reduce((s, r) => s + (r.total_amount - r.paid_amount), 0)
                  const items = [
                    { label: ar ? "المستلم (وارد)" : "Received (in)", value: fmtMoney(inTotal), cls: "text-emerald-600" },
                    { label: ar ? "المدفوع (صادر)" : "Paid (out)", value: fmtMoney(outTotal), cls: "text-red-600" },
                    { label: ar ? "ذمم مدينة مستحقة" : "Outstanding AR", value: fmtMoney(arOut), cls: "text-blue-600" },
                    { label: ar ? "ذمم دائنة مستحقة" : "Outstanding AP", value: fmtMoney(apOut), cls: "text-amber-600" },
                  ]
                  return (
                    <div className="grid gap-3 sm:grid-cols-4">
                      {items.map((it) => (
                        <div key={it.label} className="rounded-2xl border border-border/50 bg-card/80 px-4 py-3 shadow-sm">
                          <p className="text-[11px] font-medium text-muted-foreground">{it.label}</p>
                          <p dir="ltr" className={`mt-0.5 text-lg font-bold tabular-nums ${it.cls}`}>{it.value}</p>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                  <CardHeader className="pb-3 flex-row items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4 text-elite-blue-600" />{ar ? "الحسابات البنكية" : "Bank accounts"}</CardTitle>
                    <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
                      <DialogTrigger asChild>
                        <button className={dialogBtn}>
                          <Plus className="h-3.5 w-3.5" />{ar ? "حساب جديد" : "Add account"}
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md rounded-2xl">
                        <DialogHeader>
                          <DialogTitle>{ar ? "إضافة حساب بنكي" : "Add bank account"}</DialogTitle>
                          <DialogDescription>{ar ? "يرتبط الحساب بحساب في دليل الحسابات (افتراضياً 1100 بنك)" : "Linked to a Chart of Accounts account (default 1100 Bank)"}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="bankName">{ar ? "اسم البنك" : "Bank name"}</Label>
                              <Input id="bankName" value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-9" />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="bankAccName">{ar ? "اسم الحساب" : "Account name"}</Label>
                              <Input id="bankAccName" value={bankAccName} onChange={(e) => setBankAccName(e.target.value)} className="h-9" />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="bankIban">{ar ? "رقم الآيبان" : "IBAN"}</Label>
                            <Input id="bankIban" dir="ltr" value={bankIban} onChange={(e) => setBankIban(e.target.value)} className="h-9" />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1.5">
                              <Label htmlFor="bankAccNum">{ar ? "رقم الحساب" : "Account no."}</Label>
                              <Input id="bankAccNum" dir="ltr" value={bankAccNum} onChange={(e) => setBankAccNum(e.target.value)} className="h-9" />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="bankOpening">{ar ? "رصيد افتتاحي" : "Opening"}</Label>
                              <Input id="bankOpening" type="number" dir="ltr" step="0.01" value={bankOpening} onChange={(e) => setBankOpening(e.target.value)} className="h-9 text-end tabular-nums" />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="bankCoa">{ar ? "حساب الدليل" : "CoA code"}</Label>
                              <select
                                id="bankCoa"
                                value={bankCoa}
                                onChange={(e) => setBankCoa(e.target.value)}
                                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <option value="1100">{ar ? "1100 بنك" : "1100 Bank"}</option>
                                <option value="1000">{ar ? "1000 نقدية" : "1000 Cash"}</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Button onClick={() => void handleCreateBank()} disabled={bankBusy} className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800">
                              {bankBusy ? <LoadingSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                              {ar ? "إضافة" : "Add"}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  {bankAccounts.length === 0 ? (
                    <p className="px-4 pb-6 text-sm text-muted-foreground">{ar ? "لا توجد حسابات بنكية." : "No bank accounts."}</p>
                  ) : (
                    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      {bankAccounts.map((b) => (
                        <div key={b.id} className="rounded-xl border border-border/50 bg-muted/20 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-foreground">{b.bank_name}</p>
                            <Badge className={b.is_active ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" : "bg-gray-500/15 text-gray-600 border-gray-500/20"}>
                              {ar ? (b.is_active ? "نشط" : "غير نشط") : b.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{b.account_name}</p>
                          <p className="mt-2 font-mono text-xs text-foreground/80" dir="ltr">{b.iban}</p>
                          <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
                            {ar ? "رصيد افتتاحي" : "Opening"}: <span className="font-semibold tabular-nums text-foreground">{fmtMoney(b.opening_balance)} {b.currency}</span> · CoA <span className="font-mono font-semibold text-foreground">{b.coa_account_code ?? "1100"}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
                  <CardHeader className="pb-3 flex-row items-center justify-between">
                    <CardTitle className="text-base">{ar ? "المدفوعات" : "Finance payments"}</CardTitle>
                    <button onClick={openPayDialog} className={dialogBtn}>
                      <Plus className="h-3.5 w-3.5" />{ar ? "دفعة جديدة" : "New payment"}
                    </button>
                  </CardHeader>
                  <TableShell headers={[ar ? "المرجع" : "Ref", ar ? "الاتجاه" : "Dir", ar ? "التاريخ" : "Date", ar ? "الطرف" : "Party", ar ? "المبلغ" : "Amount", ar ? "الطريقة" : "Method", ar ? "التخصيص" : "Alloc.", ar ? "الحالة" : "Status", ar ? "إجراء" : "Action"]}>
                    {payments.length === 0 && <EmptyRow colSpan={9} text={ar ? "لا توجد مدفوعات." : "No payments."} />}
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">{p.payment_ref}</td>
                        <td className="px-4 py-3">
                          <Badge className={p.direction === "in" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" : "bg-red-500/15 text-red-600 border-red-500/20"}>
                            {ar ? (p.direction === "in" ? "وارد" : "صادر") : p.direction === "in" ? "In" : "Out"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{fmtDate(p.payment_date)}</td>
                        <td className="px-4 py-3 text-xs">
                          {p.customers ? (p.customers.name_ar ?? p.customers.name_en ?? "—") : p.suppliers ? (p.suppliers.name_ar ?? p.suppliers.name_en ?? "—") : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" dir="ltr">{fmtMoney(p.amount)}</td>
                        <td className="px-4 py-3 text-xs capitalize text-muted-foreground" dir="ltr">{p.method}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 rounded-full bg-elite-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-elite-blue-600" dir="ltr">
                            {p.payment_allocations?.length ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={p.status === "void" ? "bg-red-500/15 text-red-600 border-red-500/20" : p.status === "allocated" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" : p.status === "partially_allocated" ? "bg-amber-500/15 text-amber-600 border-amber-500/20" : "bg-muted text-muted-foreground"}>
                            {ar
                              ? p.status === "allocated" ? "مرحّل" : p.status === "partially_allocated" ? "تخصيص جزئي" : p.status === "void" ? "ملغاة" : p.status
                              : p.status.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {p.status !== "void" ? (
                            voidArmedId === p.id ? (
                              <button
                                onClick={() => void handleVoidPayment(p)}
                                disabled={voidBusyId === p.id}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                              >
                                {voidBusyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                                {ar ? "تأكيد؟" : "Confirm?"}
                              </button>
                            ) : (
                              <button
                                onClick={() => { setVoidArmedId(p.id); window.setTimeout(() => setVoidArmedId((cur) => (cur === p.id ? null : cur)), 4000) }}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-gray-500/25 bg-gray-500/10 px-2 text-xs font-medium text-foreground/70 transition-colors hover:bg-gray-500/20"
                              >
                                <Ban className="h-3 w-3" />
                                {ar ? "إلغاء" : "Void"}
                              </button>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </TableShell>
                </Card>

                {/* Record payment dialog */}
                <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
                  <DialogContent className="max-w-lg rounded-2xl">
                    <DialogHeader>
                      <DialogTitle>{ar ? "تسجيل دفعة" : "Record payment"}</DialogTitle>
                      <DialogDescription>
                        {ar
                          ? "استلام من عميل أو سداد لمورد، مع تخصيص للذمم المستحقة — يُرحَّل القيد تلقائياً"
                          : "Receive from a customer or pay a supplier, allocated to outstanding AR/AP — the journal posts automatically"}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => { setPayDirection("in"); syncAllocList("in") }}
                          className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors ${payDirection === "in" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60"}`}
                        >
                          <ArrowDownLeft className="h-4 w-4" />{ar ? "استلام (وارد)" : "Receipt (in)"}
                        </button>
                        <button
                          onClick={() => { setPayDirection("out"); syncAllocList("out") }}
                          className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors ${payDirection === "out" ? "border-red-500/30 bg-red-500/10 text-red-600" : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60"}`}
                        >
                          <ArrowUpRight className="h-4 w-4" />{ar ? "سداد (صادر)" : "Payment (out)"}
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="payDate">{ar ? "التاريخ" : "Date"}</Label>
                          <Input id="payDate" type="date" dir="ltr" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="h-9" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="payMethod">{ar ? "طريقة الدفع" : "Method"}</Label>
                          <select
                            id="payMethod"
                            value={payMethod}
                            onChange={(e) => setPayMethod(e.target.value)}
                            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="transfer">{ar ? "تحويل بنكي" : "Bank transfer"}</option>
                            <option value="cash">{ar ? "نقداً" : "Cash"}</option>
                            <option value="cheque">{ar ? "شيك" : "Cheque"}</option>
                            <option value="card">{ar ? "بطاقة" : "Card"}</option>
                            <option value="wps">{ar ? "WPS" : "WPS"}</option>
                          </select>
                        </div>
                      </div>

                      {payMethod !== "cash" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="payBank">{ar ? "الحساب البنكي" : "Bank account"}</Label>
                          <select
                            id="payBank"
                            value={payBank}
                            onChange={(e) => setPayBank(e.target.value)}
                            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">—</option>
                            {bankAccounts.filter((b) => b.is_active).map((b) => (
                              <option key={b.id} value={b.id}>{b.bank_name} · {b.account_name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {payDirection === "in" ? (
                        <div className="space-y-1.5">
                          <Label htmlFor="payCustomer">{ar ? "العميل" : "Customer"}</Label>
                          <select
                            id="payCustomer"
                            value={payCustomer}
                            onChange={(e) => { setPayCustomer(e.target.value); syncAllocList("in", e.target.value || undefined) }}
                            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">—</option>
                            {custOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Label htmlFor="paySupplier">{ar ? "المورد" : "Supplier"}</Label>
                          <select
                            id="paySupplier"
                            value={paySupplier}
                            onChange={(e) => { setPaySupplier(e.target.value); syncAllocList("out", e.target.value || undefined) }}
                            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">—</option>
                            {suppOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="payAmount">{ar ? "المبلغ" : "Amount"}</Label>
                        <Input id="payAmount" type="number" dir="ltr" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="h-9 text-end tabular-nums" />
                      </div>

                      <div className="space-y-1.5">
                        <Label>{ar ? "التخصيصات" : "Allocations"}</Label>
                        {payAllocs.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                            {ar ? "لا توجد ذمم مستحقة — أنشئ فاتورة/مصروفاً أولاً" : "No outstanding AR/AP — create an invoice/expense first"}
                          </p>
                        ) : (
                          <div className="max-h-52 space-y-1.5 overflow-auto rounded-lg border border-border/50 p-2">
                            {payAllocs.map((a) => (
                              <label key={a.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
                                <input
                                  type="checkbox"
                                  checked={a.selected}
                                  onChange={(e) =>
                                    setPayAllocs((prev) => prev.map((x) => (x.key === a.key ? { ...x, selected: e.target.checked } : x)))
                                  }
                                  className="h-3.5 w-3.5 rounded border-border accent-elite-blue-600"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-mono text-xs" dir="ltr">{a.label}</span>
                                  <span className="block text-[11px] text-muted-foreground">{a.party || "—"} · {ar ? "متبقٍ" : "outstanding"}: {fmtMoney(a.outstanding)}</span>
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  disabled={!a.selected}
                                  placeholder={String(a.outstanding)}
                                  value={a.amount}
                                  onChange={(e) => setPayAllocs((prev) => prev.map((x) => (x.key === a.key ? { ...x, amount: e.target.value } : x)))}
                                  className="h-8 w-28 rounded-md border border-input bg-transparent px-2 text-end text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      {(() => {
                        const allocSum = payAllocs.filter((a) => a.selected).reduce((s, a) => s + Number(a.amount || 0), 0)
                        const amount = Number(payAmount || 0)
                        const balance = Math.round((amount - allocSum) * 100) / 100
                        const diff = Math.abs(balance) > 0.01
                        return (
                          <p className={`text-xs ${diff ? "text-amber-600" : "text-emerald-600"}`} dir="ltr">
                            {ar ? "المُخصص" : "Allocated"}: {fmtMoney(allocSum)} / {fmtMoney(amount)} · {ar ? "المتبقي" : "Remaining"}: {fmtMoney(balance)}
                          </p>
                        )
                      })()}

                      <div className="space-y-1.5">
                        <Label htmlFor="payReference">{ar ? "مرجع (اختياري)" : "Reference (optional)"}</Label>
                        <Input id="payReference" value={payReference} onChange={(e) => setPayReference(e.target.value)} className="h-9" />
                      </div>

                      <div className="flex items-center gap-3">
                        <Button onClick={() => void handleRecordPayment()} disabled={payBusy} className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800">
                          {payBusy ? <LoadingSpinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                          {ar ? "تسجيل وترحيل" : "Record & post"}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* ── Reverse entry dialog ─────────────────────────────────────────── */}
      <Dialog open={!!reversalTarget} onOpenChange={(o) => { if (!o) setReversalTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "عكس قيد مرحّل" : "Reverse posted entry"}</DialogTitle>
            <DialogDescription>
              {ar
                ? `سيُنشأ قيد عكسي (مقابل) مربوط بالقيد ${reversalTarget?.entry_ref ?? ""}، ويصبح الأصل معكوساً. لا يمكن التراجع عن هذا الإجراء.`
                : `A linked reversal entry for ${reversalTarget?.entry_ref ?? ""} will be posted and the original marked reversed. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="revDate">{ar ? "تاريخ العكس" : "Reversal date"}</Label>
              <Input id="revDate" type="date" dir="ltr" value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="revDesc">{ar ? "وصف العكس (اختياري)" : "Reversal description (optional)"}</Label>
              <Input id="revDesc" value={reversalDesc} onChange={(e) => setReversalDesc(e.target.value)} className="h-9" />
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleReverse()}
                disabled={isReversing}
                className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
              >
                {isReversing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {ar ? "عكس القيد" : "Reverse entry"}
              </Button>
              <Button variant="ghost" onClick={() => setReversalTarget(null)}>
                <X className="h-4 w-4" />
                {ar ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reject entry dialog ──────────────────────────────────────────── */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason("") } }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "رفض القيد" : "Reject entry"}</DialogTitle>
            <DialogDescription>
              {ar ? "سيعود القيد إلى المسودة للمراجعة بعد بيان السبب." : "The entry returns to draft for revision after a reason is recorded."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rejectReason">{ar ? "سبب الرفض (مطلوب)" : "Rejection reason (required)"}</Label>
              <Input id="rejectReason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="h-9" />
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleReject()}
                disabled={isRejecting || !rejectReason.trim()}
                className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
              >
                {isRejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                {ar ? "رفض القيد" : "Reject entry"}
              </Button>
              <Button variant="ghost" onClick={() => { setRejectTarget(null); setRejectReason("") }}>
                <X className="h-4 w-4" />
                {ar ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reopen period dialog ─────────────────────────────────────────── */}
      <Dialog open={!!reopenTarget} onOpenChange={(o) => { if (!o) { setReopenTarget(null); setReopenReason("") } }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "إعادة فتح الفترة" : "Reopen period"}</DialogTitle>
            <DialogDescription>
              {ar ? "سيُسمح بترحيل قيود جديدة في هذه الفترة. يُسجَّل السبب في سجل المراجعة." : "New postings will be allowed in this period. The reason is recorded for audit."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reopenReason">{ar ? "سبب إعادة الفتح (مطلوب)" : "Reopen reason (required)"}</Label>
              <Input id="reopenReason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className="h-9" />
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleReopen()}
                disabled={isReopening || !reopenReason.trim()}
                className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
              >
                {isReopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                {ar ? "إعادة فتح الفترة" : "Reopen period"}
              </Button>
              <Button variant="ghost" onClick={() => { setReopenTarget(null); setReopenReason("") }}>
                <X className="h-4 w-4" />
                {ar ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
