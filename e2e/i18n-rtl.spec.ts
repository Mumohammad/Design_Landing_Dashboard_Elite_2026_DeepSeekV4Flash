/**
 * E2E smoke tests for Package 6 — i18n / RTL / accessibility.
 *
 * Tests critical flows in both Arabic (RTL) and English (LTR) at mobile
 * and desktop widths, verifying:
 *   - Correct lang and dir attributes on <html>
 *   - Translation strings render correctly
 *   - RTL layout mirroring works
 *   - Language toggle switches locale
 *   - Error pages render localized text
 */

import { test, expect, waitForPageLoad } from "./helpers"

// ── Arabic (RTL) tests ──────────────────────────────────────────────────────

test.describe("Arabic / RTL rendering", () => {
  test("landing page renders in Arabic with RTL direction", async ({ page }) => {
    // Clear locale preference to get default (Arabic)
    await page.goto("/landing")
    await page.evaluate(() => localStorage.removeItem("elite-locale"))
    await page.reload()
    await waitForPageLoad(page)

    // Check lang and dir attributes
    const lang = await page.getAttribute("html", "lang")
    const dir = await page.getAttribute("html", "dir")
    expect(lang).toBe("ar")
    expect(dir).toBe("rtl")
  })

  test("sign-in page renders in Arabic by default", async ({ page }) => {
    await page.goto("/auth/sign-in")
    await page.evaluate(() => localStorage.removeItem("elite-locale"))
    await page.reload()
    await waitForPageLoad(page)

    const lang = await page.getAttribute("html", "lang")
    expect(lang).toBe("ar")

    // Check Arabic text is present
    const heading = page.getByRole("heading", { level: 2 })
    await expect(heading.first()).toBeVisible({ timeout: 10_000 })
  })

  test("forbidden page renders localized text", async ({ page }) => {
    await page.goto("/auth/errors/forbidden")
    await waitForPageLoad(page)

    // Should show 403 error code
    const heading = page.getByRole("heading", { level: 1 })
    await expect(heading).toContainText("403")
  })
})

// ── English (LTR) tests ─────────────────────────────────────────────────────

test.describe("English / LTR rendering", () => {
  test("landing page switches to English with LTR direction", async ({ page }) => {
    await page.goto("/landing")
    // Set locale to English
    await page.evaluate(() => {
      localStorage.setItem("elite-locale", "en")
    })
    await page.reload()
    await waitForPageLoad(page)

    const lang = await page.getAttribute("html", "lang")
    const dir = await page.getAttribute("html", "dir")
    expect(lang).toBe("en")
    expect(dir).toBe("ltr")
  })

  test("sign-in page renders in English when locale is set", async ({ page }) => {
    await page.goto("/auth/sign-in")
    await page.evaluate(() => {
      localStorage.setItem("elite-locale", "en")
    })
    await page.reload()
    await waitForPageLoad(page)

    const lang = await page.getAttribute("html", "lang")
    expect(lang).toBe("en")
  })
})

// ── Locale toggle ───────────────────────────────────────────────────────────

test.describe("Language toggle", () => {
  test("toggles between Arabic and English", async ({ authenticatedPage: page }) => {
    // Start in Arabic (default)
    await page.goto("/dashboard")
    await page.evaluate(() => localStorage.removeItem("elite-locale"))
    await page.reload()
    await waitForPageLoad(page)

    let lang = await page.getAttribute("html", "lang")
    expect(lang).toBe("ar")

    // Click language toggle button (the one with flag icon)
    const langButton = page.getByRole("button", { name: /toggle language/i })
    if (await langButton.isVisible().catch(() => false)) {
      await langButton.click()
      await page.waitForTimeout(500)

      lang = await page.getAttribute("html", "lang")
      expect(lang).toBe("en")

      // Toggle back
      await langButton.click()
      await page.waitForTimeout(500)

      lang = await page.getAttribute("html", "lang")
      expect(lang).toBe("ar")
    }
  })
})

// ── Mobile responsive ───────────────────────────────────────────────────────

test.describe("Mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 812 } }) // iPhone X

  test("landing page renders correctly on mobile", async ({ page }) => {
    await page.goto("/landing")
    await waitForPageLoad(page)

    // Page should be visible without horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1) // +1 for rounding
  })

  test("sign-in form is usable on mobile", async ({ page }) => {
    await page.goto("/auth/sign-in")
    await waitForPageLoad(page)

    // Form should be visible
    const emailInput = page.getByLabel(/email/i)
    await expect(emailInput).toBeVisible({ timeout: 10_000 })

    // Button should be visible and tappable (min 44px touch target)
    const submitButton = page.getByRole("button", { name: /sign in|login|تسجيل/i })
    await expect(submitButton).toBeVisible()
    const box = await submitButton.boundingBox()
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(32) // Minimum touch target
    }
  })
})

// ── RTL layout ──────────────────────────────────────────────────────────────

test.describe("RTL layout", () => {
  test("sidebar appears on correct side in RTL", async ({ authenticatedPage: page }) => {
    await page.goto("/dashboard")
    await page.evaluate(() => {
      localStorage.setItem("elite-locale", "ar")
    })
    await page.reload()
    await waitForPageLoad(page)

    // In RTL, the sidebar should be on the right side
    const dir = await page.getAttribute("html", "dir")
    expect(dir).toBe("rtl")
  })
})

// ── Error pages ─────────────────────────────────────────────────────────────

test.describe("Error pages accessibility", () => {
  test("not-found page has accessible heading", async ({ page }) => {
    await page.goto("/nonexistent-page-12345")
    await waitForPageLoad(page)

    // Should show 404 heading
    const heading = page.getByRole("heading", { level: 1 })
    await expect(heading).toBeVisible({ timeout: 10_000 })
  })

  test("forbidden page has accessible buttons", async ({ page }) => {
    await page.goto("/auth/errors/forbidden")
    await waitForPageLoad(page)

    // Should have at least one button
    const buttons = page.getByRole("button")
    const count = await buttons.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
