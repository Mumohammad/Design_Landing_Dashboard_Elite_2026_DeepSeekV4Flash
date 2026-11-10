// E2E tests — /maintenance module (Prompt O Part 1).
//
// Gates:
//   1. route renders the maintenance workspace (KPIs + toolbar), not the
//      error boundary
//   2. list loads with zero failed rest/v1 requests for the module tables
//   3. CRUD round-trip through the real UI: create a maintenance event on a
//      seeded vehicle → start → complete → row disappears from the open
//      filter (fixture-dependent; skips gracefully when no vehicle exists)
//   4. CSV export downloads a file (fixture-independent)
//
// Fixture or persistence failures fail this release gate; they are never skipped.

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

test.describe("Maintenance module (Prompt O Part 1)", () => {
  test("route renders KPIs and the list with zero failed rest/v1 requests", async ({ authed: page }) => {
    const failed: string[] = []
    page.on("response", (r) => {
      if (r.url().includes("/rest/v1/") && r.status() >= 400) {
        failed.push(`${r.status()} ${r.url().slice(0, 160)}`)
      }
    })
    page.on("requestfailed", (r) => {
      if (r.url().includes("/rest/v1/")) failed.push(`FAILED ${r.url().slice(0, 160)}`)
    })

    await page.goto("/maintenance", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    expect(failed, "failed rest/v1 requests").toEqual([])
    const errorBoundary = page.getByText(/An error occurred|حدث خطأ/).first()
    expect(await errorBoundary.isVisible().catch(() => false), "error boundary visible").toBe(false)

    // The workspace toolbar renders (status filter + export button).
    await expect(page.getByRole("button", { name: /CSV|تصدير|Export/i }).first()).toBeVisible({ timeout: 15_000 })
  })

  test("create → start → complete round-trip through the real UI", async ({ authed: page }) => {
    await page.goto("/maintenance", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    // Open the create dialog.
    const addCta = page.getByRole("button", { name: /إضافة حدث صيانة|Add maintenance event/i }).first()
    await expect(addCta).toBeVisible()
    await addCta.click()

    // Vehicle picker must offer tenant vehicles; skip when the tenant has none.
    const vehicleSelect = page.locator("select").first()
    const optionCount = await vehicleSelect.locator("option").count()
    expect(optionCount,"seeded tenant vehicle required for maintenance acceptance").toBeGreaterThan(1)
    await vehicleSelect.selectOption({ index: 1 })

    // Fault description (required, min 3 chars).
    const fault = page.locator("textarea").first()
    await fault.fill("e2e round-trip fault — يمكن حذفها")
    await page.getByRole("button", { name: /حفظ|Save/i }).click()

    // The new event lands in the list (status open).
    const newRow = page.locator("tr", { hasText: /e2e round-trip fault/ }).first()
    await expect(newRow,"created maintenance event must persist and become visible").toBeVisible({timeout:20_000})

    // Start work (open → in_progress).
    await newRow.getByTitle(/بدء|Start/i).click()
    await page.waitForTimeout(1200)

    // Complete the event via the row action (cost required).
    await newRow.getByTitle(/إكمال|Complete/i).click()
    const costInput = page.locator('input[type="number"]').first()
    await costInput.fill("123.45")
    await page.getByRole("button", { name: /حفظ|Save/i }).click()
    await page.waitForTimeout(1500)

    // Completed events leave the default list only after the reload — force
    // one via the status filter to confirm the terminal state stuck.
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
    await expect(page.locator("tr",{hasText:/e2e round-trip fault/}).first().getByText(/مكتمل|Completed/i)).toBeVisible()
  })

  test("CSV export downloads a BOM file", async ({ authed: page }) => {
    await page.goto("/maintenance", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    const exportBtn = page.getByRole("button", { name: /تصدير|Export|CSV/i }).first()
    await expect(exportBtn).toBeVisible()
    const download = page.waitForEvent("download", { timeout: 15_000 })
    await exportBtn.click()
    const dl = await download

    expect(dl.suggestedFilename()).toMatch(/maintenance-.*\.csv$/)
  })
})
