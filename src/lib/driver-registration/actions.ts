"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { rateLimit, getClientIp } from "@/lib/auth/rate-limit"
import { fullApplicationSchema, type FullApplication } from "./schema"
import { createHash, randomBytes } from "crypto"

// ─────────────────────────────────────────────────────────────────────────────
// Submit a public driver application.
//
// Security:
//   * Rate limited per IP (3/hour default).
//   * Full zod re-validation server-side (never trust the client).
//   * Written via the service-role client (RLS never blocks the insert).
//   * tenant_id resolved server-side to the default tenant — never from the
//     applicant.
//   * EmailJS is fire-and-forget: if the email fails the application is still
//     SUBMITTED (Supabase is the source of truth).
// ─────────────────────────────────────────────────────────────────────────────

export type SubmitResult =
  | { ok: true; applicationNumber: string; applicationId: string; statusToken: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

const APPLICATION_NUMBER_REGEX = /^DRV-\d{4}-\d{6}$/



async function notifyByEmail(application: FullApplication, applicationNumber: string): Promise<void> {
  const serviceId = process.env.EMAILJS_SERVICE_ID
  const templateId = process.env.EMAILJS_TEMPLATE_ID
  const publicKey = process.env.EMAILJS_PUBLIC_KEY
  const to = process.env.EMAILJS_TO_EMAIL ?? "info@elitedev.com.sa"

  if (!serviceId || !templateId || !publicKey) {
    if (process.env.NODE_ENV !== "production") {
       
      console.warn(
        "[driver-registration] EmailJS not configured (EMAILJS_SERVICE_ID / TEMPLATE_ID / PUBLIC_KEY) — skipping notification."
      )
    }
    return
  }

  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          to_email: to,
          subject: `New Driver Application — ${applicationNumber}`,
          application_number: applicationNumber,
          applicant:
            `${application.personal.firstName} ${application.personal.middleName ?? ""} ${application.personal.lastName}`.replace(
              /\s+/g,
              " "
            ),
          mobile: application.contact.mobile,
          email: application.contact.email || "—",
          city: application.contact.city,
          work_type: application.work.workType,
          driver_category: application.work.driverCategory,
          platforms: application.platforms.platforms.join(", ") || "None",
          identity_type: application.identity.identityType,
          identity_expiry: application.identity.identityExpiry || "—",
          license_expiry: application.license.licenseExpiry,
          vehicle_availability: application.vehicle.hasVehicle ? "Yes" : "No",
          submission_date: new Date().toISOString().slice(0, 10),
        },
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
       
      console.error(
        `[driver-registration] EmailJS send failed (${res.status}) for ${applicationNumber} — application remains SUBMITTED.`
      )
    }
  } catch (err) {
    // Notification failure must NEVER fail the application.
     
    console.error("[driver-registration] EmailJS exception — application remains SUBMITTED.", err)
  }
}

export async function submitDriverApplication(
  input: FullApplication
): Promise<SubmitResult> {
  try {
    // 1. Rate limit: 3 submissions / hour / IP.
    const clientIp = await getClientIp()
    const limit = await rateLimit(`driver-app:${clientIp}`, 3, "hour")
    if (!limit.success) {
      return {
        ok: false,
        error: "rateLimited",
        fieldErrors: {},
      }
    }

    // 2. Validate everything server-side.
    const parsed = fullApplicationSchema.safeParse(input)
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".")
        fieldErrors[key] ??= []
        fieldErrors[key].push(issue.message)
      }
      return { ok: false, error: "validation", fieldErrors }
    }
    const app = parsed.data

    // 3. Resolve the default tenant (single tenant today, multi-tenant ready).
    const admin = createAdminClient()
    const { data: tenant } = await admin
      .from("tenants")
      .select("id")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .single()

    if (!tenant) {
      return { ok: false, error: "noTenant", fieldErrors: {} }
    }

    const fullName =
      `${app.personal.firstName} ${app.personal.middleName ?? ""} ${app.personal.lastName}`.replace(/\s+/g, " ")

    // 4. Insert the application (DB trigger assigns application_number + status_token_hash).
    const statusToken = randomBytes(32).toString('hex')
    const statusTokenHash = createHash('sha256').update(statusToken).digest('hex')

    const { data: inserted, error: insertError } = await admin
      .from("driver_applications")
      .insert({
        tenant_id: tenant.id,
        locale: app.locale,
        first_name: app.personal.firstName,
        middle_name: app.personal.middleName || null,
        last_name: app.personal.lastName,
        full_name: fullName,
        date_of_birth: app.personal.dateOfBirth || null,
        nationality: app.personal.nationality,
        gender: app.personal.gender,
        mobile: app.contact.mobile,
        alternative_mobile: app.contact.alternativeMobile || null,
        email: app.contact.email || null,
        city: app.contact.city,
        district: app.contact.district,
        address: app.contact.address,
        identity_type: app.identity.identityType,
        identity_number: app.identity.identityNumber,
        identity_expiry: app.identity.identityExpiry || null,
        license_number: app.license.licenseNumber,
        license_type: app.license.licenseType,
        license_country: app.license.licenseCountry,
        license_expiry: app.license.licenseExpiry || null,
        work_type: app.work.workType,
        driver_category: app.work.driverCategory,
        platform_codes: app.platforms.platforms,
        has_vehicle: app.vehicle.hasVehicle,
        vehicle_ownership: app.vehicle.ownership || null,
        vehicle_type: app.vehicle.vehicleType || null,
        vehicle_make: app.vehicle.make || null,
        vehicle_model: app.vehicle.model || null,
        vehicle_year: app.vehicle.year ? Number(app.vehicle.year) : null,
        vehicle_plate: app.vehicle.plate || null,
        vehicle_reg_expiry: app.vehicle.regExpiry || null,
        vehicle_insurance_expiry: app.vehicle.insuranceExpiry || null,
        consent_terms: app.consent.consentTerms,
        consent_privacy: app.consent.consentPrivacy,
        consent_at: new Date().toISOString(),
        status: "submitted",
        status_token_hash: statusTokenHash,
        ip_hash: clientIp,
      })
      .select("id, application_number")
      .single()

    if (insertError || !inserted) {
       
      console.error("[driver-registration] insert failed:", insertError?.message)
      return { ok: false, error: "insert", fieldErrors: {} }
    }

    if (!APPLICATION_NUMBER_REGEX.test(inserted.application_number)) {
       
      console.error("[driver-registration] unexpected application_number:", inserted.application_number)
    }

    // 5. Mirror uploaded document metadata (files already in private storage).
    const docs: { type: string; path: string; expiry: string | null }[] = [
      { type: "profile_photo", path: app.profilePhotoPath, expiry: null },
      { type: "identity", path: app.documents.identityAttachment, expiry: app.identity.identityExpiry || null },
      { type: "license", path: app.documents.licenseAttachment, expiry: app.license.licenseExpiry || null },
    ]

    if (app.vehicle.hasVehicle) {
      if (app.documents.regAttachment) {
        docs.push({ type: "vehicle_reg", path: app.documents.regAttachment, expiry: app.vehicle.regExpiry || null })
      }
      if (app.documents.insuranceAttachment) {
        docs.push({
          type: "vehicle_insurance",
          path: app.documents.insuranceAttachment,
          expiry: app.vehicle.insuranceExpiry || null,
        })
      }
    }

    const docRows = docs.map((d) => {
      const fileName = d.path.split("/").pop() ?? d.path
      return {
        application_id: inserted.id,
        tenant_id: tenant.id,
        document_type: d.type,
        file_name: fileName,
        storage_path: d.path,
        mime_type: mimeFromPath(d.path),
        file_size: null,
        expiry_date: d.expiry,
      }
    })

    const { error: docError } = await admin.from("driver_application_documents").insert(docRows)
    if (docError) {
      // Document mirror failure shouldn't fail the application either.
       
      console.error("[driver-registration] document mirror insert failed:", docError.message)
    }

    // 6. Fire-and-forget EmailJS notification (never blocks / fails the submit).
    void notifyByEmail(app, inserted.application_number)

    return { ok: true, applicationNumber: inserted.application_number, applicationId: inserted.id, statusToken }
  } catch (err) {
     
    console.error("[driver-registration] unexpected error:", err)
    return { ok: false, error: "generic", fieldErrors: {} }
  }
}

function mimeFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "png":
      return "image/png"
    case "webp":
      return "image/webp"
    case "pdf":
      return "application/pdf"
    default:
      return null
  }
}

/** Public status lookup for the QR / status page.
 *
 * Accepts a high-entropy 64-hex-char status token (not the enumerable
 * application_number). The token is hashed server-side and compared against
 * the stored hash, preventing enumeration attacks.
 */
export async function getApplicationStatus(token: string): Promise<{
  found: boolean
  status?: string
  submittedAt?: string
  applicationNumber?: string
  fullName?: string
}> {
  // Reject tokens that don't match the expected format (64 hex chars).
  if (!/^[0-9a-f]{64}$/.test(token)) return { found: false }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const admin = createAdminClient()
  const { data } = await admin
    .from("driver_applications")
    .select("application_number, status, submitted_at, full_name")
    .eq("status_token_hash", tokenHash)
    .maybeSingle()

  if (!data) return { found: false }
  return {
    found: true,
    status: data.status,
    submittedAt: data.submitted_at,
    applicationNumber: data.application_number,
    fullName: data.full_name,
  }
}
