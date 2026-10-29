"use client"

// Phase 4 — Customers / Suppliers manager (CRUD, toggle, soft-delete, CSV
// export). Embedded in the /accounting page's "Customers" and "Suppliers"
// tabs via the `kind` prop. Bilingual (AR/EN, RTL-aware).

import { useRef, useState } from "react"
import { useAccountingMasterPage } from "@/hooks/use-accounting-master-page"
import type { MasterReview, PartyMasterRow, PartyMasterSummary } from "@/lib/accounting/master-contract"
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
  RefreshCw,
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

type PartyRow = PartyMasterRow
function fmtMoney(value: string | number | null | undefined): string {
  const [whole, fraction = ""] = String(value ?? "0").split(".")
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction.padEnd(2, "0")
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
  city: string
  district: string
  building_number: string
  additional_number: string
  postal_code: string
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
    city: "",
    district: "",
    building_number: "",
    additional_number: "",
    postal_code: "",
    credit_limit: "",
    is_active: true,
  }
}

// ── Main component ───────────────────────────────────────────────────────

export function PartiesManager({ kind }: { kind: PartyKind }) {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const isCustomer = kind === "customers"
  const entityAr = isCustomer ? (ar ? "العملاء" : "Customers") : ar ? "الموردون" : "Suppliers"
  const entityArSingle = isCustomer ? (ar ? "عميل" : "customer") : ar ? "مورد" : "supplier"
  const entityEnSingle = isCustomer ? "customer" : "supplier"

  const master = useAccountingMasterPage<PartyRow>(kind)
  const { rows, loading: isLoading, search, setSearch, reload: load } = master
  const summary = master.summary as PartyMasterSummary | null
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PartyRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PartyRow | null>(null)
  const [formRequest, setFormRequest] = useState("")
  const [deleteRequest, setDeleteRequest] = useState("")
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const statusRequests = useRef(new Map<string, MasterReview & { active: boolean }>())
  const actionError = (result: { success: boolean; error?: string; errorAr?: string }) =>
    (ar ? result.errorAr ?? result.error : result.error) ?? (ar ? "تعذر إتمام العملية. أعد المحاولة." : "Could not complete the action. Try again.")

  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (type: "ok" | "err", text: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback({ type, text })
    feedbackTimer.current = type === "ok" ? setTimeout(() => setFeedback(null), 6000) : null
  }

  const kpiCards: KpiCardData[] = [
    { label: entityAr, value: summary?.total ?? "—", icon: Users, color: "#1E5A99" },
    { label: t.common.active, value: summary?.active ?? "—", icon: CheckCircle2, color: "#10B981" },
    { label: ar ? "مسجل ضريبياً" : "With tax number", value: summary?.tax_registered ?? "—", icon: ReceiptText, color: "#8B5CF6" },
    { label: ar ? "متوسط حد الائتمان" : "Avg credit limit", value: summary ? fmtMoney(summary.avg_credit_limit) : "—", icon: CircleDollarSign, color: "#F97316" },
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
          <span data-testid="party-primary-name" className="font-medium">{ar ? (r.name_ar || r.name_en) : (r.name_en || r.name_ar)}</span>
          {r.name_en && <span className="text-xs text-muted-foreground" dir={ar ? "ltr" : "rtl"}>{ar ? r.name_en : r.name_ar}</span>}
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
    try {
      const res = isCustomer ? await exportCustomersCsv(search) : await exportSuppliersCsv(search)
      if (res.success && res.csv) {
        const url = URL.createObjectURL(new Blob([res.csv], { type: "text/csv;charset=utf-8" }))
        const link = document.createElement("a"); link.href = url; link.download = kind + ".csv"
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
        flash("ok", ar ? "تم تصدير السجلات المطابقة للبحث." : "Records matching the search exported.")
      } else flash("err", actionError(res))
    } catch { flash("err", ar ? "تعذر تصدير السجلات. أعد المحاولة." : "Could not export the records. Try again.") }
    finally { setIsExporting(false) }
  }

  // ── Create / edit form ──────────────────────────────────────────────────
  const [form, setForm] = useState<PartyFormState>(emptyForm)
  const [isSavingForm, setIsSavingForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const openCreate = () => {
    setFormRequest(crypto.randomUUID())
    setForm(emptyForm())
    setFormError(null)
    setCreateOpen(true)
  }
  const openEdit = (r: PartyRow) => {
    setFormRequest(crypto.randomUUID())
    setForm({
      code: r.code,
      name_ar: r.name_ar,
      name_en: r.name_en ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      tax_number: r.tax_number ?? "",
      address: r.address ?? "",
      city: r.city ?? "",
      district: r.district ?? "",
      building_number: r.building_number ?? "",
      additional_number: r.additional_number ?? "",
      postal_code: r.postal_code ?? "",
      credit_limit: r.credit_limit != null ? String(r.credit_limit) : "",
      is_active: r.is_active,
    })
    setFormError(null)
    setEditTarget(r)
  }

  const setField = <K extends keyof PartyFormState>(key: K, value: PartyFormState[K]) =>
    setForm((p) => ({ ...p, [key]: value }))

  async function handleSubmitForm() {
    if (!formRequest) return
    setIsSavingForm(true); setFormError(null)
    const payload: PartyInput = { code: form.code || null, name_ar: form.name_ar, name_en: form.name_en || null,
      phone: form.phone || null, email: form.email || null, tax_number: form.tax_number || null,
      address: form.address || null, city: form.city || null, district: form.district || null,
      building_number: form.building_number || null, additional_number: form.additional_number || null,
      postal_code: form.postal_code || null, credit_limit: form.credit_limit !== "" ? Number(form.credit_limit) : null }
    try {
      const review = { request_id: formRequest, expected_updated_at: editTarget?.updated_at ?? "" }
      const res = editTarget
        ? isCustomer ? await updateCustomer(editTarget.id, { ...payload, is_active: form.is_active }, review) : await updateSupplier(editTarget.id, { ...payload, is_active: form.is_active }, review)
        : isCustomer ? await createCustomer(payload, { request_id: formRequest }) : await createSupplier(payload, { request_id: formRequest })
      if (res.success) {
        flash("ok", editTarget ? (ar ? "تم تحديث السجل." : "Record updated.") : (ar ? "تم إنشاء السجل." : "Record created."))
        setCreateOpen(false); setEditTarget(null); setFormRequest(""); load()
      } else setFormError(actionError(res))
    } catch { setFormError(ar ? "تعذر تأكيد الحفظ. أعد المحاولة بالتفاصيل نفسها." : "Unable to confirm the save. Retry with unchanged details.") }
    finally { setIsSavingForm(false) }
  }

  const [busyId, setBusyId] = useState<string | null>(null)
  async function handleToggleActive(r: PartyRow) {
    const intent = statusRequests.current.get(r.id) ?? { request_id: crypto.randomUUID(), expected_updated_at: r.updated_at, active: !r.is_active }
    statusRequests.current.set(r.id, intent); setBusyId(r.id)
    try {
      const review = { request_id: intent.request_id, expected_updated_at: intent.expected_updated_at }
      const res = isCustomer ? await setCustomerActive(r.id, intent.active, review) : await setSupplierActive(r.id, intent.active, review)
      if (res.success) { statusRequests.current.delete(r.id); flash("ok", intent.active ? (ar ? "تم التفعيل." : "Activated.") : (ar ? "تم الإيقاف." : "Deactivated.")); load() }
      else flash("err", actionError(res))
    } catch { flash("err", ar ? "تعذر تأكيد التغيير. أعد المحاولة أو حدّث القائمة للمراجعة." : "Unable to confirm the change. Retry or refresh the list to review.") }
    finally { setBusyId(null) }
  }

  const [isDeleting, setIsDeleting] = useState(false)
  const openDelete = (r: PartyRow) => { setDeleteTarget(r); setDeleteRequest(crypto.randomUUID()); setDeleteError(null) }
  async function handleDelete() {
    if (!deleteTarget || !deleteRequest) return
    setIsDeleting(true); setDeleteError(null)
    try {
      const review = { request_id: deleteRequest, expected_updated_at: deleteTarget.updated_at }
      const res = isCustomer ? await deleteCustomer(deleteTarget.id, review) : await deleteSupplier(deleteTarget.id, review)
      if (res.success) { setDeleteTarget(null); setDeleteRequest(""); flash("ok", ar ? "تمت أرشفة السجل مع الاحتفاظ بالمستندات السابقة." : "Record archived; existing documents are retained."); load() }
      else setDeleteError(actionError(res))
    } catch { setDeleteError(ar ? "تعذر تأكيد الأرشفة. أعد المحاولة بالسجل نفسه." : "Unable to confirm the archive. Retry the same record.") }
    finally { setIsDeleting(false) }
  }

  return (
    <div className="space-y-4" data-testid={kind + "-master"}>
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
        title={entityAr}
        subtitle={
          isCustomer
            ? ar ? "العملاء والحدود الائتمانية والأرقام الضريبية" : "Customers, credit limits and tax numbers"
            : ar ? "الموردون والحدود الائتمانية والأرقام الضريبية" : "Suppliers, credit limits and tax numbers"
        }
        kpiCards={kpiCards}
        searchPlaceholder={ar ? "ابحث بالرمز أو الاسم أو الهاتف أو البريد" : "Search code, name, phone or email"}
        searchValue={search}
        onSearchChange={setSearch}
        primaryCtaLabel={ar ? `إضافة ${entityArSingle}` : `Add ${entityEnSingle}`}
        onPrimaryCta={openCreate}
        primaryCtaIcon={Plus}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={isLoading} onClick={() => { statusRequests.current.clear(); load() }}><RefreshCw className="h-4 w-4" />{ar ? "تحديث" : "Refresh"}</Button>
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
        data={rows}
        pagination={master.error || isLoading ? undefined : master.pagination}
        loadError={master.error ? (ar ? "تعذر تحميل السجلات وإجمالياتها. أعد المحاولة قبل الاعتماد عليها." : "Could not load records and their totals. Retry before relying on them.") : undefined}
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
              onClick={() => openDelete(r)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
              title={ar ? "أرشفة" : "Archive"}
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
      <Dialog open={createOpen || !!editTarget} onOpenChange={(o) => { if (!o && !isSavingForm) { setCreateOpen(false); setEditTarget(null) } }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto rounded-2xl">
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
          <fieldset disabled={isSavingForm} className="min-w-0 space-y-3" data-testid="party-master-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="party-code">{ar ? "الرمز (اختياري)" : "Code (optional)"}</Label>
                <Input
                  id="party-code" maxLength={12}
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
                  id="party-phone" maxLength={50}
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
              <Input id="party-ar" maxLength={200} dir="rtl" value={form.name_ar} onChange={(e) => setField("name_ar", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="party-en">{ar ? "الاسم بالإنجليزية" : "English name"}</Label>
              <Input id="party-en" maxLength={200} dir="ltr" value={form.name_en} onChange={(e) => setField("name_en", e.target.value)} className="h-9" />
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
              <Input id="party-email" maxLength={254} dir="ltr" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="party-address">{ar ? "العنوان" : "Address"}</Label>
              <Input id="party-address" maxLength={2000} value={form.address} onChange={(e) => setField("address", e.target.value)} className="h-9" />
            </div>
            <fieldset className="space-y-3">
              <legend className="text-xs text-muted-foreground">
                {ar ? "العنوان الوطني (مطلوب لفواتير ZATCA الضريبية)" : "National Address (required for ZATCA standard invoices)"}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="party-city">{ar ? "المدينة" : "City"}</Label>
                  <Input id="party-city" value={form.city} onChange={(e) => setField("city", e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="party-district">{ar ? "الحي" : "District"}</Label>
                  <Input id="party-district" value={form.district} onChange={(e) => setField("district", e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="party-building">{ar ? "رقم المبنى" : "Building no."}</Label>
                  <Input id="party-building" dir="ltr" inputMode="numeric" value={form.building_number} onChange={(e) => setField("building_number", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" className="h-9 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="party-additional">{ar ? "الرقم الإضافي" : "Additional no."}</Label>
                  <Input id="party-additional" dir="ltr" inputMode="numeric" value={form.additional_number} onChange={(e) => setField("additional_number", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="5678" className="h-9 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="party-postal">{ar ? "الرمز البريدي" : "Postal code"}</Label>
                  <Input id="party-postal" dir="ltr" inputMode="numeric" value={form.postal_code} onChange={(e) => setField("postal_code", e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="12345" className="h-9 tabular-nums" />
                </div>
              </div>
            </fieldset>

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
                disabled={isSavingForm || !form.name_ar.trim()}
                className="bg-elite-blue-600 hover:bg-elite-blue-700"
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

      {/* ── Delete confirm dialog ─────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !isDeleting) setDeleteTarget(null) }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{ar ? "أرشفة السجل" : "Archive record"}</DialogTitle>
            <DialogDescription>
              {ar
                ? "سيُزال السجل من القوائم الحالية مع الاحتفاظ بالمستندات والسجل السابق."
                : "The record leaves current lists; existing documents and history are retained."}
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {ar ? "أرشفة" : "Archive"}
            </Button>
            <Button variant="ghost" disabled={isDeleting} onClick={() => setDeleteTarget(null)}>
              <X className="h-4 w-4" />
              {ar ? "إلغاء" : "Cancel"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
