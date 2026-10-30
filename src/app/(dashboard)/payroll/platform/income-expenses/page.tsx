"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { applyDefaultExpenses, deleteExpenseCategory, deleteIncomeRecords, deleteMonthlyExpense, getIncomeDashboard, saveCustomIncomeField, saveDriverCount, saveExpenseCategory, saveMonthlyExpense, type IncomeDashboardData } from "@/lib/payroll-engine/server/income-actions"
import { incomeExpensesSheets } from "@/lib/payroll-engine/exports"
import { Field, Kpi, Notice, PageShell, buttonClass, currentMonthKey, dangerButtonClass, downloadSheets, inputClass, primaryButtonClass, sar, useLang } from "@/components/payroll-engine/shared"
import { IncomeImportDialog } from "@/components/payroll-engine/income-import-dialog"

const ALLOC = { per_driver: { en: "Per driver (each rider)", ar: "لكل مندوب" }, shared: { en: "Shared (split by active drivers)", ar: "مشترك (يُقسم على المناديب)" }, assigned: { en: "Assigned to one rider", ar: "مخصص لمندوب" } } as const

export default function IncomeExpensesPage() {
  const { ar, tx } = useLang()
  const [filters, setFilters] = useState({ month: currentMonthKey(), company: "", rider: "" })
  const [data, setData] = useState<IncomeDashboardData | null>(null)
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [tab, setTab] = useState<"profit" | "expenses" | "categories">("profit")
  const [expense, setExpense] = useState({ categoryId: "", amount: "", allocationType: "", assignedRiderId: "", notes: "" })
  const [category, setCategory] = useState<{ id?: string; name: string; nameAr: string; defaultAmount: string; allocationType: string; description: string; isActive: boolean }>({ name: "", nameAr: "", defaultAmount: "", allocationType: "shared", description: "", isActive: true })
  const [field, setField] = useState({ name: "", nameAr: "", fieldType: "add" })
  const [count, setCount] = useState("")

  const load = useCallback(async () => {
    const r = await getIncomeDashboard(filters)
    if (r.success) { setData(r.data); setCount(r.data.driverCount.confirmed ? String(r.data.driverCount.confirmed) : "") } else setMessage({ kind: "err", text: r.error })
  }, [filters])
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t) }, [load])

  async function run(fn: () => Promise<{ success: boolean; error?: string }>, ok: string, after?: () => void) {
    setBusy(true); setMessage(null)
    const r = await fn()
    setBusy(false)
    if (!r.success) { setMessage({ kind: "err", text: r.error ?? "Failed" }); return }
    setMessage({ kind: "ok", text: ok }); after?.(); await load()
  }

  const s = data?.summary
  const rec = data?.reconciliation
  const catName = (c: { name: string; nameAr: string | null }) => (ar && c.nameAr ? c.nameAr : c.name)

  function addExpense(e: FormEvent) {
    e.preventDefault()
    void run(() => saveMonthlyExpense({ month: filters.month, categoryId: expense.categoryId, amount: Number(expense.amount), allocationType: expense.allocationType || undefined, assignedRiderId: expense.assignedRiderId || null, notes: expense.notes || null }),
      tx("Expense added", "تمت إضافة المصروف"), () => setExpense({ categoryId: "", amount: "", allocationType: "", assignedRiderId: "", notes: "" }))
  }
  function submitCategory(e: FormEvent) {
    e.preventDefault()
    void run(() => saveExpenseCategory({ ...category, defaultAmount: Number(category.defaultAmount || 0), nameAr: category.nameAr || null, description: category.description || null }),
      tx("Category saved", "تم حفظ الفئة"), () => setCategory({ name: "", nameAr: "", defaultAmount: "", allocationType: "shared", description: "", isActive: true }))
  }

  return (
    <PageShell title={tx("Income vs expenses", "الإيرادات مقابل المصروفات")} subtitle={tx("Rider income from the platform (synced from payroll runs or imported), less operating expenses allocated per rider.", "إيراد كل مندوب من المنصة (من مسيرات الرواتب أو الاستيراد) ناقص المصروفات التشغيلية الموزعة على المناديب.")}
      actions={<>
        <button className={buttonClass} onClick={() => setImportOpen(true)}>{tx("Import income sheet", "استيراد ملف الإيرادات")}</button>
        <button className={buttonClass} disabled={!data} onClick={() => data && downloadSheets(incomeExpensesSheets(data, filters.month), `income_vs_expenses_${filters.month}.xlsx`)}>{tx("Export Excel", "تصدير Excel")}</button>
      </>}>
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-4">
        <Field label={tx("Month", "الشهر")}><input type="month" className={inputClass} value={filters.month} onChange={e => e.target.value && setFilters({ ...filters, month: e.target.value })} /></Field>
        <Field label={tx("Company", "الشركة")}><select className={inputClass} value={filters.company} onChange={e => setFilters({ ...filters, company: e.target.value })}><option value="">{tx("All", "الكل")}</option>{data?.companies.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label={tx("Rider ID", "رقم المندوب")}><input className={inputClass} value={filters.rider} onChange={e => setFilters({ ...filters, rider: e.target.value.trim() })} /></Field>
        {data && data.months.length > 0 && <Field label={tx("Months with data", "أشهر بها بيانات")}><select className={inputClass} value="" onChange={e => e.target.value && setFilters({ ...filters, month: e.target.value })}><option value="">—</option>{data.months.map(m => <option key={m}>{m}</option>)}</select></Field>}
      </div>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {s && <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label={tx("Riders with income", "مناديب لهم إيراد")} value={String(s.activeDrivers)} />
        <Kpi label={tx("Total income", "إجمالي الإيرادات")} value={sar(s.totalIncome)} tone="good" />
        <Kpi label={tx("Expenses allocated", "المصروفات الموزعة")} value={sar(s.totalExpenses)} tone="bad" />
        <Kpi label={tx("Net profit", "صافي الربح")} value={sar(s.totalNetProfit)} tone={s.totalNetProfit >= 0 ? "good" : "bad"} />
        <Kpi label={tx("Avg net / rider", "متوسط الصافي / مندوب")} value={sar(s.avgNetPerDriver)} />
        <Kpi label={tx("Profitable / loss", "رابح / خاسر")} value={`${s.profitableCount} / ${s.unprofitableCount}`} />
      </div>}

      {data && <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4" onSubmit={e => { e.preventDefault(); void run(() => saveDriverCount({ month: filters.month, count: Number(count || 0), notes: null }), tx("Driver count confirmed", "تم تأكيد عدد المناديب")) }}>
        <div className="text-sm"><div className="font-medium">{tx("Active drivers used to split shared expenses", "عدد المناديب المستخدم لتقسيم المصروفات المشتركة")}: <b>{data.activeDriverCount}</b></div>
          <div className="text-xs text-muted-foreground">{tx("Source", "المصدر")}: {({ confirmed: tx("confirmed count", "عدد مؤكد"), income: tx("riders with income this month", "مناديب لهم إيراد هذا الشهر"), payroll: tx("latest payroll run", "آخر مسير رواتب"), none: tx("none", "لا يوجد") })[data.driverCount.source]}</div></div>
        <Field label={tx("Confirm count", "تأكيد العدد")}><input type="number" min="0" step="1" className={`${inputClass} w-32`} value={count} onChange={e => setCount(e.target.value)} /></Field>
        <button className={buttonClass} disabled={busy}>{tx("Save", "حفظ")}</button>
      </form>}

      {rec && (Math.abs(rec.sharedUnallocated) > 0.005 || Math.abs(rec.assignedUnmatched) > 0.005) && <Notice kind="info">
        {Math.abs(rec.sharedUnallocated) > 0.005 && <div>{tx(`Shared expenses SAR ${sar(rec.sharedEntered)} are split by ${data?.activeDriverCount} active drivers, but only ${s?.activeDrivers} riders have income rows — SAR ${sar(rec.sharedUnallocated)} is not charged to any rider in this view.`, `المصروفات المشتركة ${sar(rec.sharedEntered)} ر.س مقسومة على ${data?.activeDriverCount} مندوب، لكن ${s?.activeDrivers} فقط لديهم إيراد — ${sar(rec.sharedUnallocated)} ر.س غير محمّلة على أي مندوب في هذا العرض.`)}</div>}
        {Math.abs(rec.assignedUnmatched) > 0.005 && <div>{tx(`Assigned expenses SAR ${sar(rec.assignedUnmatched)} belong to riders with no income row in this view.`, `مصروفات مخصصة بقيمة ${sar(rec.assignedUnmatched)} ر.س لمناديب ليس لهم إيراد في هذا العرض.`)}</div>}
      </Notice>}

      <div role="tablist" className="flex flex-wrap gap-2">
        {([["profit", tx("Profit per rider", "الربح لكل مندوب")], ["expenses", `${tx("Monthly expenses", "مصروفات الشهر")} (${data?.expenses.length ?? 0})`], ["categories", tx("Categories & income fields", "الفئات وحقول الإيراد")]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? primaryButtonClass : buttonClass} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "profit" && data && <>
        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{[tx("Rider", "المندوب"), tx("Company", "الشركة"), tx("Basic", "الأساسي"), tx("Distance", "المسافة"), tx("Penalties", "الغرامات"), tx("Custom", "حقول إضافية"), tx("Income", "الإيراد"), tx("Per-driver", "لكل مندوب"), tx("Shared", "مشترك"), tx("Assigned", "مخصص"), tx("Expenses", "المصروفات"), tx("Net profit", "صافي الربح"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {data.driverResults.length === 0 && <tr><td colSpan={13} className="px-3 py-6 text-center text-muted-foreground">{tx("No income for this month. Approve or import a payroll run, or import an income sheet.", "لا توجد إيرادات لهذا الشهر. استورد مسير رواتب أو ملف إيرادات.")}</td></tr>}
            {data.driverResults.map(d => (
              <tr key={d.id} className="border-t border-border">
                <td className="px-3 py-2"><div className="font-medium">{d.driverName}</div><div className="text-xs text-muted-foreground">{d.riderId}</div></td>
                <td className="px-3 py-2">{d.companyName}</td>
                <td className="px-3 py-2 tabular-nums">{sar(d.record.basicPayment)}</td><td className="px-3 py-2 tabular-nums">{sar(d.record.distancePayment)}</td>
                <td className="px-3 py-2 tabular-nums">{sar(d.income.totalPenalties)}</td><td className="px-3 py-2 tabular-nums">{sar(d.income.customFieldsTotal)}</td>
                <td className="px-3 py-2 font-medium tabular-nums">{sar(d.income.totalIncome)}</td>
                <td className="px-3 py-2 tabular-nums">{sar(d.expenses.perDriverTotal)}</td><td className="px-3 py-2 tabular-nums">{sar(d.expenses.sharedTotal)}</td><td className="px-3 py-2 tabular-nums">{sar(d.expenses.assignedTotal)}</td>
                <td className="px-3 py-2 tabular-nums">{sar(d.expenses.totalExpenses)}</td>
                <td className={`px-3 py-2 font-semibold tabular-nums ${d.netProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{sar(d.netProfit)}</td>
                <td className="px-3 py-2"><button className={dangerButtonClass} title={tx("Delete income row", "حذف سطر الإيراد")} onClick={() => window.confirm(tx("Delete this income row?", "حذف سطر الإيراد؟")) && run(() => deleteIncomeRecords({ id: d.id }), tx("Deleted", "تم الحذف"))}>×</button></td>
              </tr>
            ))}
          </tbody>
          {s && data.driverResults.length > 0 && <tfoot><tr className="border-t-2 border-foreground font-semibold"><td className="px-3 py-2" colSpan={6}>{tx("Total", "الإجمالي")}</td><td className="px-3 py-2 tabular-nums">{sar(s.totalIncome)}</td><td colSpan={3} /><td className="px-3 py-2 tabular-nums">{sar(s.totalExpenses)}</td><td className="px-3 py-2 tabular-nums">{sar(s.totalNetProfit)}</td><td /></tr></tfoot>}
        </table></div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border p-4"><h2 className="mb-2 font-semibold">{tx("By company", "حسب الشركة")}</h2>
            <table className="w-full text-sm"><tbody>{data.incomeByCompany.map(c => <tr key={c.name} className="border-t border-border"><td className="py-1.5">{c.name} ({c.driverCount})</td><td className="py-1.5 tabular-nums">{sar(c.income)}</td><td className="py-1.5 tabular-nums">−{sar(c.expenses)}</td><td className="py-1.5 font-semibold tabular-nums">{sar(c.net)}</td>
              <td className="py-1.5"><button className={dangerButtonClass} onClick={() => window.confirm(tx(`Delete all ${c.name} income rows for ${filters.month}?`, `حذف جميع إيرادات ${c.name} لشهر ${filters.month}؟`)) && run(() => deleteIncomeRecords({ month: filters.month, companyName: c.name }), tx("Deleted", "تم الحذف"))}>{tx("Delete", "حذف")}</button></td></tr>)}</tbody></table></div>
          <div className="rounded-xl border border-border p-4"><h2 className="mb-2 font-semibold">{tx("Expenses entered", "المصروفات المدخلة")}</h2>
            <table className="w-full text-sm"><tbody>
              {data.expenseByCategory.map(c => <tr key={c.name} className="border-t border-border"><td className="py-1.5">{c.name}</td><td className="py-1.5 text-end tabular-nums">{sar(c.amount)}</td></tr>)}
              <tr className="border-t border-border text-muted-foreground"><td className="py-1.5">{tx("Per-driver × riders", "لكل مندوب × المناديب")}</td><td className="py-1.5 text-end tabular-nums">{sar(rec?.perDriverCharged)}</td></tr>
              <tr className="border-t border-border text-muted-foreground"><td className="py-1.5">{tx("Shared (allocated / entered)", "مشترك (موزع / مدخل)")}</td><td className="py-1.5 text-end tabular-nums">{sar(rec?.sharedAllocated)} / {sar(rec?.sharedEntered)}</td></tr>
            </tbody></table></div>
        </div>
      </>}

      {tab === "expenses" && data && <>
        <form onSubmit={addExpense} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-5">
          <Field label={tx("Category", "الفئة")}><select required className={inputClass} value={expense.categoryId} onChange={e => { const c = data.categories.find(x => x.id === e.target.value); setExpense({ ...expense, categoryId: e.target.value, allocationType: c?.allocationType ?? "", amount: expense.amount || (c?.defaultAmount ? String(c.defaultAmount) : "") }) }}>
            <option value="">—</option>{data.categories.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{catName(c)}</option>)}</select></Field>
          <Field label={tx("Amount (SAR)", "المبلغ (ر.س)")}><input required type="number" min="0.01" step="0.01" className={inputClass} value={expense.amount} onChange={e => setExpense({ ...expense, amount: e.target.value })} /></Field>
          <Field label={tx("Allocation", "طريقة التوزيع")}><select className={inputClass} value={expense.allocationType} onChange={e => setExpense({ ...expense, allocationType: e.target.value })}><option value="">{tx("Category default", "افتراضي الفئة")}</option>{Object.entries(ALLOC).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</select></Field>
          {expense.allocationType === "assigned" && <Field label={tx("Rider ID", "رقم المندوب")}><input required className={inputClass} value={expense.assignedRiderId} onChange={e => setExpense({ ...expense, assignedRiderId: e.target.value })} /></Field>}
          <Field label={tx("Notes", "ملاحظات")}><input maxLength={500} className={inputClass} value={expense.notes} onChange={e => setExpense({ ...expense, notes: e.target.value })} /></Field>
          <div className="flex items-end gap-2 md:col-span-5"><button className={primaryButtonClass} disabled={busy}>{tx("Add expense", "إضافة مصروف")}</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => run(() => applyDefaultExpenses({ month: filters.month }), tx("Default amounts added for categories not yet entered", "أضيفت المبالغ الافتراضية للفئات غير المدخلة"))}>{tx("Add category defaults", "إضافة المبالغ الافتراضية")}</button></div>
          <p className="text-xs text-muted-foreground md:col-span-5">{tx("Per driver: the amount is charged to EVERY rider (e.g. iqama per rider). Shared: the total is divided by the active driver count (e.g. office rent). Assigned: charged to one rider only.", "لكل مندوب: يُحمّل المبلغ على كل مندوب (مثل الإقامة). مشترك: يُقسم الإجمالي على عدد المناديب النشطين (مثل إيجار المكتب). مخصص: يُحمّل على مندوب واحد.")}</p>
        </form>
        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{[tx("Category", "الفئة"), tx("Allocation", "التوزيع"), tx("Rider", "المندوب"), tx("Amount", "المبلغ"), tx("Notes", "ملاحظات"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>{data.expenses.map(x => <tr key={x.id} className="border-t border-border"><td className="px-3 py-2">{x.categoryName}</td><td className="px-3 py-2">{ar ? ALLOC[x.allocationType as keyof typeof ALLOC]?.ar : ALLOC[x.allocationType as keyof typeof ALLOC]?.en}</td><td className="px-3 py-2">{x.assignedRiderId ?? "—"}</td>
            <td className="px-3 py-2 tabular-nums">{sar(x.amount)}</td><td className="px-3 py-2 text-xs text-muted-foreground">{x.notes}</td>
            <td className="px-3 py-2"><button className={dangerButtonClass} onClick={() => window.confirm(tx("Delete this expense?", "حذف هذا المصروف؟")) && run(() => deleteMonthlyExpense(x.id), tx("Deleted", "تم الحذف"))}>{tx("Delete", "حذف")}</button></td></tr>)}</tbody>
        </table></div>
      </>}

      {tab === "categories" && data && <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <form onSubmit={submitCategory} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-2">
            <Field label={tx("Category name", "اسم الفئة")}><input required maxLength={120} className={inputClass} value={category.name} onChange={e => setCategory({ ...category, name: e.target.value })} /></Field>
            <Field label={tx("Arabic name", "الاسم بالعربية")}><input maxLength={120} className={inputClass} value={category.nameAr} onChange={e => setCategory({ ...category, nameAr: e.target.value })} /></Field>
            <Field label={tx("Default monthly amount", "المبلغ الشهري الافتراضي")}><input type="number" min="0" step="0.01" className={inputClass} value={category.defaultAmount} onChange={e => setCategory({ ...category, defaultAmount: e.target.value })} /></Field>
            <Field label={tx("Allocation", "التوزيع")}><select className={inputClass} value={category.allocationType} onChange={e => setCategory({ ...category, allocationType: e.target.value })}>{Object.entries(ALLOC).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={category.isActive} onChange={e => setCategory({ ...category, isActive: e.target.checked })} />{tx("Active", "نشط")}</label>
            <div className="flex gap-2"><button className={primaryButtonClass} disabled={busy}>{category.id ? tx("Update", "تحديث") : tx("Add category", "إضافة فئة")}</button>{category.id && <button type="button" className={buttonClass} onClick={() => setCategory({ name: "", nameAr: "", defaultAmount: "", allocationType: "shared", description: "", isActive: true })}>{tx("New", "جديد")}</button>}</div>
          </form>
          <table className="w-full rounded-xl border border-border text-sm"><tbody>{data.categories.map(c => (
            <tr key={c.id} className="border-t border-border"><td className="px-3 py-2">{catName(c)}{!c.isActive && <span className="ms-2 text-xs text-muted-foreground">({tx("inactive", "غير نشط")})</span>}</td><td className="px-3 py-2 text-xs">{ar ? ALLOC[c.allocationType as keyof typeof ALLOC]?.ar : ALLOC[c.allocationType as keyof typeof ALLOC]?.en}</td><td className="px-3 py-2 tabular-nums">{sar(c.defaultAmount)}</td>
              <td className="px-3 py-2"><div className="flex gap-2"><button className={buttonClass} onClick={() => setCategory({ id: c.id, name: c.name, nameAr: c.nameAr ?? "", defaultAmount: String(c.defaultAmount), allocationType: c.allocationType, description: c.description ?? "", isActive: c.isActive })}>{tx("Edit", "تعديل")}</button>
                <button className={dangerButtonClass} onClick={() => window.confirm(tx("Delete this category?", "حذف هذه الفئة؟")) && run(() => deleteExpenseCategory(c.id), tx("Deleted", "تم الحذف"))}>{tx("Delete", "حذف")}</button></div></td></tr>
          ))}</tbody></table>
        </div>
        <div className="space-y-3">
          <form onSubmit={e => { e.preventDefault(); void run(() => saveCustomIncomeField({ ...field, nameAr: field.nameAr || null }), tx("Field saved", "تم حفظ الحقل"), () => setField({ name: "", nameAr: "", fieldType: "add" })) }} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-3">
            <Field label={tx("Custom income field", "حقل إيراد إضافي")}><input required maxLength={120} className={inputClass} value={field.name} onChange={e => setField({ ...field, name: e.target.value })} /></Field>
            <Field label={tx("Arabic name", "الاسم بالعربية")}><input maxLength={120} className={inputClass} value={field.nameAr} onChange={e => setField({ ...field, nameAr: e.target.value })} /></Field>
            <Field label={tx("Effect", "الأثر")}><select className={inputClass} value={field.fieldType} onChange={e => setField({ ...field, fieldType: e.target.value })}><option value="add">{tx("Adds to income", "يضاف للإيراد")}</option><option value="deduct">{tx("Deducts from income", "يخصم من الإيراد")}</option></select></Field>
            <div className="md:col-span-3"><button className={primaryButtonClass} disabled={busy}>{tx("Add field", "إضافة حقل")}</button></div>
            <p className="text-xs text-muted-foreground md:col-span-3">{tx("Custom fields can be mapped to columns when importing an income sheet (e.g. tips, incentives, equipment charges).", "يمكن ربط الحقول الإضافية بأعمدة عند استيراد ملف الإيرادات (مثل الإكراميات والحوافز ورسوم المعدات).")}</p>
          </form>
          <table className="w-full rounded-xl border border-border text-sm"><tbody>{data.customFields.map(f => <tr key={f.id} className="border-t border-border"><td className="px-3 py-2">{ar && f.nameAr ? f.nameAr : f.name}</td><td className="px-3 py-2 text-xs">{f.fieldType === "add" ? tx("adds", "يضاف") : tx("deducts", "يخصم")}</td></tr>)}</tbody></table>
        </div>
      </div>}

      {importOpen && <IncomeImportDialog defaultMonth={filters.month} customFields={data?.customFields.filter(f => f.isActive) ?? []} onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); void load() }} />}
    </PageShell>
  )
}
