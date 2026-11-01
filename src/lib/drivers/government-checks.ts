// Government verification catalogue (manual checks; official APIs need contracts with Elm / GOSI / HRSD).
export const GOV_CHECK_TYPES = ["muqeem", "absher", "qiwa", "gosi", "mudad", "traffic"] as const
export type GovCheckType = (typeof GOV_CHECK_TYPES)[number]
export type GovCheckResult = "ok" | "issue" | "pending"

export const GOV_CHECKS: Record<GovCheckType, { en: string; ar: string; what: string; whatAr: string; url: string; cadenceDays: number }> = {
  muqeem: { en: "Muqeem", ar: "مقيم", what: "Iqama validity, exit/re-entry & passport status", whatAr: "صلاحية الإقامة وتأشيرات الخروج والعودة والجواز", url: "https://muqeem.sa", cadenceDays: 30 },
  absher: { en: "Absher Business", ar: "أبشر أعمال", what: "Traffic violations, licence & vehicle status", whatAr: "المخالفات المرورية وحالة الرخصة والمركبة", url: "https://business.absher.sa", cadenceDays: 7 },
  qiwa: { en: "Qiwa", ar: "قوى", what: "Work permit & employment contract", whatAr: "رخصة العمل وعقد العمل", url: "https://qiwa.sa", cadenceDays: 30 },
  gosi: { en: "GOSI", ar: "التأمينات الاجتماعية", what: "Social insurance registration & wage", whatAr: "تسجيل التأمينات والأجر المسجل", url: "https://www.gosi.gov.sa", cadenceDays: 30 },
  mudad: { en: "Mudad (WPS)", ar: "مدد", what: "Wage protection — salary paid & matched", whatAr: "حماية الأجور — صرف الراتب ومطابقته", url: "https://mudad.com.sa", cadenceDays: 30 },
  traffic: { en: "Traffic (Muroor)", ar: "المرور", what: "Driving licence validity & points", whatAr: "صلاحية رخصة القيادة والنقاط", url: "https://www.moi.gov.sa", cadenceDays: 90 },
}

export interface GovCheckRow { id: string; check_type: string; result: string; reference: string | null; notes: string | null; checked_on: string; next_due_on: string | null; created_at: string }
export type GovCheckState = "never" | "ok" | "issue" | "pending" | "due"

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}

/** Latest check per type and its state (overdue when past next due / cadence). */
export function summarizeGovChecks(rows: GovCheckRow[], today: string): Record<GovCheckType, { last: GovCheckRow | null; state: GovCheckState; dueOn: string | null }> {
  const out = {} as Record<GovCheckType, { last: GovCheckRow | null; state: GovCheckState; dueOn: string | null }>
  for (const t of GOV_CHECK_TYPES) {
    const last = rows.filter((r) => r.check_type === t).sort((a, b) => (a.checked_on === b.checked_on ? (a.created_at < b.created_at ? 1 : -1) : a.checked_on < b.checked_on ? 1 : -1))[0] ?? null
    if (!last) { out[t] = { last: null, state: "never", dueOn: null }; continue }
    const dueOn = last.next_due_on ?? addDays(last.checked_on, GOV_CHECKS[t].cadenceDays)
    const state: GovCheckState = last.result === "issue" ? "issue" : last.result === "pending" ? "pending" : dueOn < today ? "due" : "ok"
    out[t] = { last, state, dueOn }
  }
  return out
}
