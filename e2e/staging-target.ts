import { expect, type APIRequestContext } from "@playwright/test"

/** Refuse hosted credential tests against an accidentally production-bound preview. */
export async function assertStagingTarget(request: APIRequestContext) {
  if (!process.env.BASE_URL) return // disposable local development server
  const staging = process.env.STAGING_SUPABASE_URL?.replace(/\/$/, "")
  if (staging !== "https://viowrovartosrkqukjxy.supabase.co") {
    throw new Error("The dedicated staging Supabase URL is required for hosted E2E")
  }
  const response = await request.get("/landing")
  expect(response.ok()).toBe(true)
  const policy = response.headers()["content-security-policy"] ?? ""
  expect(policy).toContain(staging)
  expect(policy).not.toContain("https://wwfnsbilmyxeawgzicmv.supabase.co")
}
