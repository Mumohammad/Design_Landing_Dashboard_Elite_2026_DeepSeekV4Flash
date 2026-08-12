import { z } from "zod"

export const payrollSchema = z.object({
  id: z.string(),
  driverId: z.string(),
  basicSalary: z.number(),
  housingAllowance: z.number(),
  transportAllowance: z.number(),
  performanceBonus: z.number().optional(),
  overtime: z.number().optional(),
  absenceDeduction: z.number().optional(),
  violationDeduction: z.number().optional(),
  advanceDeduction: z.number().optional(),
  gosiDeduction: z.number().optional(),
  otherDeductions: z.number().optional(),
  netAmount: z.number(),
  status: z.enum(["pending", "approved", "paid"]),
})

export const driverSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameArabic: z.string().optional(),
  nationality: z.string(),
  iqamaNumber: z.string(),
  iqamaExpiry: z.string(),
  passportNumber: z.string(),
  passportExpiry: z.string(),
  licenseNumber: z.string(),
  licenseExpiry: z.string(),
  phone: z.string(),
  photoUrl: z.string().optional(),
  hireDate: z.string(),
  contractType: z.string(),
  salary: z.number(),
  employmentStatus: z.enum(["active", "suspended", "on_leave"]),
})
