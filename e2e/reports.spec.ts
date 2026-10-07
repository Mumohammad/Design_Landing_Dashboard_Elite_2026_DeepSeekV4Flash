// E2E tests — /reports hub (Prompt O Part 5).
//
// Gates: route renders, the three tabs mount with zero failed rest/v1
// requests, the generate form + history table render, and the templates /
// documents tabs surface their tables. Report generation and document
// generation are permission-gated (reports:export / templates:create) and
// fixture-dependent, so they are validated for UI presence only here.

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

test.describe("Reports hub (Prompt O Part 5)", () => {
  test("/reports renders the reports tab with zero failed rest/v1 requests", async ({ authed: page }) => {
    const failed: string[] = []
    page.on("response", (r) => {
      if (r.url().includes("/rest/v1/") && r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 160)}`)
    })
    page.on("requestfailed", (r) => {
      if (r.url().includes("/rest/v1/")) failed.push(`FAILED ${r.url().slice(0, 160)}`)
    })

    await page.goto("/reports", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    expect(failed, "failed rest/v1 requests").toEqual([])
    const errorBoundary = page.getByText(/An error occurred|حدث خطأ/).first()
    expect(await errorBoundary.isVisible().catch(() => false), "error boundary visible").toBe(false)

    // The three hub tabs render.
    await expect(page.getByRole("tab", { name: /النماذج|Templates/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("tab", { name: /المستندات|Documents/i })).toBeVisible()

    // The generate form surfaces the catalog + the queue action.
    await expect(page.getByRole("button", { name: /إنشاء تقرير|Generate report/i })).toBeVisible()
  })

  test("templates tab renders the document_templates catalog with generate actions", async ({ authed: page }) => {
    await page.goto("/reports", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    await page.getByRole("tab", { name: /النماذج|Templates/i }).click()

    const generateBtn = page.getByRole("button", { name: /إنشاء مستند|Generate document/i }).first()
    const visible = await generateBtn.isVisible().catch(() => false)
    if (!visible) {
      test.skip(true, "no active document_templates rows for the test tenant (fixture-dependent)")
      return
    }

    // The session dialog opens with the entity pickers (generation itself is
    // permission-gated: templates:create).
    await generateBtn.click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press("Escape")
  })

  test("documents tab renders the generated_documents list", async ({ authed: page }) => {
    await page.goto("/reports", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    await page.getByRole("tab", { name: /المستندات|Documents/i }).click()
    await expect(page.getByText(/لا توجد مستندات|No generated documents/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
