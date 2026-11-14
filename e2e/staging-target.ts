import { expect, type APIRequestContext } from "@playwright/test"
import { verificationRequest } from "../scripts/lib/verification-access.mjs"

/** Refuse hosted credential tests against an accidentally production-bound preview. */
export async function assertStagingTarget(request: APIRequestContext) {
  if (!process.env.BASE_URL) return // disposable local development server
  const staging = process.env.STAGING_SUPABASE_URL?.replace(/\/$/, "")
  if (staging !== "https://viowrovartosrkqukjxy.supabase.co") {
    throw new Error("The dedicated staging Supabase URL is required for hosted E2E")
  }
  const response = await verificationRequest(request, "/landing", {}, process.env.BASE_URL)
  expect(response.ok()).toBe(true)
  const policy = response.headers()["content-security-policy"] ?? ""
  expect(policy).toContain(staging)
  expect(policy).not.toContain("https://wwfnsbilmyxeawgzicmv.supabase.co")
}

/** A required public fixture, never an authentication credential. */
export function requireApplicationTenantSlug(value: string | undefined = process.env.E2E_TENANT_SLUG): string {
  if (typeof value !== "string" || value !== value.trim() || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
    throw new Error("A canonical E2E_TENANT_SLUG for an active synthetic staging tenant is required")
  }
  return value
}
