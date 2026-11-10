"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { approvePayrollRun, cancelPayrollRun, createPayrollJournalDraft, payrollWorkbookDownloadUrl, recalculatePayrollRun, updatePayrollException } from "@/lib/payroll-engine/server/run-actions"
import { getPayrollRunDetail, getPayslipCompany, listJournalAccounts, type RunDetail } from "@/lib/payroll-engine/server/read-actions"
import { payrollResultsSheets } from "@/lib/payroll-engine/exports"
import { monthLabel, monthLabelAr, toHalalas } from "@/lib/payroll-engine/month"
import { openPayslips, type PayslipCompany } from "@/components/payroll-engine/payslip-print"
import { PayslipViewer } from "@/components/payroll-engine/payslip-viewer"
import { FileText } from "lucide-react"
import { Field, Kpi, Notice, PageShell, StatusBadge, buttonClass, dangerButtonClass, downloadSheets, inputClass, int, primaryButtonClass, sar, useLang } from "@/components/payroll-engine/shared"

type Row = RunDetail["results"][number]

export default function PlatformPayrollRunPage() {
  const { id } = useParams<{ id: string }>()
  const { ar, tx } = useLang()
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const [tab, setTab] = useState<"results" | "payslips" | "exceptions" | "rules">("results")
  const [company, setCompany] = useState<PayslipCompany | null>(null)
  useEffect(() => { void getPayslipCompany().then(r => { if (r.success) setCompany(r.data) }) }, [])
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Row | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [journalOpen, setJournalOpen] = useState(false)
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name: string; type: string }>>([])
  const [journal, setJournal] = useState({ expenseAccountId: "", payableAccountId: "" })

  const load = useCallback(async () => {
    const r = await getPayrollRunDetail(id)
    if (r.success) { setDetail(r.data); setError("") } else setError(r.error)
  }, [id])
  useEffect(() => { void load() }, [load])

  const run = detail?.run
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (detail?.results ?? []).filter(r => !q || r.riderId.toLowerCase().includes(q) || r.driverName.toLowerCase().includes(q))
  }, [detail, search])

  async function act(label: string, fn: () => Promise<{ success: boolean; error?: string }>, ok: string) {
    setBusy(label); setMessage(null)
    try {
      const r = await fn()
      if (!r.success) setMessage({ kind: "err", text: r.error ?? tx("Action failed", "تعذّر تنفيذ الإجراء") })
      else { setMessage({ kind: "ok", text: ok }); await load() }
    } finally { setBusy("") }
  }

  if (error) return <PageShell title={tx("Payroll run", "مسير الرواتب")}><Notice kind="err">{error}</Notice></PageShell>
  if (!detail || !run) return <PageShell title={tx("Payroll run", "مسير الرواتب")}><p className="text-sm text-muted-foreground">{tx("Loading…", "جارٍ التحميل…")}</p></PageShell>

  const month = ar ? monthLabelAr(run.monthKey) : monthLabel(run.monthKey)
  const payable = toHalalas(detail.results.reduce((s, r) => s + toHalalas(r.result.finalNetSalary), 0))
  const meta = { month, platform: run.platformName, status: run.status, company }
  const exportRows = detail.results.map(r => ({ result: r.result, bank: r.bank }))

  return (
    <PageShell
      title={`${tx("Payroll", "رواتب")} ${month} — ${run.platformName}`}
      subtitle={`${run.fileName} · ${tx("Rule set", "مجموعة القواعد")}: ${run.ruleSetName}${run.recalculatedAt ? ` · ${tx("recalculated", "أعيد احتسابه")} ${new Date(run.recalculatedAt).toLocaleString()}` : ""}`}
      actions={<>
        <StatusBadge status={run.status} />
        {run.status === "draft" && <button className={buttonClass} disabled={!!busy} onClick={() => act("recalc", () => recalculatePayrollRun({ runId: run.id, version: run.version }), tx("Recalculated with the current rules and adjustments", "أعيد الاحتساب بالقواعد والتعديلات الحالية"))}>{busy === "recalc" ? tx("Recalculating…", "جارٍ إعادة الاحتساب…") : tx("Recalculate", "إعادة احتساب")}</button>}
        {run.status === "draft" && <button className={primaryButtonClass} disabled={!!busy} onClick={() => {
          if (!window.confirm(tx(`Approve payroll for ${run.totalDrivers} riders, net SAR ${sar(payable)}? Installments will advance.`, `اعتماد رواتب ${run.totalDrivers} مندوب بصافي ${sar(payable)} ر.س؟ سيتم احتساب الأقساط.`))) return
          void act("approve", () => approvePayrollRun({ runId: run.id, version: run.version }), tx("Payroll approved", "تم اعتماد المسير"))
        }}>{busy === "approve" ? tx("Approving…", "جارٍ الاعتماد…") : tx("Approve", "اعتماد")}</button>}
        {run.status !== "cancelled" && <button className={dangerButtonClass} disabled={!!busy} onClick={() => setCancelOpen(true)}>{tx("Cancel run", "إلغاء المسير")}</button>}
      </>}
    >
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {run.status === "cancelled" && <Notice kind="err">{tx("Cancelled", "ملغى")}: {run.cancelReason}</Notice>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label={tx("Riders", "المناديب")} value={String(run.totalDrivers)} />
        <Kpi label={tx("Gross (SAR)", "الإجمالي (ر.س)")} value={sar(run.totalGross)} />
        <Kpi label={tx("Platform penalties", "غرامات المنصة")} value={sar(run.totalPenalties)} tone="bad" />
        <Kpi label={tx("Traffic fines", "المخالفات المرورية")} value={sar(run.totalTraffic)} tone="bad" />
        <Kpi label={tx("Net payable (SAR)", "الصافي المستحق (ر.س)")} value={sar(payable)} tone="good" />
        <Kpi label={tx("Variance vs platform", "الفرق عن المنصة")} value={sar(run.totalVariance)} tone={Math.abs(run.totalVariance) > 0.005 ? "warn" : undefined} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} onClick={() => downloadSheets(payrollResultsSheets({ payrollMonth: run.payrollMonth, platformName: run.platformName, ruleSetName: run.ruleSetName, status: run.status, fileName: run.fileName }, exportRows), `payroll_${run.monthKey}_${run.platformName.replace(/\W+/g, "_")}.xlsx`)}>{tx("Export Excel", "تصدير Excel")}</button>
        <button className={buttonClass} onClick={() => { if (!openPayslips(exportRows, meta, ar)) setMessage({ kind: "err", text: tx("Allow pop-ups to print payslips", "اسمح بالنوافذ المنبثقة لطباعة القسائم") }) }}>{tx("Print all payslips", "طباعة جميع القسائم")}</button>
        <button className={buttonClass} onClick={async () => { const r = await payrollWorkbookDownloadUrl(run.id); if (r.success) window.location.href = r.data.url; else setMessage({ kind: "err", text: r.error }) }}>{tx("Original workbook", "الملف الأصلي")}</button>
        {run.status === "approved" && !run.journalEntryId && <button className={buttonClass} onClick={async () => {
          setJournalOpen(true)
          const r = await listJournalAccounts()
          if (r.success) setAccounts(r.data); else setMessage({ kind: "err", text: r.error })
        }}>{tx("Create journal draft", "إنشاء قيد يومية (مسودة)")}</button>}
        {run.journalEntryId && <Link className={buttonClass} href="/accounting">{tx("Journal draft created — open accounting", "تم إنشاء القيد — فتح المحاسبة")}</Link>}
      </div>

      <div role="tablist" className="flex gap-2">
        {([["results", tx("Riders", "المناديب")], ["payslips", tx("Payslips", "القسائم")], ["exceptions", `${tx("Exceptions", "الملاحظات")} (${detail.exceptions.length})`], ["rules", tx("Applied rules", "القواعد المطبقة")]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? primaryButtonClass : buttonClass} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "results" && <>
        <input className={`${inputClass} max-w-sm`} placeholder={tx("Search rider ID or name", "ابحث برقم المندوب أو الاسم")} value={search} onChange={e => setSearch(e.target.value)} />
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>
              {[tx("Rider", "المندوب"), tx("Orders", "الطلبات"), tx("Target", "المستهدف"), tx("Gross", "الإجمالي"), tx("Penalties", "الغرامات"), tx("Other deductions", "خصومات أخرى"), tx("Net", "الصافي"), tx("Platform basic", "أساسي المنصة"), tx("Variance", "الفرق"), tx("Review", "المراجعة"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const x = r.result
                const other = x.trafficViolationsDeduction + x.customDeductionTotal + x.manualDeductionTotal
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2"><div className="font-medium">{r.driverName}</div><div className="text-xs text-muted-foreground">{r.riderId}{!r.driverId && ` · ${tx("not linked", "غير مرتبط")}`}</div></td>
                    <td className="px-3 py-2 tabular-nums">{int(x.completedOrders)}</td>
                    <td className="px-3 py-2 tabular-nums">{int(x.selectedTargetThreshold)}</td>
                    <td className="px-3 py-2 tabular-nums">{sar(x.grossSalaryBeforePenalties)}</td>
                    <td className="px-3 py-2 tabular-nums">{sar(x.totalOtherPenalties)}</td>
                    <td className="px-3 py-2 tabular-nums">{sar(other)}</td>
                    <td className="px-3 py-2 font-semibold tabular-nums">{sar(x.finalNetSalary)}</td>
                    <td className="px-3 py-2 tabular-nums">{sar(x.uploadedBasicPayment)}</td>
                    <td className="px-3 py-2 tabular-nums">{sar(x.varianceAmount)} <StatusBadge status={x.varianceStatus} /></td>
                    <td className="px-3 py-2"><StatusBadge status={x.reviewStatus} /></td>
                    <td className="px-3 py-2"><button className={buttonClass} onClick={() => setSelected(r)}>{tx("Payslip", "القسيمة")}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>}

      {tab === "payslips" && <>
        <input className={`${inputClass} max-w-sm`} placeholder={tx("Search rider ID or name", "ابحث برقم المندوب أو الاسم")} value={search} onChange={e => setSearch(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(r => {
            const x = r.result
            const attain = x.selectedTargetThreshold > 0 ? Math.round((x.completedOrders / x.selectedTargetThreshold) * 100) : 0
            return (
              <div key={r.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><FileText className="h-5 w-5" /></span>
                  <StatusBadge status={x.performanceBand} />
                </div>
                <div className="mt-3 font-bold">{r.driverName}</div>
                <div className="text-xs text-muted-foreground">{r.riderId}{!r.driverId && ` · ${tx("not linked", "غير مرتبط")}`}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted-foreground">{tx("Net salary", "صافي الراتب")}</div><div className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">SAR {sar(x.finalNetSalary)}</div></div>
                  <div><div className="text-muted-foreground">{tx("Orders", "الطلبات")}</div><div className="font-semibold tabular-nums">{int(x.completedOrders)}</div></div>
                  <div><div className="text-muted-foreground">{tx("Attainment", "الإنجاز")}</div><div className="font-semibold tabular-nums">{attain}%</div></div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-500/10"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-700" style={{ width: `${Math.min(100, attain)}%` }} /></div>
                <button type="button" className={`${buttonClass} mt-4 w-full`} onClick={() => setSelected(r)}><FileText className="h-4 w-4" />{tx("View payslip", "عرض القسيمة")}</button>
              </div>
            )
          })}
        </div>
      </>}

      {tab === "exceptions" && (
        <div className="space-y-2">
          {detail.exceptions.length === 0 && <p className="text-sm text-muted-foreground">{tx("No exceptions", "لا توجد ملاحظات")}</p>}
          {detail.exceptions.map(e => (
            <div key={e.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge status={e.severity} /><code className="text-xs">{e.code}</code>{e.rowRef && <span className="text-xs text-muted-foreground">{tx("Rider", "المندوب")} {e.rowRef}</span>}<StatusBadge status={e.reviewStatus} /></div>
                <p className="text-sm">{e.message}</p>
                {e.suggestedAction && <p className="text-xs text-muted-foreground">{e.suggestedAction}</p>}
              </div>
              {run.status === "draft" && <div className="flex gap-2">
                {e.reviewStatus !== "resolved" && <button className={buttonClass} onClick={() => act(e.id, () => updatePayrollException({ id: e.id, status: "resolved" }), tx("Marked resolved", "تم التحديد كمعالج"))}>{tx("Resolve", "معالجة")}</button>}
                {e.reviewStatus !== "ignored" && <button className={buttonClass} onClick={() => act(e.id, () => updatePayrollException({ id: e.id, status: "ignored" }), tx("Ignored", "تم التجاهل"))}>{tx("Ignore", "تجاهل")}</button>}
                {e.reviewStatus !== "open" && <button className={buttonClass} onClick={() => act(e.id, () => updatePayrollException({ id: e.id, status: "open" }), tx("Reopened", "أعيد فتحه"))}>{tx("Reopen", "إعادة فتح")}</button>}
              </div>}
            </div>
          ))}
        </div>
      )}

      {tab === "rules" && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm"><tbody>
            {Object.entries(run.ruleSnapshot).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
              <tr key={k} className="border-t border-border"><td className="px-3 py-1.5 font-mono text-xs">{k}</td><td className="px-3 py-1.5">{Array.isArray(v) ? v.join(", ") : String(v)}</td></tr>
            ))}
          </tbody></table>
        </div>
      )}

      {selected && <PayslipViewer ar={ar} rows={[{ result: selected.result, bank: selected.bank }]} meta={meta} title={`${selected.driverName} · ${selected.riderId}`} onClose={() => setSelected(null)}
        onPrintBlocked={() => setMessage({ kind: "err", text: tx("Allow pop-ups to print payslips", "اسمح بالنوافذ المنبثقة لطباعة القسائم") })} />}

      {cancelOpen && (
        <Modal title={tx("Cancel payroll run", "إلغاء مسير الرواتب")} onClose={() => setCancelOpen(false)}>
          <p className="text-sm text-muted-foreground">{run.status === "approved" ? tx("Installment progress applied at approval will be rolled back. Linked journal drafts must be handled in accounting.", "سيتم التراجع عن الأقساط المحتسبة عند الاعتماد. يجب معالجة قيود اليومية المرتبطة في المحاسبة.") : tx("The draft will be kept for audit but excluded from reports.", "ستُحفظ المسودة للتدقيق وتُستبعد من التقارير.")}</p>
          <Field label={tx("Reason", "السبب")}><textarea className={inputClass} rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <button className={buttonClass} onClick={() => setCancelOpen(false)}>{tx("Back", "رجوع")}</button>
            <button className={dangerButtonClass} disabled={!!busy || reason.trim().length < 3} onClick={async () => { await act("cancel", () => cancelPayrollRun({ runId: run.id, reason }), tx("Payroll run cancelled", "تم إلغاء المسير")); setCancelOpen(false) }}>{tx("Cancel run", "إلغاء المسير")}</button>
          </div>
        </Modal>
      )}

      {journalOpen && (
        <Modal title={tx("Journal draft", "قيد يومية (مسودة)")} onClose={() => setJournalOpen(false)}>
          <p className="text-sm text-muted-foreground">{tx(`Debit salaries expense / credit salaries payable for SAR ${sar(payable)}, dated the last day of the month. An accountant reviews and posts it.`, `مدين مصروف الرواتب / دائن رواتب مستحقة بمبلغ ${sar(payable)} ر.س بتاريخ آخر يوم في الشهر. يراجعه المحاسب ويرحّله.`)}</p>
          <Field label={tx("Expense account (debit)", "حساب المصروف (مدين)")}>
            <select className={inputClass} value={journal.expenseAccountId} onChange={e => setJournal({ ...journal, expenseAccountId: e.target.value })}>
              <option value="">—</option>{accounts.filter(a => a.type === "expense").map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <Field label={tx("Payable account (credit)", "حساب المستحقات (دائن)")}>
            <select className={inputClass} value={journal.payableAccountId} onChange={e => setJournal({ ...journal, payableAccountId: e.target.value })}>
              <option value="">—</option>{accounts.filter(a => a.type === "liability").map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <button className={buttonClass} onClick={() => setJournalOpen(false)}>{tx("Close", "إغلاق")}</button>
            <button className={primaryButtonClass} disabled={!!busy || !journal.expenseAccountId || !journal.payableAccountId} onClick={async () => { await act("journal", () => createPayrollJournalDraft({ runId: run.id, ...journal }), tx("Journal draft created", "تم إنشاء القيد")); setJournalOpen(false) }}>{tx("Create draft", "إنشاء المسودة")}</button>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
