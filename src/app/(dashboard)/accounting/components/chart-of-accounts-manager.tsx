"use client"

// Phase 2 — Chart of Accounts manager (CoA CRUD, CSV import/export,
// opening balances, per-tenant defaults). Embedded in the /accounting page's
// "Accounts" tab. Bilingual (AR/EN, RTL-aware).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
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
  exportChartAccountsCsv,
  importChartAccountsCsv,
  initializeDefaultCoa,
  postOpeningBalances,
  CONVENTIONAL_BALANCE,
  type AccountType,
  type NormalBalance,
} from "@/lib/accounting/actions"
import {
  Pencil,
  Power,
  Download,
  Upload,
  Wand2,
  Scale,
  Save,
  X,
  Plus,
  Loader2,
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

interface AccountRow {
  id: string
  account_code: string
  name_ar: string
  name_en: string
  account_type: AccountType
  normal_balance: NormalBalance
  parent_id: string | null
  is_contra: boolean
  is_active: boolean
  description: string | null
}

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

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** All descendants of `rootId` in the account tree (for cycle-safe parents). */
function collectDescendants(rows: AccountRow[], rootId: string): Set<string> {
  const result = new Set<string>()
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift()!
    for (const r of rows) {
      if (r.parent_id === id && !result.has(r.id)) {
        result.add(r.id)
        queue.push(r.id)
      }
    }
  }
  return result
}

const ACCOUNT_QUERY =
  "id,account_code,name_ar,name_en,account_type,normal_balance,parent_id,is_contra,is_active,description"

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

export function ChartOfAccountsManager() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [rows, setRows] = useState<AccountRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  // dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AccountRow | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [openingOpen, setOpeningOpen] = useState(false)

  // Refresh helper (called from event handlers after mutations). The initial
  // load lives in the effect below (inline IIFE — matches the accounting page
  // convention and satisfies react-hooks/set-state-in-effect).
  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("chart_of_accounts")
      .select(ACCOUNT_QUERY)
      .is("deleted_at", null)
      .order("account_code", { ascending: true })
    if (error) {
      console.error(error)
      setRows([])
    } else {
      setRows((data as unknown as AccountRow[]) ?? [])
    }
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select(ACCOUNT_QUERY)
        .is("deleted_at", null)
        .order("account_code", { ascending: true })
      if (error) {
        console.error(error)
        setRows([])
      } else {
        setRows((data as unknown as AccountRow[]) ?? [])
      }
      setIsLoading(false)
    })()
  }, [])

  const flash = (type: Feedback["type"], text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 6000)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.account_code.toLowerCase().includes(q) ||
        r.name_ar.toLowerCase().includes(q) ||
        r.name_en.toLowerCase().includes(q)
    )
  }, [rows, search])

  const kpiCards: KpiCardData[] = [
    { label: ar ? "إجمالي الحسابات" : "Total accounts", value: rows.length, icon: ListTree, color: "#1E5A99" },
    { label: t.common.active, value: rows.filter((r) => r.is_active).length, icon: CheckCircle2, color: "#10B981" },
    {
      label: ar ? "الأصول" : "Assets",
      value: rows.filter((r) => r.account_type === "asset").length,
      icon: CircleDollarSign,
      color: "#0EA5E9",
    },
    {
      label: ar ? "الإيرادات والمصروفات" : "Income & expense",
      value: rows.filter((r) => r.account_type === "income" || r.account_type === "expense").length,
      icon: Scale,
      color: "#8B5CF6",
    },
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
          <span className="font-medium">{r.name_ar}</span>
          <span className="text-xs text-muted-foreground" dir="ltr">{r.name_en}</span>
          {r.is_contra && (
            <Badge className="bg-purple-500/15 text-purple-600 border-purple-500/20" title="Contra account">
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
        const parent = rows.find((p) => p.id === r.parent_id)
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
    const res = await exportChartAccountsCsv()
    setIsExporting(false)
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "chart-of-accounts.csv"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      flash("ok", ar ? "تم تصدير دليل الحسابات." : "Chart of accounts exported.")
    } else {
      flash("err", res.error ?? "Export failed")
    }
  }

  // ── Load defaults ───────────────────────────────────────────────────────
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false)
  async function handleLoadDefaults() {
    setIsLoadingDefaults(true)
    const res = await initializeDefaultCoa()
    setIsLoadingDefaults(false)
    if (res.success) {
      flash("ok", ar ? "تم تحميل دليل الحسابات الافتراضي." : "Default chart of accounts loaded.")
      await load()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // ── Create / edit form ──────────────────────────────────────────────────
  const [form, setForm] = useState<AccountFormState>(emptyForm)
  const [isSavingForm, setIsSavingForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const openCreate = () => {
    setForm(emptyForm())
    setFormError(null)
    setCreateOpen(true)
  }
  const openEdit = (r: AccountRow) => {
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

  // Parent candidates: same type, excluding self and its descendants (cycle-safe).
  const parentCandidates = useMemo(() => {
    const excluded = editTarget ? collectDescendants(rows, editTarget.id) : new Set<string>()
    return rows.filter(
      (r) =>
        r.account_type === form.account_type &&
        r.id !== editTarget?.id &&
        !excluded.has(r.id) &&
        r.is_active
    )
  }, [rows, form.account_type, editTarget])

  async function handleSubmitForm() {
    setIsSavingForm(true)
    setFormError(null)
    const payload = {
      account_code: form.account_code,
      name_ar: form.name_ar,
      name_en: form.name_en,
      account_type: form.account_type,
      normal_balance: form.normal_balance,
      parent_id: form.parent_id || null,
      is_contra: form.is_contra,
      description: form.description || null,
    }
    const res = editTarget
      ? await updateChartAccount({ ...payload, account_id: editTarget.id, is_active: form.is_active })
      : await createChartAccount(payload)
    setIsSavingForm(false)
    if (res.success) {
      flash("ok", editTarget ? (ar ? "تم تحديث الحساب." : "Account updated.") : (ar ? "تم إنشاء الحساب." : "Account created."))
      setCreateOpen(false)
      setEditTarget(null)
      await load()
    } else {
      setFormError(res.error ?? "Failed")
    }
  }

  // ── Deactivate / activate ───────────────────────────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null)
  async function handleToggleActive(r: AccountRow) {
    setBusyId(r.id)
    // Deactivating goes through the guarded action (COA005); reactivating
    // through the update path (is_active=true has no guard — safe to re-enable).
    const res = r.is_active
      ? await deactivateChartAccount({ account_id: r.id })
      : await updateChartAccount({ account_id: r.id, is_active: true })
    setBusyId(null)
    if (res.success) {
      flash("ok", r.is_active ? (ar ? "تم إيقاف الحساب." : "Account deactivated.") : (ar ? "تم تفعيل الحساب." : "Account activated."))
      await load()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // ── Import CSV ──────────────────────────────────────────────────────────
  const [csvText, setCsvText] = useState("")
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImport() {
    setIsImporting(true)
    setImportResult(null)
    const res = await importChartAccountsCsv({ csv: csvText })
    setIsImporting(false)
    if (res.success) {
      flash("ok", ar ? `تم استيراد ${res.imported ?? 0} حساب.` : `${res.imported ?? 0} account(s) imported.`)
      setImportResult({ imported: res.imported ?? 0, skipped: res.skipped ?? 0, errors: [] })
      setCsvText("")
      await load()
    } else {
      setImportResult({ imported: res.imported ?? 0, skipped: res.skipped ?? 0, errors: res.errors ?? [] })
      if (!res.errors?.length) flash("err", res.error ?? "Import failed")
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvText(await file.text())
    e.target.value = ""
  }

  // ── Opening balances ────────────────────────────────────────────────────
  const [obDate, setObDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [obLines, setObLines] = useState<{ key: number; account_id: string; debit: string; credit: string }[]>([
    { key: 1, account_id: "", debit: "", credit: "" },
  ])
  const [isPostingOb, setIsPostingOb] = useState(false)
  const [obError, setObError] = useState<string | null>(null)

  const openOpening = () => {
    setObDate(new Date().toISOString().slice(0, 10))
    setObLines([{ key: Date.now(), account_id: "", debit: "", credit: "" }])
    setObError(null)
    setOpeningOpen(true)
  }
  const updateObLine = (key: number, patch: Partial<(typeof obLines)[number]>) =>
    setObLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addObLine = () => setObLines((prev) => [...prev, { key: Date.now(), account_id: "", debit: "", credit: "" }])
  const removeObLine = (key: number) => setObLines((prev) => prev.filter((l) => l.key !== key))

  const obTotalDebit = obLines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const obTotalCredit = obLines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const obBalanced = Math.abs(obTotalDebit - obTotalCredit) < 0.001 && obTotalDebit > 0

  async function handlePostOpening() {
    setIsPostingOb(true)
    setObError(null)
    const res = await postOpeningBalances({
      entry_date: obDate,
      lines: obLines.map((l) => ({
        account_id: l.account_id,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      })),
    })
    setIsPostingOb(false)
    if (res.success) {
      flash("ok", ar ? "تم ترحيل الأرصدة الافتتاحية." : "Opening balances posted.")
      setOpeningOpen(false)
      await load()
    } else {
      setObError(res.error ?? "Failed")
    }
  }

  const inputCls = "h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
  const selectCls = `${inputCls} w-full`

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
        title={ar ? "دليل الحسابات" : "Chart of Accounts"}
        subtitle={
          ar
            ? "إدارة الحسابات، الاستيراد/التصدير، الأرصدة الافتتاحية"
            : "Manage accounts, import/export, opening balances"
        }
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel={ar ? "حساب جديد" : "Add account"}
        onPrimaryCta={openCreate}
        primaryCtaIcon={Plus}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => { setImportResult(null); setCsvText(""); setImportOpen(true) }}
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
        data={filtered}
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
              disabled={busyId === r.id}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
                r.is_active
                  ? "text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  : "text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
              }`}
              title={r.is_active ? (ar ? "إيقاف" : "Deactivate") : ar ? "تفعيل" : "Activate"}
            >
              {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
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
      <Dialog open={createOpen || !!editTarget} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditTarget(null) } }}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? (ar ? "تعديل حساب" : "Edit account") : ar ? "إضافة حساب" : "Add account"}</DialogTitle>
            <DialogDescription>
              {ar ? "رمز فريد 3-6 أرقام، ونوع يتوافق مع طبيعة الرصيد" : "Unique 3-6 digit code; type must match the normal balance"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="coa-code">{ar ? "رمز الحساب" : "Code"}</Label>
                <Input
                  id="coa-code"
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
              <Input id="coa-ar" dir="rtl" value={form.name_ar} onChange={(e) => setField("name_ar", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coa-en">{ar ? "الاسم بالإنجليزية" : "English name"}</Label>
              <Input id="coa-en" dir="ltr" value={form.name_en} onChange={(e) => setField("name_en", e.target.value)} className="h-9" />
            </div>

            <div className="space-y-1.5">
              <Label>{ar ? "الطبيعة" : "Normal balance"}</Label>
              <div className="flex gap-2">
                {(["debit", "credit"] as const).map((nb) => (
                  <button
                    key={nb}
                    type="button"
                    onClick={() => setField("normal_balance", nb)}
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
                  onChange={(e) => toggleContra(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-elite-blue-600"
                />
                {ar ? "حساب مقابل (يخالف الطبيعة الاعتيادية)" : "Contra account (opposes the conventional balance)"}
              </label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="coa-parent">{ar ? "الحساب الأب (اختياري)" : "Parent account (optional)"}</Label>
              <select
                id="coa-parent"
                value={form.parent_id}
                onChange={(e) => setField("parent_id", e.target.value)}
                className={selectCls}
              >
                <option value="">—</option>
                {parentCandidates.map((p) => (
                  <option key={p.id} value={p.id}>{p.account_code} · {ar ? p.name_ar : p.name_en}</option>
                ))}
              </select>
              {parentCandidates.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {ar ? "لا توجد حسابات أب متاحة من نفس النوع." : "No same-type parent accounts available."}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="coa-desc">{ar ? "الوصف (اختياري)" : "Description (optional)"}</Label>
              <Input id="coa-desc" value={form.description} onChange={(e) => setField("description", e.target.value)} className="h-9" />
            </div>

            {editTarget && (
              <div className="space-y-1.5">
                <Label>{ar ? "الحالة" : "Status"}</Label>
                <div className="flex gap-2">
                  {[true, false].map((active) => (
                    <button
                      key={String(active)}
                      type="button"
                      onClick={() => setField("is_active", active)}
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

            {formError && <p className="text-xs text-red-500">{formError}</p>}

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
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import CSV dialog ─────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg rounded-2xl">
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
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => void handleFile(e)} className="hidden" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg"
              >
                <FileText className="h-3.5 w-3.5" />
                {ar ? "اختيار ملف" : "Choose file"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCsvText(SAMPLE_CSV)}
                className="rounded-lg text-xs"
              >
                {ar ? "نموذج" : "Sample"}
              </Button>
            </div>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              dir="ltr"
              placeholder={SAMPLE_CSV}
              rows={7}
              className="w-full rounded-lg border border-input bg-transparent p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {importResult && (
              <div className="space-y-1 rounded-xl border border-border/50 bg-muted/20 p-3 text-xs">
                <p className={importResult.errors.length ? "text-amber-600" : "text-emerald-600"}>
                  {ar ? "تم الاستيراد" : "Imported"}: {importResult.imported} · {ar ? "تم التخطي" : "Skipped"}: {importResult.skipped}
                  {importResult.errors.length > 0 && ` · ${ar ? "أخطاء" : "Errors"}: ${importResult.errors.length}`}
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="max-h-28 space-y-0.5 overflow-y-auto text-red-500">
                    {importResult.errors.slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}
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
      <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
        <DialogContent className="max-w-xl rounded-2xl">
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
              <Input id="ob-date" type="date" dir="ltr" value={obDate} onChange={(e) => setObDate(e.target.value)} className="h-9" />
            </div>

            <div className="rounded-xl border border-border/50">
              <div className="grid grid-cols-[1fr_90px_90px_32px] gap-2 border-b border-border/50 bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                <span>{ar ? "الحساب" : "Account"}</span>
                <span>{ar ? "مدين" : "Debit"}</span>
                <span>{ar ? "دائن" : "Credit"}</span>
                <span />
              </div>
              {obLines.map((l) => (
                <div key={l.key} className="grid grid-cols-[1fr_90px_90px_32px] items-center gap-2 px-3 py-2">
                  <select
                    value={l.account_id}
                    onChange={(e) => updateObLine(l.key, { account_id: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">—</option>
                    {rows.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.account_code} · {ar ? a.name_ar : a.name_en}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    dir="ltr"
                    min="0"
                    step="0.01"
                    value={l.debit}
                    onChange={(e) => updateObLine(l.key, { debit: e.target.value })}
                    className="h-9 text-end tabular-nums"
                  />
                  <Input
                    type="number"
                    dir="ltr"
                    min="0"
                    step="0.01"
                    value={l.credit}
                    onChange={(e) => updateObLine(l.key, { credit: e.target.value })}
                    className="h-9 text-end tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => removeObLine(l.key)}
                    disabled={obLines.length <= 1}
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

            {obError && <p className="text-xs text-red-500">{obError}</p>}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handlePostOpening()}
                disabled={isPostingOb || !obBalanced || obLines.some((l) => !l.account_id)}
                className="bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 hover:from-elite-blue-700 hover:to-elite-blue-800"
              >
                {isPostingOb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
                {ar ? "ترحيل الأرصدة" : "Post balances"}
              </Button>
              <Button variant="ghost" onClick={() => setOpeningOpen(false)}>
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
