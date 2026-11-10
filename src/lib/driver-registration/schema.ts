import { z } from "zod"

// ─────────────────────────────────────────────────────────────────────────────
// Driver Registration — zod schemas (client + server share these).
// ─────────────────────────────────────────────────────────────────────────────

export const mobileRegex = /^(\+?966|0)?5\d{8}$/

const saMobile = z
  .string()
  .min(1, "errorRequired")
  .regex(mobileRegex, "errorInvalidMobile")

const optionalString = z
  .string()
  .trim()
  .max(120, "errorTooLong")
  .optional()
  .or(z.literal(""))

const nameField = z.string().trim().min(2, "errorRequired").max(80, "errorTooLong")

export const personalSchema = z.object({
  firstName: nameField,
  middleName: optionalString,
  lastName: nameField,
  dateOfBirth: z.string().min(1, "errorRequired"),
  nationality: z.string().trim().min(2, "errorRequired").max(60, "errorTooLong"),
  gender: z.enum(["male", "female"], { message: "errorRequired" }),
})
export type PersonalValues = z.infer<typeof personalSchema>

export const contactSchema = z.object({
  mobile: saMobile,
  alternativeMobile: optionalString.refine((v) => !v || mobileRegex.test(v), {
    message: "errorInvalidMobile",
  }),
  email: z.union([z.literal(""), z.string().trim().email("errorInvalidEmail").max(120, "errorTooLong")]),
  city: z.string().trim().min(2, "errorRequired").max(80, "errorTooLong"),
  district: z.string().trim().min(2, "errorRequired").max(80, "errorTooLong"),
  address: z.string().trim().min(5, "errorRequired").max(200, "errorTooLong"),
})
export type ContactValues = z.infer<typeof contactSchema>

export const identityTypeEnum = z.enum(["iqama", "national_id", "passport"])

export const identitySchema = z
  .object({
    identityType: identityTypeEnum,
    identityNumber: z.string().trim().min(4, "errorRequired").max(20, "errorTooLong"),
    identityExpiry: z.string(), // date or "" for passport
    identityAttachment: z.string().min(1, "errorRequired"), // storage path after upload
  })
  .superRefine((data, ctx) => {
    if (data.identityType !== "passport" && !data.identityExpiry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identityExpiry"],
        message: "errorRequired",
      })
    }
  })
export type IdentityValues = z.infer<typeof identitySchema>

export const licenseSchema = z.object({
  licenseNumber: z.string().trim().min(4, "errorRequired").max(20, "errorTooLong"),
  licenseType: z.string().trim().min(2, "errorRequired").max(60, "errorTooLong"),
  licenseCountry: z.string().trim().min(2, "errorRequired").max(60, "errorTooLong"),
  licenseExpiry: z.string().min(1, "errorRequired"),
  licenseAttachment: z.string().min(1, "errorRequired"),
})
export type LicenseValues = z.infer<typeof licenseSchema>

export const workSchema = z.object({
  workType: z.enum(["full_time", "freelancer"], { message: "errorRequired" }),
  driverCategory: z.enum(["sponsored_type_1", "sponsored_type_2", "freelancer"], {
    message: "errorRequired",
  }),
})
export type WorkValues = z.infer<typeof workSchema>

export const platformsSchema = z.object({
  platforms: z.array(z.string()).min(1, "errorNone"),
})
export type PlatformsValues = z.infer<typeof platformsSchema>

const vehicleRequired = z.string().trim().min(1, "errorRequired").max(40, "errorTooLong")

export const vehicleSchema = z
  .object({
    hasVehicle: z.boolean(),
    ownership: optionalString,
    vehicleType: optionalString,
    make: optionalString,
    model: optionalString,
    year: optionalString,
    plate: optionalString,
    regExpiry: z.string(),
    insuranceExpiry: z.string(),
    regAttachment: z.string(),
    insuranceAttachment: z.string(),
  })
  .superRefine((data, ctx) => {
    if (!data.hasVehicle) return
    const fields: [keyof typeof data, string][] = [
      ["ownership", "ownership"],
      ["vehicleType", "type"],
      ["make", "make"],
      ["model", "model"],
      ["year", "year"],
      ["plate", "plate"],
      ["regExpiry", "regExpiry"],
      ["insuranceExpiry", "insuranceExpiry"],
    ]
    for (const [key, pathKey] of fields) {
      const val = data[key] as string
      const parsed = vehicleRequired.safeParse(val)
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [pathKey as never],
          message: "errorRequired",
        })
      }
    }
  })
export type VehicleValues = z.infer<typeof vehicleSchema>

export const documentsSchema = z.object({
  identityAttachment: z.string().min(1, "errorRequired"),
  licenseAttachment: z.string().min(1, "errorRequired"),
  regAttachment: z.string().optional().or(z.literal("")),
  insuranceAttachment: z.string().optional().or(z.literal("")),
})
export type DocumentsValues = z.infer<typeof documentsSchema>

export const consentSchema = z
  .object({
    consentTerms: z.boolean(),
    consentPrivacy: z.boolean(),
  })
  .refine((d) => d.consentTerms && d.consentPrivacy, { message: "consentRequired" })
export type ConsentValues = z.infer<typeof consentSchema>

// ── Full application (server-side final validation) ─────────────────────────
export const fullApplicationSchema = z.object({
  locale: z.enum(["ar", "en", "ur", "bn"]),
  personal: personalSchema,
  contact: contactSchema,
  identity: identitySchema,
  license: licenseSchema,
  work: workSchema,
  platforms: platformsSchema,
  vehicle: vehicleSchema,
  documents: documentsSchema,
  consent: consentSchema,
  profilePhotoPath: z.string().min(1, "errorRequired"),
})
export type FullApplication = z.infer<typeof fullApplicationSchema>

export type StepKey =
  | "personal"
  | "contact"
  | "identity"
  | "license"
  | "work"
  | "platforms"
  | "vehicle"
  | "documents"
  | "review"

export const STEP_ORDER: StepKey[] = [
  "personal",
  "contact",
  "identity",
  "license",
  "work",
  "platforms",
  "vehicle",
  "documents",
  "review",
]
