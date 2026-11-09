"use client"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, Camera, Copy, FileSpreadsheet, FileWarning, Loader2, MessageSquareWarning, Plus, Search, Send, Settings2, ScanText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import {
  CLAIM_STATUSES, STATUS_LABELS, SUPPORTING_DOC_NOTICE, VAT_REVIEWED, VAT_UNVERIFIED, categoryLabel, num,
  type ClaimSettings, type ClaimStatus, type ExpenseClaim,
} from "@/lib/expense-claims/constants"
import { breakdown, buildDashboard, filterClaims, formatMoney, type ClaimFilters, type GroupKey } from "@/lib/expense-claims/dashboard"
import { exportExpenseClaims, getClaimSettings, getExpenseAccess, getTenantUserNames, type ExpenseAccess } from "@/lib/expense-claims/actions"
import { TelegramLinkDialog } from "./telegram-link-dialog"
import { readCompleteAttachments, readCompleteClaims } from "@/lib/expense-claims/complete-reads"
import { Notice, StatusBadge, UnverifiedTag, downloadBase64, selectClass, useBi } from "./shared"

type AlertKey = "missingDocuments" | "possibleDuplicates" | "needsInfo" | "unverifiedFields" | "amountsMismatch"

export function ClaimsDashboard() {
  const { L, t } = useBi()
  const router = useRouter()
  const [access, setAccess] = useState<ExpenseAccess | null | undefined>(undefined)
  const [settings, setSettings] = useState<ClaimSettings | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [claims, setClaims] = useState<ExpenseClaim[] | null>(null)
  const [attCount, setAttCount] = useState<Record<string, number>>({})
  const [filters, setFilters] = useState<ClaimFilters>({})
  const [alert, setAlert] = useState<AlertKey | null>(null)
  const [group, setGroup] = useState<GroupKey>("month")
  const [tgOpen, setTgOpen] = useState(false)
  useEffect(() => {
    if (!access?.create || new URLSearchParams(window.location.search).get("telegram") !== "1") return
    const id = window.setTimeout(() => setTgOpen(true), 0)
    return () => window.clearTimeout(id)
  }, [access?.create])
  const [exportOpen, setExportOpen] = useState(false)
  const [markExported, setMarkExported] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [reload, setReload] = useState(0)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    void (async () => {
      try {
        setLoadError(false)
        const permissions = await getExpenseAccess()
        if (cancelled) return
        setAccess(permissions)
        if (!permissions || (!permissions.create && !permissions.read && !permissions.approve)) return
        const [all, policy, actors] = await Promise.all([readCompleteClaims(supabase), getClaimSettings(), getTenantUserNames()])
        const attachments = await readCompleteAttachments(supabase, all.map(claim => claim.id))
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const attachment of attachments) counts[attachment.claim_id] = (counts[attachment.claim_id] ?? 0) + 1
        setClaims(all); setAttCount(counts); setSettings(policy); setNames(actors)
      } catch {
        if (!cancelled) setLoadError(true)
      }
    })()
    return () => { cancelled = true }
  }, [reload])

  const filtered = useMemo(() => filterClaims(claims ?? [], filters, names), [claims, filters, names])
  const dash = useMemo(() => buildDashboard(filtered, attCount), [filtered, attCount])
  const visible = useMemo(() => (alert ? filtered.filter((c) => dash.alerts[alert].includes(c.id)) : filtered), [alert, filtered, dash])
  const groups = useMemo(() => breakdown(filtered.filter((c) => c.status !== "draft" && c.status !== "rejected"), group), [filtered, group])
  const options = useMemo(() => {
    const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort()
    const cs = claims ?? []
    return { department: uniq(cs.map((c) => c.department)), currency: uniq(cs.map((c) => c.currency)), submitter: uniq(cs.map((c) => c.submitter_id)), category: uniq([...(settings?.categories ?? []), ...cs.map((c) => c.category)]) }
  }, [claims, settings])

  if (loadError) return <div role="alert" className="space-y-3 p-6"><p>{t("Could not load complete claims and receipt evidence. Try again.", "تعذر تحميل المطالبات وأدلة الإيصالات كاملة. أعد المحاولة.")}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>{t("Try again", "أعد المحاولة")}</Button></div>
  if (access !== undefined && (!access || (!access.create && !access.read && !access.approve))) return <div className="p-6"><Notice tone="warn">{t("You do not have access to expense claims.", "ليس لديك صلاحية الوصول إلى مطالبات المصروفات.")}</Notice></div>
  if (!access || !settings || claims === null) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…", "جارٍ التحميل…")}</div>

  const teamView = access.read || access.approve
  const loc = settings.amount_locale
  const setF = (k: keyof ClaimFilters, v: string) => setFilters((f) => ({ ...f, [k]: v ? (k === "from" || k === "to" || k === "q" ? v : [v]) : null }))
  const one = (k: keyof ClaimFilters) => ((filters[k] as string[] | null | undefined)?.[0] ?? "")
  const groupLabel = (k: string) => group === "category" ? L(categoryLabel(k || null)) : group === "submitter" ? names[k] ?? "—" : k || "—"
  const maxByCur = new Map<string, number>()
  for (const g of groups) maxByCur.set(g.currency, Math.max(maxByCur.get(g.currency) ?? 0, g.money.total))

  async function doExport() {
    setExporting(true)
    const r = await exportExpenseClaims({ ...filters }, markExported)
    setExporting(false)
    if (!r.ok) { toast.error(t(r.error, r.errorAr)); return }
    downloadBase64(r.base64, r.filename)
    toast.success(t(`Exported ${r.rows} claim(s)${r.marked ? `; ${r.marked} marked as exported` : ""}.`, `تم تصدير ${r.rows} مطالبة${r.marked ? `، وتعليم ${r.marked} كمُصدَّرة` : ""}.`))
    setExportOpen(false)
    if (r.marked) setReload((x) => x + 1)
  }

  const alertDefs: Array<[AlertKey, string, React.ReactNode]> = [
    ["missingDocuments", t("Missing supporting document", "بدون مستند داعم"), <FileWarning key="a" className="size-4" />],
    ["possibleDuplicates", t("Possible duplicates", "تكرارات محتملة"), <Copy key="b" className="size-4" />],
    ["needsInfo", t("Waiting for submitter info", "بانتظار معلومات من مقدم الطلب"), <MessageSquareWarning key="c" className="size-4" />],
    ["unverifiedFields", t("Pending with unverified suggested details", "معلقة ببيانات مقترحة غير متحقق منها"), <ScanText key="d" className="size-4" />],
    ["amountsMismatch", t("Amounts do not add up", "المبالغ غير متطابقة"), <AlertTriangle key="e" className="size-4" />],
  ]

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="me-auto">
          <h1 className="text-xl font-semibold">{t("Expense claims", "مطالبات المصروفات")}</h1>
          <p className="text-sm text-muted-foreground">{teamView ? t("Employee expense claims and receipts — separate from the accounting ledger and e-invoicing.", "مطالبات مصروفات الموظفين وإيصالاتها — منفصلة عن دفتر الحسابات والفوترة الإلكترونية.") : t("Your expense claims and receipts.", "مطالبات مصروفاتك وإيصالاتها.")}</p>
        </div>
        {access.create && <Button asChild variant="outline"><Link href="/expenses/claims/quick"><Camera className="size-4" />{t("Quick upload", "رفع سريع")}</Link></Button>}
        {access.create && <Button asChild><Link href="/expenses/claims/new"><Plus className="size-4" />{t("New expense", "مصروف جديد")}</Link></Button>}
        {access.create && <Button variant="outline" onClick={() => setTgOpen(true)}><Send className="size-4" />{t("Link Telegram", "ربط تيليجرام")}</Button>}
        {access.export && <Button variant="outline" onClick={() => setExportOpen(true)}><FileSpreadsheet className="size-4" />{t("Export Expenses", "تصدير المصروفات")}</Button>}
        {access.manage && <Button variant="ghost" asChild><Link href="/expenses/claims/settings"><Settings2 className="size-4" />{t("Settings", "الإعدادات")}</Link></Button>}
      </div>

      <section className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-7">
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">{t("From", "من")}</span><Input type="date" value={filters.from ?? ""} onChange={(e) => setF("from", e.target.value)} /></label>
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">{t("To", "إلى")}</span><Input type="date" value={filters.to ?? ""} onChange={(e) => setF("to", e.target.value)} /></label>
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">{t("Category", "الفئة")}</span>
          <select className={selectClass} value={one("category")} onChange={(e) => setF("category", e.target.value)}><option value="">{t("All", "الكل")}</option>{options.category.map((c) => <option key={c} value={c}>{L(categoryLabel(c))}</option>)}</select></label>
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">{t("Department", "القسم")}</span>
          <select className={selectClass} value={one("department")} onChange={(e) => setF("department", e.target.value)}><option value="">{t("All", "الكل")}</option>{options.department.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        {teamView && <label className="space-y-1 text-xs"><span className="text-muted-foreground">{t("Submitter", "مقدم الطلب")}</span>
          <select className={selectClass} value={one("submitter")} onChange={(e) => setF("submitter", e.target.value)}><option value="">{t("All", "الكل")}</option>{options.submitter.map((c) => <option key={c} value={c}>{names[c] ?? c.slice(0, 8)}</option>)}</select></label>}
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">{t("Currency", "العملة")}</span>
          <select className={selectClass} value={one("currency")} onChange={(e) => setF("currency", e.target.value)}><option value="">{t("All", "الكل")}</option>{options.currency.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="space-y-1 text-xs"><span className="text-muted-foreground">{t("Search", "بحث")}</span>
          <div className="relative"><Search className="pointer-events-none absolute start-2 top-2.5 size-4 text-muted-foreground" /><Input className="ps-8" value={filters.q ?? ""} onChange={(e) => setF("q", e.target.value)} placeholder={t("Supplier, claim no.…", "المورد، رقم المطالبة…")} /></div></label>
        <div className="flex flex-wrap gap-1.5 sm:col-span-2 lg:col-span-7">
          {CLAIM_STATUSES.map((s) => {
            const on = filters.status?.includes(s)
            return <button key={s} type="button" onClick={() => setFilters((f) => { const cur = new Set(f.status ?? []); if (cur.has(s)) cur.delete(s); else cur.add(s); return { ...f, status: [...cur] as ClaimStatus[] } })}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>{L(STATUS_LABELS[s])} · {dash.counts[s]}</button>
          })}
          {(Object.values(filters).some((v) => (Array.isArray(v) ? v.length : v)) || alert) && <button type="button" className="text-xs underline" onClick={() => { setFilters({}); setAlert(null) }}>{t("Clear filters", "مسح عوامل التصفية")}</button>}
        </div>
      </section>

      {claims === null ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading claims…", "جارٍ تحميل المطالبات…")}</div> : (
        <>
          {dash.byCurrency.length === 0 ? <Notice>{t("No claims for the current filters.", "لا توجد مطالبات لعوامل التصفية الحالية.")}</Notice> : (
            <div className="space-y-3">
              {dash.byCurrency.map((k) => (
                <div key={k.currency} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    [t("Approved spend", "المصروفات المعتمدة"), k.approved.total, k.approved.count],
                    [t("Pending review", "بانتظار المراجعة"), k.pending.total, k.pending.count],
                    [t("Awaiting reimbursement", "بانتظار السداد"), k.awaitingReimbursement.total, k.awaitingReimbursement.count],
                    [t("Reimbursed", "تم سدادها"), k.reimbursed.total, k.reimbursed.count],
                    [L(VAT_REVIEWED), k.vatShownReviewed, null],
                    [L(VAT_UNVERIFIED), k.vatShownUnverified, null],
                  ].map(([label, value, count], i) => (
                    <div key={i} className={`rounded-xl border p-3 ${i === 5 ? "border-amber-500/40" : ""}`}>
                      <div className="text-xs text-muted-foreground">{label as string} · {k.currency}</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(value as number, k.currency, loc)}</div>
                      {count !== null && <div className="text-[11px] text-muted-foreground">{count as number} {t("claim(s)", "مطالبة")}</div>}
                    </div>
                  ))}
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">{t("Totals are per currency and never combined. VAT figures are as printed on receipts — not a determination of recoverable VAT.", "الإجماليات حسب العملة ولا تُدمج. أرقام الضريبة كما هي مطبوعة في الإيصالات — وليست تحديداً للضريبة القابلة للاسترداد.")}</p>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {alertDefs.map(([key, label, icon]) => {
              const n = dash.alerts[key].length
              return <button key={key} type="button" disabled={!n} onClick={() => setAlert(alert === key ? null : key)}
                className={`flex items-center gap-2 rounded-xl border p-3 text-start text-xs ${n ? "border-amber-500/40 bg-amber-500/5" : "opacity-60"} ${alert === key ? "ring-2 ring-amber-500" : ""}`}>
                {icon}<span className="flex-1">{label}</span><span className="text-base font-semibold">{n}</span></button>
            })}
          </div>

          {teamView && groups.length > 0 && (
            <section className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="me-auto text-sm font-semibold">{t("Breakdown (submitted and later, excluding rejected)", "التوزيع (المقدمة وما بعدها، باستثناء المرفوضة)")}</h2>
                {(["month", "category", "department", "submitter", "supplier"] as GroupKey[]).map((g) => (
                  <button key={g} type="button" onClick={() => setGroup(g)} className={`rounded-md border px-2 py-0.5 text-xs ${group === g ? "border-primary bg-primary/10" : ""}`}>
                    {{ month: t("Month", "الشهر"), category: t("Category", "الفئة"), department: t("Department", "القسم"), submitter: t("Submitter", "مقدم الطلب"), supplier: t("Supplier", "المورد"), status: "" }[g]}
                  </button>
                ))}
              </div>
              <ul className="space-y-1.5">
                {groups.slice(0, 40).map((g) => (
                  <li key={`${g.currency}-${g.key}`} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs">
                    <span className="truncate" title={groupLabel(g.key)}>{groupLabel(g.key)}</span>
                    <div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-emerald-500/70" style={{ width: `${Math.max(2, (g.money.total / (maxByCur.get(g.currency) || 1)) * 100)}%` }} /></div>
                    <span className="tabular-nums">{formatMoney(g.money.total, g.currency, loc)} · {g.money.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>{[t("Claim", "المطالبة"), t("Date", "التاريخ"), ...(teamView ? [t("Submitter", "مقدم الطلب")] : []), t("Supplier", "المورد"), t("Category", "الفئة"), t("Total", "الإجمالي"), t("VAT (as shown)", "الضريبة (كما تظهر)"), t("Status", "الحالة"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {visible.length === 0 ? <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{t("No claims.", "لا توجد مطالبات.")}</td></tr> : visible.slice(0, 500).map((c) => (
                  <tr key={c.id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => router.push(`/expenses/claims/${c.id}`)}>
                    <td className="px-3 py-2 font-mono text-xs"><Link href={`/expenses/claims/${c.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{c.claim_no}</Link></td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.expense_date ?? "—"}</td>
                    {teamView && <td className="px-3 py-2">{names[c.submitter_id] ?? "—"}</td>}
                    <td className="max-w-[14rem] truncate px-3 py-2">{c.supplier_name ?? "—"}</td>
                    <td className="px-3 py-2">{c.category ? L(categoryLabel(c.category)) : "—"}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatMoney(num(c.total_amount), c.currency, loc)}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatMoney(num(c.vat_amount), c.currency, loc)}{!c.verified_at && num(c.vat_amount) ? <UnverifiedTag className="ms-1" /> : null}</td>
                    <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                    <td className="px-3 py-2"><div className="flex gap-1 text-amber-600">
                      {c.duplicate_status === "possible" && <Copy className="size-4" aria-label={t("Possible duplicate", "تكرار محتمل")} />}
                      {c.status !== "draft" && c.status !== "rejected" && !attCount[c.id] && <FileWarning className="size-4" aria-label={t("No document", "بدون مستند")} />}
                      {c.source === "telegram" && <Send className="size-4 text-sky-600" aria-label="Telegram" />}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length > 500 && <p className="p-2 text-xs text-muted-foreground">{t("Showing the first 500 claims. Narrow the filters or export to see all.", "يتم عرض أول 500 مطالبة. ضيّق عوامل التصفية أو صدّر لرؤية الكل.")}</p>}
          </section>
          <Notice>{L(SUPPORTING_DOC_NOTICE)}</Notice>
        </>
      )}

      <TelegramLinkDialog open={tgOpen} onOpenChange={setTgOpen} />
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Export Expenses (.xlsx)", "تصدير المصروفات (.xlsx)")}</DialogTitle>
            <DialogDescription>{t(`Exports the ${filtered.length} claim(s) matching the current filters, with summaries by month, category, department and status per currency, reviewer details and attachment file names.`, `يصدّر ${filtered.length} مطالبة مطابقة لعوامل التصفية الحالية، مع ملخصات حسب الشهر والفئة والقسم والحالة لكل عملة، وبيانات المراجع وأسماء ملفات المرفقات.`)}</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={markExported} onCheckedChange={(v) => setMarkExported(v === true)} className="mt-0.5" /><span>{t("Mark approved claims in this export as “Exported”", "تعليم المطالبات المعتمدة في هذا التصدير كـ \"مُصدَّرة\"")}</span></label>
          <Notice>{t(`Labels: ${settings.export_language === "both" ? "English + Arabic" : settings.export_language === "ar" ? "Arabic" : "English"} (change in settings). The file is not a VAT return, a ZATCA filing or an e-invoice.`, `اللغة: ${settings.export_language === "both" ? "الإنجليزية + العربية" : settings.export_language === "ar" ? "العربية" : "الإنجليزية"} (يمكن تغييرها من الإعدادات). الملف ليس إقراراً ضريبياً ولا تقديماً للهيئة ولا فاتورة إلكترونية.`)}</Notice>
          <Button disabled={exporting || filtered.length === 0} onClick={doExport}>{exporting ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}{t("Download Excel", "تنزيل Excel")}</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
