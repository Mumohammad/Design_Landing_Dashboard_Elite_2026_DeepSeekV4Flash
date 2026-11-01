// Shared types for driver documents (014_drivers.sql driver_documents).
// Client-safe: type-only, no server imports.

export const DOC_REGISTER_TYPES = ["iqama","passport","driving_license","vehicle_license","medical_certificate","police_clearance","employment_contract","bank_letter","photo","other","national_id","health_certificate","home_delivery_permit","ajeer_permit","food_handling_certificate","vehicle_lease_agreement","driver_card","work_permit","authorization_letter","training_certificate","medical_insurance","vehicle_insurance","vehicle_handover_report","vehicle_return_report","accident_report"] as const

export type DocCategory = "identity" | "driving" | "health" | "vehicle" | "employment"

export interface DocTypeMeta { type: (typeof DOC_REGISTER_TYPES)[number]; en: string; ar: string; category: DocCategory; expires: boolean; core?: boolean }

/** Document vault catalogue: label, grouping and whether the document expires. */
export const DOC_CATALOG: readonly DocTypeMeta[] = [
  { type: "national_id", en: "National ID", ar: "الهوية الوطنية", category: "identity", expires: true },
  { type: "iqama", en: "Iqama (Residence ID)", ar: "الإقامة", category: "identity", expires: true, core: true },
  { type: "passport", en: "Passport", ar: "جواز السفر", category: "identity", expires: true, core: true },
  { type: "work_permit", en: "Work permit", ar: "تصريح العمل", category: "identity", expires: true },
  { type: "driving_license", en: "Driving licence", ar: "رخصة القيادة", category: "driving", expires: true, core: true },
  { type: "home_delivery_permit", en: "Home delivery permit", ar: "تصريح التوصيل", category: "driving", expires: true },
  { type: "ajeer_permit", en: "Ajeer permit", ar: "تصريح أجير", category: "driving", expires: true },
  { type: "driver_card", en: "Driver card", ar: "بطاقة السائق", category: "driving", expires: true },
  { type: "training_certificate", en: "Training certificate", ar: "شهادة التدريب", category: "driving", expires: false },
  { type: "health_certificate", en: "Health certificate", ar: "الشهادة الصحية", category: "health", expires: true },
  { type: "medical_insurance", en: "Medical insurance", ar: "التأمين الطبي", category: "health", expires: true, core: true },
  { type: "medical_certificate", en: "Medical certificate", ar: "الشهادة الطبية", category: "health", expires: true },
  { type: "food_handling_certificate", en: "Food handling certificate", ar: "شهادة تداول الأغذية", category: "health", expires: true },
  { type: "vehicle_license", en: "Vehicle registration (Istimara)", ar: "استمارة المركبة", category: "vehicle", expires: true },
  { type: "vehicle_insurance", en: "Vehicle insurance", ar: "تأمين المركبة", category: "vehicle", expires: true, core: true },
  { type: "vehicle_lease_agreement", en: "Vehicle lease agreement", ar: "عقد إيجار المركبة", category: "vehicle", expires: true },
  { type: "vehicle_handover_report", en: "Vehicle handover report", ar: "تقرير تسليم المركبة", category: "vehicle", expires: false, core: true },
  { type: "vehicle_return_report", en: "Vehicle return report", ar: "تقرير استلام المركبة", category: "vehicle", expires: false },
  { type: "accident_report", en: "Accident report (Najm)", ar: "تقرير حادث (نجم)", category: "vehicle", expires: false },
  { type: "employment_contract", en: "Employment contract", ar: "عقد العمل", category: "employment", expires: true, core: true },
  { type: "bank_letter", en: "Bank letter (IBAN)", ar: "خطاب البنك (الآيبان)", category: "employment", expires: false },
  { type: "police_clearance", en: "Police clearance", ar: "صحيفة الحالة الجنائية", category: "employment", expires: true },
  { type: "authorization_letter", en: "Authorization letter", ar: "خطاب التفويض", category: "employment", expires: true },
  { type: "other", en: "Other document", ar: "مستند آخر", category: "employment", expires: false },
]

export const DOC_CATEGORIES: readonly { id: DocCategory; en: string; ar: string }[] = [
  { id: "identity", en: "Identity & residency", ar: "الهوية والإقامة" },
  { id: "driving", en: "Driving & permits", ar: "القيادة والتصاريح" },
  { id: "health", en: "Health & insurance", ar: "الصحة والتأمين" },
  { id: "vehicle", en: "Vehicle & handover", ar: "المركبة والتسليم" },
  { id: "employment", en: "Employment & finance", ar: "العمل والمالية" },
]

const META = new Map(DOC_CATALOG.map((d) => [d.type as string, d]))
export function docTypeMeta(type: string): DocTypeMeta | undefined { return META.get(type) }
export function docTypeLabel(type: string, isAr: boolean): string {
  const m = META.get(type)
  return m ? (isAr ? m.ar : m.en) : type === "photo" ? (isAr ? "الصورة" : "Photo") : (isAr ? "مستند" : "Document")
}

/** Every uploadable type (photo is handled by the profile photo flow). */
export const DOC_UPLOAD_TYPES = DOC_CATALOG.map((d) => d.type)

export type DriverDocType = (typeof DOC_REGISTER_TYPES)[number]

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
