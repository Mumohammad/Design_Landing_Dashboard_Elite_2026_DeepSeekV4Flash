"use client"

import { useEffect, useState } from "react"
import { importIncomeRows, type IncomeImportResult } from "@/lib/payroll-engine/server/income-actions"
import { Field, Notice, buttonClass, inputClass, primaryButtonClass, sar, useLang } from "./shared"

// Same target fields and auto-mapping heuristic as the upstream import dialog,
// plus every income component the engine understands and tenant custom fields.
const FIELDS = [
  { key: "riderId", en: "Rider ID *", ar: "رقم المندوب *", hints: ["rider_id", "rider id", "riderid", "معرف المندوب", "رقم المندوب"] },
  { key: "driverName", en: "Driver name", ar: "اسم المندوب", hints: ["rider_name", "driver name", "name", "الاسم", "اسم السائق", "اسم المندوب"] },
  { key: "basicPayment", en: "Basic payment", ar: "الدفعة الأساسية", hints: ["basic_payment", "basic payment", "basic", "الدفعة الأساسية"] },
  { key: "distancePayment", en: "Distance payment", ar: "بدل المسافة", hints: ["distance_payment", "distance", "بدل المسافة"] },
  { key: "segmentPayment", en: "Segment payment", ar: "بدل الفئات", hints: ["segment_payment", "segment", "بدل الفئات"] },
  { key: "acceptancePenalty", en: "Acceptance penalty", ar: "غرامة القبول", hints: ["acceptance_rate_penalties", "acceptance"] },
  { key: "contactPenalty", en: "Contact penalty", ar: "غرامة التواصل", hints: ["contact_rate_penalties", "contact"] },
  { key: "stackingDeduction", en: "Stacking deduction", ar: "خصم الطلبات المتعددة", hints: ["stacking_deduction", "stacking"] },
  { key: "declinedPenalty", en: "Declined penalty", ar: "غرامة الرفض", hints: ["declined_penalties", "declined"] },
  { key: "latePenalty", en: "Late penalty", ar: "غرامة التأخير", hints: ["late_penalty", "late"] },
  { key: "noShowPenalty", en: "No-show penalty", ar: "غرامة عدم الحضور", hints: ["no_show_penalty", "no show", "noshow"] },
  { key: "noShowSpecialPenalty", en: "No-show (special cities)", ar: "عدم الحضور (مدن خاصة)", hints: ["no_show_penalty_special_cities", "special cities"] },
  { key: "dailyAcceptancePenalty", en: "Daily acceptance penalty", ar: "غرامة القبول اليومي", hints: ["daily_acceptance_rate_penalty", "daily acceptance"] },
  { key: "missedDaysPenalty", en: "Missed days penalty", ar: "غرامة الأيام الفائتة", hints: ["missed_days_penalty", "missed days"] },
  { key: "riderBalance", en: "Rider balance (deducted)", ar: "محفظة المندوب (تُخصم)", hints: ["rider_balance", "balance", "محفظة"] },
] as const

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]+/g, " ").trim()

function autoMap(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()
  for (const f of FIELDS) {
    // exact hint first, then contains — the more specific hints are listed first
    const exact = headers.find(h => !used.has(h) && f.hints.some(x => norm(h) === norm(x)))
    const loose = exact ?? headers.find(h => !used.has(h) && f.hints.some(x => norm(h).includes(norm(x))))
    if (loose) { out[f.key] = loose; used.add(loose) }
  }
  return out
}

type Sheet = { name: string; headers: string[]; rows: Record<string, unknown>[] }

export function IncomeImportDialog({ defaultMonth, customFields, onClose, onImported }: {
  defaultMonth: string; customFields: Array<{ id: string; name: string; nameAr: string | null; fieldType: "add" | "deduct" }>; onClose: () => void; onImported: () => void
}) {
  const { ar, tx } = useLang()
  const [file, setFile] = useState<File | null>(null)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetName, setSheetName] = useState("")
  const [month, setMonth] = useState(defaultMonth)
  const [companyName, setCompanyName] = useState("HungerStation")
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<IncomeImportResult | null>(null)
  const [forceUpdate, setForceUpdate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", k)
    return () => window.removeEventListener("keydown", k)
  }, [onClose])

  const sheet = sheets.find(s => s.name === sheetName)

  async function readFile(f: File) {
    setError(""); setPreview(null); setFile(f)
    try {
      const XLSX = await import("xlsx")
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" })
      const parsed: Sheet[] = wb.SheetNames.map(name => {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: null })
        const headers = [...new Set(rows.flatMap(r => Object.keys(r)))]
        return { name, headers, rows }
      }).filter(s => s.rows.length > 0)
      if (!parsed.length) { setError(tx("The file has no data rows", "الملف لا يحتوي على بيانات")); return }
      // Prefer the sheet that looks like rider data (has a rider id column).
      const best = parsed.find(s => autoMap(s.headers).riderId) ?? parsed[0]
      setSheets(parsed); setSheetName(best.name); setMapping(autoMap(best.headers))
    } catch (e) { setError(e instanceof Error ? e.message : tx("Could not read the file", "تعذّرت قراءة الملف")) }
  }

  function mappedRows() {
    if (!sheet) return []
    return sheet.rows.map(r => {
      const out: Record<string, unknown> = {}
      for (const [field, col] of Object.entries(mapping)) if (col && !field.startsWith("cf:")) out[field] = r[col]
      out.customFields = customFields.filter(f => mapping[`cf:${f.id}`]).map(f => ({ name: f.name, type: f.fieldType, amount: Number(r[mapping[`cf:${f.id}`]] ?? 0) || 0 }))
      return out
    }).filter(r => String(r.riderId ?? "").trim())
  }

  async function submit(previewOnly: boolean) {
    if (!mapping.riderId) { setError(tx("Map the Rider ID column", "اربط عمود رقم المندوب")); return }
    setBusy(true); setError("")
    const r = await importIncomeRows({ month, companyName, rows: mappedRows(), forceUpdate, preview: previewOnly, sourceFile: file?.name ?? null })
    setBusy(false)
    if (!r.success) { setError(r.error); return }
    if (previewOnly) setPreview(r.data); else onImported()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={tx("Import monthly income", "استيراد الإيرادات الشهرية")} className="max-h-[92vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{tx("Import monthly income", "استيراد الإيرادات الشهرية")}</h2>
        <p className="text-sm text-muted-foreground">{tx("Upload a delivery company sheet, map its columns, preview the calculated income, then save. Income = basic + distance + segment − all penalties − |rider balance| ± custom fields.", "ارفع ملف شركة التوصيل، اربط الأعمدة، عاين الإيراد المحتسب، ثم احفظ. الإيراد = الأساسي + المسافة + الفئات − جميع الغرامات − |المحفظة| ± الحقول الإضافية.")}</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={tx("Month", "الشهر")}><input type="month" className={inputClass} value={month} onChange={e => setMonth(e.target.value)} /></Field>
          <Field label={tx("Company", "الشركة")}><input maxLength={80} className={inputClass} value={companyName} onChange={e => setCompanyName(e.target.value)} /></Field>
          <Field label={tx("File (.xlsx / .csv)", "الملف (.xlsx / .csv)")}><input type="file" accept=".xlsx,.xls,.csv" className={inputClass} onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} /></Field>
        </div>
        {sheets.length > 1 && <Field label={tx("Sheet", "الورقة")}><select className={inputClass} value={sheetName} onChange={e => { const s = sheets.find(x => x.name === e.target.value); setSheetName(e.target.value); setMapping(autoMap(s?.headers ?? [])); setPreview(null) }}>{sheets.map(s => <option key={s.name} value={s.name}>{s.name} ({s.rows.length})</option>)}</select></Field>}
        {sheet && <>
          <div className="text-xs text-muted-foreground">{sheet.rows.length} {tx("rows", "صف")} · {sheet.headers.length} {tx("columns", "عمود")}</div>
          <div className="grid gap-2 md:grid-cols-2">
            {[...FIELDS.map(f => ({ key: f.key as string, label: ar ? f.ar : f.en })), ...customFields.map(f => ({ key: `cf:${f.id}`, label: `${ar && f.nameAr ? f.nameAr : f.name} (${f.fieldType === "add" ? "+" : "−"})` }))].map(f => (
              <label key={f.key} className="grid grid-cols-2 items-center gap-2 text-sm">{f.label}
                <select className={inputClass} value={mapping[f.key] ?? ""} onChange={e => { setMapping({ ...mapping, [f.key]: e.target.value }); setPreview(null) }}>
                  <option value="">{tx("— not mapped —", "— غير مربوط —")}</option>{sheet.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select></label>
            ))}
          </div>
        </>}
        {error && <Notice kind="err">{error}</Notice>}
        {preview && <div className="space-y-2">
          <Notice kind="info">{preview.rowCount} {tx("riders", "مندوب")} · {tx("Total income", "إجمالي الإيراد")} SAR {sar(preview.totalIncome)} · {tx("Penalties", "الغرامات")} SAR {sar(preview.totalPenalties)} · {preview.rows.filter(r => !r.linked).length} {tx("not linked to a driver profile", "غير مرتبطين بملف سائق")}</Notice>
          {preview.payrollManaged && <Notice kind="err">{tx("This month/company already has income synced from a payroll run. Importing overwrites those rows; recalculating that run later replaces them again.", "لهذا الشهر/الشركة إيرادات من مسير رواتب. الاستيراد يستبدلها، وإعادة احتساب المسير لاحقاً تستبدلها مجدداً.")}</Notice>}
          {preview.duplicateRiderIds.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={forceUpdate} onChange={e => setForceUpdate(e.target.checked)} />{tx(`Overwrite ${preview.duplicateRiderIds.length} existing record(s)`, `استبدال ${preview.duplicateRiderIds.length} سجل موجود`)}</label>}
          {preview.errors.length > 0 && <Notice kind="err"><ul className="list-disc ps-5">{preview.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border"><table className="w-full text-xs"><tbody>{preview.rows.slice(0, 200).map(r => <tr key={r.riderId} className="border-t border-border"><td className="px-2 py-1">{r.riderId}</td><td className="px-2 py-1">{r.driverName}</td><td className="px-2 py-1 text-end tabular-nums">{sar(r.totalPenalties)}</td><td className="px-2 py-1 text-end font-medium tabular-nums">{sar(r.totalIncome)}</td></tr>)}</tbody></table></div>
        </div>}
        <div className="flex justify-end gap-2">
          <button className={buttonClass} onClick={onClose}>{tx("Close", "إغلاق")}</button>
          <button className={buttonClass} disabled={busy || !sheet} onClick={() => submit(true)}>{tx("Preview", "معاينة")}</button>
          <button className={primaryButtonClass} disabled={busy || !preview || (preview.duplicateRiderIds.length > 0 && !forceUpdate)} onClick={() => submit(false)}>{busy ? tx("Saving…", "جارٍ الحفظ…") : tx("Save income", "حفظ الإيرادات")}</button>
        </div>
      </div>
    </div>
  )
}
