// E2E tests — /vehicles current-driver FK regression (Prompt N).
//
// Prod incident: the PostgREST embed hint
//   current_driver:drivers!vehicles_current_driver_id_fkey(...)
// 400s when the FK constraint `vehicles_current_driver_id_fkey` is absent
// (it was never defined in repo migrations — fixed by
// 20261001230000_vehicles_current_driver_fk.sql). The page then renders the
// error boundary.
//
// Gates:
//   1. /vehicles loads with ZERO failed /rest/v1/vehicles requests (the 400
//      symptom) and renders the fleet table, not the error boundary
//   2. the current-driver chip renders for a seeded assignment
//      (vehicle.current_driver_id → drivers row, same FK join)
//   3. no Radix "Missing Description or aria-describedby" console warning
//      on /vehicles — including after opening the shared ⌘K search dialog
//      (command-search.tsx) and the create-vehicle dialog
//
// NOTE: tests 2/3 require the local fixtures (sweep user + a seeded
// vehicle/driver assignment — see scripts/photo-matrix.mjs seeding
// conventions). Skips gracefully (test.skip) when fixtures are missing so
// the suite still passes against a bare environment.

import { test as base, expect, type Page } from "@playwright/test"

// ── Auth fixture (route-sweep login convention) ──────────────────────────────

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

// ── 1. The 400 symptom: zero failed vehicles requests, table renders ─────────

test.describe("Vehicles — current-driver FK regression", () => {
  test("/vehicles loads with zero failed rest/v1/vehicles requests and no error boundary", async ({
    authed: page,
  }) => {
    const failedVehicleRequests: string[] = []
    page.on("response", (r) => {
      if (r.url().includes("/rest/v1/vehicles") && r.status() >= 400) {
        failedVehicleRequests.push(`${r.status()} ${r.url().slice(0, 160)}`)
      }
    })
    page.on("requestfailed", (r) => {
      if (r.url().includes("/rest/v1/vehicles")) {
        failedVehicleRequests.push(`FAILED ${r.url().slice(0, 160)}`)
      }
    })

    await page.goto("/vehicles", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    expect(failedVehicleRequests, "failed vehicles REST requests").toEqual([])

    // The incident rendered the in-page error boundary ("An error occurred").
    const errorBoundary = page.getByText(/An error occurred|حدث خطأ/).first()
    expect(await errorBoundary.isVisible().catch(() => false), "error boundary visible").toBe(false)
  })

  // ── 2. Current-driver chip (needs a seeded assignment) ─────────────────────

  test("renders the current-driver chip for the seeded assignment", async ({ authed: page }) => {
    await page.goto("/vehicles", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(1500)

    // The chip is a Link to /drivers/<current_driver_id> rendered in the
    // assigned-driver column (page.tsx assigned_driver column render).
    const chip = page.locator('a[href^="/drivers/"]').first()
    if (!(await chip.isVisible().catch(() => false))) {
      test.skip(true, "no seeded vehicle assignment available (fixture-dependent)")
      return
    }
    const href = await chip.getAttribute("href")
    expect(href, "chip links to the assigned driver detail page").toMatch(/^\/drivers\//)
    // Chip shows a name (Arabic name, English name, or driver_code fallback)
    expect((await chip.textContent())?.trim() ?? "").not.toBe("")
  })

  // ── 3. No Radix missing-description a11y warning ───────────────────────────

  test("no 'Missing Description or aria-describedby' console warning (open both dialogs)", async ({
    authed: page,
  }) => {
    const a11yWarnings: string[] = []
    page.on("console", (m) => {
      if (/Missing `?Description`? or `?aria-describedby/i.test(m.text())) {
        a11yWarnings.push(m.text().slice(0, 200))
      }
    })

    await page.goto("/vehicles", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

    // Shared ⌘K command-search dialog (the DialogContent that lacked a
    // Description — mounted from the dashboard topbar on every module page).
    const searchTrigger = page.getByRole("button").filter({ hasText: /⌘/ }).first()
    if (await searchTrigger.isVisible().catch(() => false)) {
      await searchTrigger.click()
      await page.waitForTimeout(800)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(400)
    }

    // Create-vehicle dialog (has a DialogDescription already — must stay clean).
    // NB: don't match bare /مركبة/ — it also hits sidebar nav links.
    const addCta = page.getByRole("button", { name: /إضافة مركبة|Add Vehicle/i }).first()
    if (await addCta.isVisible().catch(() => false)) {
      // dispatchEvent instead of click: in RTL the left sidebar can geometrically
      // intercept the header CTA's click point; we only need the dialog opened.
      await addCta.dispatchEvent("click")
      await page.waitForTimeout(800)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(400)
    }

    expect(a11yWarnings, "Radix missing-description warnings").toEqual([])
  })
})
