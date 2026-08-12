"use client"

// Phase 4 — Customers / Suppliers manager (CRUD, toggle, soft-delete, CSV
// export). Embedded in the /accounting page's "Customers" and "Suppliers"
// tabs via the `kind` prop. Bilingual (AR/EN, RTL-aware).

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import {
  createCustomer,
  updateCustomer,
  setCustomerActive,
  deleteCustomer,
  exportCustomersCsv,
  createSupplier,
  updateSupplier,
  setSupplierActive,
  deleteSupplier,
  exportSuppliersCsv,
  type PartyKind,
  type PartyInput,
} from "@/lib/accounting/parties"
import {
  Pencil,
  Power,
  Trash2,
  Download,
  Save,
  X,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Users,
  ReceiptText,
  CircleDollarSign,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// ── Row shape ────────────────────────────────────────────────────────────

interface PartyRow {
  id: string
  code: string
  name_ar: string
  name_en: string | null
  phone: string | null
  email: string | null
  tax_number: string | null
  address: string | null
  credit_limit: number | null
  is_active: boolean
}

function fmtMoney(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Form state ───────────────────────────────────────────────────────────

interface PartyFormState {
  code: string
  name_ar: string
  name_en: string
  phone: string
  email: string
  tax_number: string
  address: string
  credit_limit: string
  is_active: boolean
}

function emptyForm(): PartyFormState {
  return {
    code: "",
    name_ar: "",
    name_en: "",
    phone: "",
    email: "",
    tax_number: "",
    address: "",
    credit_limit: "",
    is_active: true,
  }
}

// ── Main component ───────────────────────────────────────────────────────

export function PartiesManager({ kind }: { kind: PartyKind }) {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const isCustomer = kind === "customers"
  const codeCol = isCustomer ? "customer_code" : "supplier_code"
  const entityAr = isCustomer ? (ar ? "العملاء" : "Customers") : ar ? "الموردون" : "Suppliers"
  const entityArSingle = isCustomer ? (ar ? "عميل" : "customer") : ar ? "مورد" : "supplier"
  const entityEnSingle = isCustomer ? "customer" : "supplier"

  const [rows, setRows] = useState<PartyRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PartyRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PartyRow | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from(kind)
      .select(`id,${codeCol},name_ar,name_en,phone,email,tax_number,address,credit_limit,is_active`)
      .is("deleted_at", null)
      .order(codeCol, { ascending: true })
    if (error) {
      console.error(error)
      setRows([])
    } else {
      setRows(
        (data as unknown as (Omit<PartyRow, "code"> & Record<string, unknown>)[] ?? []).map((r) => ({
          id: r.id,
          code: String(r[codeCol] ?? ""),
          name_ar: r.name_ar,
          name_en: r.name_en,
          phone: r.phone,
          email: r.email,
          tax_number: r.tax_number,
          address: r.address,
          credit_limit: r.credit_limit,
          is_active: r.is_active,
        }))
      )
    }
    setIsLoading(false)
  }, [kind, codeCol])

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from(kind)
        .select(`id,${codeCol},name_ar,name_en,phone,email,tax_number,address,credit_limit,is_active`)
        .is("deleted_at", null)
        .order(codeCol, { ascending: true })
      if (error) {
        console.error(error)
        setRows([])
      } else {
        setRows(
          (data as unknown as (Omit<PartyRow, "code"> & Record<string, unknown>)[] ?? []).map((r) => ({
            id: r.id,
            code: String(r[codeCol] ?? ""),
            name_ar: r.name_ar,
            name_en: r.name_en,
            phone: r.phone,
            email: r.email,
            tax_number: r.tax_number,
            address: r.address,
            credit_limit: r.credit_limit,
            is_active: r.is_active,
          }))
        )
      }
      setIsLoading(false)
    })()
  }, [kind, codeCol])

  const flash = (type: "ok" | "err", text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 6000)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name_ar.toLowerCase().includes(q) ||
        (r.name_en ?? "").toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q)
    )
  }, [rows, search])

  const avgLimit = rows.length
    ? rows.reduce((s, r) => s + (r.credit_limit ?? 0), 0) / rows.length
    : 0

  const kpiCards: KpiCardData[] = [
    { label: entityAr, value: rows.length, icon: Users, color: "#1E5A99" },
    { label: t.common.active, value: rows.filter((r) => r.is_active).length, icon: CheckCircle2, color: "#10B981" },
    {
      label: ar ? "مسجل ضريبياً" : "With tax number",
      value: rows.filter((r) => r.tax_number).length,
      icon: ReceiptText,
      color: "#8B5CF6",
    },
    {
      label: ar ? "متوسط حد الائتمان" : "Avg credit limit",
      value: `${fmtMoney(avgLimit)}`,
      icon: CircleDollarSign,
      color: "#0EA5E9",
    },
  ]

  const columns: TableColumn<PartyRow>[] = [
    {
      key: "code",
      header: ar ? "الرمز" : "Code",
      render: (r) => <span dir="ltr" className="font-mono text-xs font-medium">{r.code}</span>,
    },
    {
      key: "name_ar",
      header: ar ? "الاسم" : "Name",
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{r.name_ar}</span>
          {r.name_en && <span className="text-xs text-muted-foreground" dir="ltr">{r.name_en}</span>}
        </div>
      ),
    },
    {
      key: "phone",
      header: ar ? "الهاتف" : "Phone",
      render: (r) => <span dir="ltr" className="text-xs text-muted-foreground">{r.phone ?? "—"}</span>,
    },
    {
      key: "tax_number",
      header: ar ? "الرقم الضريبي" : "Tax no.",
      render: (r) =>
        r.tax_number ? (
          <span dir="ltr" className="font-mono text-xs text-muted-foreground">{r.tax_number}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "credit_limit",
      header: ar ? "حد الائتمان" : "Credit limit",
      render: (r) => (
        <span dir="ltr" className="text-xs font-medium tabular-nums">
          {r.credit_limit != null ? `${fmtMoney(r.credit_limit)}` : "—"}
        </span>
      ),
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
    const res = isCustomer ? await exportCustomersCsv() : await exportSuppliersCsv()
    setIsExporting(false)
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${kind}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      flash("ok", ar ? `تم تصدير ${entityAr}.` : `${entityAr} exported.`)
    } else {
      flash("err", res.error ?? "Export failed")
    }
  }

  // ── Create / edit form ──────────────────────────────────────────────────
  const [form, setForm] = useState<PartyFormState>(emptyForm)
  const [isSavingForm, setIsSavingForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const openCreate = () => {
    setForm(emptyForm())
    setFormError(null)
    setCreateOpen(true)
  }
  const openEdit = (r: PartyRow) => {
    setForm({
      code: r.code,
      name_ar: r.name_ar,
      name_en: r.name_en ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      tax_number: r.tax_number ?? "",
      address: r.address ?? "",
      credit_limit: r.credit_limit != null ? String(r.credit_limit) : "",
      is_active: r.is_active,
    })
    setFormError(null)
    setEditTarget(r)
  }

  const setField = <K extends keyof PartyFormState>(key: K, value: PartyFormState[K]) =>
    setForm((p) => ({ ...p, [key]: value }))

  async function handleSubmitForm() {
    setIsSavingForm(true)
    setFormError(null)
    const payload: PartyInput = {
      code: form.code || null,
      name_ar: form.name_ar,
      name_en: form.name_en || null,
      phone: form.phone || null,
      email: form.email || null,
      tax_number: form.tax_number || null,
      address: form.address || null,
      credit_limit: form.credit_limit !== "" ? Number(form.credit_limit) : null,
    }
    const res = editTarget
      ? isCustomer
        ? await updateCustomer({ ...payload, id: editTarget.id, is_active: form.is_active })
        : await updateSupplier({ ...payload, id: editTarget.id, is_active: form.is_active })
      : isCustomer
        ? await createCustomer(payload)
        : await createSupplier(payload)
    setIsSavingForm(false)
    if (res.success) {
      flash("ok", editTarget
        ? (ar ? "تم تحديث السجل." : "Record updated.")
        : (ar ? "تم إنشاء السجل." : "Record created."))
      setCreateOpen(false)
      setEditTarget(null)
      await load()
    } else {
      setFormError(res.error ?? "Failed")
    }
  }

  // ── Toggle active ───────────────────────────────────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null)
  async function handleToggleActive(r: PartyRow) {
    setBusyId(r.id)
    const res = isCustomer
      ? await setCustomerActive({ id: r.id, is_active: !r.is_active })
      : await setSupplierActive({ id: r.id, is_active: !r.is_active })
    setBusyId(null)
    if (res.success) {
      flash("ok", r.is_active ? (ar ? "تم الإيقاف." : "Deactivated.") : (ar ? "تم التفعيل." : "Activated."))
      await load()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

  // ── Soft-delete ─────────────────────────────────────────────────────────
  const [isDeleting, setIsDeleting] = useState(false)
  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    const res = isCustomer
      ? await deleteCustomer({ id: deleteTarget.id })
      : await deleteSupplier({ id: deleteTarget.id })
    setIsDeleting(false)
    setDeleteTarget(null)
    if (res.success) {
      flash("ok", ar ? "تم حذف السجل." : "Record deleted.")
      await load()
    } else {
      flash("err", res.error ?? "Failed")
    }
  }

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
        title={entityAr}
        subtitle={
          isCustomer
            ? ar ? "العملاء والحدود الائتمانية والأرقام الضريبية" : "Customers, credit limits and tax numbers"
            : ar ? "الموردون والحدود الائتمانية والأرقام الضريبية" : "Suppliers, credit limits and tax numbers"
        }
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel={ar ? `إضافة ${entityArSingle}` : `Add ${entityEnSingle}`}
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
              onClick={() => void handleToggleActive(r)}
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
            <button
              onClick={() => setDeleteTarget(r)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
              title={ar ? "حذف" : "Delete"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        isLoading={isLoading}
        emptyStateMessage={
          isCustomer
            ? ar ? "لا يوجد عملاء بعد. أضف عميلاً جديداً." : "No customers yet. Add your first customer."
            : ar ? "لا يوجد موردون بعد. أضف مورداً جديداً." : "No suppliers yet. Add your first supplier."
        }
      />

      {/* ── Create / Edit dialog ─────────────────────────────────────── */}
      <Dialog open={createOpen || !!editTarget} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditTarget(null) } }}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {editTarget
                ? ar ? `تعديل ${entityArSingle}` : `Edit ${entityEnSingle}`
                : ar ? `إضافة ${entityArSingle}` : `Add ${entityEnSingle}`}
            </DialogTitle>
            <DialogDescription>
              {ar
                ? "الرمز اختياري (يُولّد تلقائياً عند تركه فارغاً)؛ الرقم الضريبي يجب أن يكون 15 رقماً"
                : "Code is optional (auto-generated when empty); tax number must be 15 digits"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="party-code">{ar ? "الرمز (اختياري)" : "Code (optional)"}</Label>
                <Input
                  id="party-code"
                  dir="ltr"
                  value={form.code}
                  onChange={(e) => setField("code", e.target.value)}
                  placeholder={isCustomer ? "CUST-0004" : "SUPP-0004"}
                  className="h-9 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="party-phone">{ar ? "الهاتف" : "Phone"}</Label>
                <Input
                  id="party-phone"
                  dir="ltr"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="+9665xxxxxxxx"
                  className="h-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="party-ar">{ar ? "الاسم بالعربية" : "Arabic name"}</Label>
              <Input id="party-ar" dir="rtl" value={form.name_ar} onChange={(e) => setField("name_ar", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="party-en">{ar ? "الاسم بالإنجليزية" : "English name"}</Label>
              <Input id="party-en" dir="ltr" value={form.name_en} onChange={(e) => setField("name_en", e.target.value)} className="h-9" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="party-tax">{ar ? "الرقم الضريبي (15 رقماً)" : "Tax number (15 digits)"}</Label>
                <Input
                  id="party-tax"
                  dir="ltr"
                  value={form.tax_number}
                  onChange={(e) => setField("tax_number", e.target.value.replace(/\D/g, "").slice(0, 15))}
                  placeholder="310122993400003"
                  className="h-9 font-mono"
                  maxLength={15}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="party-limit">{ar ? "حد الائتمان (ر.س)" : "Credit limit (SAR)"}</Label>
                <Input
                  id="party-limit"
                  dir="ltr"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.credit_limit}
                  onChange={(e) => setField("credit_limit", e.target.value)}
                  placeholder="0.00"
                  className="h-9 text-end tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="party-email">{ar ? "البريد الإلكتروني" : "Email"}</Label>
              <Input id="party-email" dir="ltr" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="party-address">{ar ? "العنوان" : "Address"}</Label>
              <Input id="party-address" value={form.address} onChange={(e) => setField("address", e.target.value)} className="h-9" />
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
                disabled={isSavingForm || !form.name_ar.trim()}
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

      {/* ── Delete confirm dialog ─────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "حذف السجل" : "Delete record"}</DialogTitle>
            <DialogDescription>
              {ar
                ? `سيتم حذف ${entityArSingle} "${deleteTarget?.name_ar ?? ""}" نهائياً من القوائم (حذف ناعم). لا يمكن التراجع.`
                : `"${deleteTarget?.name_ar ?? ""}" will be removed from the lists (soft delete). This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {ar ? "حذف" : "Delete"}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              <X className="h-4 w-4" />
              {ar ? "إلغاء" : "Cancel"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
