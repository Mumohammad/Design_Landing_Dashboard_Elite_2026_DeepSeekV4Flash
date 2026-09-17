// Shared types for driver documents (014_drivers.sql driver_documents).
// Client-safe: type-only, no server imports.

export const DOC_UPLOAD_TYPES = [
  "national_id",
  "iqama",
  "health_certificate",
  "home_delivery_permit",
  "ajeer_permit",
] as const

export type DriverDocType = (typeof DOC_UPLOAD_TYPES)[number]

export interface DriverDocument {
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
