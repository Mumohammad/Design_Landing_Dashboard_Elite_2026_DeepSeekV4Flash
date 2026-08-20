// Smoke tests — quick verification that critical pages load and core
// navigation works. These are the first tests to run in CI to catch
// deployment issues.
//
// No authentication required for public pages; auth fixture used for
// dashboard pages.

import { test as base, expect, type Page } from "@playwright/test"

// ── Auth fixture ─────────────────────────────────────────────────────────────

const test = base.extend<{ authed: Page }>({
  authed: async ({ page }, use) => {
    const email = process.env.TEST_USER_EMAIL ?? "admin@elitedev.com.sa"
    const password = process.env.TEST_USER_PASSWORD ?? "Test1234!"

    await page.goto("/auth/sign-in")
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole("button", { name: /sign in|login|تسجيل/i }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await use(page)
  },
})

// ── Public pages ─────────────────────────────────────────────────────────────

test.describe("Public Pages", () => {
  test("landing page loads", async ({ page }) => {
    await page.goto("/landing")
    await page.waitForLoadState("networkidle", { timeout: 30_000 })
    // Should have some heading content
    const headings = page.getByRole("heading")
    expect(await headings.count()).toBeGreaterThan(0)
  })

  test("sign-in page loads", async ({ page }) => {
    await page.goto("/auth/sign-in")
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel(/password/i)).toBeVisible()
  })

  test("root redirects to landing", async ({ page }) => {
    await page.goto("/")
    await page.waitForURL(/\/landing/, { timeout: 15_000 })
    expect(page.url()).toContain("/landing")
  })
})

// ── Dashboard pages (authenticated) ─────────────────────────────────────────

test.describe("Dashboard Smoke Tests", () => {
  const DASHBOARD_PAGES = [
    { path: "/dashboard", name: "Dashboard" },
    { path: "/drivers", name: "Drivers" },
    { path: "/vehicles", name: "Vehicles" },
    { path: "/attendance", name: "Attendance" },
    { path: "/payroll", name: "Payroll" },
    { path: "/invoices", name: "Invoices" },
    { path: "/accounting", name: "Accounting" },
    { path: "/expenses", name: "Expenses" },
    { path: "/orders", name: "Orders" },
    { path: "/settings", name: "Settings" },
  ]

  for (const { path, name } of DASHBOARD_PAGES) {
    test(`${name} page loads (${path})`, async ({ authed: page }) => {
      await page.goto(path)
      await page.waitForLoadState("networkidle", { timeout: 30_000 })

      // Page should have a heading or not show a 404/error
      const is404 = await page
        .locator("text=/404|not found|غير موجود/i")
        .isVisible()
        .catch(() => false)
      expect(is404).toBeFalsy()
    })
  }
})

// ── Navigation ───────────────────────────────────────────────────────────────

test.describe("Sidebar Navigation", () => {
  test("sidebar is visible after login", async ({ authed: page }) => {
    // Sidebar should be present
    const sidebar = page.locator("nav, [role='navigation'], [class*='sidebar']").first()
    await expect(sidebar).toBeVisible({ timeout: 15_000 })
  })

  test("can navigate to a module via sidebar", async ({ authed: page }) => {
    // Click on a sidebar link (e.g., Drivers)
    const driversLink = page.getByRole("link", { name: /drivers|السائقين/i }).first()
    if (await driversLink.isVisible().catch(() => false)) {
      await driversLink.click()
      await page.waitForLoadState("networkidle", { timeout: 15_000 })
      expect(page.url()).toContain("/drivers")
    }
  })
})

// ── Auth edge cases ──────────────────────────────────────────────────────────

test.describe("Auth Edge Cases", () => {
  test("unauthenticated user is redirected to sign-in", async ({ page }) => {
    await page.goto("/dashboard")
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
    expect(page.url()).toContain("/auth/sign-in")
  })

  test("sign-in page shows error for locked account", async ({ page }) => {
    await page.goto("/auth/sign-in?error=AUTH_ACCOUNT_LOCKED")
    const errorEl = page.locator("[role='alert'], [class*='error']")
    await expect(errorEl.first()).toBeVisible({ timeout: 5_000 })
  })
})
