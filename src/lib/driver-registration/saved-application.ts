import "server-only"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { deflateRawSync, inflateRawSync } from "node:zlib"
import { z } from "zod"
import {
  STEP_ORDER,
  contactSchema,
  documentsSchema,
  identitySchema,
  licenseSchema,
  personalSchema,
  platformsSchema,
  vehicleSchema,
  workSchema,
  type StepKey,
} from "./schema"
import { ownsUploadPath } from "./draft"

/**
 * Save-and-resume for the public driver application.
 *
 * The draft never touches localStorage or the database. It is sealed with
 * AES-256-GCM into an httpOnly, SameSite=Lax cookie, so page scripts cannot
 * read the applicant's personal data, the browser cannot tamper with it, and
 * it disappears after SAVED_APPLICATION_TTL_SECONDS or when the application
 * is submitted. Consent is never saved: the applicant re-confirms on resume.
 */
export { SAVED_APPLICATION_COOKIE } from "./saved-application-constants"
export const SAVED_APPLICATION_TTL_SECONDS = 2 * 60 * 60
/** Browsers drop cookies over 4096 bytes including name and attributes. */
export const SAVED_APPLICATION_MAX_COOKIE_CHARS = 3800

const VERSION = 1

const sections = {
  personal: personalSchema,
  contact: contactSchema,
  identity: identitySchema,
  license: licenseSchema,
  work: workSchema,
  platforms: platformsSchema,
  vehicle: vehicleSchema,
  documents: documentsSchema,
} as const

type SectionKey = keyof typeof sections

export type SavedApplicationData = {
  [K in SectionKey]: z.infer<(typeof sections)[K]> | null
} & { profilePhotoPath: string }

export type SavedApplication = {
  tenantSlug: string
  step: StepKey
  savedAt: number
  data: SavedApplicationData
}

const ATTACHMENT_FIELDS: Record<string, readonly string[]> = {
  identity: ["identityAttachment"],
  license: ["licenseAttachment"],
  vehicle: ["regAttachment", "insuranceAttachment"],
  documents: ["identityAttachment", "licenseAttachment", "regAttachment", "insuranceAttachment"],
}

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error("Saved applications are not configured")
  return createHash("sha256").update(`driver-application-draft-v${VERSION}:${secret}`).digest()
}

/**
 * Keeps only sections that pass their own step schema, and only uploads that
 * belong to the caller's current upload draft. Anything else is dropped so a
 * resumed application can never point at another applicant's files.
 */
export function sanitizeSavedData(input: unknown, uploadDraft: string | null): SavedApplicationData {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const out = { profilePhotoPath: "" } as SavedApplicationData
  for (const name of Object.keys(sections) as SectionKey[]) {
    const parsed = sections[name].safeParse(raw[name])
    let value: Record<string, unknown> | null = parsed.success ? { ...(parsed.data as Record<string, unknown>) } : null
    if (value) {
      for (const field of ATTACHMENT_FIELDS[name] ?? []) {
        const path = value[field]
        if (typeof path === "string" && path && !(uploadDraft && ownsUploadPath(uploadDraft, path))) {
          // An upload that is no longer ours (expired or foreign) voids the
          // whole step; the applicant re-uploads it on resume.
          value = null
          break
        }
      }
    }
    ;(out as Record<string, unknown>)[name] = value
  }
  const photo = raw.profilePhotoPath
  out.profilePhotoPath =
    typeof photo === "string" && uploadDraft && ownsUploadPath(uploadDraft, photo) ? photo : ""
  // The personal step owns the profile photo; without it the step is incomplete.
  if (!out.profilePhotoPath) out.personal = null
  return out
}

/** The furthest step the applicant may resume at: the first incomplete one. */
export function resumeStep(data: SavedApplicationData, requested: StepKey): StepKey {
  const firstMissing = STEP_ORDER.find((step) => step !== "review" && !(data as Record<string, unknown>)[step])
  const limit = firstMissing ?? "review"
  return STEP_ORDER.indexOf(requested) <= STEP_ORDER.indexOf(limit) ? requested : limit
}

const envelope = z.object({
  v: z.literal(VERSION),
  t: z.string().min(1).max(80),
  s: z.enum(STEP_ORDER as [StepKey, ...StepKey[]]),
  at: z.number().int().positive(),
  d: z.unknown(),
})

export function sealSavedApplication(saved: SavedApplication): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  cipher.setAAD(Buffer.from(`tenant:${saved.tenantSlug}`))
  const plain = deflateRawSync(
    Buffer.from(JSON.stringify({ v: VERSION, t: saved.tenantSlug, s: saved.step, at: saved.savedAt, d: saved.data }))
  )
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`
}

export function openSavedApplication(
  sealed: string | undefined,
  tenantSlug: string,
  uploadDraft: string | null,
  now = Date.now()
): SavedApplication | null {
  if (!sealed || sealed.length > SAVED_APPLICATION_MAX_COOKIE_CHARS) return null
  const [version, payload] = sealed.split(".")
  if (version !== String(VERSION) || !payload) return null
  try {
    const bytes = Buffer.from(payload, "base64url")
    if (bytes.length < 29) return null
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12))
    decipher.setAAD(Buffer.from(`tenant:${tenantSlug}`))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const plain = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
    const parsed = envelope.safeParse(JSON.parse(inflateRawSync(plain, { maxOutputLength: 64 * 1024 }).toString("utf8")))
    if (!parsed.success || parsed.data.t !== tenantSlug) return null
    if (parsed.data.at > now || now - parsed.data.at > SAVED_APPLICATION_TTL_SECONDS * 1000) return null
    const data = sanitizeSavedData(parsed.data.d, uploadDraft)
    return { tenantSlug, step: resumeStep(data, parsed.data.s), savedAt: parsed.data.at, data }
  } catch {
    return null
  }
}
