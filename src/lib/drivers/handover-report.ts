// Printable bilingual vehicle handover/return report (pure HTML builder).
import { escapeHtml } from "@/lib/notifications/digest-email"

export interface HandoverReportInput {
  company: string
  form: Record<string, unknown> & { form_type: string; form_date: string; odometer_reading: number; fuel_level: string | null; overall_condition: string | null; defects_noted: string | null; notes: string | null; finalized_at: string | null; driver_acknowledged_at: string | null; supervisor_acknowledged_at: string | null }
  driver: { name: string; code: string | null; iqama: string | null }
  vehicle: { plate: string | null; make: string | null; model: string | null; year: number | null }
  conditions: readonly (readonly [string, string, string])[]
  items: readonly (readonly [string, string, string])[]
  photoUrls: string[]
  driverSignatureUrl: string | null
  supervisorSignatureUrl: string | null
}

const COND: Record<string, [string, string, string]> = {
  ok: ["OK", "سليم", "#047857"], minor_issue: ["Minor issue", "خلل بسيط", "#b45309"], major_issue: ["Major issue", "خلل كبير", "#b91c1c"], missing: ["Missing", "مفقود", "#b91c1c"],
}
const OVERALL: Record<string, [string, string]> = { excellent: ["Excellent", "ممتازة"], good: ["Good", "جيدة"], fair: ["Fair", "متوسطة"], poor: ["Poor", "ضعيفة"], damaged: ["Damaged", "متضررة"] }

const e = (v: unknown) => escapeHtml(v === null || v === undefined || v === "" ? "—" : String(v))
const safeUrl = (u: string) => (/^(https:|blob:|data:image\/)/.test(u) ? escapeHtml(u) : "")

export function buildHandoverReportHtml(r: HandoverReportInput): string {
  const isReturn = r.form.form_type === "return"
  const title = isReturn ? ["Vehicle return report", "محضر استلام مركبة"] : ["Vehicle handover report", "محضر تسليم مركبة"]
  const condRows = r.conditions.map(([k, en, ar]) => {
    const c = COND[String(r.form[k] ?? "")]
    return `<tr><td>${e(en)}<br><small dir="rtl">${e(ar)}</small></td><td style="color:${c?.[2] ?? "#334155"};font-weight:600">${c ? `${e(c[0])} · ${e(c[1])}` : "—"}</td></tr>`
  }).join("")
  const itemRows = r.items.map(([k, en, ar]) => {
    const v = r.form[k]
    return `<tr><td>${e(en)}<br><small dir="rtl">${e(ar)}</small></td><td style="font-weight:600;color:${v === true ? "#047857" : v === false ? "#b91c1c" : "#334155"}">${v === true ? "Present · موجود" : v === false ? "Missing · مفقود" : "—"}</td></tr>`
  }).join("")
  const photos = r.photoUrls.map((u) => safeUrl(u)).filter(Boolean).map((u) => `<img src="${u}" alt="">`).join("")
  const sig = (label: string, labelAr: string, url: string | null, at: string | null) => `<div class="sig"><div class="sigbox">${url && safeUrl(url) ? `<img src="${safeUrl(url)}" alt="">` : ""}</div><div><b>${label}</b> · <span dir="rtl">${labelAr}</span></div><small>${at ? e(new Date(at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })) : "Not signed · غير موقّع"}</small></div>`
  const overall = OVERALL[String(r.form.overall_condition ?? "")]
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(title[0])} ${e(r.vehicle.plate)}</title><style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#0f172a;margin:0;font-size:12px}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0f1e33;padding-bottom:10px;margin-bottom:14px}
h1{margin:0;font-size:20px}h2{font-size:13px;margin:16px 0 6px;color:#1e3a8a;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kv{border:1px solid #e2e8f0;border-radius:8px;padding:6px 8px}.kv small{display:block;color:#64748b}
table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #eef2f7;padding:5px 6px;vertical-align:top}td small{color:#64748b}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.photos{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.photos img{width:100%;height:110px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0}
.sigs{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:10px}.sig{text-align:center}.sigbox{height:80px;border-bottom:1px solid #94a3b8;margin-bottom:6px;display:flex;align-items:flex-end;justify-content:center}.sigbox img{max-height:78px;max-width:100%}
.note{border:1px solid #e2e8f0;border-radius:8px;padding:8px;min-height:36px;white-space:pre-wrap}footer{margin-top:16px;color:#64748b;font-size:10px;text-align:center}
</style></head><body>
<header><div><div style="color:#64748b">${e(r.company)}</div><h1>${e(title[0])}</h1><div dir="rtl" style="font-size:16px;font-weight:700">${e(title[1])}</div></div>
<div style="text-align:end"><div><b>Date · التاريخ:</b> ${e(r.form.form_date)}</div><div><b>Ref:</b> ${e(String(r.form.id ?? "").slice(0, 8).toUpperCase())}</div><div>${r.form.finalized_at ? "Finalized · معتمد" : "Draft · مسودة"}</div></div></header>
<div class="grid">
<div class="kv"><small>Driver · السائق</small><b>${e(r.driver.name)}</b></div><div class="kv"><small>Code / Iqama · الكود / الإقامة</small>${e(r.driver.code)} / ${e(r.driver.iqama)}</div>
<div class="kv"><small>Vehicle · المركبة</small><b>${e([r.vehicle.make, r.vehicle.model, r.vehicle.year].filter(Boolean).join(" "))}</b></div><div class="kv"><small>Plate · اللوحة</small><b dir="ltr">${e(r.vehicle.plate)}</b></div>
<div class="kv"><small>Odometer · العداد</small><b>${e(Number(r.form.odometer_reading).toLocaleString("en-US"))} km</b></div><div class="kv"><small>Fuel · الوقود</small><b>${e(r.form.fuel_level)}</b></div>
<div class="kv"><small>Overall · الحالة العامة</small><b>${overall ? `${e(overall[0])} · ${e(overall[1])}` : "—"}</b></div><div class="kv"><small>Photos · الصور</small><b>${r.photoUrls.length}</b></div>
</div>
<div class="cols"><div><h2>Condition checklist · فحص الحالة</h2><table>${condRows}</table></div><div><h2>Equipment & documents · المعدات والوثائق</h2><table>${itemRows}</table>
<h2>Observed defects · العيوب المرصودة</h2><div class="note">${e(r.form.defects_noted)}</div><h2>Notes · ملاحظات</h2><div class="note">${e(r.form.notes)}</div></div></div>
${photos ? `<h2>Photos · الصور</h2><div class="photos">${photos}</div>` : ""}
<h2>Acknowledgement · الإقرار</h2>
<p>The driver confirms the vehicle condition recorded above. · <span dir="rtl">يقر السائق بحالة المركبة الموضحة أعلاه.</span></p>
<div class="sigs">${sig("Driver", "السائق", r.driverSignatureUrl, r.form.driver_acknowledged_at)}${sig("Supervisor", "المشرف", r.supervisorSignatureUrl, r.form.supervisor_acknowledged_at)}</div>
<footer>Generated by EliteDev · ${e(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC</footer>
</body></html>`
}
