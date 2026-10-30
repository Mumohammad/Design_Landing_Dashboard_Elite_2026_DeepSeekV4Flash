// Printable payslips (one rider per A4 page) opened in a new window.
// Layout follows the owner's payroll reference (Payroll-Sys-2026 "salary
// statement"): branded gradient header with the tenant logo and company
// details, rider strip, performance band, working summary / earnings cards,
// deductions card, net-salary hero and signature footer. Bilingual labels.
import { payslipBreakdown } from "@/lib/payroll-engine/payslip"
import type { DriverResultCalc } from "@/lib/payroll-engine/salary-engine"

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round((n + Number.EPSILON) * 100) / 100)
const num = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n || 0)

export interface PrintRow { result: DriverResultCalc; bank: { beneficiaryName?: string; iban?: string; bankName?: string } | null }

/** Tenant details printed on every payslip (Settings → Company). */
export interface PayslipCompany {
  nameAr: string; nameEn: string; legalName?: string | null; crNumber?: string | null; vatNumber?: string | null
  address?: string | null; district?: string | null; city?: string | null; postalCode?: string | null; buildingNumber?: string | null
  phone?: string | null; email?: string | null; logoDataUrl?: string | null
}
export interface PayslipMeta { month: string; platform: string; status: string; company?: PayslipCompany | null; generatedAt?: Date }

const BAND: Record<string, { en: string; ar: string; tone: string }> = {
  top: { en: "Top performer", ar: "أفضل أداء", tone: "#047857" },
  high: { en: "High", ar: "مرتفع", tone: "#0f766e" },
  average: { en: "Average", ar: "متوسط", tone: "#b45309" },
  low: { en: "Low", ar: "منخفض", tone: "#c2410c" },
  bottom: { en: "Needs improvement", ar: "يحتاج تحسين", tone: "#b91c1c" },
}

const maskIban = (iban: string) => iban.length > 8 ? `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}` : iban

export function payslipsHtml(rows: readonly PrintRow[], meta: PayslipMeta, ar: boolean): string {
  const c = meta.company
  const generated = (meta.generatedAt ?? new Date()).toLocaleDateString("en-GB")
  const bi = (en: string, a: string) => ar
    ? `<bdi class="pri" dir="rtl">${esc(a)}</bdi>&ensp;<bdi class="sec" dir="ltr">${esc(en)}</bdi>`
    : `<bdi class="pri" dir="ltr">${esc(en)}</bdi>&ensp;<bdi class="sec" dir="rtl">${esc(a)}</bdi>`
  const primaryName = ar ? (c?.nameAr || c?.nameEn || "") : (c?.nameEn || c?.nameAr || "")
  const secondaryName = ar ? c?.nameEn : c?.nameAr
  const address = [c?.buildingNumber, c?.address, c?.district, c?.city, c?.postalCode].filter(Boolean).join("، ")
  const ids = [c?.crNumber ? `CR ${c.crNumber}` : "", c?.vatNumber ? `VAT ${c.vatNumber}` : ""].filter(Boolean).join(" · ")
  const contact = [c?.phone, c?.email].filter(Boolean).join(" · ")
  const pages = rows.map(({ result: r, bank }) => {
    const p = payslipBreakdown(r)
    const attain = r.selectedTargetThreshold > 0 ? (r.completedOrders / r.selectedTargetThreshold) * 100 : 0
    const band = BAND[r.performanceBand] ?? BAND.average
    const line = (l: { en: string; ar: string; amount: number; kind: string }, sign: "+" | "-" | "") =>
      `<div class="row${l.kind === "adjustment" ? " muted" : ""}"><div class="lbl">${bi(l.en, l.ar)}</div><div class="amt ${sign === "-" ? "neg" : sign === "+" ? "pos" : ""}" dir="ltr">${sign === "-" && l.amount !== 0 ? "−" : sign === "+" ? "+" : ""}${money(Math.abs(l.amount))}</div></div>`
    const earnings = p.earnings.map((l, i) => line(l, l.amount < 0 ? "-" : i === 0 ? "" : "+")).join("")
    const deductions = p.deductions.map(l => line(l, "-")).join("") || `<div class="row empty">${bi("No deductions this month", "لا توجد خصومات هذا الشهر")}</div>`
    return `<section class="slip">
  <header class="hero">
    <div class="hero-main">
      <div class="eyebrow">${ar ? "كشف راتب · <span>SALARY STATEMENT</span>" : "SALARY STATEMENT · <span>كشف راتب</span>"}</div>
      <h1><bdi>${esc(primaryName)}</bdi></h1>
      ${secondaryName && secondaryName !== primaryName ? `<div class="name-ar"><bdi>${esc(secondaryName)}</bdi></div>` : ""}
      ${c?.legalName ? `<div class="sub">${esc(c.legalName)}</div>` : ""}
      ${address ? `<div class="sub"><bdi dir="rtl">${esc(address)}</bdi></div>` : ""}
      ${ids || contact ? `<div class="sub"><bdi dir="ltr">${esc([ids, contact].filter(Boolean).join(" · "))}</bdi></div>` : ""}
    </div>
    <div class="hero-side">
      ${c?.logoDataUrl ? `<div class="logo"><img src="${esc(c.logoDataUrl)}" alt=""></div>` : ""}
      <div class="period"><div class="k">${ar ? "فترة الراتب · PAY PERIOD" : "PAY PERIOD · فترة الراتب"}</div><div class="v">${esc(meta.month)}</div></div>
    </div>
  </header>
  ${meta.status !== "approved" ? `<div class="draft">${bi("DRAFT — not approved yet", "مسودة — لم تُعتمد بعد")}</div>` : ""}
  <div class="strip">
    <div><div class="k">${bi("Driver name", "اسم السائق")}</div><div class="v">${esc(r.driverName || "—")}</div></div>
    <div><div class="k">${bi("Rider ID", "معرّف المندوب")}</div><div class="v mono">${esc(r.riderId)}</div></div>
    <div><div class="k">${bi("Platform", "المنصة")}</div><div class="v">${esc(meta.platform)}</div></div>
    <div><div class="k">${bi("Contract", "العقد")}</div><div class="v mono">${esc(r.contractName || "—")}</div></div>
    <div><div class="k">${bi("Vehicle", "نوع المركبة")}</div><div class="v">${esc(r.vehicleType || "—")}</div></div>
  </div>
  <div class="band"><div>${bi("Performance", "الأداء")} <b class="chip" style="color:${band.tone};border-color:${band.tone}33;background:${band.tone}12">${esc(band.en)} · ${esc(band.ar)}</b></div>
    <div>${bi("Target attainment", "نسبة الإنجاز")} <b dir="ltr">${num(attain)}%</b><span class="bar"><i style="width:${Math.min(100, Math.max(0, attain))}%"></i></span></div></div>
  <div class="grid">
    <div class="card"><h3>${bi("Working summary", "ملخص العمل")}</h3>
      <div class="row"><div class="lbl">${bi("Completed orders", "الطلبات المنجزة")}</div><div class="amt">${num(r.completedOrders)}</div></div>
      <div class="row"><div class="lbl">${bi("Target orders", "الطلبات المستهدفة")}</div><div class="amt">${num(r.selectedTargetThreshold)}</div></div>
      <div class="row"><div class="lbl">${bi("Working days", "أيام العمل")}</div><div class="amt">${num(r.actualWorkingDays)}</div></div>
      <div class="row"><div class="lbl">${bi("Working hours", "ساعات العمل")}</div><div class="amt">${num(r.workingHours)}</div></div>
      <div class="row"><div class="lbl">${bi("Rate per order", "سعر الطلب")}</div><div class="amt">${money(r.appliedSalaryPerOrder)}</div></div>
    </div>
    <div class="card"><h3>${bi("Earnings", "الاستحقاقات")}</h3>${earnings}
      <div class="row total"><div class="lbl">${bi("Gross salary", "إجمالي الراتب")}</div><div class="amt" dir="ltr">SAR ${money(p.gross)}</div></div>
    </div>
  </div>
  <div class="card ded"><h3>${bi("Deductions", "الخصومات")}</h3>${deductions}
    <div class="row total"><div class="lbl">${bi("Total deductions", "إجمالي الخصومات")}</div><div class="amt neg" dir="ltr">−${money(Math.abs(p.totalDeductions))}</div></div>
  </div>
  <div class="net">
    <div><div class="eyebrow dark">FINAL NET SALARY</div><div class="net-ar">صافي الراتب النهائي</div>
      <div class="payto">${bi("Payable to", "يُصرف إلى")} <b><bdi>${esc(bank?.beneficiaryName || r.driverName)}</bdi></b>${bank?.iban ? ` · <bdi>${esc(bank.bankName ?? "")}</bdi> <bdi class="mono" dir="ltr">${esc(maskIban(bank.iban))}</bdi>` : ""}</div></div>
    <div class="net-amt"><div class="v" dir="ltr">SAR ${money(p.net)}</div><div class="k">${esc(meta.month)}</div></div>
  </div>
  <footer>
    <p>${bi("This is a computer-generated payslip.", "هذه قسيمة راتب صادرة إلكترونياً.")} · <bdi dir="ltr">${esc(generated)}</bdi></p>
    <div class="sign"><div><i></i>${bi("Approved by (Payroll)", "اعتماد (الرواتب)")}</div><div><i></i>${bi("Driver signature", "توقيع السائق")}</div></div>
  </footer>
</section>`
  })
  return `<!doctype html><html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${esc(ar ? "قسائم الرواتب" : "Payslips")} — ${esc(meta.month)}</title>
<style>
@font-face{font-family:Cairo;src:url("/fonts/cairo.woff2") format("woff2");font-weight:200 1000;font-display:block}
@page{size:A4;margin:0}
*{box-sizing:border-box}body{margin:0;font-family:Cairo,"Noto Sans Arabic",Arial,sans-serif;color:#0f172a;background:#eef2f1;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.slip{width:210mm;height:297mm;margin:0 auto 16px;background:#fff;display:flex;flex-direction:column;page-break-after:always;overflow:hidden}
.slip:last-child{page-break-after:auto}
.hero{display:flex;justify-content:space-between;gap:20px;padding:22px 30px 20px;color:#fff;background:radial-gradient(120% 140% at 0% 0%,#065f46 0%,#047857 45%,#10b981 100%)}
.eyebrow{font-size:9.5px;letter-spacing:.28em;font-weight:700;opacity:.85}.eyebrow span{letter-spacing:0}.eyebrow.dark{color:#047857;opacity:1}
h1{margin:6px 0 2px;font-size:22px;font-weight:800;line-height:1.25}.name-ar{font-size:16px;font-weight:700;opacity:.95}
.sub{font-size:10.5px;opacity:.82;margin-top:3px}
.hero-side{display:flex;flex-direction:column;align-items:flex-end;gap:10px;min-width:150px}
.logo{background:#fff;border-radius:14px;padding:6px 10px;box-shadow:0 6px 20px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;width:150px;height:72px}
.logo img{max-width:100%;max-height:100%;object-fit:contain}
.period{border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);border-radius:12px;padding:8px 14px;text-align:center;min-width:150px;backdrop-filter:blur(4px)}
.period .k{font-size:8.5px;letter-spacing:.14em;color:#d1fae5;text-transform:none}.period .v{font-size:17px;font-weight:800;margin-top:2px}
.draft{margin:10px 30px 0;padding:6px 12px;border-radius:8px;background:#fffbeb;border:1px solid #f59e0b;color:#92400e;font-weight:800;font-size:11px;text-align:center}
.strip{display:grid;grid-template-columns:1.3fr .9fr 1fr 1.3fr .8fr;gap:10px;padding:12px 30px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.strip>div{border-inline-start:3px solid #10b981;padding-inline-start:9px}
.k{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}.v{font-size:13px;font-weight:800;margin-top:2px;overflow-wrap:anywhere}.v.mono{font-size:11.5px}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:0}
.sec{color:#94a3b8;font-weight:500;text-transform:none;letter-spacing:0}
.band{display:flex;justify-content:space-between;align-items:center;padding:9px 30px;background:#ecfdf5;border-bottom:1px solid #d1fae5;font-size:11px;color:#334155}
.chip{display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid;font-size:10.5px}
.bar{display:inline-block;width:90px;height:6px;border-radius:9px;background:#d1fae5;margin-inline-start:8px;vertical-align:middle;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#10b981,#047857)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px 30px 0}
.card{border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.card h3{margin:0 0 8px;padding-bottom:7px;border-bottom:2px solid #064e3b;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#064e3b;display:flex;align-items:center;gap:6px}
.card h3:before{content:"";width:4px;height:14px;border-radius:3px;background:#10b981}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:5px 0;border-bottom:1px dashed #e2e8f0;font-size:11.5px}
.row:last-child{border-bottom:0}.row.muted{color:#64748b;font-style:italic}.row.empty{color:#94a3b8;justify-content:center}
.amt{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.pos{color:#047857}.neg{color:#b91c1c}
.row.total{margin-top:4px;padding-top:9px;border-top:2px solid #064e3b;border-bottom:0;font-size:13px}.row.total .amt{font-size:15px;color:#064e3b}
.ded{margin:14px 30px 0;background:linear-gradient(180deg,#fff,#fff5f5);border-color:#fecaca}.ded h3{color:#991b1b;border-color:#991b1b}.ded h3:before{background:#ef4444}
.ded .row.total{border-color:#991b1b}.ded .row.total .amt{color:#b91c1c}
.net{margin:16px 30px 0;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 20px;border-radius:16px;border:1px solid #6ee7b7;border-inline-start:6px solid #047857;background:linear-gradient(110deg,#ecfdf5 0%,#d1fae5 60%,#a7f3d0 100%)}
.net-ar{font-size:18px;font-weight:800;color:#064e3b}.payto{font-size:10.5px;color:#047857;margin-top:4px}
.net-amt{text-align:end}.net-amt .v{font-size:30px;font-weight:900;color:#064e3b;letter-spacing:-.01em}.net-amt .k{text-transform:none}
footer{margin-top:auto;padding:14px 30px 18mm;background:linear-gradient(180deg,#fff,#ecfdf5);text-align:center}
footer p{font-size:9.5px;color:#64748b;font-style:italic;margin:0 0 30px}
.sign{display:flex;justify-content:space-between;gap:40px}.sign>div{flex:1;font-size:10.5px;font-weight:700;color:#334155}.sign i{display:block;border-top:1px solid #334155;margin-bottom:6px}
@media screen{body{padding:12px 0}.slip{box-shadow:0 10px 40px rgba(15,23,42,.12);border-radius:6px}}
@media print{body{background:#fff}.slip{margin:0;box-shadow:none;border-radius:0}}
</style></head><body>${pages.join("")}</body></html>`
}

export function openPayslips(rows: readonly PrintRow[], meta: PayslipMeta, ar: boolean): boolean {
  const w = window.open("", "_blank")
  if (!w) return false
  w.document.open()
  w.document.write(payslipsHtml(rows, meta, ar))
  w.document.close()
  // Wait for the embedded font so Arabic shapes correctly before printing.
  const print = () => { w.focus(); w.print() }
  void (w.document.fonts?.ready ?? Promise.resolve()).then(() => setTimeout(print, 250), () => setTimeout(print, 400))
  return true
}
