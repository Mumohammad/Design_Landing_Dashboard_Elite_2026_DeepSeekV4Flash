"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { attendanceStatuses } from "@/lib/payroll/preparation-schema"
import { archivePayrollRule, loadPayrollPreparation, lockPayrollPreparation, openPayrollPreparation, reviewPayrollOrders, savePayrollAdvance, savePayrollAttendance, savePayrollPeriodBasis, savePayrollRule, transitionPayrollAdvance, type PreparationResult } from "@/lib/payroll/preparation-actions"

interface Driver { employment: { from: string; to: string; requiresBasis: boolean; issue: string | null }; id: string; name: string; code: string; category: "sponsored_type1" | "sponsored_type2" | "freelancer" }
interface Rule { id: string; driver_id: string; category: Driver["category"]; version: number; effective_date: string; is_active: boolean; [key: string]: unknown }
interface Review { driver_id: string; version: number; attendance_reviewed: boolean; orders_reviewed: boolean }
interface Advance { id: string; driver_id: string; amount: number; advance_date: string; repayment_month: string; reason: string; status: string; preparation_version: number }
interface PeriodBasis { id: string; driver_id: string; version: number; mode: string; is_current: boolean; rule_snapshot: Rule; [key: string]: unknown }
interface Snapshot {
  period: { id: string; status: string; working_days_count: number; preparation_version: number } | null
  bases: PeriodBasis[]; drivers: Driver[]; rules: Rule[]; reviews: Review[]; attendance: { driver_id: string; date: string; status: string }[]
  orders: { driver_id: string; delivered: number; revenue: number; entries: number }[]; advances: Advance[]
  paidPayroll: { id: string; driver_id: string }[]; defaults: Record<string, unknown>
}
interface PreparationDraft {
  snapshot: Snapshot | null
  driverId: string
  days: Record<string, string>
  editingRule: Rule | null
  editingAdvance: Advance | null
}
function attendanceDays(snapshot: Snapshot | null, driverId: string): Record<string, string> {
  return Object.fromEntries((snapshot?.attendance ?? []).filter(day => day.driver_id === driverId).map(day => [day.date, day.status]))
}
const inputClass = "w-full rounded-xl border border-input bg-background shadow-xs px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
const buttonClass = "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label> }

export default function PayrollPreparationPage() {
  const { locale } = useTranslation(); const ar = locale === "ar"
  const text = (en: string, arabic: string) => ar ? arabic : en
  const now = new Date()
  const [request, setRequest] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const { year, month } = request
  const [draft, setDraft] = useState<PreparationDraft>({ snapshot: null, driverId: "", days: {}, editingRule: null, editingAdvance: null })
  const { driverId, days, editingRule, editingAdvance } = draft
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState(false)
  const [loadedRequest, setLoadedRequest] = useState<typeof request | null>(null)
  const advanceRequestIds = useRef(new Map<string, string>())
  const mutationInFlight = useRef(false)
  const loadSequence = useRef(0)
  const mounted = useRef(false)
  const periodKey = `${year}-${String(month).padStart(2,"0")}`
  const loading = loadedRequest !== request
  const snapshot = loading ? null : draft.snapshot
  const refresh = useCallback(() => {
    const sequence = ++loadSequence.current
    const fail = (error: unknown) => {
      if (sequence !== loadSequence.current) return
      setDraft(current => ({ ...current, snapshot: null, days: {}, editingRule: null, editingAdvance: null }))
      setError(true); setMessage(error instanceof Error ? error.message : "Unable to load preparation")
      setLoadedRequest(request)
    }
    return loadPayrollPreparation(request.year, request.month).then(result => {
      if (sequence !== loadSequence.current) return
      if (!result.success || !result.data) { fail(new Error(result.error ?? "Unable to load preparation")); return }
      const next = result.data as unknown as Snapshot
      setDraft(current => {
        const driverId = next.drivers.some(driver => driver.id === current.driverId) ? current.driverId : next.drivers[0]?.id ?? ""
        return { snapshot: next, driverId, days: attendanceDays(next, driverId), editingRule: null, editingAdvance: null }
      })
      setLoadedRequest(request)
    }, fail)
  }, [request])
  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false; loadSequence.current += 1 }
  }, [refresh])
  function requestRefresh() { if (mounted.current) setRequest(current => ({ ...current })) }
  function setDriverId(driverId: string) {
    setDraft(current => ({ ...current, driverId, days: attendanceDays(current.snapshot, driverId), editingRule: null, editingAdvance: null }))
  }
  function setDays(days: Record<string, string>) { setDraft(current => ({ ...current, days })) }
  function setEditingRule(editingRule: Rule | null) { setDraft(current => ({ ...current, editingRule })) }
  function setEditingAdvance(editingAdvance: Advance | null) { setDraft(current => ({ ...current, editingAdvance })) }
  async function run(action: () => Promise<PreparationResult>) {
    if (busy || mutationInFlight.current) return
    mutationInFlight.current = true
    setBusy(true); setMessage("")
    try { const result = await action(); if (!mounted.current) return; setError(!result.success); setMessage(result.success ? text("Saved. The preparation has been refreshed.","تم الحفظ وتحديث التحضير.") : result.error ?? "Unable to save"); if (result.success) requestRefresh() }
    catch { if (mounted.current) { setError(true); setMessage(text("The request could not be completed. Refresh the preparation and try again.","تعذر إتمام الطلب. حدّث التحضير ثم حاول مرة أخرى.")) } }
    finally { mutationInFlight.current = false; if (mounted.current) setBusy(false) }
  }
  const selected = snapshot?.drivers.find(d => d.id === driverId)
  const review = snapshot?.reviews.find(r => r.driver_id === driverId)
  const orders = snapshot?.orders.find(o => o.driver_id === driverId)
  const locked = snapshot?.period?.status === "locked"
  const basis = snapshot?.bases.find(b => b.driver_id === driverId)
  const applicableRule = locked && basis ? basis.rule_snapshot : snapshot?.rules.filter(r => r.driver_id === driverId && r.is_active && r.effective_date <= (selected?.employment.from ?? "")).sort((a,b) => b.effective_date.localeCompare(a.effective_date))[0]
  const calendar = Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, i) => `${periodKey}-${String(i+1).padStart(2,"0")}`)
  function number(form: FormData, name: string) { const value = form.get(name); return typeof value === "string" && value.trim() !== "" ? Number(value) : undefined }
  function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(["workingDaysTarget","targetOrders","baseSalary","bonusRate","deductionRate","packageAmount","thresholdOrders","carRentDeduction","bonusCap","deductionCap","minimumNetFloor"].map(k => [k,number(form,k)]))
    void run(() => savePayrollRule({ ...values, driverId, category: selected.category, effectiveDate: form.get("effectiveDate"), note: form.get("note"), ...(editingRule ? { id: editingRule.id, expectedVersion: editingRule.version } : {}) }))
  }
  function submitAdvance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const context = `${periodKey}:${driverId}`
    const requestId = advanceRequestIds.current.get(context) ?? crypto.randomUUID()
    if (!editingAdvance) advanceRequestIds.current.set(context, requestId)
    void run(async () => {
      const result = await savePayrollAdvance({ driverId, amount: number(form, "amount"), advanceDate: form.get("advanceDate"), repaymentMonth: periodKey, reason: form.get("reason"), ...(editingAdvance ? { id: editingAdvance.id, expectedVersion: editingAdvance.preparation_version } : { requestId }) })
      if (result.success && !editingAdvance && advanceRequestIds.current.get(context) === requestId) advanceRequestIds.current.delete(context)
      return result
    })
  }
  const ruleFields = selected?.category === "sponsored_type2" ? [["packageAmount","package_amount","Package (SAR)","الباقة (ر.س)"],["thresholdOrders","threshold_orders","Order threshold","حد الطلبات"],["carRentDeduction","car_rent_deduction","Car rent deduction (SAR)","خصم إيجار السيارة (ر.س)"]] : [["baseSalary","base_salary","Base salary (SAR)","الراتب الأساسي (ر.س)"],["bonusRate","bonus_rate","Bonus per extra order (SAR)","مكافأة الطلب الإضافي (ر.س)"],["deductionRate","deduction_rate","Deduction per missing order (SAR)","خصم الطلب الناقص (ر.س)"]]
  const statusLabels: Record<string, [string,string]> = { present:["Present","حاضر"], absent_excused:["Excused absence","غياب بعذر"], absent_unexcused:["Unexcused absence","غياب دون عذر"], late:["Late","متأخر"], half_day:["Half day","نصف يوم"], on_leave:["On leave","إجازة"], public_holiday:["Public holiday","عطلة رسمية"], day_off:["Day off","راحة"] }
  return <section aria-labelledby="payroll-preparation-title" className="mx-auto max-w-6xl space-y-8 px-4 py-6 lg:px-6" dir={ar ? "rtl" : "ltr"}>
    <header className="space-y-2"><Link href="/payroll" className="text-sm text-primary underline underline-offset-4">{text("Back to payroll","العودة للرواتب")}</Link><h1 id="payroll-preparation-title" className="text-2xl font-bold">{text("Prepare payroll inputs","تحضير بيانات الرواتب")}</h1><p className="max-w-3xl text-sm text-muted-foreground">{text("Review each driver's explicit pay rule, every employed date, and recorded orders before locking the month. Locked source records and financial history cannot be edited here.","راجع قاعدة أجر كل سائق وجميع أيام التوظيف والطلبات المسجلة قبل إقفال الشهر. لا يمكن تعديل السجلات المقفلة والسجل المالي هنا.")}</p></header>
    <fieldset disabled={busy} className="m-0 min-w-0 space-y-8 border-0 p-0" aria-label={text("Prepare payroll inputs","تحضير بيانات الرواتب")}>
    <section className="flex flex-wrap items-end gap-3" aria-label={text("Preparation period","فترة التحضير")}>
      <Field label={text("Year","السنة")}><input aria-label={text("Year","السنة")} className={inputClass} type="number" min="2000" max="2100" value={year} onChange={event => { const year = Number(event.target.value); setRequest(current => ({ ...current, year })) }} /></Field>
      <Field label={text("Month","الشهر")}><select className={inputClass} value={month} onChange={event => { const month = Number(event.target.value); setRequest(current => ({ ...current, month })) }}>{Array.from({length:12},(_,i) => <option key={i} value={i+1}>{i+1}</option>)}</select></Field>
      <button className={buttonClass} disabled={busy || loading} onClick={requestRefresh}>{text("Refresh","تحديث")}</button>
      {snapshot?.period && <p className="py-2 text-sm">{text("Period status:","حالة الفترة:")} <strong>{locked ? text("Locked","مقفلة") : text("Open","مفتوحة")}</strong></p>}
    </section>
    {message && <p role={error ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${error ? "border-destructive text-destructive" : "border-border"}`}>{message}</p>}
    {loading ? <p role="status">{text("Loading preparation…","جار تحميل التحضير…")}</p> : snapshot && <>
      <p className="text-sm text-muted-foreground">{text("Tenant reference values (enter and confirm the values for this period):","القيم المرجعية للمنشأة (أدخل قيم الفترة واعتمدها):")} {text("Working days","أيام العمل")} {String(snapshot.defaults["payroll.default_working_days"] ?? "—")} · {text("Minimum net floor (SAR)","الحد الأدنى للصافي (ر.س)")} {String(snapshot.defaults["payroll.min_net_floor"] ?? "—")}</p>
      {!snapshot.period && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => openPayrollPreparation({ year,month,workingDays:number(f,"workingDays") })) }} className="flex flex-wrap items-end gap-3">
        <Field label={text("Working days in this period","أيام العمل في الفترة")}><input className={inputClass} name="workingDays" type="number" min="1" max={calendar.length} required /></Field><button className={buttonClass} disabled={busy}>{text("Open preparation period","فتح فترة التحضير")}</button>
      </form>}
      <Field label={text("Driver","السائق")}><select className={`${inputClass} max-w-lg`} value={driverId} onChange={e => setDriverId(e.target.value)}><option value="" disabled>{text("Select driver","اختر السائق")}</option>{snapshot.drivers.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}</select></Field>
      {!selected && <p>{text("No active drivers are available.","لا يوجد سائقون نشطون.")}</p>}
      {selected && <>
      <section className="space-y-4 border-t border-border pt-6"><h2 className="text-lg font-semibold">{text("Pay rules","قواعد الأجر")}</h2><p className="text-sm text-muted-foreground">{text("Enter explicit amounts, including zero when appropriate. Mid-month rate changes require a separately reviewed split calculation. Rules already used in payroll or locked preparation cannot be edited or archived.","أدخل المبالغ صراحة، بما فيها الصفر عند الحاجة. تغييرات منتصف الشهر تتطلب احتساباً مقسماً ومراجعة مستقلة. لا يمكن تعديل أو أرشفة القواعد المستخدمة في الرواتب أو التحضير المقفل.")}</p>
        <ul className="divide-y divide-border">{snapshot.rules.filter(r => r.driver_id === driverId).map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{r.effective_date} · {text("Version","الإصدار")} {r.version} · {r.is_active ? text("Active","نشطة") : text("Archived","مؤرشفة")}</span>{r.is_active && !locked && <span className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => setEditingRule(r)}>{text("Edit rule","تعديل القاعدة")}</button><button className={buttonClass} disabled={busy} onClick={() => { const note = window.prompt(text("Archive reason (at least 5 characters)","سبب الأرشفة (5 أحرف على الأقل)")); if(note) void run(() => archivePayrollRule({ id:r.id,expectedVersion:r.version,note })) }}>{text("Archive","أرشفة")}</button></span>}</li>)}</ul>
        {!locked && <form key={`${driverId}:${editingRule?.id ?? "new"}`} onSubmit={submitRule} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={text("Effective date","تاريخ السريان")}><input className={inputClass} name="effectiveDate" type="date" required defaultValue={editingRule?.effective_date} /></Field>
          {[["workingDaysTarget","working_days_target","Target working days","أيام العمل المستهدفة"],["targetOrders","target_orders","Monthly order target","الطلبات الشهرية المستهدفة"],...ruleFields,...(selected.category === "freelancer" ? [["bonusCap","bonus_cap","Bonus cap (SAR)","حد المكافأة (ر.س)"],["deductionCap","deduction_cap","Deduction cap (SAR)","حد الخصم (ر.س)"]] : []),["minimumNetFloor","minimum_net_floor","Minimum net floor (SAR)","الحد الأدنى للصافي (ر.س)"]].map(([name,key,en,arabic]) => <Field key={name} label={text(en,arabic)}><input className={inputClass} name={name} type="number" min="0" step={name.includes("Target") || name.includes("Orders") ? "1" : "0.01"} required defaultValue={editingRule?.[key] == null ? "" : String(editingRule[key])} /></Field>)}
          <Field label={text("Rule review note","ملاحظة مراجعة القاعدة")}><input className={inputClass} name="note" minLength={5} maxLength={1000} required /></Field><div className="flex items-end gap-2"><button disabled={busy} className={buttonClass}>{editingRule ? text("Save rule changes","حفظ تعديلات القاعدة") : text("Create pay rule","إنشاء قاعدة الأجر")}</button>{editingRule && <button type="button" className={buttonClass} onClick={() => setEditingRule(null)}>{text("Cancel edit","إلغاء التعديل")}</button>}</div>
        </form>}
      </section>
      {selected.employment.issue && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{text("Employment dates need review before payroll can be prepared.","يجب مراجعة تواريخ التوظيف قبل تحضير الرواتب.")} <Link className="underline underline-offset-4" href={`/drivers/${driverId}`}>{text("Review driver employment dates","مراجعة تواريخ توظيف السائق")}</Link> ({selected.employment.issue})</p>}
      {selected.employment.requiresBasis && !selected.employment.issue && <section className="space-y-4 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">{text("Reviewed period pay basis","أساس أجر الفترة المراجع")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{text("Recorded employment for this month:","فترة التوظيف المسجلة لهذا الشهر:")} {selected.employment.from} — {selected.employment.to}. {text("Enter agreed payable amounts and the adjusted order target for this interval. These amounts are used once; the app does not prorate them again. Confirm the actual rule rates and caps below.","أدخل المبالغ المستحقة المتفق عليها وهدف الطلبات المعدل لهذه الفترة. تُستخدم هذه القيم مرة واحدة دون احتساب نسبي إضافي. اعتمد معدلات القاعدة وحدودها المبينة أدناه.")}</p>
        {basis && <p role="status" className="text-sm">{locked ? text("Approved basis is frozen with this period.","تم تثبيت الأساس المعتمد مع هذه الفترة.") : basis.is_current ? text("Period basis approved. Review again if any amount changes.","تم اعتماد أساس الفترة. أعد المراجعة عند تعديل أي مبلغ.") : text("The rule or employment dates changed. Review and approve the basis again.","تغيرت القاعدة أو تواريخ التوظيف. راجع أساس الفترة واعتمده مجدداً.")}</p>}
        {!applicableRule ? <p className="text-sm">{text("Create an explicit pay rule effective on or before the first employed date.","أنشئ قاعدة أجر صريحة تسري في أول يوم توظيف أو قبله.")}</p> : <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">{text("Rule version / effective date","إصدار القاعدة / تاريخ السريان")}</dt><dd>{applicableRule.version} / {applicableRule.effective_date}</dd></div>{selected.category !== "sponsored_type2" && <><div><dt className="text-muted-foreground">{text("Bonus / deduction per order (SAR)","مكافأة / خصم الطلب (ر.س)")}</dt><dd>{String(applicableRule.bonus_rate)} / {String(applicableRule.deduction_rate)}</dd></div>{selected.category === "freelancer" && <div><dt className="text-muted-foreground">{text("Bonus / deduction caps (zero means no cap)","حد المكافأة / الخصم (الصفر دون حد)")}</dt><dd>{String(applicableRule.bonus_cap)} / {String(applicableRule.deduction_cap)}</dd></div>}</>}</dl>
          {!locked && snapshot.period && <form key={`basis:${driverId}:${basis?.version ?? 0}:${applicableRule.id}:${applicableRule.version}`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={event => {
            event.preventDefault();const form=new FormData(event.currentTarget)
            void run(() => savePayrollPeriodBasis({ year,month,driverId,expectedVersion:basis?.version ?? 0,ruleId:applicableRule.id,ruleVersion:applicableRule.version,
              employedFrom:selected.employment.from,employedTo:selected.employment.to,periodBaseAmount:number(form,"periodBaseAmount"),periodOrderTarget:number(form,"periodOrderTarget"),
              periodAbsenceDeduction:number(form,"periodAbsenceDeduction"),periodMinimumFloor:number(form,"periodMinimumFloor"),periodPackageThreshold:number(form,"periodPackageThreshold"),periodRentDeduction:number(form,"periodRentDeduction"),ratesAcknowledged:form.get("ratesAcknowledged")==="on",note:form.get("note") }))
          }}>
            {[["periodBaseAmount","period_base_amount","Agreed period base amount (SAR)","الأجر الأساسي المتفق عليه للفترة (ر.س)"],["periodOrderTarget","period_order_target","Adjusted period order target","هدف طلبات الفترة المعدل"],["periodAbsenceDeduction","period_absence_deduction","Reviewed period absence deduction (SAR)","خصم غياب الفترة المراجع (ر.س)"],["periodMinimumFloor","period_minimum_floor","Reviewed period net floor (SAR)","الحد الأدنى لصافي الفترة المراجع (ر.س)"],...(selected.category==="sponsored_type2" ? [["periodPackageThreshold","period_package_threshold","Reviewed period package threshold","حد باقة الفترة المراجع"],["periodRentDeduction","period_rent_deduction","Reviewed period rent deduction (SAR)","خصم إيجار الفترة المراجع (ر.س)"]] : [])].map(([name,key,en,arabic]) => <Field key={name} label={text(en,arabic)}><input className={inputClass} name={name} type="number" min="0" step={name==="periodOrderTarget" || name==="periodPackageThreshold" ? "1" : "0.01"} required defaultValue={basis?.[key] == null ? "" : String(basis[key])} /></Field>)}
            <Field label={text("Period basis review note","ملاحظة مراجعة أساس الفترة")}><input className={inputClass} name="note" minLength={5} maxLength={1000} required /></Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2"><input className="mt-1 accent-primary" type="checkbox" name="ratesAcknowledged" required />{text("I reviewed these employment dates, the rule rates/caps, and every entered period amount.","راجعت تواريخ التوظيف ومعدلات القاعدة وحدودها وجميع مبالغ الفترة المدخلة.")}</label>
            <div className="flex items-end"><button className={buttonClass} disabled={busy}>{text("Approve period pay basis","اعتماد أساس أجر الفترة")}</button></div>
          </form>}
        </>}
      </section>}

      {snapshot.period && <section className="space-y-4 border-t border-border pt-6"><h2 className="text-lg font-semibold">{text("Attendance and orders review","مراجعة الحضور والطلبات")}</h2>
        <p className="text-sm">{text("Attendance reviewed:","الحضور مراجع:")} {review?.attendance_reviewed ? text("Yes","نعم") : text("No","لا")} · {text("Orders reviewed:","الطلبات مراجعة:")} {review?.orders_reviewed ? text("Yes","نعم") : text("No","لا")}</p>
        <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => savePayrollAttendance({ year,month,driverId,expectedVersion:review?.version ?? 0,employedFrom:selected.employment.from,employedTo:selected.employment.to,days:calendar.filter(date => date>=selected.employment.from && date<=selected.employment.to).map(date => ({date,status:days[date]})),note:f.get("note") })) }} className="space-y-4">
          <p className="text-sm text-muted-foreground">{text("Classify every employed date explicitly, including days off and leave. Dates outside recorded employment do not create attendance records. Partial-period pay uses the approved amounts above.","صنّف كل يوم توظيف صراحة بما فيه الراحة والإجازة. لا تُنشأ سجلات حضور خارج فترة التوظيف المسجلة. تُستخدم مبالغ الفترة الجزئية المعتمدة أعلاه.")}</p>
          <fieldset disabled={busy || locked || Boolean(selected.employment.issue)} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5"><legend className="sr-only">{text("Calendar attendance","حضور أيام الشهر")}</legend>{calendar.map(date => date<selected.employment.from || date>selected.employment.to ? <div key={date} className="grid content-start gap-1.5 py-2 text-sm"><span>{date}</span><span className="text-muted-foreground">{text("Outside recorded employment","خارج فترة التوظيف المسجلة")}</span></div> : <Field key={date} label={date}><select className={inputClass} value={days[date] ?? ""} required onChange={e => setDays({...days,[date]:e.target.value})}><option value="">{text("Choose status","اختر الحالة")}</option>{attendanceStatuses.map(s => <option key={s} value={s}>{text(...statusLabels[s])}</option>)}</select></Field>)}</fieldset>
          {!locked && <div className="flex flex-wrap items-end gap-3"><Field label={text("Attendance review note","ملاحظة مراجعة الحضور")}><input className={inputClass} name="note" minLength={5} required /></Field><button className={buttonClass} disabled={busy}>{text("Save and review attendance","حفظ ومراجعة الحضور")}</button></div>}
        </form>
        <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => reviewPayrollOrders({ year,month,driverId,expectedVersion:review?.version ?? 0,delivered:Number(orders?.delivered ?? 0),revenue:Number(orders?.revenue ?? 0),note:f.get("note") })) }}>
          <p className="w-full text-sm">{text("Recorded daily orders:","الطلبات اليومية المسجلة:")} {Number(orders?.delivered ?? 0)} · {text("Revenue (SAR):","الإيراد (ر.س):")} {Number(orders?.revenue ?? 0).toFixed(2)} · {Number(orders?.entries ?? 0)} {text("entries","سجلات")} <Link href="/orders" className="text-primary underline underline-offset-4">{text("Review or edit daily orders","مراجعة أو تعديل الطلبات اليومية")}</Link></p>
          {!locked && <><Field label={text("Order review note (confirm zero if no orders)","ملاحظة مراجعة الطلبات (اعتمد الصفر إن لم توجد طلبات)")}><input className={inputClass} name="note" minLength={5} required /></Field><button className={buttonClass} disabled={busy}>{text("Confirm recorded order totals","اعتماد إجمالي الطلبات المسجلة")}</button></>}
        </form>
      </section>}
      <section className="space-y-4 border-t border-border pt-6"><h2 className="text-lg font-semibold">{text("Payroll advances","سلف الرواتب")}</h2><p className="text-sm text-muted-foreground">{text("Advances are separate from expenses. Edit pending advances; approved advances retain their financial history. Repayment requires a paid payroll with matching total advance deductions.","السلف منفصلة عن المصروفات. تُعدل السلف المعلقة فقط، وتُحفظ السلف المعتمدة في سجلها المالي. يتطلب السداد راتباً مدفوعاً وإجمالي خصم سلف مطابقاً.")}</p>
        <ul className="divide-y divide-border">{snapshot.advances.filter(a => a.driver_id === driverId).map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{Number(a.amount).toFixed(2)} SAR · {a.advance_date} · {a.status === "pending" ? text("Pending","معلقة") : a.status === "approved" ? text("Approved","معتمدة") : a.status === "repaid" ? text("Repaid","مسددة") : a.status === "cancelled" ? text("Cancelled","ملغاة") : a.status} · {a.reason}</span><span className="flex flex-wrap gap-2">{a.status === "pending" && <button className={buttonClass} disabled={busy} onClick={() => setEditingAdvance(a)}>{text("Edit advance","تعديل السلفة")}</button>}{(a.status === "pending" ? ["approved","cancelled"] : a.status === "approved" ? ["repaid","cancelled"] : []).map(to => <button key={to} className={buttonClass} disabled={busy || (to === "repaid" && !snapshot.paidPayroll.some(p => p.driver_id === driverId))} onClick={() => { const note=window.prompt(text("Decision reason (at least 5 characters)","سبب القرار (5 أحرف على الأقل)")); if(note) void run(() => transitionPayrollAdvance({ id:a.id,expectedVersion:a.preparation_version,to,note,payrollPeriodId:snapshot.paidPayroll.find(p => p.driver_id === driverId)?.id })) }}>{to === "approved" ? text("Approve","اعتماد") : to === "repaid" ? text("Record payroll repayment","تسجيل سداد الراتب") : text("Cancel advance","إلغاء السلفة")}</button>)}</span></li>)}</ul>
        <form key={`${periodKey}:${driverId}:${editingAdvance?.id ?? "new-advance"}`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={submitAdvance}>
          <Field label={text("Amount (SAR)","المبلغ (ر.س)")}><input name="amount" type="number" min="0.01" step="0.01" required className={inputClass} defaultValue={editingAdvance?.amount} /></Field><Field label={text("Advance date","تاريخ السلفة")}><input name="advanceDate" type="date" required className={inputClass} defaultValue={editingAdvance?.advance_date} /></Field><Field label={text("Reason","السبب")}><input name="reason" minLength={5} required className={inputClass} defaultValue={editingAdvance?.reason} /></Field><div className="flex items-end gap-2"><button disabled={busy} className={buttonClass}>{editingAdvance ? text("Save pending advance","حفظ السلفة المعلقة") : text("Request advance","طلب سلفة")}</button>{editingAdvance && <button type="button" className={buttonClass} onClick={() => setEditingAdvance(null)}>{text("Cancel edit","إلغاء التعديل")}</button>}</div><p className="text-sm text-muted-foreground sm:col-span-2">{text("Repayment month:","شهر السداد:")} {periodKey}</p>
        </form>
      </section>
      </>}
      {snapshot.period && !locked && <section className="space-y-4 border-t border-border pt-6"><h2 className="text-lg font-semibold">{text("Lock reviewed period","إقفال الفترة المراجعة")}</h2><p className="text-sm text-muted-foreground">{text("All active drivers need complete pay rules, reviewed attendance, and confirmed orders. Locking creates exact monthly summaries and freezes the source records. Check the driver reviews before confirming.","يجب استكمال قواعد الأجر والحضور والطلبات لجميع السائقين النشطين. يُنشئ الإقفال ملخصات شهرية دقيقة ويقفل السجلات المصدرية. راجع حالة كل سائق قبل الاعتماد.")}</p><ul className="space-y-1 text-sm">{snapshot.drivers.map(d => { const r=snapshot.reviews.find(r => r.driver_id===d.id); return <li key={d.id}>{d.name}: {r?.attendance_reviewed && r?.orders_reviewed && (!d.employment.requiresBasis || snapshot.bases.some(b => b.driver_id===d.id && b.is_current)) ? text("Attendance and orders reviewed","تمت مراجعة الحضور والطلبات") : text("Review incomplete","المراجعة غير مكتملة")}</li> })}</ul>
        <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); const f=new FormData(e.currentTarget); void run(() => lockPayrollPreparation({ year,month,expectedVersion:snapshot.period?.preparation_version,note:f.get("note") })) }}><Field label={text("Final review note","ملاحظة المراجعة النهائية")}><input name="note" required minLength={5} className={inputClass} /></Field><button className={buttonClass} disabled={busy}>{text("Lock attendance and order inputs","إقفال بيانات الحضور والطلبات")}</button></form>
      </section>}
    </>}
    </fieldset>
  </section>
}
