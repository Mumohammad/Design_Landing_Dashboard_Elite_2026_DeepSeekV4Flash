// Application types for the Driver Registration review module.
// Mirrors supabase/migrations/029_driver_applications.sql + 030.

export type ApplicationStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"

export type ApplicationIdentityType = "iqama" | "national_id" | "passport"
export type ApplicationWorkType = "full_time" | "freelancer"
export type ApplicationDriverCategory =
  | "sponsored_type_1"
  | "sponsored_type_2"
  | "freelancer"

export type ApplicationDocumentType =
  | "profile_photo"
  | "identity"
  | "license"
  | "vehicle_reg"
  | "vehicle_insurance"

export type DocumentVerificationStatus = "pending" | "verified" | "rejected"

export interface DriverApplication {
  id: string
  application_number: string
  tenant_id: string
  locale: "ar" | "en" | "ur" | "bn"

  // Personal
  first_name: string
  middle_name: string | null
  last_name: string
  full_name: string
  date_of_birth: string | null
  nationality: string | null
  gender: "male" | "female" | null

  // Contact
  mobile: string
  alternative_mobile: string | null
  email: string | null
  city: string | null
  district: string | null
  address: string | null

  // Identity
  identity_type: ApplicationIdentityType
  identity_number: string | null
  identity_expiry: string | null

  // License
  license_number: string | null
  license_type: string | null
  license_country: string | null
  license_expiry: string | null

  // Work
  work_type: ApplicationWorkType
  driver_category: ApplicationDriverCategory | null
  platform_codes: string[]

  // Vehicle
  has_vehicle: boolean | null
  vehicle_ownership: string | null
  vehicle_type: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  vehicle_plate: string | null
  vehicle_reg_expiry: string | null
  vehicle_insurance_expiry: string | null

  // Consent
  consent_terms: boolean
  consent_privacy: boolean
  consent_at: string | null

  status: ApplicationStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null

  created_at: string
  updated_at: string
  submitted_at: string
}

export interface DriverApplicationDocument {
  id: string
  application_id: string
  tenant_id: string
  document_type: ApplicationDocumentType
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size: number | null
  expiry_date: string | null
  verification_status: DocumentVerificationStatus
  uploaded_at: string
}
