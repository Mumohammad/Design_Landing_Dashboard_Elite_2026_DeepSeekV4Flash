/// <reference lib="es2020.bigint" />
import { z } from "zod"

export type DriverCategory =
  | "sponsored_type1"
  | "sponsored_type2"
  | "freelancer"

export type DriverStatus =
  | "draft"
  | "active"
  | "on_leave"
  | "suspended"
  | "terminated"
  | "blacklisted"

export type EmploymentType = "full_time" | "part_time" | "contract" | "temporary"

export type ContractType = "unlimited" | "limited" | "task_based"

export type DriverDocumentType =
  | "iqama"
  | "passport"
  | "driving_license"
  | "vehicle_license"
  | "medical_certificate"
  | "police_clearance"
  | "employment_contract"
  | "bank_letter"
  | "photo"
  | "other"

export type CodStatus = "pending" | "reconciled" | "disputed" | "written_off"

export const driverCategorySchema = z.enum([
  "sponsored_type1",
  "sponsored_type2",
  "freelancer",
])

export const driverStatusSchema = z.enum([
  "draft",
  "active",
  "on_leave",
  "suspended",
  "terminated",
  "blacklisted",
])

export const employmentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "temporary",
])

export const contractTypeSchema = z.enum(["unlimited", "limited", "task_based"])

export const driverDocumentTypeSchema = z.enum([
  "iqama",
  "passport",
  "driving_license",
  "vehicle_license",
  "medical_certificate",
  "police_clearance",
  "employment_contract",
  "bank_letter",
  "photo",
  "other",
])

export const codStatusSchema = z.enum([
  "pending",
  "reconciled",
  "disputed",
  "written_off",
])

export interface Driver {
  id: string
  tenant_id: string
  driver_code: string | null
  full_name_ar: string
  full_name_en: string | null
  preferred_name: string | null
  photo_url: string | null
  nationality: string | null
  nationality_code: string | null
  date_of_birth: string | null
  place_of_birth: string | null
  gender: string | null
  marital_status: string | null
  iqama_number: string | null
  iqama_issue_date: string | null
  iqama_expiry_date: string | null
  profession_on_iqama: string | null
  passport_number: string | null
  passport_expiry_date: string | null
  license_number: string | null
  license_type: string | null
  license_issue_date: string | null
  license_expiry_date: string | null
  primary_mobile: string
  secondary_mobile: string | null
  personal_email: string | null
  work_email: string | null
  current_city: string | null
  current_region: string | null
  national_address: string | null
  category: DriverCategory
  employment_type: EmploymentType | null
  contract_type: ContractType | null
  status: DriverStatus
  job_title: string | null
  department: string | null
  cost_center: string | null
  hire_date: string | null
  onboarding_date: string | null
  probation_start: string | null
  probation_end: string | null
  contract_start: string | null
  contract_end: string | null
  termination_date: string | null
  termination_reason: string | null
  rehire_eligible: boolean
  supervisor_id: string | null
  hr_owner_id: string | null
  ops_owner_id: string | null
  payroll_rule_id: string | null
  basic_salary: number | null
  housing_allowance: number | null
  transport_allowance: number | null
  other_allowances: Record<string, unknown> | null
  gosi_wage_basis: number | null
  payroll_group: string | null
  bank_name: string | null
  iban: string | null
  payment_method: string | null
  primary_platform_id: string | null
  current_vehicle_id: string | null
  driver_type: string | null
  city_zone: string | null
  service_area: string | null
  shift_type: string | null
  operational_state: string | null
  dispatch_eligible: boolean
  cod_outstanding_amount: number
  cod_last_reconciled_at: string | null
  cod_risk_flag: boolean
  cod_risk_reason: string | null
  profile_completeness_score: number
  compliance_risk_score: number
  documents_complete: boolean
  last_compliance_review_at: string | null
  next_compliance_review_at: string | null
  tags: string[] | null
  internal_notes: string | null
  priority: string
  archived_reason: string | null
  created_at: string
  updated_at: string
}

export interface DriverDocument {
  id: string
  tenant_id: string
  driver_id: string
  document_type: DriverDocumentType
  document_number: string | null
  issue_date: string | null
  expiry_date: string | null
  file_url: string
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  verified: boolean
  verified_by: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface DriverEmergencyContact {
  id: string
  tenant_id: string
  driver_id: string
  full_name: string
  relationship: string | null
  mobile: string
  email: string | null
  is_primary: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface DriverCodSession {
  id: string
  tenant_id: string
  driver_id: string
  platform_id: string
  session_date: string
  orders_with_cod: number
  cod_collected: number
  cod_submitted: number
  submission_method: string
  status: CodStatus
  reconciled_at: string | null
  reconciled_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface DriverSalaryHistory {
  id: string
  tenant_id: string
  driver_id: string
  basic_salary_old: number | null
  basic_salary_new: number | null
  housing_allowance_old: number | null
  housing_allowance_new: number | null
  transport_allowance_old: number | null
  transport_allowance_new: number | null
  change_reason: string | null
  effective_date: string
  changed_by: string
  created_at: string
}

export interface DriverPayrollRule {
  id: string
  tenant_id: string
  name: string
  description: string | null
  rule_type: string
  calculation_config: Record<string, unknown> | null
  is_active: boolean
  created_at: string
  updated_at: string
}

const SAUDI_MOBILE_REGEX = /^(05\d{8}|\+9665\d{8})$/
const IQAMA_REGEX = /^[12]\d{9}$/

export function validateSaudiIBAN(iban: string): boolean {
  if (!/^SA\d{22}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (ch) =>
    (ch.charCodeAt(0) - 55).toString(),
  )
  return BigInt(numeric) % BigInt(97) === BigInt(1)
}

const driverCreateBaseSchema = z.object({
  driver_code: z.string().nullable().optional(),
  full_name_ar: z.string().min(1),
  full_name_en: z.string().nullable().optional(),
  preferred_name: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  nationality_code: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  place_of_birth: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  marital_status: z.string().nullable().optional(),
  iqama_number: z
    .string()
    .regex(IQAMA_REGEX, "Invalid iqama number")
    .nullable()
    .optional(),
  iqama_issue_date: z.string().nullable().optional(),
  iqama_expiry_date: z.string().nullable().optional(),
  profession_on_iqama: z.string().nullable().optional(),
  passport_number: z.string().nullable().optional(),
  passport_expiry_date: z.string().nullable().optional(),
  license_number: z.string().nullable().optional(),
  license_type: z.string().nullable().optional(),
  license_issue_date: z.string().nullable().optional(),
  license_expiry_date: z.string().nullable().optional(),
  primary_mobile: z
    .string()
    .regex(SAUDI_MOBILE_REGEX, "Invalid Saudi mobile number"),
  secondary_mobile: z
    .string()
    .regex(SAUDI_MOBILE_REGEX, "Invalid Saudi mobile number")
    .nullable()
    .optional(),
  personal_email: z.email().nullable().optional(),
  work_email: z.email().nullable().optional(),
  current_city: z.string().nullable().optional(),
  current_region: z.string().nullable().optional(),
  national_address: z.string().nullable().optional(),
  category: driverCategorySchema,
  employment_type: employmentTypeSchema.nullable().optional(),
  contract_type: contractTypeSchema.nullable().optional(),
  status: driverStatusSchema,
  job_title: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  cost_center: z.string().nullable().optional(),
  hire_date: z.string().nullable().optional(),
  onboarding_date: z.string().nullable().optional(),
  probation_start: z.string().nullable().optional(),
  probation_end: z.string().nullable().optional(),
  contract_start: z.string().nullable().optional(),
  contract_end: z.string().nullable().optional(),
  termination_date: z.string().nullable().optional(),
  termination_reason: z.string().nullable().optional(),
  rehire_eligible: z.boolean().optional(),
  supervisor_id: z.string().nullable().optional(),
  hr_owner_id: z.string().nullable().optional(),
  ops_owner_id: z.string().nullable().optional(),
  payroll_rule_id: z.string().nullable().optional(),
  basic_salary: z.number().min(500).max(50000).nullable().optional(),
  housing_allowance: z.number().min(0).nullable().optional(),
  transport_allowance: z.number().min(0).nullable().optional(),
  other_allowances: z.record(z.string(), z.unknown()).nullable().optional(),
  gosi_wage_basis: z.number().nullable().optional(),
  payroll_group: z.string().nullable().optional(),
  bank_name: z.string().nullable().optional(),
  iban: z
    .string()
    .refine(validateSaudiIBAN, "Invalid Saudi IBAN")
    .nullable()
    .optional(),
  payment_method: z.string().nullable().optional(),
  primary_platform_id: z.string().nullable().optional(),
  current_vehicle_id: z.string().nullable().optional(),
  driver_type: z.string().nullable().optional(),
  city_zone: z.string().nullable().optional(),
  service_area: z.string().nullable().optional(),
  shift_type: z.string().nullable().optional(),
  operational_state: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  internal_notes: z.string().nullable().optional(),
  priority: z.string().optional(),
})

const contractDateRefine = (data: {
  contract_start?: string | null
  contract_end?: string | null
}) => {
  if (data.contract_start && data.contract_end) {
    return data.contract_end > data.contract_start
  }
  return true
}

export const driverCreateSchema = driverCreateBaseSchema.refine(
  contractDateRefine,
  {
    message: "contract_end must be after contract_start",
    path: ["contract_end"],
  },
)

export const driverUpdateSchema = driverCreateBaseSchema
  .partial()
  .refine(contractDateRefine, {
    message: "contract_end must be after contract_start",
    path: ["contract_end"],
  })

export const codSessionSchema = z.object({
  driver_id: z.string().min(1),
  platform_id: z.string().min(1),
  session_date: z.string().min(1),
  orders_with_cod: z.number().int().min(0),
  cod_collected: z.number().min(0),
  cod_submitted: z.number().min(0),
  submission_method: z.string().min(1),
  notes: z.string().nullable().optional(),
})

export type DriverCreateInput = z.infer<typeof driverCreateSchema>
export type DriverUpdateInput = z.infer<typeof driverUpdateSchema>
export type CodSessionInput = z.infer<typeof codSessionSchema>
