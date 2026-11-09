// Payslip breakdown reconstructed from a stored DriverResultCalc. Every line
// is derived from engine outputs and the residual "cap / floor" lines make the
// payslip reconcile to the engine's gross and net to the halala; the tests
// assert those residuals are zero whenever no cap or floor applies.
import type { DriverResultCalc } from "./salary-engine"

export const DEDUCTIBLE_PENALTY_KEYS = ["acceptance", "contact", "stacking", "declined", "late", "noshow", "noshow_special", "daily_acceptance", "missed_days", "rider_balance", "car_deduction", "tga_deduction"] as const

export const PENALTY_LABELS: Record<string, { en: string; ar: string }> = {
  acceptance: { en: "Acceptance rate penalty", ar: "غرامة نسبة القبول" },
  contact: { en: "Contact rate penalty", ar: "غرامة نسبة التواصل" },
  stacking: { en: "Stacking deduction", ar: "خصم الطلبات المتعددة" },
  declined: { en: "Declined orders penalty", ar: "غرامة الطلبات المرفوضة" },
  late: { en: "Late penalty", ar: "غرامة التأخير" },
  noshow: { en: "No-show penalty", ar: "غرامة عدم الحضور" },
  noshow_special: { en: "No-show (special cities)", ar: "عدم الحضور (مدن خاصة)" },
  daily_acceptance: { en: "Daily acceptance penalty", ar: "غرامة القبول اليومي" },
  missed_days: { en: "Missed days penalty", ar: "غرامة الأيام الفائتة" },
  rider_balance: { en: "Rider balance (wallet)", ar: "محفظة المندوب" },
  car_deduction: { en: "Car deduction", ar: "خصم السيارة" },
  tga_deduction: { en: "TGA deduction", ar: "خصم هيئة النقل" },
}

export interface PayslipLine { key: string; en: string; ar: string; amount: number; kind: "earning" | "deduction" | "adjustment" }

export interface PayslipBreakdown {
  earnings: PayslipLine[]; gross: number
  deductions: PayslipLine[]; totalDeductions: number
  net: number
  /** Residuals from caps/floors (zero when none applied). */
  grossFloorAdjustment: number; penaltyCapAdjustment: number; capFloorAdjustment: number
}

export function payslipBreakdown(r: DriverResultCalc): PayslipBreakdown {
  const daysMode = r.salaryDivisorMode === "days_prorated_mode"
  const base = daysMode ? r.adjustedBaseSalary : Math.min(r.completedOrders, r.selectedTargetThreshold) * r.appliedSalaryPerOrder
  const earnings: PayslipLine[] = [
    { key: "base", en: daysMode ? "Prorated base salary" : "Earned salary (orders × rate)", ar: daysMode ? "الراتب الأساسي النسبي" : "الراتب المكتسب (الطلبات × السعر)", amount: base, kind: "earning" },
  ]
  if (r.missingOrderDeduction) earnings.push({ key: "missing", en: `Missing orders (${fmtN(r.missingOrders)} × ${fmtN(r.appliedDeductionPerMissing)})`, ar: `الطلبات الناقصة (${fmtN(r.missingOrders)} × ${fmtN(r.appliedDeductionPerMissing)})`, amount: -r.missingOrderDeduction, kind: "deduction" })
  const flooredBase = Math.max(base - r.missingOrderDeduction, 0)
  if (flooredBase !== base - r.missingOrderDeduction) earnings.push({ key: "base_floor", en: "Earned salary floor (not below zero)", ar: "حد أدنى للراتب المكتسب (لا يقل عن صفر)", amount: flooredBase - (base - r.missingOrderDeduction), kind: "adjustment" })
  if (r.bonusAmount) earnings.push({ key: "bonus", en: `Extra orders bonus (${fmtN(r.extraOrders)} × ${fmtN(r.appliedBonusPerExtra)})`, ar: `مكافأة الطلبات الإضافية (${fmtN(r.extraOrders)} × ${fmtN(r.appliedBonusPerExtra)})`, amount: r.bonusAmount, kind: "earning" })
  r.customBonuses.forEach((b, i) => earnings.push({ key: `cb${i}`, en: b.name, ar: b.nameAr || b.name, amount: b.amount, kind: "earning" }))
  r.manualBonuses.forEach((b, i) => earnings.push({ key: `mb${i}`, en: b.title, ar: b.titleAr || b.title, amount: b.amount, kind: "earning" }))
  const reconstructedGross = earnings.reduce((s, l) => s + l.amount, 0)
  const grossFloorAdjustment = r.grossSalaryBeforePenalties - reconstructedGross
  if (Math.abs(grossFloorAdjustment) > 1e-9) earnings.push({ key: "gross_adj", en: "Rule adjustment", ar: "تعديل وفق القواعد", amount: grossFloorAdjustment, kind: "adjustment" })

  const deductions: PayslipLine[] = []
  for (const k of DEDUCTIBLE_PENALTY_KEYS) {
    const v = r.penalties[k] || 0
    if (v) deductions.push({ key: k, en: PENALTY_LABELS[k].en, ar: PENALTY_LABELS[k].ar, amount: v, kind: "deduction" })
  }
  const rawPenalties = DEDUCTIBLE_PENALTY_KEYS.reduce((s, k) => s + (r.penalties[k] || 0), 0)
  const penaltyCapAdjustment = r.totalOtherPenalties - rawPenalties
  if (Math.abs(penaltyCapAdjustment) > 1e-9) deductions.push({ key: "penalty_cap", en: "Maximum penalty cap", ar: "سقف الغرامات", amount: penaltyCapAdjustment, kind: "adjustment" })
  if (r.trafficViolationsDeduction) deductions.push({ key: "traffic", en: "Traffic violations", ar: "المخالفات المرورية", amount: r.trafficViolationsDeduction, kind: "deduction" })
  r.customDeductions.forEach((d, i) => deductions.push({ key: `cd${i}`, en: d.monthlyDeduction !== undefined ? `${d.name} (installment)` : d.name, ar: d.monthlyDeduction !== undefined ? `${d.nameAr || d.name} (قسط)` : d.nameAr || d.name, amount: d.monthlyDeduction ?? d.amount, kind: "deduction" }))
  r.manualDeductions.forEach((d, i) => deductions.push({ key: `md${i}`, en: d.title, ar: d.titleAr || d.title, amount: d.amount, kind: "deduction" }))
  const uncapped = r.totalOtherPenalties + r.trafficViolationsDeduction + r.customDeductionTotal + r.manualDeductionTotal
  const listed = deductions.reduce((s, l) => s + l.amount, 0)
  // The engine nets the cap into totalDeductions; recover it from gross − net when no floor applied.
  const impliedDeductions = r.grossSalaryBeforePenalties - r.finalNetSalary
  // Deduction cap and salary floor are netted inside the engine; show their combined effect as one line.
  const capFloorAdjustment = Math.abs(impliedDeductions - uncapped) > 1e-9 ? impliedDeductions - uncapped : 0
  if (capFloorAdjustment) deductions.push({ key: "cap_floor", en: "Unrecovered deductions (cap / salary floor / net not below zero)", ar: "خصومات غير مستردة (سقف / حد أدنى / الصافي لا يقل عن صفر)", amount: capFloorAdjustment, kind: "adjustment" })
  const totalDeductions = listed + capFloorAdjustment
  return { earnings, gross: r.grossSalaryBeforePenalties, deductions, totalDeductions, net: r.finalNetSalary, grossFloorAdjustment, penaltyCapAdjustment, capFloorAdjustment }
}

function fmtN(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
