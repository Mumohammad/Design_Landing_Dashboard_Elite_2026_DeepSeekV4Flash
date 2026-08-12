export type PayrollRecord = {
  id: string
  driverId: string
  driverName: string
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  performanceBonus: number
  overtime: number
  absenceDeduction: number
  violationDeduction: number
  advanceDeduction: number
  gosiDeduction: number
  otherDeductions: number
  netAmount: number
  status: "pending" | "approved" | "paid"
}

export const payrolls: PayrollRecord[] = [
  {
    id: "pay-001",
    driverId: "driver-001",
    driverName: "Ahmed Alotaibi",
    basicSalary: 4200,
    housingAllowance: 800,
    transportAllowance: 250,
    performanceBonus: 120,
    overtime: 220,
    absenceDeduction: 0,
    violationDeduction: 0,
    advanceDeduction: 0,
    gosiDeduction: 315,
    otherDeductions: 0,
    netAmount: 5275,
    status: "approved",
  },
  {
    id: "pay-002",
    driverId: "driver-002",
    driverName: "Mona Alsubaie",
    basicSalary: 3800,
    housingAllowance: 750,
    transportAllowance: 250,
    performanceBonus: 90,
    overtime: 160,
    absenceDeduction: 0,
    violationDeduction: 0,
    advanceDeduction: 200,
    gosiDeduction: 285,
    otherDeductions: 0,
    netAmount: 4565,
    status: "pending",
  },
]
