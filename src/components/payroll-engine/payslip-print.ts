// Printable payslips (one rider per page) opened in a new window.
import { payslipBreakdown } from "@/lib/payroll-engine/payslip"
import type { DriverResultCalc } from "@/lib/payroll-engine/salary-engine"

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export interface PrintRow { result: DriverResultCalc; bank: { beneficiaryName?: string; iban?: string; bankName?: string } | null }

export function payslipsHtml(rows: readonly PrintRow[], meta: { month: string; platform: string; status: string; company?: string }, ar: boolean): string {
  const t = (en: string, a: string) => esc(ar ? a : en)
  const pages = rows.map(({ result: r, bank }) => {
    const p = payslipBreakdown(r)
    const line = (l: { en: string; ar: string; amount: number }) => `<tr><td>${esc(ar ? l.ar : l.en)}</td><td class="n">${money(l.amount)}</td></tr>`
    return `<section class="slip">
      <header><div><h1>${t("Payslip", "قسيمة راتب")}</h1><div class="muted">${esc(meta.company ?? "")}</div></div>
      <div class="meta"><div>${t("Month", "الشهر")}: <b>${esc(meta.month)}</b></div><div>${t("Platform", "المنصة")}: <b>${esc(meta.platform)}</b></div>${meta.status !== "approved" ? `<div class="draft">${t("DRAFT — not approved", "مسودة — غير معتمدة")}</div>` : ""}</div></header>
      <table class="info"><tr><td>${t("Rider", "المندوب")}</td><td><b>${esc(r.driverName)}</b> (${esc(r.riderId)})</td><td>${t("Contract", "العقد")}</td><td>${esc(r.contractName)}</td></tr>
      <tr><td>${t("Completed orders", "الطلبات المنجزة")}</td><td>${esc(r.completedOrders)}</td><td>${t("Target orders", "الطلبات المستهدفة")}</td><td>${esc(Math.round(r.selectedTargetThreshold * 100) / 100)}</td></tr>
      <tr><td>${t("Working days", "أيام العمل")}</td><td>${esc(r.actualWorkingDays)}</td><td>${t("Rate per order", "سعر الطلب")}</td><td>${money(r.appliedSalaryPerOrder)}</td></tr></table>
      <div class="cols"><table><thead><tr><th>${t("Earnings", "الاستحقاقات")}</th><th class="n">SAR</th></tr></thead><tbody>${p.earnings.map(line).join("")}</tbody>
      <tfoot><tr><td>${t("Gross salary", "إجمالي الراتب")}</td><td class="n">${money(p.gross)}</td></tr></tfoot></table>
      <table><thead><tr><th>${t("Deductions", "الاستقطاعات")}</th><th class="n">SAR</th></tr></thead><tbody>${p.deductions.map(line).join("") || `<tr><td colspan="2" class="muted">—</td></tr>`}</tbody>
      <tfoot><tr><td>${t("Total deductions", "إجمالي الاستقطاعات")}</td><td class="n">${money(p.totalDeductions)}</td></tr></tfoot></table></div>
      <div class="net">${t("Net salary", "صافي الراتب")}: <b>SAR ${money(Math.round((p.net + Number.EPSILON) * 100) / 100)}</b></div>
      ${bank?.iban ? `<div class="muted">${t("Paid to", "يُحوَّل إلى")}: ${esc(bank.beneficiaryName || r.driverName)} · ${esc(bank.bankName ?? "")} · ${esc(bank.iban)}</div>` : ""}
      <footer><div>${t("Employee signature", "توقيع الموظف")}: ____________</div><div>${t("Approved by", "اعتماد")}: ____________</div></footer>
    </section>`
  })
  return `<!doctype html><html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${t("Payslips", "قسائم الرواتب")} — ${esc(meta.month)}</title>
  <style>body{font-family:Arial,"Noto Sans Arabic",sans-serif;color:#111;margin:0}.slip{padding:28px 36px;page-break-after:always}.slip:last-child{page-break-after:auto}
  header{display:flex;justify-content:space-between;border-bottom:2px solid #1e3a8a;padding-bottom:8px;margin-bottom:12px}h1{margin:0;color:#1e3a8a;font-size:22px}.muted{color:#666;font-size:12px}
  .meta{font-size:13px;text-align:end}.draft{color:#b45309;font-weight:bold}table{width:100%;border-collapse:collapse;font-size:12.5px}td,th{padding:5px 6px;border-bottom:1px solid #e5e7eb;text-align:start}
  .n{text-align:end;font-variant-numeric:tabular-nums;white-space:nowrap}.info td:nth-child(odd){color:#555;width:18%}.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px}
  thead th{background:#f3f4f6}tfoot td{font-weight:bold;border-top:2px solid #111}.net{margin:16px 0 8px;padding:10px;background:#ecfdf5;border:1px solid #10b981;font-size:16px;text-align:center}
  footer{display:flex;justify-content:space-between;margin-top:36px;font-size:12px}@media print{.slip{padding:12mm}}</style></head><body>${pages.join("")}</body></html>`
}

export function openPayslips(rows: readonly PrintRow[], meta: { month: string; platform: string; status: string; company?: string }, ar: boolean): boolean {
  const w = window.open("", "_blank")
  if (!w) return false
  w.document.open()
  w.document.write(payslipsHtml(rows, meta, ar))
  w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 400)
  return true
}
