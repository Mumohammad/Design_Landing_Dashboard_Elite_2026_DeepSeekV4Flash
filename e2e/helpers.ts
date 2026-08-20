// Shared E2E test helpers for EliteDev.
//
// Provides:
//   - Auth fixture: logs in via the Supabase client and saves session state
//   - Common page assertions (loading, empty, error states)
//   - Locale helpers (AR/EN)

import { test as base, expect, type Page } from "@playwright/test"

// ── Auth fixture ─────────────────────────────────────────────────────────────

type TestCredentials = {
  email: string
  password: string
}

const DEFAULT_CREDENTIALS: TestCredentials = {
  email: process.env.TEST_USER_EMAIL ?? "admin@elitedev.com.sa",
  password: process.env.TEST_USER_PASSWORD ?? "Test1234!",
}

/**
 * Extended test fixture that provides an authenticated page.
 *
 * Usage:
 *   import { test, expect } from "./helpers"
 *   test("dashboard loads", async ({ authenticatedPage }) => {
 *     await expect(authenticatedPage.locator("h1")).toContainText("Dashboard")
 *   })
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page, context }, use) => {
    // 1. Navigate to the login page
    await page.goto("/auth/sign-in")

    // 2. Fill in credentials
    await page.getByLabel(/email/i).fill(DEFAULT_CREDENTIALS.email)
    await page.getByLabel(/password/i).fill(DEFAULT_CREDENTIALS.password)

    // 3. Submit the form
    await page.getByRole("button", { name: /sign in|login|تسجيل/i }).click()

    // 4. Wait for redirect to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

    // 5. Provide the authenticated page to the test
    await use(page)
  },
})

export { expect }

// ── Page state assertions ────────────────────────────────────────────────────

/**
 * Assert that the page shows a loading skeleton/spinner.
 */
export async function expectLoading(page: Page): Promise<void> {
  const loadingIndicators = page.locator(
    '[class*="animate-pulse"], [class*="loading"], [role="progressbar"], .skeleton'
  )
  await expect(loadingIndicators.first()).toBeVisible({ timeout: 10_000 })
}

/**
 * Assert that the page shows an error state.
 */
export async function expectError(page: Page): Promise<void> {
  const errorIndicators = page.locator(
    '[class*="error"], [role="alert"], text=/error|خطأ/i'
  )
  await expect(errorIndicators.first()).toBeVisible({ timeout: 10_000 })
}

/**
 * Assert that a page heading is visible.
 */
export async function expectHeading(page: Page, text: string | RegExp): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1 }).filter({ hasText: text })
  ).toBeVisible({ timeout: 15_000 })
}

/**
 * Wait for the page to fully load (no loading indicators).
 */
export async function waitForPageLoad(page: Page): Promise<void> {
  // Wait for network to be idle
  await page.waitForLoadState("networkidle", { timeout: 30_000 })
  // Wait for any loading spinners to disappear
  const spinner = page.locator('[class*="animate-spin"], .loading-spinner')
  if (await spinner.isVisible().catch(() => false)) {
    await spinner.waitFor({ state: "hidden", timeout: 15_000 })
  }
}

// ── Navigation helpers ───────────────────────────────────────────────────────

/**
 * Navigate to a dashboard module and wait for it to load.
 */
export async function navigateToModule(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await waitForPageLoad(page)
}

/**
 * Click a sidebar navigation link by text.
 */
export async function clickSidebarLink(page: Page, text: string | RegExp): Promise<void> {
  await page.getByRole("link", { name: text }).first().click()
  await waitForPageLoad(page)
}
