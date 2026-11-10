// Driver performance scorecard (pure). Each pillar is 0-100 or null when there
// is no data; the overall score re-normalises weights over available pillars.

export type AttendanceStatus = "present" | "late" | "half_day" | "absent_excused" | "absent_unexcused" | "on_leave" | "public_holiday" | "day_off"
export type Severity = "minor" | "moderate" | "major" | "critical"

export interface ScorecardInput {
  todayIso: string
  attendance: { status: string }[]
  violations: { severity: string | null; status: string | null }[]
  orders: { total_delivered: number | null; total_failed: number | null; total_returned: number | null; working_days: number | null }[]
  documents: (string | null)[] // identity document expiry dates (iqama, licence, passport…)
  latestReview: number | null
}

export interface Pillar { key: "attendance" | "conduct" | "productivity" | "compliance" | "review"; score: number | null; weight: number; detail: { en: string; ar: string } }
export interface Scorecard { overall: number | null; grade: string; tier: { en: string; ar: string; tone: "elite" | "good" | "ok" | "risk" | "none" }; pillars: Pillar[] }

const ATTENDANCE_CREDIT: Record<string, number> = { present: 1, late: 0.85, half_day: 0.5, absent_excused: 0.7, absent_unexcused: 0 }
const SEVERITY_PENALTY: Record<string, number> = { minor: 5, moderate: 10, major: 20, critical: 35 }
export const ORDERS_PER_DAY_TARGET = 20

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

export function attendanceScore(rows: { status: string }[]): number | null {
  const counted = rows.filter((r) => r.status in ATTENDANCE_CREDIT)
  if (!counted.length) return null
  return clamp((counted.reduce((s, r) => s + ATTENDANCE_CREDIT[r.status], 0) / counted.length) * 100)
}

export function conductScore(rows: { severity: string | null; status: string | null }[]): number {
  const penalty = rows.filter((r) => r.status !== "waived" && r.status !== "closed_dismissed")
    .reduce((s, r) => s + (SEVERITY_PENALTY[r.severity ?? "minor"] ?? 5), 0)
  return clamp(100 - penalty)
}

export function productivityScore(rows: ScorecardInput["orders"]): number | null {
  const delivered = rows.reduce((s, r) => s + (r.total_delivered ?? 0), 0)
  const failed = rows.reduce((s, r) => s + (r.total_failed ?? 0) + (r.total_returned ?? 0), 0)
  const days = rows.reduce((s, r) => s + (r.working_days ?? 0), 0)
  if (delivered + failed === 0) return null
  const success = (delivered / (delivered + failed)) * 100
  const pace = days > 0 ? Math.min(100, (delivered / days / ORDERS_PER_DAY_TARGET) * 100) : success
  return clamp(success * 0.6 + pace * 0.4)
}

export function complianceScore(expiries: (string | null)[], todayIso: string): number | null {
  if (!expiries.length) return null
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  const credit = expiries.map((d) => {
    if (!d) return 0
    const days = (Date.parse(`${d.slice(0, 10)}T00:00:00Z`) - today) / 86_400_000
    return days < 0 ? 0 : days <= 30 ? 0.6 : 1
  })
  return clamp((credit.reduce<number>((s, c) => s + c, 0) / credit.length) * 100)
}

export function gradeFor(score: number | null): Scorecard["tier"] & { grade: string } {
  if (score === null) return { grade: "—", en: "Not enough data", ar: "لا توجد بيانات كافية", tone: "none" }
  if (score >= 90) return { grade: "A+", en: "Elite performer", ar: "أداء نخبوي", tone: "elite" }
  if (score >= 80) return { grade: "A", en: "Excellent", ar: "ممتاز", tone: "good" }
  if (score >= 70) return { grade: "B", en: "Good", ar: "جيد", tone: "good" }
  if (score >= 60) return { grade: "C", en: "Needs improvement", ar: "يحتاج تحسين", tone: "ok" }
  return { grade: "D", en: "At risk", ar: "في دائرة الخطر", tone: "risk" }
}

export function buildScorecard(input: ScorecardInput): Scorecard {
  const att = attendanceScore(input.attendance)
  const prod = productivityScore(input.orders)
  const comp = complianceScore(input.documents, input.todayIso)
  const delivered = input.orders.reduce((s, r) => s + (r.total_delivered ?? 0), 0)
  const pillars: Pillar[] = [
    { key: "attendance", score: att, weight: 0.25, detail: { en: `${input.attendance.length} days recorded (90d)`, ar: `${input.attendance.length} يوم مسجل (90 يوم)` } },
    { key: "conduct", score: conductScore(input.violations), weight: 0.25, detail: { en: `${input.violations.length} violation(s) in 180d`, ar: `${input.violations.length} مخالفة خلال 180 يوم` } },
    { key: "productivity", score: prod, weight: 0.25, detail: { en: `${delivered.toLocaleString("en")} orders (3 months)`, ar: `${delivered.toLocaleString("ar-SA")} طلب (3 أشهر)` } },
    { key: "compliance", score: comp, weight: 0.15, detail: { en: "Iqama, licence & passport validity", ar: "صلاحية الإقامة والرخصة والجواز" } },
    { key: "review", score: input.latestReview === null ? null : clamp(input.latestReview), weight: 0.1, detail: { en: "Latest completed review", ar: "آخر تقييم مكتمل" } },
  ]
  const available = pillars.filter((p) => p.score !== null)
  const totalWeight = available.reduce((s, p) => s + p.weight, 0)
  // Conduct alone (always 100 with no violations) is not enough to grade.
  const meaningful = available.filter((p) => p.key !== "conduct").length > 0
  const overall = meaningful && totalWeight > 0 ? clamp(available.reduce((s, p) => s + (p.score as number) * p.weight, 0) / totalWeight) : null
  const g = gradeFor(overall)
  return { overall, grade: g.grade, tier: { en: g.en, ar: g.ar, tone: g.tone }, pillars }
}
