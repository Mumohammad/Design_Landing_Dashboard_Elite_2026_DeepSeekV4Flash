// Excel sheet builders (array-of-arrays) shared by the client download and
// the tests. Numbers are written unrounded so Excel totals equal the app;
// only the bank-transfer amount is rounded to halalas (what is actually paid).
import type { IncomeDashboard } from "./income-dashboard"
import { toHalalas } from "./month"
import { DEDUCTIBLE_PENALTY_KEYS, PENALTY_LABELS, payslipBreakdown } from "./payslip"
import type { DriverResultCalc } from "./salary-engine"

export type Cell = string | number | null
export interface SheetSpec { name: string; rows: Cell[][]; cols?: number[] }

const BAND: Record<string, string> = { top: "Top Performer", high: "High", average: "Average", low: "Low", bottom: "Bottom" }
const sum = <T,>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)

export interface ExportRun { payrollMonth: string; platformName: string; ruleSetName: string; status: string; fileName: string; companyName?: string }
export interface ExportRow { result: DriverResultCalc; bank: { beneficiaryName?: string; iban?: string; bankName?: string } | null }

export function payrollResultsSheets(run: ExportRun, rows: readonly ExportRow[]): SheetSpec[] {
  const rs = rows.map(r => r.result)
  const slips = rs.map(payslipBreakdown)
  const summary: SheetSpec = { name: "Summary", cols: [40, 28], rows: [
    [run.companyName || "Payroll", null], ["Payroll month", run.payrollMonth], ["Platform", run.platformName], ["Status", run.status], ["Rule set", run.ruleSetName], ["Source file", run.fileName],
    ["Generated", new Date().toISOString()], [null, null],
    ["Total riders", rs.length], ["Total completed orders", sum(rs, r => r.completedOrders)],
    ["Total earned base (SAR)", sum(slips, s => s.earnings.find(l => l.key === "base")?.amount ?? 0)],
    ["Total missing-order deduction (SAR)", sum(rs, r => r.missingOrderDeduction)],
    ["Total extra-orders bonus (SAR)", sum(rs, r => r.bonusAmount)],
    ["Total custom bonuses (SAR)", sum(rs, r => r.customBonusTotal)], ["Total manual bonuses (SAR)", sum(rs, r => r.manualBonusTotal)],
    ["Total gross salary (SAR)", sum(rs, r => r.grossSalaryBeforePenalties)],
    ["Total platform penalties (SAR)", sum(rs, r => r.totalOtherPenalties)], ["Total traffic violations (SAR)", sum(rs, r => r.trafficViolationsDeduction)],
    ["Total custom deductions (SAR)", sum(rs, r => r.customDeductionTotal)], ["Total manual deductions (SAR)", sum(rs, r => r.manualDeductionTotal)],
    ["Total cap / floor adjustments (SAR)", sum(slips, s => s.capFloorAdjustment)],
    ["Total deductions (SAR)", sum(slips, s => s.totalDeductions)],
    ["Total net salary (SAR)", sum(rs, r => r.finalNetSalary)],
    ["Total net payable, rounded per rider (SAR)", toHalalas(sum(rs, r => toHalalas(r.finalNetSalary)))],
    ["Total uploaded basic payment (SAR)", sum(rs, r => r.uploadedBasicPayment)], ["Total variance (SAR)", sum(rs, r => r.varianceAmount)],
    [null, null], ["Check: gross − deductions − net", sum(slips, s => s.gross - s.totalDeductions - s.net)],
  ] }
  const head = ["Rider ID", "Driver name", "Contract", "Vehicle", "Band", "Completed orders", "Target orders", "Extra orders", "Missing orders", "Working days", "Working hours",
    "Salary per order", "Earned base", "Missing-order deduction", "Extra-orders bonus", "Custom bonuses", "Manual bonuses", "Gross salary",
    "Platform penalties", "Traffic", "Custom deductions", "Manual deductions", "Cap / floor adj.", "Total deductions", "Net salary",
    "Uploaded basic payment", "Variance", "Variance %", "Variance status", "Review status", "Inactive reason"]
  const body = rows.map(({ result: r }, i) => {
    const s = slips[i]
    return [r.riderId, r.driverName, r.contractName, r.vehicleType, BAND[r.performanceBand] ?? r.performanceBand, r.completedOrders, r.selectedTargetThreshold, r.extraOrders, r.missingOrders,
      r.actualWorkingDays, r.workingHours, r.appliedSalaryPerOrder, s.earnings.find(l => l.key === "base")?.amount ?? 0, r.missingOrderDeduction, r.bonusAmount, r.customBonusTotal, r.manualBonusTotal,
      r.grossSalaryBeforePenalties, r.totalOtherPenalties, r.trafficViolationsDeduction, r.customDeductionTotal, r.manualDeductionTotal, s.capFloorAdjustment, s.totalDeductions, r.finalNetSalary,
      r.uploadedBasicPayment, r.varianceAmount, r.variancePercentage, r.varianceStatus, r.reviewStatus, r.inactiveReason || "Active"] as Cell[]
  })
  const totalsRow: Cell[] = head.map((_, c) => (c === 0 ? "TOTAL" : c >= 5 && c <= 27 && c !== 11 ? sum(body, row => Number(row[c]) || 0) : null))
  const results: SheetSpec = { name: "Driver Results", cols: head.map((h, i) => (i === 1 ? 24 : Math.max(12, Math.min(22, h.length + 2)))), rows: [head, ...body, totalsRow] }

  const pHead = ["Rider ID", "Driver name", ...DEDUCTIBLE_PENALTY_KEYS.map(k => PENALTY_LABELS[k].en), "Cap adjustment", "Total penalties"]
  const pBody = rs.map((r, i) => [r.riderId, r.driverName, ...DEDUCTIBLE_PENALTY_KEYS.map(k => r.penalties[k] || 0), slips[i].penaltyCapAdjustment, r.totalOtherPenalties] as Cell[])
  const penalties: SheetSpec = { name: "Penalties Breakdown", cols: pHead.map((_, i) => (i === 1 ? 24 : 16)), rows: [pHead, ...pBody, ["TOTAL", null, ...pHead.slice(2).map((_, j) => sum(pBody, row => Number(row[j + 2]) || 0))]] }

  const aRows: Cell[][] = [["Rider ID", "Driver name", "Type", "Item", "Amount (SAR)"]]
  for (const r of rs) {
    for (const b of r.customBonuses) aRows.push([r.riderId, r.driverName, "Custom bonus", b.name, b.amount])
    for (const b of r.manualBonuses) aRows.push([r.riderId, r.driverName, "Manual bonus", b.title, b.amount])
    for (const d of r.customDeductions) aRows.push([r.riderId, r.driverName, d.monthlyDeduction !== undefined ? "Custom deduction (installment)" : "Custom deduction", d.name, d.monthlyDeduction ?? d.amount])
    for (const d of r.manualDeductions) aRows.push([r.riderId, r.driverName, "Manual deduction", d.title, d.amount])
    if (r.trafficViolationsDeduction) aRows.push([r.riderId, r.driverName, "Traffic violations", "Traffic fines", r.trafficViolationsDeduction])
  }
  const adjustments: SheetSpec = { name: "Adjustments", cols: [14, 24, 28, 30, 14], rows: aRows }

  const bank: SheetSpec = { name: "Bank Transfer", cols: [14, 28, 30, 30, 16], rows: [["Rider ID", "Beneficiary name", "IBAN", "Bank", "Amount (SAR)"],
    ...rows.map(({ result: r, bank: b }) => [r.riderId, b?.beneficiaryName || r.driverName, b?.iban ?? "", b?.bankName ?? "", toHalalas(r.finalNetSalary)] as Cell[]),
    ["TOTAL", null, null, null, toHalalas(sum(rs, r => toHalalas(r.finalNetSalary)))]] }
  return [summary, results, penalties, adjustments, bank]
}

export function incomeExpensesSheets(dash: IncomeDashboard, month: string, companyName = ""): SheetSpec[] {
  const s = dash.summary
  const exec: SheetSpec = { name: "Executive Summary", cols: [36, 18, 18, 18, 18], rows: [
    [`${companyName ? companyName + " — " : ""}Income vs Expenses`, null], ["Month", month], ["Riders with income", s.activeDrivers], ["Active driver count (shared split)", dash.activeDriverCount],
    ["Total income (SAR)", s.totalIncome], ["Total expenses allocated (SAR)", s.totalExpenses], ["Net profit (SAR)", s.totalNetProfit], ["Average net per rider (SAR)", s.avgNetPerDriver],
    ["Profitable / loss riders", `${s.profitableCount} / ${s.unprofitableCount}`], [null, null],
    ["Income by company", null], ["Company", "Riders", "Income", "Expenses", "Net"],
    ...dash.incomeByCompany.map(c => [c.name, c.driverCount, c.income, c.expenses, c.net] as Cell[]), [null, null],
    ["Expenses entered by category", null], ["Category", "Amount entered", "Per active driver"],
    ...dash.expenseByCategory.map(c => [c.name, c.amount, dash.activeDriverCount > 0 ? c.amount / dash.activeDriverCount : 0] as Cell[]), [null, null],
    ["Reconciliation", null],
    ["Per-driver expenses × riders (charged)", dash.reconciliation.perDriverCharged],
    ["Shared expenses entered", dash.reconciliation.sharedEntered], ["Shared expenses allocated to riders", dash.reconciliation.sharedAllocated], ["Shared expenses not allocated", dash.reconciliation.sharedUnallocated],
    ["Assigned expenses entered", dash.reconciliation.assignedEntered], ["Assigned expenses matched to riders", dash.reconciliation.assignedAllocated], ["Assigned expenses with no income row", dash.reconciliation.assignedUnmatched],
  ] }
  const head = ["Rider ID", "Driver name", "Company", "Basic pay", "Distance pay", "Segment pay", "Custom fields (net)", "Total penalties", "Rider balance", "Total income", "Per-driver exp.", "Shared exp.", "Assigned exp.", "Total expenses", "Net profit"]
  const body = dash.driverResults.map(d => [d.riderId, d.driverName, d.companyName, d.record.basicPayment, d.record.distancePayment, d.record.segmentPayment, d.income.customFieldsTotal, d.income.totalPenalties, d.record.riderBalance,
    d.income.totalIncome, d.expenses.perDriverTotal, d.expenses.sharedTotal, d.expenses.assignedTotal, d.expenses.totalExpenses, d.netProfit] as Cell[])
  const details: SheetSpec = { name: "Driver Details", cols: head.map((_, i) => (i === 1 ? 24 : 14)), rows: [head, ...body, ["TOTAL", null, null, ...head.slice(3).map((_, j) => sum(body, r => Number(r[j + 3]) || 0))]] }
  return [exec, details]
}
