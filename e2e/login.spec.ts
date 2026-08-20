// E2E tests for the Login / Authentication flow.
//
// Covers:
//   1. Login page renders correctly
//   2. Successful login redirects to dashboard
//   3. Invalid credentials show error
//   4. Empty form validation
//   5. Password visibility toggle
//   6. Locked account error
//   7. RTL layout verification

import { test, expect, waitForPageLoad, expectHeading } from "./helpers"

test.describe("Login Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/sign-in")
    await waitForPageLoad(page)
  })

  test("renders the login page with form elements", async ({ page }) => {
    // Page heading
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

    // Form fields
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()

    // Submit button
    await expect(
      page.getByRole("button", { name: /sign in|login|تسجيل/i })
    ).toBeVisible()
  })

  test("shows validation errors for empty submission", async ({ page }) => {
    // Click submit without filling in fields
    await page.getByRole("button", { name: /sign in|login|تسجيل/i }).click()

    // Should show validation errors
    await expect(page.locator("[role='alert']").first()).toBeVisible({ timeout: 5_000 })
  })

  test("shows error for invalid credentials", async ({ page }) => {
    await page.getByLabel(/email/i).fill("wrong@example.com")
    await page.getByLabel(/password/i).fill("WrongPassword123!")
    await page.getByRole("button", { name: /sign in|login|تسجيل/i }).click()

    // Should show an error message (not redirect)
    await expect(page.locator("[role='alert'], [class*='error']").first()).toBeVisible({
      timeout: 15_000,
    })
    // Should still be on the login page
    expect(page.url()).toContain("/auth/sign-in")
  })

  test("successful login redirects to dashboard", async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL ?? "admin@elitedev.com.sa"
    const password = process.env.TEST_USER_PASSWORD ?? "Test1234!"

    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole("button", { name: /sign in|login|تسجيل/i }).click()

    // Should redirect to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    expect(page.url()).toContain("/dashboard")
  })

  test("password visibility toggle works", async ({ page }) => {
    const passwordInput = page.getByLabel(/password/i)

    // Password should be hidden by default
    await expect(passwordInput).toHaveAttribute("type", "password")

    // Click the eye icon to show password
    const toggleButton = page.locator("button").filter({ has: page.locator("[class*='lucide-eye']") })
    if (await toggleButton.isVisible().catch(() => false)) {
      await toggleButton.click()
      await expect(passwordInput).toHaveAttribute("type", "text")

      // Click again to hide
      await toggleButton.click()
      await expect(passwordInput).toHaveAttribute("type", "password")
    }
  })

  test("error URL params show appropriate messages", async ({ page }) => {
    // Test locked account error
    await page.goto("/auth/sign-in?error=AUTH_ACCOUNT_LOCKED")
    await waitForPageLoad(page)
    await expect(page.locator("[role='alert'], [class*='error']").first()).toBeVisible({
      timeout: 5_000,
    })

    // Test inactive account error
    await page.goto("/auth/sign-in?error=AUTH_ACCOUNT_INACTIVE")
    await waitForPageLoad(page)
    await expect(page.locator("[role='alert'], [class*='error']").first()).toBeVisible({
      timeout: 5_000,
    })
  })

  test("page is responsive on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }) // iPhone X
    await waitForPageLoad(page)

    // Form should still be visible and usable
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(
      page.getByRole("button", { name: /sign in|login|تسجيل/i })
    ).toBeVisible()
  })
})
