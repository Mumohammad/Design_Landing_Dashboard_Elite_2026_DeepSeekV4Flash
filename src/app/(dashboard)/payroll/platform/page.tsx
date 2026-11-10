"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState, type FormEvent } from "react"
import { createClient } from "@/lib/supabase/client"
import { importPayrollWorkbook, preparePayrollWorkbookUpload } from "@/lib/payroll-engine/server/run-actions"
import { listPayrollRuns, type RunSummary } from "@/lib/payroll-engine/server/read-actions"
import { monthLabel, monthLabelAr } from "@/lib/payroll-engine/month"
import { Field, Kpi, Notice, PageShell, StatusBadge, currentMonthKey, inputClass, primaryButtonClass, sar, useLang } from "@/components/payroll-engine/shared"

export default function PlatformPayrollRunsPage() {
  const { ar, tx } = useLang()
  const router = useRouter()
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [platforms, setPlatforms] = useState<Array<{ id: string; name: string }>>([])
  const [error, setError] = useState("")
  const [form, setForm] = useState({ monthKey: currentMonthKey(), platformId: "", platformName: "HungerStation" })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await listPayrollRuns()
    if (r.success) { setRuns(r.data.runs); setPlatforms(r.data.platforms); setError("") } else { setRuns([]); setError(r.error) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) { setMessage({ kind: "err", text: tx("Choose the platform payroll workbook (.xlsx)", "اختر ملف رواتب المنصة (.xlsx)") }); return }
    if (file.size > 10 * 1024 * 1024) { setMessage({ kind: "err", text: tx("Workbooks are limited to 10 MB", "الحد الأقصى لحجم الملف 10 ميجابايت") }); return }
    setMessage(null)
    try {
      setBusy(tx("Uploading…", "جارٍ الرفع…"))
      const prep = await preparePayrollWorkbookUpload(file.name)
      if (!prep.success) throw new Error(prep.error)
      const up = await createClient().storage.from("payroll-workbooks").upload(prep.data.path, file, {
        contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: false })
      if (up.error) throw new Error(up.error.message)
      setBusy(tx("Calculating payroll…", "جارٍ احتساب الرواتب…"))
      const res = await importPayrollWorkbook({ path: prep.data.path, fileName: file.name, monthKey: form.monthKey, platformName: form.platformName, platformId: form.platformId || null })
      if (!res.success) throw new Error(res.error)
      router.push(`/payroll/platform/runs/${res.data.runId}`)
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : tx("Import failed", "فشل الاستيراد") })
    } finally { setBusy("") }
  }

  const active = (runs ?? []).filter(r => r.status !== "cancelled")
  const latest = active[0]

  return (
    <PageShell title={tx("Platform payroll", "رواتب المنصات")} subtitle={tx("Import the delivery platform workbook (RLVL / WR sheets), review every rider's calculation, then approve.", "استورد ملف منصة التوصيل (أوراق RLVL / WR)، راجع احتساب كل مندوب، ثم اعتمد المسير.")}>
      {latest && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label={tx("Latest run", "آخر مسير")} value={ar ? monthLabelAr(latest.monthKey) : latest.payrollMonth} />
          <Kpi label={tx("Riders", "المناديب")} value={String(latest.totalDrivers)} />
          <Kpi label={tx("Gross (SAR)", "الإجمالي (ر.س)")} value={sar(latest.totalGross)} />
          <Kpi label={tx("Net payable (SAR)", "الصافي المستحق (ر.س)")} value={sar(latest.totalNet)} tone="good" />
        </div>
      )}

      <form onSubmit={submit} className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-5 md:items-end">
        <Field label={tx("Payroll month", "شهر الرواتب")}>
          <input type="month" required className={inputClass} value={form.monthKey} onChange={e => setForm({ ...form, monthKey: e.target.value })} />
        </Field>
        <Field label={tx("Platform", "المنصة")}>
          <select className={inputClass} value={form.platformId} onChange={e => {
            const p = platforms.find(x => x.id === e.target.value)
            setForm({ ...form, platformId: e.target.value, platformName: p?.name ?? form.platformName })
          }}>
            <option value="">{tx("— Not linked —", "— غير مرتبط —")}</option>
            {platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={tx("Platform name on records", "اسم المنصة في السجلات")}>
          <input required maxLength={80} className={inputClass} value={form.platformName} onChange={e => setForm({ ...form, platformName: e.target.value })} />
        </Field>
        <Field label={tx("Workbook (.xlsx)", "الملف (.xlsx)")}>
          <input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className={inputClass} onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <button type="submit" className={primaryButtonClass} disabled={!!busy}>{busy || tx("Import & calculate", "استيراد واحتساب")}</button>
        <p className="text-xs text-muted-foreground md:col-span-5">{tx("Re-importing the same month and platform replaces that month's draft. Approved months must be cancelled first.", "إعادة استيراد نفس الشهر والمنصة تستبدل المسودة. يجب إلغاء المسير المعتمد أولاً.")}</p>
      </form>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {error && <Notice kind="err">{error}</Notice>}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
            <tr>{[tx("Month", "الشهر"), tx("Platform", "المنصة"), tx("Status", "الحالة"), tx("Riders", "المناديب"), tx("Gross", "الإجمالي"), tx("Penalties", "الغرامات"), tx("Net", "الصافي"), tx("Open issues", "ملاحظات مفتوحة"), tx("File", "الملف")].map(h => <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {runs === null && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{tx("Loading…", "جارٍ التحميل…")}</td></tr>}
            {runs?.length === 0 && !error && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">{tx("No payroll runs yet — import a workbook above.", "لا توجد مسيرات بعد — استورد ملفاً أعلاه.")}</td></tr>}
            {runs?.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2 font-medium"><Link className="underline-offset-2 hover:underline" href={`/payroll/platform/runs/${r.id}`}>{ar ? monthLabelAr(r.monthKey) : monthLabel(r.monthKey)}</Link></td>
                <td className="px-3 py-2">{r.platformName}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2 tabular-nums">{r.totalDrivers}</td>
                <td className="px-3 py-2 tabular-nums">{sar(r.totalGross)}</td>
                <td className="px-3 py-2 tabular-nums">{sar(r.totalPenalties)}</td>
                <td className="px-3 py-2 font-semibold tabular-nums">{sar(r.totalNet)}</td>
                <td className="px-3 py-2 tabular-nums">{r.openExceptions || "—"}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-xs text-muted-foreground" title={r.fileName}>{r.fileName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
