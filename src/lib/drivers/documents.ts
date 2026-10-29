// Shared types for driver documents (014_drivers.sql driver_documents).
// Client-safe: type-only, no server imports.

export const DOC_REGISTER_TYPES = ["iqama","passport","driving_license","vehicle_license","medical_certificate","police_clearance","employment_contract","bank_letter","photo","other","national_id","health_certificate","home_delivery_permit","ajeer_permit","food_handling_certificate","vehicle_lease_agreement","driver_card","work_permit","authorization_letter","training_certificate"] as const

export const DOC_UPLOAD_TYPES = [
  "national_id",
  "iqama",
  "driving_license",
  "health_certificate",
  "home_delivery_permit",
  "ajeer_permit",
] as const

export type DriverDocType = (typeof DOC_UPLOAD_TYPES)[number]

export interface DriverDocument {
  workflow_version: number
  id: string
  driver_id: string
  doc_type: string
  doc_number: string | null
  expiry_date: string | null
  issuing_authority: string | null
  file_url: string
  is_verified: boolean
  is_active: boolean
  created_at: string
}
