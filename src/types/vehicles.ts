import { z } from "zod"

export type VehicleStatus =
  | "available"
  | "assigned"
  | "in_maintenance"
  | "off_road"
  | "retired"

export type VehicleCondition = "excellent" | "good" | "fair" | "poor" | "damaged"

export type FuelType = "petrol" | "diesel" | "hybrid" | "electric"

export type VehicleDocumentType =
  | "registration"
  | "insurance"
  | "inspection"
  | "operating_card"
  | "ownership"
  | "modification_permit"
  | "other"

export type HandoverFormType = "handover" | "return"

export type MaintenanceType =
  | "preventive"
  | "emergency"
  | "periodic"
  | "repair"

export type MaintenanceStatus =
  | "open"
  | "in_progress"
  | "completed"
  | "cancelled"

export const vehicleStatusSchema = z.enum([
  "available",
  "assigned",
  "in_maintenance",
  "off_road",
  "retired",
])

export const vehicleConditionSchema = z.enum([
  "excellent",
  "good",
  "fair",
  "poor",
  "damaged",
])

export const fuelTypeSchema = z.enum(["petrol", "diesel", "hybrid", "electric"])

export const vehicleDocumentTypeSchema = z.enum([
  "registration",
  "insurance",
  "inspection",
  "operating_card",
  "ownership",
  "modification_permit",
  "other",
])

export const handoverFormTypeSchema = z.enum(["handover", "return"])

export const maintenanceTypeSchema = z.enum([
  "preventive",
  "emergency",
  "periodic",
  "repair",
])

export const maintenanceStatusSchema = z.enum([
  "open",
  "in_progress",
  "completed",
  "cancelled",
])

export interface Vehicle {
  id: string
  tenant_id: string
  vehicle_code: string | null
  plate_number: string
  plate_type: string | null
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  vin: string | null
  fuel_type: FuelType | null
  vehicle_category: string | null
  status: VehicleStatus
  condition: VehicleCondition
  current_odometer: number
  odometer_unit: string
  assigned_driver_id: string | null
  current_assignment_id: string | null
  primary_platform_id: string | null
  city_zone: string | null
  service_area: string | null
  operational_state: string | null
  purchase_date: string | null
  purchase_price: number | null
  current_value: number | null
  insurance_provider: string | null
  insurance_policy_number: string | null
  insurance_expiry_date: string | null
  registration_expiry_date: string | null
  operating_card_expiry: string | null
  next_inspection_date: string | null
  fuel_level: number | null
  handover_required: boolean
  last_handover_form_id: string | null
  notes: string | null
  tags: string[] | null
  created_at: string
  updated_at: string
}

export interface VehicleDocument {
  id: string
  tenant_id: string
  vehicle_id: string
  document_type: VehicleDocumentType
  document_number: string | null
  issue_date: string | null
  expiry_date: string | null
  issuing_authority: string | null
  file_url: string
  file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  is_active: boolean
  verified: boolean
  verified_by: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface VehicleHandoverForm {
  id: string
  tenant_id: string
  vehicle_id: string
  form_type: HandoverFormType
  form_date: string
  from_driver_id: string | null
  to_driver_id: string | null
  odometer_reading: number
  fuel_level: number | null
  overall_condition: VehicleCondition
  condition_checklist: Record<string, boolean> | null
  items_present: string[] | null
  defects_noted: string | null
  photos: string[] | null
  handed_by_signature: string | null
  received_by_signature: string | null
  handed_by: string | null
  received_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface VehicleAssignment {
  id: string
  tenant_id: string
  vehicle_id: string
  driver_id: string
  assigned_at: string
  returned_at: string | null
  start_odometer: number | null
  end_odometer: number | null
  assignment_reason: string | null
  handover_form_id: string | null
  return_form_id: string | null
  status: string
  assigned_by: string | null
  returned_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface VehicleOdometerLog {
  id: string
  tenant_id: string
  vehicle_id: string
  reading: number
  reading_date: string
  source: string | null
  logged_by: string | null
  notes: string | null
  created_at: string
}

export interface VehicleMaintenanceEvent {
  id: string
  tenant_id: string
  vehicle_id: string
  maintenance_type: MaintenanceType
  status: MaintenanceStatus
  event_date: string
  completed_date: string | null
  odometer_at_service: number | null
  description: string | null
  cost: number | null
  vendor: string | null
  invoice_number: string | null
  parts_replaced: string[] | null
  next_service_date: string | null
  next_service_odometer: number | null
  performed_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const vehicleCreateBaseSchema = z.object({
  vehicle_code: z.string().nullable().optional(),
  plate_number: z
    .string()
    .min(4)
    .refine(
      (val) => {
        const arabicPlate = /^[\u0600-\u06FF]{1,3}\s?\d{3,4}$/
        const englishPlate = /^[A-Z]{1,3}\s?\d{3,4}$/
        const numericOnly = /^\d{4,7}$/
        return (
          arabicPlate.test(val) ||
          englishPlate.test(val) ||
          numericOnly.test(val)
        )
      },
      "Invalid Saudi plate format",
    ),
  plate_type: z.string().nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z
    .number()
    .int()
    .min(1950)
    .max(new Date().getFullYear() + 1)
    .nullable()
    .optional(),
  color: z.string().nullable().optional(),
  vin: z.string().nullable().optional(),
  fuel_type: fuelTypeSchema.nullable().optional(),
  vehicle_category: z.string().nullable().optional(),
  status: vehicleStatusSchema.optional(),
  condition: vehicleConditionSchema.optional(),
  current_odometer: z.number().int().min(0).optional(),
  odometer_unit: z.string().optional(),
  assigned_driver_id: z.string().nullable().optional(),
  current_assignment_id: z.string().nullable().optional(),
  primary_platform_id: z.string().nullable().optional(),
  city_zone: z.string().nullable().optional(),
  service_area: z.string().nullable().optional(),
  operational_state: z.string().nullable().optional(),
  purchase_date: z.string().nullable().optional(),
  purchase_price: z.number().min(0).nullable().optional(),
  current_value: z.number().min(0).nullable().optional(),
  insurance_provider: z.string().nullable().optional(),
  insurance_policy_number: z.string().nullable().optional(),
  insurance_expiry_date: z.string().nullable().optional(),
  registration_expiry_date: z.string().nullable().optional(),
  operating_card_expiry: z.string().nullable().optional(),
  next_inspection_date: z.string().nullable().optional(),
  fuel_level: z.number().min(0).max(100).nullable().optional(),
  handover_required: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
})

export const vehicleCreateSchema = vehicleCreateBaseSchema

export const vehicleUpdateSchema = vehicleCreateBaseSchema.partial()

export const handoverFormSchema = z.object({
  form_type: handoverFormTypeSchema,
  form_date: z.string().min(1),
  from_driver_id: z.string().nullable().optional(),
  to_driver_id: z.string().nullable().optional(),
  odometer_reading: z.number().int().min(0),
  fuel_level: z.number().min(0).max(100).nullable().optional(),
  overall_condition: vehicleConditionSchema,
  condition_checklist: z.record(z.string(), z.boolean()).nullable().optional(),
  items_present: z.array(z.string()).nullable().optional(),
  defects_noted: z.string().nullable().optional(),
  photos: z.array(z.string()).nullable().optional(),
  handed_by_signature: z.string().nullable().optional(),
  received_by_signature: z.string().nullable().optional(),
  handed_by: z.string().nullable().optional(),
  received_by: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export type VehicleCreateInput = z.infer<typeof vehicleCreateSchema>
export type VehicleUpdateInput = z.infer<typeof vehicleUpdateSchema>
export type HandoverFormInput = z.infer<typeof handoverFormSchema>
