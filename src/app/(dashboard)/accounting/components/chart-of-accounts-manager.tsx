"use client"

// Phase 2 — Chart of Accounts manager (CoA CRUD, CSV import/export,
// opening balances, per-tenant defaults). Embedded in the /accounting page's
// "Accounts" tab. Bilingual (AR/EN, RTL-aware).

import { useUiText } from "@/components/localized-text"
import { useRef, useState } from "react"
import { useAccountingMasterPage } from "@/hooks/use-accounting-master-page"
import { useChartParentPage } from "@/hooks/use-chart-parent-page"
import { formatChartImportError, MASTER_IMPORT_MAX_BYTES, type ChartMasterRow, type ChartMasterSummary, type MasterReview } from "@/lib/accounting/master-contract"
import { AccountingPageControls } from "@/components/accounting/accounting-page-controls"
import { AccountingOptionPicker } from "@/components/accounting/accounting-option-picker"
import { sumAccountingMoney } from "@/lib/accounting/paged-reads"
import { useTranslation } from "@/hooks/use-translation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import {
  createChartAccount,
  updateChartAccount,
  deactivateChartAccount,
  archiveChartAccount,
  exportChartAccountsCsv,
  importChartAccountsCsv,
  initializeDefaultCoa,
  postOpeningBalances,
} from "@/lib/accounting/actions"
import {
  CONVENTIONAL_BALANCE,
  type AccountType,
  type NormalBalance,
} from "@/lib/accounting/csv-utils"
import {
  Pencil,
  Power,
  Trash2,
  Download,
  Upload,
  Wand2,
  Scale,
  Save,
  X,
  Plus,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ListTree,
  FolderTree,
  CircleDollarSign,
  FileText,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

// ── Row shape ────────────────────────────────────────────────────────────

type AccountRow = ChartMasterRow

const TYPE_AR: Record<AccountType, string> = {
  asset: "أصل",
  liability: "التزام",
  equity: "حقوق ملكية",
  income: "إيراد",
  expense: "مصروف",
}

const TYPE_CLASS: Record<AccountType, string> = {
  asset: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  liability: "bg-amber-500/15 text-amber-600 border-amber-500/20",
  equity: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  income: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  expense: "bg-red-500/15 text-red-600 border-red-500/20",
}

function fmtMoney(value: string | null): string {
  if (value === null) return "—"
  const [whole, fraction = ""] = value.split(".")
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction.padEnd(2, "0")
}

const SAMPLE_CSV = [
  "account_code,name_ar,name_en,account_type,normal_balance,parent_code,is_contra,is_active,description",
  "6000,مصروفات السيارات,Vehicle Expenses,expense,debit,,false,true,",
  "6100,مصروفات الاتصالات,Telecom Expenses,expense,debit,,false,true,",
  "6200,مصروفات التسويق,Marketing Expenses,expense,debit,,false,true,",
].join("\n")

interface Feedback {
  type: "ok" | "err"
  text: string
}

// ── Account form (create / edit) ─────────────────────────────────────────

interface AccountFormState {
  account_code: string
  name_ar: string
  name_en: string
  account_type: AccountType
  normal_balance: NormalBalance
  parent_id: string
  is_contra: boolean
  is_active: boolean
  description: string
}

function emptyForm(): AccountFormState {
  return {
    account_code: "",
    name_ar: "",
    name_en: "",
    account_type: "asset",
    normal_balance: "debit",
    parent_id: "",
    is_contra: false,
    is_active: true,
    description: "",
  }
}

// ── Main component ───────────────────────────────────────────────────────

function ChartParentPicker({ type, excludeId, value, onChange, disabled, selectedLabel, ar }: {
  type: AccountType; excludeId?: string; value: string; onChange: (id: string) => void; disabled: boolean; selectedLabel?: string; ar: boolean
}) {
  const page = useChartParentPage(type, excludeId)
  const [selected, setSelected] = useState<AccountRow | null>(null)
  const options = selected && selected.id === value && !page.rows.some(row => row.id === value) ? [selected, ...page.rows] : page.rows
  return <fieldset disabled={disabled} data-testid="coa-parent-picker" className="min-w-0 space-y-2 rounded-lg border border-border/60 p-2">
    <Label htmlFor="coa-parent">{ar ? "الحساب الأب (اختياري)" : "Parent account (optional)"}</Label>
    <AccountingPageControls state={page} />
    <select id="coa-parent" value={value} disabled={page.loading || page.error || disabled} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" onChange={event => { onChange(event.target.value); setSelected(options.find(row => row.id === event.target.value) ?? null) }}>
      <option value="">{ar ? "بدون حساب أب" : "No parent account"}</option>
      {value && !options.some(row => row.id === value) && <option value={value}>{selectedLabel || value}</option>}
      {options.map(row => <option key={row.id} value={row.id}>{row.account_code} · {ar ? row.name_ar : row.name_en}</option>)}
    </select>
    {!page.loading && !page.error && page.pagination.totalRecords === 0 && <p className="text-xs text-muted-foreground">{ar ? "لا توجد حسابات أب متاحة من نفس النوع." : "No same-type parent accounts available."}</p>}
  </fieldset>
}

export function ChartOfAccountsManager() {
  const ui = useUiText()
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const master = useAccountingMasterPage<AccountRow>("accounts")
  const { rows, loading: isLoading, search, setSearch, reload: load } = master
  const summary = master.summary as ChartMasterSummary | null
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AccountRow | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [openingOpen, setOpeningOpen] = useState(false)
  const [formRequest, setFormRequest] = useState("")
  const [importRequest, setImportRequest] = useState("")
  const [openingRequest, setOpeningRequest] = useState("")
  const defaultsRequest = useRef<string | null>(null)
  const statusRequests = useRef(new Map<string, MasterReview & { active: boolean }>())
  const actionError = (result: { success: boolean; error?: string; errorAr?: string }) =>
    (ar ? result.errorAr ?? result.error : result.error) ?? (ar ? "تعذر إتمام العملية. أعد المحاولة." : "Could not complete the action. Try again.")

  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (type: Feedback["type"], text: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback({ type, text })
    feedbackTimer.current = type === "ok" ? setTimeout(() => setFeedback(null), 6000) : null
  }

  const kpiCards: KpiCardData[] = [
    { label: ar ? "إجمالي الحسابات" : "Total accounts", value: summary?.total ?? "—", icon: ListTree, color: "#1E5A99" },
    { label: t.common.active, value: summary?.active ?? "—", icon: CheckCircle2, color: "#10B981" },
    { label: ar ? "الأصول" : "Assets", value: summary?.assets ?? "—", icon: CircleDollarSign, color: "#0EA5E9" },
    { label: ar ? "الإيرادات والمصروفات" : "Income & expense", value: summary?.income_expense ?? "—", icon: Scale, color: "#8B5CF6" },
  ]

  const columns: TableColumn<AccountRow>[] = [
    {
      key: "account_code",
      header: ar ? "الرمز" : "Code",
      render: (r) => <span dir="ltr" className="font-mono text-xs font-medium">{r.account_code}</span>,
    },
    {
      key: "name_ar",
      header: ar ? "الاسم" : "Name",
      render: (r) => (
        <div className="flex items-center gap-2">
          <span data-testid="chart-primary-name" className="font-medium">{ar ? (r.name_ar || r.name_en) : (r.name_en || r.name_ar)}</span>
          <span className="text-xs text-muted-foreground" dir={ar ? "ltr" : "rtl"}>{ar ? r.name_en : r.name_ar}</span>
          {r.is_contra && (
            <Badge className="bg-purple-500/15 text-purple-600 border-purple-500/20" title={ui("Contra account")}>
              {ar ? "مقابل" : "Contra"}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "account_type",
      header: ar ? "النوع" : "Type",
      render: (r) => (
        <Badge className={TYPE_CLASS[r.account_type]}>
          {ar ? TYPE_AR[r.account_type] : r.account_type}
        </Badge>
      ),
    },
    {
      key: "normal_balance",
      header: ar ? "الطبيعة" : "Balance",
      render: (r) => (
        <span dir="ltr" className="text-xs text-muted-foreground">
          {ar ? (r.normal_balance === "debit" ? "مدين" : "دائن") : r.normal_balance}
        </span>
      ),
    },
    {
      key: "parent_id",
      header: ar ? "الأب" : "Parent",
      render: (r) => {
        if (!r.parent_id) return <span className="text-xs text-muted-foreground">—</span>
        const parent = r.parent_code ? { account_code: r.parent_code, name_ar: r.parent_name_ar, name_en: r.parent_name_en } : undefined
        return (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <FolderTree className="h-3 w-3" />
            {parent?.account_code ?? "—"}
          </span>
        )
      },
    },
    {
      key: "is_active",
      header: t.common.status,
      render: (r) =>
        r.is_active ? (
          <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">
            {t.common.active}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-gray-500/20 bg-gray-500/15 px-2 py-0.5 text-xs font-medium text-gray-600">
            {t.common.inactive}
          </span>
        ),
    },
  ]

  // ── Export ──────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false)
  async function handleExport() {
    setIsExporting(true)
    try {
      const res = await exportChartAccountsCsv(search)
      if (res.success && res.csv) {
        const url = URL.createObjectURL(new Blob([res.csv], { type: "text/csv;charset=utf-8" }))
        const link = document.createElement("a"); link.href = url; link.download = "chart-of-accounts.csv"
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
        flash("ok", ar ? "تم تصدير السجلات المطابقة للبحث." : "Records matching the search exported.")
      } else flash("err", actionError(res))
    } catch { flash("err", ar ? "تعذر تصدير السجلات. أعد المحاولة." : "Could not export the records. Try again.") }
    finally { setIsExporting(false) }
  }

  // ── Load defaults ───────────────────────────────────────────────────────
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false)
  async function handleLoadDefaults() {
    setIsLoadingDefaults(true)
    const request_id = defaultsRequest.current ?? crypto.randomUUID(); defaultsRequest.current = request_id
    try {
      const res = await initializeDefaultCoa({ request_id })
      if (res.success) { defaultsRequest.current = null; flash("ok", ar ? "تم تحميل دليل الحسابات الافتراضي." : "Default chart of accounts loaded."); load() }
      else flash("err", actionError(res))
    } catch { flash("err", ar ? "تعذر تأكيد تحميل الحسابات الافتراضية. أعد المحاولة." : "Unable to confirm default account initialization. Retry the same action.") }
    finally { setIsLoadingDefaults(false) }
  }

  // ── Create / edit form ──────────────────────────────────────────────────
  const [form, setForm] = useState<AccountFormState>(emptyForm)
  const [isSavingForm, setIsSavingForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const openCreate = () => {
    setFormRequest(crypto.randomUUID())
    setForm(emptyForm())
    setFormError(null)
    setCreateOpen(true)
  }
  const openEdit = (r: AccountRow) => {
    setFormRequest(crypto.randomUUID())
    setForm({
      account_code: r.account_code,
      name_ar: r.name_ar,
      name_en: r.name_en,
      account_type: r.account_type,
      normal_balance: r.normal_balance,
      parent_id: r.parent_id ?? "",
      is_contra: r.is_contra,
      is_active: r.is_active,
      description: r.description ?? "",
    })
    setFormError(null)
    setEditTarget(r)
  }

  const setField = <K extends keyof AccountFormState>(key: K, value: AccountFormState[K]) =>
    setForm((p) => ({ ...p, [key]: value }))

  const flip = (b: NormalBalance): NormalBalance => (b === "debit" ? "credit" : "debit")

  const changeType = (type: AccountType) => {
    setForm((p) => ({
      ...p,
      account_type: type,
      parent_id: type === p.account_type ? p.parent_id : "",
      // Auto-suggest the conventional balance unless this is a contra account.
      normal_balance: p.is_contra ? flip(CONVENTIONAL_BALANCE[type]) : CONVENTIONAL_BALANCE[type],
    }))
  }

  const toggleContra = (contra: boolean) => {
    setForm((p) => ({
      ...p,
      is_contra: contra,
      // Flipping contra-ness flips the suggested side.
      normal_balance: contra ? flip(CONVENTIONAL_BALANCE[p.account_type]) : CONVENTIONAL_BALANCE[p.account_type],
    }))
  }

  async function handleSubmitForm() {
    if (!formRequest) return
    setIsSavingForm(true); setFormError(null)
    const payload = { account_code: form.account_code, name_ar: form.name_ar, name_en: form.name_en,
      account_type: form.account_type, normal_balance: form.normal_balance, parent_id: form.parent_id || null,
      is_contra: form.is_contra, description: form.description || null, request_id: formRequest }
    try {
      const res = editTarget ? await updateChartAccount({ ...payload, account_id: editTarget.id, expected_updated_at: editTarget.updated_at, is_active: form.is_active }) : await createChartAccount(payload)
      if (res.success) {
        flash("ok", editTarget ? (ar ? "تم تحديث الحساب." : "Account updated.") : (ar ? "تم إنشاء الحساب." : "Account created."))
        setCreateOpen(false); setEditTarget(null); setFormRequest(""); load()
      } else setFormError(actionError(res))
    } catch { setFormError(ar ? "تعذر تأكيد الحفظ. أعد المحاولة بالتفاصيل نفسها." : "Unable to confirm the save. Retry with unchanged details.") }
    finally { setIsSavingForm(false) }
  }

  const [busyId, setBusyId] = useState<string | null>(null)
  async function handleToggleActive(r: AccountRow) {
    if (r.is_canonical) return
    const intent = statusRequests.current.get(r.id) ?? { request_id: crypto.randomUUID(), expected_updated_at: r.updated_at, active: !r.is_active }
    statusRequests.current.set(r.id, intent); setBusyId(r.id)
    try {
      const review = { request_id: intent.request_id, expected_updated_at: intent.expected_updated_at }
      const res = intent.active ? await updateChartAccount({ account_id: r.id, is_active: true, ...review }) : await deactivateChartAccount({ account_id: r.id, ...review })
      if (res.success) { statusRequests.current.delete(r.id); flash("ok", intent.active ? (ar ? "تم تفعيل الحساب." : "Account activated.") : (ar ? "تم إيقاف الحساب." : "Account deactivated.")); load() }
      else flash("err", actionError(res))
    } catch { flash("err", ar ? "تعذر تأكيد التغيير. أعد المحاولة أو حدّث القائمة للمراجعة." : "Unable to confirm the change. Retry or refresh the list to review.") }
    finally { setBusyId(null) }
  }

  // ── Import CSV ──────────────────────────────────────────────────────────
  const [csvText, setCsvText] = useState("")
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImport() {
    if (!importRequest) return
    if (new TextEncoder().encode(csvText).byteLength > MASTER_IMPORT_MAX_BYTES) { flash("err", ar ? "محتوى CSV كبير جداً. قسّمه إلى ملفات أصغر." : "CSV content is too large. Split it into smaller files."); return }
    setIsImporting(true); setImportResult(null)
    try {
      const res = await importChartAccountsCsv(csvText, { request_id: importRequest })
      if (typeof res.imported === "number") {
        setImportResult({ imported: res.imported, skipped: res.skipped ?? 0, errors: res.errors ?? [] })
        setImportRequest(crypto.randomUUID())
        if (res.imported > 0) load()
      }
      if (res.success) { flash("ok", ar ? "تم استيراد " + (res.imported ?? 0) + " حساب." : (res.imported ?? 0) + " account(s) imported."); setCsvText("") }
      else if (!res.errors?.length) flash("err", actionError(res))
    } catch { flash("err", ar ? "تعذر تأكيد الاستيراد. أعد المحاولة بالملف نفسه." : "Unable to confirm the import. Retry the same file.") }
    finally { setIsImporting(false) }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (file.size > MASTER_IMPORT_MAX_BYTES) { flash("err", ar ? "الملف كبير جداً. قسّمه إلى ملفات أصغر." : "The file is too large. Split it into smaller files."); return }
      setCsvText(await file.text())
    } catch { flash("err", ar ? "تعذر قراءة الملف المحدد." : "Could not read the selected file.") }
    finally { event.target.value = "" }
  }

  // ── Opening balances ────────────────────────────────────────────────────
  const [obDate, setObDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [obLines, setObLines] = useState<{ key: number; account_id: string; debit: string; credit: string }[]>([
    { key: 1, account_id: "", debit: "", credit: "" },
  ])
  const [isPostingOb, setIsPostingOb] = useState(false)
  const [obError, setObError] = useState<string | null>(null)

  const openOpening = () => {
    setOpeningRequest(crypto.randomUUID())
    setObDate(new Date().toISOString().slice(0, 10))
    setObLines([{ key: Date.now(), account_id: "", debit: "", credit: "" }])
    setObError(null)
    setOpeningOpen(true)
  }
  const updateObLine = (key: number, patch: Partial<(typeof obLines)[number]>) =>
    setObLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addObLine = () => setObLines((prev) => [...prev, { key: Date.now(), account_id: "", debit: "", credit: "" }])
  const removeObLine = (key: number) => setObLines((prev) => prev.filter((l) => l.key !== key))

  let obTotalDebit: string | null = null, obTotalCredit: string | null = null
  try { obTotalDebit = sumAccountingMoney(...obLines.map(line => line.debit || "0")); obTotalCredit = sumAccountingMoney(...obLines.map(line => line.credit || "0")) } catch { /* Invalid input remains visible; posting stays disabled. */ }
  const obBalanced = obTotalDebit !== null && obTotalCredit !== null && obTotalDebit === obTotalCredit && obTotalDebit !== "0.00"

  async function handlePostOpening() {
    if (!openingRequest || !obBalanced) return
    setIsPostingOb(true); setObError(null)
    try {
      const res = await postOpeningBalances({ request_id: openingRequest, entry_date: obDate,
        lines: obLines.map(line => ({ account_id: line.account_id, debit: Number(line.debit || 0), credit: Number(line.credit || 0) })) })
      if (res.success) { flash("ok", ar ? "تم ترحيل الأرصدة الافتتاحية." : "Opening balances posted."); setOpeningOpen(false); setOpeningRequest(""); load() }
      else setObError(actionError(res))
    } catch { setObError(ar ? "تعذر تأكيد الترحيل. أعد المحاولة بالأرصدة نفسها." : "Unable to confirm the posting. Retry with unchanged balances.") }
    finally { setIsPostingOb(false) }
  }

  const [archiveTarget, setArchiveTarget] = useState<AccountRow | null>(null)
  const [archiveRequest, setArchiveRequest] = useState("")
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)
  const openArchive = (row: AccountRow) => { if (!row.can_archive) return; setArchiveTarget(row); setArchiveRequest(crypto.randomUUID()); setArchiveError(null) }
  async function handleArchive() {
    if (!archiveTarget || !archiveRequest) return
    setIsArchiving(true); setArchiveError(null)
    try {
      const res = await archiveChartAccount({ account_id: archiveTarget.id, request_id: archiveRequest, expected_updated_at: archiveTarget.updated_at })
      if (res.success) { setArchiveTarget(null); setArchiveRequest(""); flash("ok", ar ? "تمت أرشفة الحساب." : "Account archived."); load() }
      else setArchiveError(actionError(res))
    } catch { setArchiveError(ar ? "تعذر تأكيد الأرشفة. أعد المحاولة بالحساب نفسه." : "Unable to confirm the archive. Retry the same account.") }
    finally { setIsArchiving(false) }
  }

  const inputCls = "h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
  const selectCls = `${inputCls} w-full`

  return (
    <div className="space-y-4" data-testid="accounts-master">
      {feedback && (
        <div
          role={feedback.type === "err" ? "alert" : "status"}
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
        title={ar ? "دليل الحسابات" : "Chart of Accounts"}
        subtitle={
          ar
            ? "إدارة الحسابات، الاستيراد/التصدير، الأرصدة الافتتاحية"
            : "Manage accounts, import/export, opening balances"
        }
        kpiCards={kpiCards}
        searchPlaceholder={ar ? "ابحث برمز الحساب أو الاسم" : "Search account code or name"}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel={ar ? "حساب جديد" : "Add account"}
        onPrimaryCta={openCreate}
        primaryCtaIcon={Plus}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={isLoading} onClick={() => { statusRequests.current.clear(); defaultsRequest.current = null; load() }}><RefreshCw className="h-4 w-4" />{ar ? "تحديث" : "Refresh"}</Button>
            <button
              onClick={handleLoadDefaults}
              disabled={isLoadingDefaults}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 disabled:opacity-50"
              title={ar ? "تحميل دليل الحسابات الافتراضي" : "Load default chart of accounts"}
            >
              {isLoadingDefaults ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {ar ? "الافتراضي" : "Defaults"}
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 disabled:opacity-50"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {ar ? "تصدير CSV" : "Export CSV"}
            </button>
            <button
              onClick={() => { setImportRequest(crypto.randomUUID()); setImportResult(null); setCsvText(""); setImportOpen(true) }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/50 bg-muted/30 px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60"
            >
              <Upload className="h-3.5 w-3.5" />
              {ar ? "استيراد CSV" : "Import CSV"}
            </button>
            <button
              onClick={openOpening}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 px-3.5 text-xs font-medium text-white shadow-sm transition-all hover:from-elite-blue-700 hover:to-elite-blue-800"
            >
              <Scale className="h-3.5 w-3.5" />
              {ar ? "أرصدة افتتاحية" : "Opening balances"}
            </button>
          </div>
        }
        columns={columns}
        data={rows}
        pagination={master.error || isLoading ? undefined : master.pagination}
        loadError={master.error ? (ar ? "تعذر تحميل الحسابات وإجمالياتها. أعد المحاولة قبل الاعتماد عليها." : "Could not load accounts and their totals. Retry before relying on them.") : undefined}
        onRetry={load}
        retryLabel={ar ? "أعد المحاولة" : "Retry"}
        rowActions={(r) => (
          <div className="flex items-center gap-1">
            <button
              onClick={() => openEdit(r)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-elite-blue-500/10 hover:text-elite-blue-600"
              title={ar ? "تعديل" : "Edit"}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleToggleActive(r)}
              disabled={busyId === r.id || r.is_canonical}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
                r.is_active
                  ? "text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  : "text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
              }`}
              title={r.is_canonical ? (ar ? "حساب قياسي محمي" : "Protected standard account") : r.is_active ? (ar ? "إيقاف" : "Deactivate") : ar ? "تفعيل" : "Activate"}
            >
              {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => openArchive(r)} disabled={!r.can_archive || isArchiving} aria-label={ar ? "أرشفة" : "Archive"}
              title={r.is_canonical ? (ar ? "حساب قياسي محمي" : "Protected standard account") : !r.can_archive ? (ar ? "هذا الحساب مرتبط بسجلات أخرى ولا يمكن أرشفته." : "This account is referenced and cannot be archived.") : ar ? "أرشفة" : "Archive"}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        isLoading={isLoading}
        emptyStateMessage={
          ar
            ? "لا توجد حسابات بعد. أنشئ حساباً جديداً أو حمّل الدليل الافتراضي."
            : "No accounts yet. Create one or load the default chart."
        }
        emptyStateAction={{ label: ar ? "تحميل الافتراضي" : "Load defaults", onClick: handleLoadDefaults }}
      />

      {/* ── Create / Edit dialog ─────────────────────────────────────── */}
      <Dialog open={createOpen || !!editTarget} onOpenChange={(o) => { if (!o && !isSavingForm) { setCreateOpen(false); setEditTarget(null) } }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? (ar ? "تعديل حساب" : "Edit account") : ar ? "إضافة حساب" : "Add account"}</DialogTitle>
            <DialogDescription>
              {ar ? "رمز فريد 3-6 أرقام، ونوع يتوافق مع طبيعة الرصيد" : "Unique 3-6 digit code; type must match the normal balance"}
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={isSavingForm} className="min-w-0 space-y-3" data-testid="chart-master-form">
            {editTarget?.is_canonical && <p className="text-sm text-muted-foreground">{ar ? "هذا حساب قياسي. يمكن تعديل الاسم والوصف فقط؛ بنية الحساب وحالته محميتان." : "This is a standard account. Names and description can change; structure and status are protected."}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="coa-code">{ar ? "رمز الحساب" : "Code"}</Label>
                <Input
                  id="coa-code"
                  disabled={!!editTarget?.is_canonical}
                  maxLength={6}
                  dir="ltr"
                  value={form.account_code}
                  onChange={(e) => setField("account_code", e.target.value)}
                  placeholder="5900"
                  className="h-9 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coa-type">{ar ? "النوع" : "Type"}</Label>
                <select
                  id="coa-type"
                  disabled={!!editTarget?.is_canonical}
                  value={form.account_type}
                  onChange={(e) => changeType(e.target.value as AccountType)}
                  className={selectCls}
                >
                  {Object.keys(TYPE_AR).map((ty) => (
                    <option key={ty} value={ty}>{ar ? TYPE_AR[ty as AccountType] : ty}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="coa-ar">{ar ? "الاسم بالعربية" : "Arabic name"}</Label>
              <Input id="coa-ar" maxLength={200} dir="rtl" value={form.name_ar} onChange={(e) => setField("name_ar", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coa-en">{ar ? "الاسم بالإنجليزية" : "English name"}</Label>
              <Input id="coa-en" maxLength={200} dir="ltr" value={form.name_en} onChange={(e) => setField("name_en", e.target.value)} className="h-9" />
            </div>

            <div className="space-y-1.5">
              <Label>{ar ? "الطبيعة" : "Normal balance"}</Label>
              <div role="group" aria-label={ar ? "الطبيعة" : "Normal balance"} className="flex gap-2">
                {(["debit", "credit"] as const).map((nb) => (
                  <button
                    key={nb}
                    type="button"
                    onClick={() => setField("normal_balance", nb)}
                    aria-pressed={form.normal_balance === nb}
                    disabled={!!editTarget?.is_canonical}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      form.normal_balance === nb
                        ? "border-elite-blue-500/60 bg-elite-blue-600/10 text-elite-blue-600"
                        : "border-border/50 text-muted-foreground"
                    }`}
                  >
                    {ar ? (nb === "debit" ? "مدين" : "دائن") : nb}
                  </button>
                ))}
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.is_contra}
                  disabled={!!editTarget?.is_canonical}
                  onChange={(e) => toggleContra(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-elite-blue-600"
                />
                {ar ? "حساب مقابل (يخالف الطبيعة الاعتيادية)" : "Contra account (opposes the conventional balance)"}
              </label>
            </div>

            <ChartParentPicker key={formRequest + ":" + form.account_type} type={form.account_type} excludeId={editTarget?.id} value={form.parent_id} onChange={value => setField("parent_id", value)} disabled={isSavingForm || !!editTarget?.is_canonical} ar={ar} selectedLabel={editTarget?.parent_code ? editTarget.parent_code + " · " + (ar ? editTarget.parent_name_ar : editTarget.parent_name_en) : undefined} />

            <div className="space-y-1.5">
              <Label htmlFor="coa-desc">{ar ? "الوصف (اختياري)" : "Description (optional)"}</Label>
              <Input id="coa-desc" maxLength={1000} value={form.description} onChange={(e) => setField("description", e.target.value)} className="h-9" />
            </div>

            {editTarget && (
              <div className="space-y-1.5">
                <Label>{ar ? "الحالة" : "Status"}</Label>
                <div role="group" aria-label={ar ? "الحالة" : "Status"} className="flex gap-2">
                  {[true, false].map((active) => (
                    <button
                      key={String(active)}
                      type="button"
                      onClick={() => setField("is_active", active)}
                      aria-pressed={form.is_active === active}
                      disabled={!!editTarget?.is_canonical}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        form.is_active === active
                          ? active
                            ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-600"
                            : "border-red-500/60 bg-red-500/10 text-red-500"
                          : "border-border/50 text-muted-foreground"
                      }`}
                    >
                      {ar ? (active ? "نشط" : "غير نشط") : active ? "Active" : "Inactive"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}

            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={() => void handleSubmitForm()}
                disabled={isSavingForm || !form.account_code.trim() || !form.name_ar.trim() || !form.name_en.trim()}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isSavingForm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t.common.save}
              </Button>
              <Button variant="ghost" onClick={() => { setCreateOpen(false); setEditTarget(null) }}>
                <X className="h-4 w-4" />
                {ar ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </fieldset>
        </DialogContent>
      </Dialog>

      {/* ── Import CSV dialog ─────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={value => { if (!isImporting) setImportOpen(value) }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "استيراد دليل الحسابات (CSV)" : "Import chart of accounts (CSV)"}</DialogTitle>
            <DialogDescription>
              {ar
                ? "الأعمدة المطلوبة: account_code, name_ar, name_en, account_type, normal_balance"
                : "Required columns: account_code, name_ar, name_en, account_type, normal_balance"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input ref={fileRef} disabled={isImporting} type="file" accept=".csv,text/csv" onChange={(e) => void handleFile(e)} className="hidden" />
              <Button
                variant="outline"
                size="sm"
                disabled={isImporting}
                onClick={() => fileRef.current?.click()}
                className="rounded-lg"
              >
                <FileText className="h-3.5 w-3.5" />
                {ar ? "اختيار ملف" : "Choose file"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isImporting}
                onClick={() => setCsvText(SAMPLE_CSV)}
                className="rounded-lg text-xs"
              >
                {ar ? "نموذج" : "Sample"}
              </Button>
            </div>
            <Label htmlFor="coa-csv">{ar ? "محتوى ملف CSV" : "CSV content"}</Label>
            <textarea
              id="coa-csv"
              disabled={isImporting}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              dir="ltr"
              placeholder={SAMPLE_CSV}
              rows={7}
              className="w-full rounded-lg border border-input bg-transparent p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {importResult && (
              <div role="status" data-testid="chart-import-result" className="space-y-1 rounded-xl border border-border/50 bg-muted/20 p-3 text-xs">
                <p className={importResult.errors.length ? "text-amber-600" : "text-emerald-600"}>
                  {ar ? "تم الاستيراد" : "Imported"}: {importResult.imported} · {ar ? "تم التخطي" : "Skipped"}: {importResult.skipped}
                  {importResult.errors.length > 0 && ` · ${ar ? "أخطاء" : "Errors"}: ${importResult.errors.length}`}
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="max-h-28 space-y-0.5 overflow-y-auto text-red-500">
                    {importResult.errors.map((e, i) => <li key={i} className="break-words">{formatChartImportError(e, ar)}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleImport()}
                disabled={isImporting || !csvText.trim()}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {ar ? "استيراد" : "Import"}
              </Button>
              <Button variant="ghost" onClick={() => setImportOpen(false)}>
                <X className="h-4 w-4" />
                {ar ? "إغلاق" : "Close"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Opening balances dialog ───────────────────────────────────── */}
      <Dialog open={openingOpen} onOpenChange={value => { if (!isPostingOb) setOpeningOpen(value) }}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "الأرصدة الافتتاحية" : "Opening balances"}</DialogTitle>
            <DialogDescription>
              {ar
                ? "يُرحَّل كقيد افتتاحي متوازن عبر محرك القيود (يظهر في ميزان المراجعة)"
                : "Posted as a balanced opening journal entry (appears in the trial balance)"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ob-date">{ar ? "التاريخ" : "Date"}</Label>
              <Input id="ob-date" disabled={isPostingOb} type="date" dir="ltr" value={obDate} onChange={(e) => setObDate(e.target.value)} className="h-9" />
            </div>

            <div className="rounded-xl border border-border/50">
              <div className="hidden gap-2 border-b sm:grid sm:grid-cols-[minmax(0,1fr)_90px_90px_32px] border-border/50 bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                <span>{ar ? "الحساب" : "Account"}</span>
                <span>{ar ? "مدين" : "Debit"}</span>
                <span>{ar ? "دائن" : "Credit"}</span>
                <span />
              </div>
              {obLines.map((l, index) => (
                <div key={l.key} className="grid grid-cols-2 items-end gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_90px_90px_32px]">
                  <div className="col-span-2 min-w-0 sm:col-span-1"><AccountingOptionPicker kind="accounts" id={"ob-account-" + l.key} label={(ar ? "الحساب " : "Account ") + (index + 1)} ar={ar} value={l.account_id} onChange={value => updateObLine(l.key, { account_id: value })} disabled={isPostingOb} /></div>
                  <Input
                    type="number"
                    dir="ltr"
                    min="0"
                    step="0.01"
                    aria-label={(ar ? "مدين " : "Debit ") + (index + 1)}
                    placeholder={ar ? "مدين" : "Debit"}
                    disabled={isPostingOb}
                    value={l.debit}
                    onChange={(e) => updateObLine(l.key, { debit: e.target.value })}
                    className="h-9 min-w-0 text-end tabular-nums"
                  />
                  <Input
                    type="number"
                    dir="ltr"
                    min="0"
                    step="0.01"
                    aria-label={(ar ? "دائن " : "Credit ") + (index + 1)}
                    placeholder={ar ? "دائن" : "Credit"}
                    disabled={isPostingOb}
                    value={l.credit}
                    onChange={(e) => updateObLine(l.key, { credit: e.target.value })}
                    className="h-9 min-w-0 text-end tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => removeObLine(l.key)}
                    aria-label={(ar ? "حذف السطر " : "Remove line ") + (index + 1)}
                    disabled={isPostingOb || obLines.length <= 1}
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
                onClick={addObLine}
                disabled={isPostingOb}
                className="text-xs font-medium text-elite-blue-600 hover:text-elite-blue-700"
              >
                + {ar ? "إضافة سطر" : "Add line"}
              </button>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">{ar ? "المجموع" : "Totals"}:</span>
                <span dir="ltr" className="tabular-nums font-medium">{fmtMoney(obTotalDebit)}</span>
                <span dir="ltr" className="tabular-nums font-medium">{fmtMoney(obTotalCredit)}</span>
                {obBalanced ? (
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

            {obError && <p role="alert" className="text-sm text-destructive">{obError}</p>}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handlePostOpening()}
                disabled={isPostingOb || !obBalanced || obLines.some((l) => !l.account_id)}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isPostingOb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
                {ar ? "ترحيل الأرصدة" : "Post balances"}
              </Button>
              <Button variant="ghost" disabled={isPostingOb} onClick={() => setOpeningOpen(false)}>
                <X className="h-4 w-4" />
                {ar ? "إلغاء" : "Cancel"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!archiveTarget} onOpenChange={value => { if (!value && !isArchiving) setArchiveTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>{ar ? "أرشفة الحساب" : "Archive account"}</DialogTitle>
            <DialogDescription>{ar ? "سيُزال الحساب من القوائم الحالية. الحسابات القياسية أو المرتبطة بسجلات أخرى محمية." : "The account leaves current lists. Standard accounts and accounts referenced by other records are protected."}</DialogDescription>
          </DialogHeader>
          {archiveError && <p role="alert" className="text-sm text-destructive">{archiveError}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="destructive" disabled={isArchiving} onClick={() => void handleArchive()}>{isArchiving && <Loader2 className="h-4 w-4 animate-spin" />}{ar ? "أرشفة" : "Archive"}</Button>
            <Button variant="ghost" disabled={isArchiving} onClick={() => setArchiveTarget(null)}>{ar ? "إلغاء" : "Cancel"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
