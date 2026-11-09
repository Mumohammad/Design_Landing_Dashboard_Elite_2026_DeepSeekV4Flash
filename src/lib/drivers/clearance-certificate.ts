// Driver exit / clearance (مخالصة) definitions and printable certificate builder (pure).
import { escapeHtml } from "@/lib/notifications/digest-email"

export const OFFBOARDING_EXIT_TYPES = ["resignation", "termination", "end_of_contract", "transfer", "final_exit", "other"] as const
export type OffboardingExitType = (typeof OFFBOARDING_EXIT_TYPES)[number]
export const EXIT_TYPE_LABELS: Record<OffboardingExitType, [string, string]> = {
  resignation: ["Resignation", "استقالة"], termination: ["Termination", "إنهاء خدمة"], end_of_contract: ["End of contract", "انتهاء العقد"],
  transfer: ["Sponsorship transfer", "نقل كفالة"], final_exit: ["Final exit", "خروج نهائي"], other: ["Other", "أخرى"],
}

export const OFFBOARDING_MANUAL_KEYS = ["assets_returned", "final_settlement", "exit_interview", "gosi_deregistered", "muqeem_updated", "visa_or_transfer", "access_revoked"] as const
export type OffboardingManualKey = (typeof OFFBOARDING_MANUAL_KEYS)[number]
export const MANUAL_ITEM_LABELS: Record<OffboardingManualKey, [string, string, string, string]> = {
  assets_returned: ["Uniform, phone & equipment returned", "استلام الزي والجوال والمعدات", "Bag, uniform, phone, power bank, helmet…", "الحقيبة والزي والجوال والباور بانك والخوذة…"],
  final_settlement: ["Final settlement paid", "صرف المخالصة النهائية", "End-of-service award, last salary, deductions", "مكافأة نهاية الخدمة وآخر راتب والخصومات"],
  exit_interview: ["Exit interview done", "إجراء مقابلة الخروج", "Reason and feedback recorded", "تسجيل السبب والملاحظات"],
  gosi_deregistered: ["GOSI subscription ended", "إيقاف اشتراك التأمينات (GOSI)", "Exclude the worker in GOSI", "استبعاد العامل في التأمينات الاجتماعية"],
  muqeem_updated: ["Muqeem / Qiwa updated", "تحديث مقيم / قوى", "Contract ended on Qiwa, status updated on Muqeem", "إنهاء العقد في قوى وتحديث الحالة في مقيم"],
  visa_or_transfer: ["Exit visa or transfer issued", "إصدار تأشيرة الخروج أو نقل الكفالة", "Final exit / exit-reentry / transfer completed", "خروج نهائي أو خروج وعودة أو نقل خدمات"],
  access_revoked: ["App & system access revoked", "إلغاء صلاحيات الأنظمة والتطبيقات", "Company apps, groups, fuel cards", "تطبيقات الشركة والمجموعات وبطاقات الوقود"],
}

export type SystemCheck = { key: string; label: string; labelAr: string; ok: boolean; detail: string; detailAr: string; blocking: boolean }

export interface ClearanceInput {
  company: string
  ref: string | null
  driver: { name: string; code: string | null; iqama: string | null; nationality: string | null; joinDate: string | null }
  exitType: string
  reason: string | null
  lastWorkingDay: string | null
  completedAt: string | null
  settlementAmount: number | null
  settlementNotes: string | null
  systemChecks: SystemCheck[]
  manual: { key: OffboardingManualKey; done: boolean; at: string | null; note: string | null }[]
}

const e = (v: unknown) => escapeHtml(v === null || v === undefined || v === "" ? "—" : String(v))
const sar = (n: number | null) => (n === null || n === undefined ? "—" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`)

export function clearanceProgress(manual: ClearanceInput["manual"], checks: SystemCheck[]): { done: number; total: number; ready: boolean } {
  const done = manual.filter((m) => m.done).length + checks.filter((c) => c.ok).length
  const ready = manual.every((m) => m.done) && checks.filter((c) => c.blocking).every((c) => c.ok)
  return { done, total: manual.length + checks.length, ready }
}

export function buildClearanceCertificateHtml(r: ClearanceInput): string {
  const exit = EXIT_TYPE_LABELS[r.exitType as OffboardingExitType] ?? EXIT_TYPE_LABELS.other
  const mark = (ok: boolean) => `<b style="color:${ok ? "#047857" : "#b91c1c"}">${ok ? "✓ Cleared · تم" : "✗ Pending · معلّق"}</b>`
  const sys = r.systemChecks.map((c) => `<tr><td>${e(c.label)}<br><small dir="rtl">${e(c.labelAr)}</small></td><td>${mark(c.ok)}<br><small>${e(c.detail)}</small></td></tr>`).join("")
  const man = r.manual.map((m) => {
    const l = MANUAL_ITEM_LABELS[m.key]
    return `<tr><td>${e(l[0])}<br><small dir="rtl">${e(l[1])}</small></td><td>${mark(m.done)}${m.at ? `<br><small>${e(new Date(m.at).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" }))}</small>` : ""}${m.note ? `<br><small>${e(m.note)}</small>` : ""}</td></tr>`
  }).join("")
  const final = !!r.completedAt
  return `<!doctype html><html><head><meta charset="utf-8"><title>Clearance ${e(r.ref ?? r.driver.name)}</title><style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#0f172a;margin:0;font-size:12px}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0f1e33;padding-bottom:10px;margin-bottom:14px}
h1{margin:0;font-size:20px}h2{font-size:13px;margin:16px 0 6px;color:#1e3a8a;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.kv{border:1px solid #e2e8f0;border-radius:8px;padding:6px 8px}.kv small{display:block;color:#64748b}
table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #eef2f7;padding:5px 6px;vertical-align:top}td small{color:#64748b}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.stamp{display:inline-block;border:2px solid ${final ? "#047857" : "#b45309"};color:${final ? "#047857" : "#b45309"};border-radius:8px;padding:4px 10px;font-weight:700}
.sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:28px}.sig{text-align:center}.sigbox{height:60px;border-bottom:1px solid #94a3b8;margin-bottom:6px}
p.decl{border:1px solid #e2e8f0;border-radius:8px;padding:8px;line-height:1.6}footer{margin-top:16px;color:#64748b;font-size:10px;text-align:center}
</style></head><body>
<header><div><div style="color:#64748b">${e(r.company)}</div><h1>Driver clearance certificate</h1><div dir="rtl" style="font-size:16px;font-weight:700">شهادة مخالصة وإخلاء طرف سائق</div></div>
<div style="text-align:end"><div><b>Ref:</b> ${e(r.ref)}</div><div><b>Date · التاريخ:</b> ${e((r.completedAt ?? new Date().toISOString()).slice(0, 10))}</div><div class="stamp">${final ? "Final · نهائية" : "Draft · مسودة"}</div></div></header>
<div class="grid">
<div class="kv"><small>Driver · السائق</small><b>${e(r.driver.name)}</b></div><div class="kv"><small>Code · الكود</small>${e(r.driver.code)}</div><div class="kv"><small>Iqama / ID · الإقامة</small>${e(r.driver.iqama)}</div>
<div class="kv"><small>Nationality · الجنسية</small>${e(r.driver.nationality)}</div><div class="kv"><small>Joined · تاريخ الالتحاق</small>${e(r.driver.joinDate)}</div><div class="kv"><small>Last working day · آخر يوم عمل</small><b>${e(r.lastWorkingDay)}</b></div>
<div class="kv"><small>Exit type · نوع الخروج</small><b>${e(exit[0])} · ${e(exit[1])}</b></div><div class="kv"><small>Final settlement · المخالصة</small><b>${e(sar(r.settlementAmount))}</b></div><div class="kv"><small>Reason · السبب</small>${e(r.reason)}</div>
</div>
<div class="cols"><div><h2>System checks · فحوصات النظام</h2><table>${sys}</table></div><div><h2>Clearance checklist · بنود المخالصة</h2><table>${man}</table></div></div>
${r.settlementNotes ? `<h2>Settlement notes · ملاحظات المخالصة</h2><p class="decl">${e(r.settlementNotes)}</p>` : ""}
<h2>Declaration · إقرار</h2>
<p class="decl">I confirm that I have received all my dues and returned all company property, and I have no further claims against the company. · <span dir="rtl">أقر بأنني استلمت كامل مستحقاتي وسلمت جميع عهد الشركة، ولا تبقى لي أي مطالبات تجاه الشركة.</span></p>
<div class="sigs"><div class="sig"><div class="sigbox"></div><b>Driver</b> · <span dir="rtl">السائق</span></div><div class="sig"><div class="sigbox"></div><b>HR</b> · <span dir="rtl">الموارد البشرية</span></div><div class="sig"><div class="sigbox"></div><b>Fleet / Finance</b> · <span dir="rtl">الأسطول / المالية</span></div></div>
<footer>Generated by EliteDev · ${e(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC</footer>
</body></html>`
}
