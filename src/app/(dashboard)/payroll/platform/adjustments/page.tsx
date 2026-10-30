"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { deletePayrollRecord, savePayrollAdjustment, savePayrollItem, savePayrollTrafficFine } from "@/lib/payroll-engine/server/admin-actions"
import { getPayrollAdjustments, type AdjustmentsData } from "@/lib/payroll-engine/server/read-actions"
import { Field, Notice, PageShell, StatusBadge, buttonClass, dangerButtonClass, inputClass, primaryButtonClass, sar, useLang } from "@/components/payroll-engine/shared"

type Item = AdjustmentsData["items"][number]
type Adj = AdjustmentsData["adjustments"][number]
type Fine = AdjustmentsData["traffic"][number]

const emptyItem = { kind: "bonus" as "bonus" | "deduction", name: "", nameAr: "", amount: "", description: "", status: "active", applyToAll: true, targetRiderIds: "", installmentEnabled: false, installmentMonthlyAmount: "" }
const emptyAdj = { riderId: "", title: "", titleAr: "", amount: "", adjustmentType: "deduction" as "bonus" | "deduction", category: "custom", status: "active", notes: "" }
const emptyFine = { riderId: "", ticketDate: new Date().toISOString().slice(0, 10), ticketNumber: "", violationType: "", amount: "", status: "approved", notes: "", installmentEnabled: false, installmentMonthlyAmount: "" }

export default function PlatformPayrollAdjustmentsPage() {
  const { ar, tx } = useLang()
  const [data, setData] = useState<AdjustmentsData | null>(null)
  const [tab, setTab] = useState<"items" | "manual" | "traffic">("items")
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [item, setItem] = useState<typeof emptyItem & { id?: string }>(emptyItem)
  const [adj, setAdj] = useState<typeof emptyAdj & { id?: string }>(emptyAdj)
  const [fine, setFine] = useState<typeof emptyFine & { id?: string }>(emptyFine)

  const load = useCallback(async () => {
    const r = await getPayrollAdjustments()
    if (r.success) setData(r.data); else setMessage({ kind: "err", text: r.error })
  }, [])
  useEffect(() => { void load() }, [load])

  async function run(fn: () => Promise<{ success: boolean; error?: string; data?: unknown }>, ok: string, after?: () => void) {
    setBusy(true); setMessage(null)
    const r = await fn()
    setBusy(false)
    if (!r.success) { setMessage({ kind: "err", text: r.error ?? "Failed" }); return }
    const n = Number((r.data as { refreshedRuns?: number } | undefined)?.refreshedRuns ?? 0)
    const synced = n > 0 ? " " + tx(`Payslips updated in ${n} draft payroll run${n === 1 ? "" : "s"}.`, `تم تحديث قسائم الرواتب في ${n} مسودة.`) : ""
    setMessage({ kind: "ok", text: ok + synced }); after?.(); await load()
  }
  const saved = tx("Saved.", "تم الحفظ.")
  const remove = (kind: "item" | "adjustment" | "traffic", id: string) => {
    if (window.confirm(tx("Delete this record?", "حذف هذا السجل؟"))) void run(() => deletePayrollRecord({ kind, id }), tx("Deleted", "تم الحذف"))
  }
  const riderOptions = <datalist id="riders">{data?.riders.map(r => <option key={r.riderId} value={r.riderId}>{r.name}</option>)}</datalist>

  function submitItem(e: FormEvent) {
    e.preventDefault()
    void run(() => savePayrollItem({ ...item, amount: Number(item.amount), installmentMonthlyAmount: Number(item.installmentMonthlyAmount || 0),
      targetRiderIds: item.targetRiderIds.split(/[\s,]+/).filter(Boolean), nameAr: item.nameAr || null, description: item.description || null }), saved, () => setItem(emptyItem))
  }
  function submitAdj(e: FormEvent) {
    e.preventDefault()
    void run(() => savePayrollAdjustment({ ...adj, amount: Number(adj.amount), titleAr: adj.titleAr || null, notes: adj.notes || null }), saved, () => setAdj(emptyAdj))
  }
  function submitFine(e: FormEvent) {
    e.preventDefault()
    void run(() => savePayrollTrafficFine({ ...fine, amount: Number(fine.amount), installmentMonthlyAmount: Number(fine.installmentMonthlyAmount || 0), ticketNumber: fine.ticketNumber || null, notes: fine.notes || null }), saved, () => setFine(emptyFine))
  }

  const editItem = (i: Item) => setItem({ id: i.id, kind: i.kind, name: i.name, nameAr: i.nameAr ?? "", amount: String(i.amount), description: i.description ?? "", status: i.status, applyToAll: i.applyToAll, targetRiderIds: i.targetRiderIds.join(", "), installmentEnabled: i.installmentEnabled, installmentMonthlyAmount: String(i.installmentMonthlyAmount || "") })
  const editAdj = (a: Adj) => setAdj({ id: a.id, riderId: a.riderId, title: a.title, titleAr: a.titleAr ?? "", amount: String(a.amount), adjustmentType: a.adjustmentType, category: a.category, status: a.status, notes: a.notes ?? "" })
  const editFine = (f: Fine) => setFine({ id: f.id, riderId: f.riderId, ticketDate: f.ticketDate, ticketNumber: f.ticketNumber ?? "", violationType: f.violationType, amount: String(f.amount), status: f.status, notes: f.notes ?? "", installmentEnabled: f.installmentEnabled, installmentMonthlyAmount: String(f.installmentMonthlyAmount || "") })

  const th = (labels: string[]) => <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{labels.map((l, i) => <th key={i} className="px-3 py-2 text-start font-medium">{l}</th>)}</tr></thead>
  const installment = (x: { installmentEnabled: boolean; installmentMonthlyAmount: number; installmentTotalPaid: number; installmentStatus: string; amount: number }) =>
    x.installmentEnabled ? <span className="text-xs">{sar(x.installmentMonthlyAmount)}/{tx("mo", "شهر")} · {tx("paid", "مدفوع")} {sar(x.installmentTotalPaid)} / {sar(x.amount)} <StatusBadge status={x.installmentStatus} /></span> : "—"

  return (
    <PageShell title={tx("Bonuses, deductions & traffic fines", "المكافآت والخصومات والمخالفات")} subtitle={tx("Recurring items apply every month while active; manual adjustments apply until marked paid; approved traffic fines are deducted in full or by monthly installment.", "البنود المتكررة تُطبق شهرياً ما دامت نشطة؛ التعديلات اليدوية تُطبق حتى تُعلَّم كمدفوعة؛ المخالفات المعتمدة تُخصم كاملة أو بأقساط شهرية.")}>
      {riderOptions}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <div role="tablist" className="flex flex-wrap gap-2">
        {([["items", tx("Recurring items", "بنود متكررة")], ["manual", tx("Manual adjustments", "تعديلات يدوية")], ["traffic", tx("Traffic fines", "المخالفات المرورية")]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? primaryButtonClass : buttonClass} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "items" && <>
        <form onSubmit={submitItem} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-4">
          <Field label={tx("Type", "النوع")}><select className={inputClass} value={item.kind} onChange={e => setItem({ ...item, kind: e.target.value as "bonus" | "deduction", installmentEnabled: e.target.value === "deduction" && item.installmentEnabled })}><option value="bonus">{tx("Bonus", "مكافأة")}</option><option value="deduction">{tx("Deduction", "خصم")}</option></select></Field>
          <Field label={tx("Name", "الاسم")}><input required maxLength={120} className={inputClass} value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} /></Field>
          <Field label={tx("Arabic name", "الاسم بالعربية")}><input maxLength={120} className={inputClass} value={item.nameAr} onChange={e => setItem({ ...item, nameAr: e.target.value })} /></Field>
          <Field label={tx("Amount (SAR)", "المبلغ (ر.س)")}><input required type="number" min="0" step="0.01" className={inputClass} value={item.amount} onChange={e => setItem({ ...item, amount: e.target.value })} /></Field>
          <Field label={tx("Applies to", "يُطبق على")}><select className={inputClass} value={item.applyToAll ? "all" : "some"} onChange={e => setItem({ ...item, applyToAll: e.target.value === "all" })}><option value="all">{tx("All riders", "جميع المناديب")}</option><option value="some">{tx("Selected rider IDs", "مناديب محددون")}</option></select></Field>
          {!item.applyToAll && <Field label={tx("Rider IDs (comma separated)", "أرقام المناديب (مفصولة بفاصلة)")}><input required className={inputClass} value={item.targetRiderIds} onChange={e => setItem({ ...item, targetRiderIds: e.target.value })} /></Field>}
          <Field label={tx("Status", "الحالة")}><select className={inputClass} value={item.status} onChange={e => setItem({ ...item, status: e.target.value })}><option value="active">{tx("Active", "نشط")}</option><option value="inactive">{tx("Inactive", "غير نشط")}</option></select></Field>
          {item.kind === "deduction" && <label className="flex items-center gap-2 self-end text-sm font-medium"><input type="checkbox" checked={item.installmentEnabled} onChange={e => setItem({ ...item, installmentEnabled: e.target.checked })} />{tx("Deduct in monthly installments", "خصم بأقساط شهرية")}</label>}
          {item.installmentEnabled && <Field label={tx("Monthly installment (SAR)", "القسط الشهري (ر.س)")}><input required type="number" min="0.01" step="0.01" className={inputClass} value={item.installmentMonthlyAmount} onChange={e => setItem({ ...item, installmentMonthlyAmount: e.target.value })} /></Field>}
          <Field label={tx("Description", "الوصف")}><input maxLength={500} className={inputClass} value={item.description} onChange={e => setItem({ ...item, description: e.target.value })} /></Field>
          <div className="flex items-end gap-2 md:col-span-4"><button className={primaryButtonClass} disabled={busy}>{item.id ? tx("Update item", "تحديث البند") : tx("Add item", "إضافة بند")}</button>{item.id && <button type="button" className={buttonClass} onClick={() => setItem(emptyItem)}>{tx("New", "جديد")}</button>}</div>
        </form>
        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm">
          {th([tx("Item", "البند"), tx("Type", "النوع"), tx("Amount", "المبلغ"), tx("Applies to", "يُطبق على"), tx("Installments", "الأقساط"), tx("Status", "الحالة"), ""])}
          <tbody>{data?.items.map(i => (
            <tr key={i.id} className="border-t border-border"><td className="px-3 py-2 font-medium">{ar && i.nameAr ? i.nameAr : i.name}</td><td className="px-3 py-2">{i.kind === "bonus" ? tx("Bonus", "مكافأة") : tx("Deduction", "خصم")}</td>
              <td className="px-3 py-2 tabular-nums">{sar(i.amount)}</td><td className="px-3 py-2 text-xs">{i.applyToAll ? tx("All riders", "جميع المناديب") : i.targetRiderIds.join(", ")}</td>
              <td className="px-3 py-2">{installment(i)}</td><td className="px-3 py-2"><StatusBadge status={i.status} /></td>
              <td className="px-3 py-2"><div className="flex gap-2"><button className={buttonClass} onClick={() => editItem(i)}>{tx("Edit", "تعديل")}</button><button className={dangerButtonClass} onClick={() => remove("item", i.id)}>{tx("Delete", "حذف")}</button></div></td></tr>
          ))}</tbody></table></div>
      </>}

      {tab === "manual" && <>
        <form onSubmit={submitAdj} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-4">
          <Field label={tx("Rider ID", "رقم المندوب")}><input required list="riders" maxLength={64} className={inputClass} value={adj.riderId} onChange={e => setAdj({ ...adj, riderId: e.target.value })} /></Field>
          <Field label={tx("Type", "النوع")}><select className={inputClass} value={adj.adjustmentType} onChange={e => setAdj({ ...adj, adjustmentType: e.target.value as "bonus" | "deduction" })}><option value="deduction">{tx("Deduction", "خصم")}</option><option value="bonus">{tx("Bonus", "مكافأة")}</option></select></Field>
          <Field label={tx("Title", "العنوان")}><input required maxLength={160} className={inputClass} value={adj.title} onChange={e => setAdj({ ...adj, title: e.target.value })} /></Field>
          <Field label={tx("Arabic title", "العنوان بالعربية")}><input maxLength={160} className={inputClass} value={adj.titleAr} onChange={e => setAdj({ ...adj, titleAr: e.target.value })} /></Field>
          <Field label={tx("Amount (SAR)", "المبلغ (ر.س)")}><input required type="number" min="0.01" step="0.01" className={inputClass} value={adj.amount} onChange={e => setAdj({ ...adj, amount: e.target.value })} /></Field>
          <Field label={tx("Category", "الفئة")}><select className={inputClass} value={adj.category} onChange={e => setAdj({ ...adj, category: e.target.value })}><option value="custom">{tx("General", "عام")}</option><option value="license">{tx("License", "رخصة")}</option><option value="custom_bonus">{tx("Custom bonus", "مكافأة خاصة")}</option><option value="custom_deduction">{tx("Custom deduction", "خصم خاص")}</option></select></Field>
          <Field label={tx("Status", "الحالة")}><select className={inputClass} value={adj.status} onChange={e => setAdj({ ...adj, status: e.target.value })}><option value="active">{tx("Active (applies to payroll)", "نشط (يُطبق على الرواتب)")}</option><option value="paid">{tx("Paid / settled", "مدفوع / مسوّى")}</option><option value="inactive">{tx("Inactive", "غير نشط")}</option></select></Field>
          <Field label={tx("Notes", "ملاحظات")}><input maxLength={500} className={inputClass} value={adj.notes} onChange={e => setAdj({ ...adj, notes: e.target.value })} /></Field>
          <div className="flex items-end gap-2 md:col-span-4"><button className={primaryButtonClass} disabled={busy}>{adj.id ? tx("Update", "تحديث") : tx("Add adjustment", "إضافة تعديل")}</button>{adj.id && <button type="button" className={buttonClass} onClick={() => setAdj(emptyAdj)}>{tx("New", "جديد")}</button>}</div>
          <p className="text-xs text-muted-foreground md:col-span-4">{tx("Active adjustments are included in every payroll calculation until you mark them Paid — mark them Paid after the month is approved.", "التعديلات النشطة تدخل في كل احتساب حتى تُعلَّم كمدفوعة — علّمها كمدفوعة بعد اعتماد الشهر.")}</p>
        </form>
        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm">
          {th([tx("Rider", "المندوب"), tx("Title", "العنوان"), tx("Type", "النوع"), tx("Amount", "المبلغ"), tx("Status", "الحالة"), ""])}
          <tbody>{data?.adjustments.map(a => (
            <tr key={a.id} className="border-t border-border"><td className="px-3 py-2"><div>{a.driverName || "—"}</div><div className="text-xs text-muted-foreground">{a.riderId}</div></td>
              <td className="px-3 py-2">{ar && a.titleAr ? a.titleAr : a.title}</td><td className="px-3 py-2">{a.adjustmentType === "bonus" ? tx("Bonus", "مكافأة") : tx("Deduction", "خصم")}</td>
              <td className="px-3 py-2 tabular-nums">{sar(a.amount)}</td><td className="px-3 py-2"><StatusBadge status={a.status} /></td>
              <td className="px-3 py-2"><div className="flex gap-2">{a.status === "active" && <button className={buttonClass} onClick={() => run(() => savePayrollAdjustment({ ...a, status: "paid" }), tx("Marked paid", "تم التعليم كمدفوع"))}>{tx("Mark paid", "تعليم كمدفوع")}</button>}<button className={buttonClass} onClick={() => editAdj(a)}>{tx("Edit", "تعديل")}</button><button className={dangerButtonClass} onClick={() => remove("adjustment", a.id)}>{tx("Delete", "حذف")}</button></div></td></tr>
          ))}</tbody></table></div>
      </>}

      {tab === "traffic" && <>
        <form onSubmit={submitFine} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-4">
          <Field label={tx("Rider ID", "رقم المندوب")}><input required list="riders" maxLength={64} className={inputClass} value={fine.riderId} onChange={e => setFine({ ...fine, riderId: e.target.value })} /></Field>
          <Field label={tx("Ticket date", "تاريخ المخالفة")}><input required type="date" className={inputClass} value={fine.ticketDate} onChange={e => setFine({ ...fine, ticketDate: e.target.value })} /></Field>
          <Field label={tx("Ticket number", "رقم المخالفة")}><input maxLength={80} className={inputClass} value={fine.ticketNumber} onChange={e => setFine({ ...fine, ticketNumber: e.target.value })} /></Field>
          <Field label={tx("Violation", "نوع المخالفة")}><input required maxLength={160} className={inputClass} value={fine.violationType} onChange={e => setFine({ ...fine, violationType: e.target.value })} /></Field>
          <Field label={tx("Amount (SAR)", "المبلغ (ر.س)")}><input required type="number" min="0.01" step="0.01" className={inputClass} value={fine.amount} onChange={e => setFine({ ...fine, amount: e.target.value })} /></Field>
          <Field label={tx("Status", "الحالة")}><select className={inputClass} value={fine.status} onChange={e => setFine({ ...fine, status: e.target.value })}><option value="approved">{tx("Approved (deduct)", "معتمدة (تُخصم)")}</option><option value="pending">{tx("Pending", "قيد الانتظار")}</option><option value="rejected">{tx("Rejected", "مرفوضة")}</option><option value="paid">{tx("Paid", "مدفوعة")}</option></select></Field>
          <label className="flex items-center gap-2 self-end text-sm font-medium"><input type="checkbox" checked={fine.installmentEnabled} onChange={e => setFine({ ...fine, installmentEnabled: e.target.checked })} />{tx("Monthly installments", "أقساط شهرية")}</label>
          {fine.installmentEnabled && <Field label={tx("Monthly installment (SAR)", "القسط الشهري (ر.س)")}><input required type="number" min="0.01" step="0.01" className={inputClass} value={fine.installmentMonthlyAmount} onChange={e => setFine({ ...fine, installmentMonthlyAmount: e.target.value })} /></Field>}
          <Field label={tx("Notes", "ملاحظات")}><input maxLength={500} className={inputClass} value={fine.notes} onChange={e => setFine({ ...fine, notes: e.target.value })} /></Field>
          <div className="flex items-end gap-2 md:col-span-4"><button className={primaryButtonClass} disabled={busy}>{fine.id ? tx("Update", "تحديث") : tx("Add fine", "إضافة مخالفة")}</button>{fine.id && <button type="button" className={buttonClass} onClick={() => setFine(emptyFine)}>{tx("New", "جديد")}</button>}</div>
          <p className="text-xs text-muted-foreground md:col-span-4">{tx("Approved fines without installments are deducted in full every run until marked Paid; installment fines stop automatically when fully paid.", "المخالفات المعتمدة بدون أقساط تُخصم كاملة في كل مسير حتى تُعلَّم كمدفوعة؛ المخالفات بالأقساط تتوقف تلقائياً عند السداد الكامل.")}</p>
        </form>
        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm">
          {th([tx("Rider", "المندوب"), tx("Date", "التاريخ"), tx("Violation", "المخالفة"), tx("Amount", "المبلغ"), tx("Installments", "الأقساط"), tx("Status", "الحالة"), ""])}
          <tbody>{data?.traffic.map(f => (
            <tr key={f.id} className="border-t border-border"><td className="px-3 py-2"><div>{f.driverName || "—"}</div><div className="text-xs text-muted-foreground">{f.riderId}</div></td>
              <td className="px-3 py-2">{f.ticketDate}</td><td className="px-3 py-2">{f.violationType}{f.ticketNumber && <div className="text-xs text-muted-foreground">#{f.ticketNumber}</div>}</td>
              <td className="px-3 py-2 tabular-nums">{sar(f.amount)}</td><td className="px-3 py-2">{installment(f)}</td><td className="px-3 py-2"><StatusBadge status={f.status} /></td>
              <td className="px-3 py-2"><div className="flex gap-2"><button className={buttonClass} onClick={() => editFine(f)}>{tx("Edit", "تعديل")}</button><button className={dangerButtonClass} onClick={() => remove("traffic", f.id)}>{tx("Delete", "حذف")}</button></div></td></tr>
          ))}</tbody></table></div>
      </>}
    </PageShell>
  )
}
