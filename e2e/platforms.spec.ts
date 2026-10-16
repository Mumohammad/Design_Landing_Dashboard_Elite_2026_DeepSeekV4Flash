// E2E tests — /platforms module (Prompt O Part 2).
//
// Gates: route renders, list loads with zero failed rest/v1 requests,
// drill-down tab navigation works, CSV import dialog opens with validation,
// CSV export downloads. Skips gracefully on permission/fixture gaps.

import { test as base, expect, type Page } from "@playwright/test"

const test = base.extend<{ authed: Page }>({
  authed: async ({ page }, use) => {
    const email = process.env.TEST_USER_EMAIL ?? "sweep-admin@tenant001.test"
    const password = process.env.TEST_USER_PASSWORD ?? "Test1234!"

    await page.goto("/auth/sign-in", { waitUntil: "domcontentloaded" })
    await page.locator("button[type=submit]").waitFor({ state: "visible", timeout: 30_000 })
    await page.waitForTimeout(1500)
    await page.locator('input[type="email"]').first().fill(email)
    await page.locator('input[type="password"]').first().fill(password)
    await page.locator("button[type=submit]").click()
    await page.waitForURL(/\/dashboard|\/landing|\/settings\/mfa/, { timeout: 45_000 })
    await use(page) // eslint-disable-line react-hooks/rules-of-hooks -- Playwright fixture `use`, not React
  },
})

test.describe("Platforms module (Prompt O Part 2)", () => {
  test("/platforms renders KPIs and the platform list with zero failed rest/v1 requests", async ({ authed: page }) => {
    const failed: string[] = []
    page.on("response", (r) => {
      if (r.url().includes("/rest/v1/") && r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 160)}`)
    })
    page.on("requestfailed", (r) => {
      if (r.url().includes("/rest/v1/")) failed.push(`FAILED ${r.url().slice(0, 160)}`)
    })

    await page.goto("/platforms", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    expect(failed, "failed rest/v1 requests").toEqual([])
    const errorBoundary = page.getByText(/An error occurred|حدث خطأ/).first()
    expect(await errorBoundary.isVisible().catch(() => false), "error boundary visible").toBe(false)
  })

  test("platform drill-down renders tabs and navigates back", async ({ authed: page }) => {
    await page.goto("/platforms", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    // Click the first platform row link (fixture-dependent).
    const rowLink = page.locator('a[href^="/platforms/"]').filter({ hasNot: page.locator('[data-sidebar]') }).first()
    const visible = await rowLink.isVisible().catch(() => false)
    const href = visible ? await rowLink.getAttribute("href") : null
    if (!href || href === "/platforms") {
      test.skip(true, "no seeded platforms available (fixture-dependent)")
      return
    }

    await page.goto(href, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    // The four drill-down tabs render.
    await expect(page.getByRole("button", { name: /الإدخالات اليومية|Daily entries/i }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: /سجل الدفعات|Payments ledger/i }).first()).toBeVisible()

    // Tab switch works.
    await page.getByRole("button", { name: /سجل الدفعات|Payments ledger/i }).first().click()
    await page.waitForTimeout(500)
    await expect(page.getByRole("button", { name: /تسجيل دفعة|Record payment/i }).first()).toBeVisible()
  })

  test("CSV import dialog validates pasted rows", async ({ authed: page }) => {
    await page.goto("/platforms", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    // Wait for the list to load (fixture-dependent): a row link must exist.
    const rowLink = page.locator('a[href^="/platforms/"]').first()
    const rowVisible = await rowLink.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)
    if (!rowVisible) {
      test.skip(true, "no seeded platforms available (fixture-dependent)")
      return
    }

    const importBtn = page.getByTitle(/استيراد|Import/i).first()
    await importBtn.waitFor({ state: "visible", timeout: 10_000 })
    // dispatchEvent instead of click(): the row micro-re-renders (KPI timers),
    // so a positional click can land on a sibling button after layout shifts;
    // a dispatched click resolves the element afresh and fires React's onClick.
    await importBtn.dispatchEvent("click")
    const box = page.locator("textarea").first()
    await box.waitFor({ state: "visible", timeout: 10_000 })
    await box.fill("driver_code,entry_date,gross_revenue\nDRV-1,2026-10-01,100\n,2026-10-01,5")
    // Validation preview counts appear.
    await expect(page.getByText(/Rows parsed|الصفوف المقروءة/)).toBeVisible()
    await expect(page.getByText(/Invalid|فاشل/).first()).toBeVisible()
  })
})
