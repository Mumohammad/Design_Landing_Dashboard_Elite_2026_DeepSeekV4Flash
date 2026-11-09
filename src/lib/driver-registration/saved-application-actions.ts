"use server"

import { cookies } from "next/headers"
import { getClientIp, rateLimit } from "@/lib/auth/rate-limit"
import { STEP_ORDER, type StepKey } from "./schema"
import { getUploadDraft } from "./draft"
import {
  SAVED_APPLICATION_COOKIE,
  SAVED_APPLICATION_MAX_COOKIE_CHARS,
  SAVED_APPLICATION_TTL_SECONDS,
  openSavedApplication,
  resumeStep,
  sanitizeSavedData,
  sealSavedApplication,
  type SavedApplication,
} from "./saved-application"

const TENANT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  }
}

/** Returns the applicant's saved application for this tenant, if any. */
export async function loadSavedApplication(tenantSlug: string): Promise<SavedApplication | null> {
  if (!TENANT_SLUG.test(tenantSlug)) return null
  const jar = await cookies()
  return openSavedApplication(jar.get(SAVED_APPLICATION_COOKIE)?.value, tenantSlug, await getUploadDraft())
}

/**
 * Seals the completed steps into the applicant's own browser. Only values
 * that pass each step's schema and uploads owned by this browser are kept.
 */
export async function saveApplicationProgress(
  tenantSlug: string,
  step: StepKey,
  data: unknown
): Promise<{ ok: true; savedAt: number } | { ok: false; reason: "invalid" | "rate_limited" | "too_large" | "unavailable" }> {
  if (!TENANT_SLUG.test(tenantSlug) || !STEP_ORDER.includes(step)) return { ok: false, reason: "invalid" }
  const ip = await getClientIp()
  if (!(await rateLimit(`driver-draft:${ip}`, 120, "hour")).success) return { ok: false, reason: "rate_limited" }
  try {
    const clean = sanitizeSavedData(data, await getUploadDraft())
    const savedAt = Date.now()
    const sealed = sealSavedApplication({ tenantSlug, step: resumeStep(clean, step), savedAt, data: clean })
    if (sealed.length > SAVED_APPLICATION_MAX_COOKIE_CHARS) return { ok: false, reason: "too_large" }
    ;(await cookies()).set(SAVED_APPLICATION_COOKIE, sealed, cookieOptions(SAVED_APPLICATION_TTL_SECONDS))
    return { ok: true, savedAt }
  } catch {
    return { ok: false, reason: "unavailable" }
  }
}

/** Forgets the saved application (start over, or after a successful submit). */
export async function discardSavedApplication(): Promise<void> {
  ;(await cookies()).set(SAVED_APPLICATION_COOKIE, "", cookieOptions(0))
}
