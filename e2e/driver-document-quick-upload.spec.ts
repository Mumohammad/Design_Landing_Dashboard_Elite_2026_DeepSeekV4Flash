import { test, expect } from "./preview-test"
import { assertStagingTarget } from "./staging-target"

test.use({ viewport: { width: 390, height: 844 }, trace: "off", video: "off", screenshot: "off" })
test.beforeAll(async ({ request }) => assertStagingTarget(request))

for (const locale of ["en", "ar"] as const) {
  test(`${locale}: document search distinguishes exhausted retries from empty results and clears closed drafts`, async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL
    const password = process.env.TEST_USER_PASSWORD
    if (!email || !password) throw Error("Dedicated staging credentials are required")
    await page.goto("/auth/sign-in?lang=en")
    await page.getByLabel(/^Email$/i).fill(email)
    await page.getByLabel(/^Password$/i).fill(password)
    await page.getByRole("button", { name: /^Sign in$/i }).click()
    await page.waitForURL(/\/dashboard(?:\?|$)/)
    try {
      await page.goto(`/drivers?lang=${locale}`)
      const open = page.getByRole("button", { name: locale === "en" ? "Upload document" : "رفع مستند", exact: true })
      await open.click()
      const dialog = page.getByTestId("driver-document-quick-upload")
      await expect(dialog).toBeVisible()
      let failedResponses = 0
      let recoveredResponses = 0
      let unavailable = true
      const searchUrl = (url: URL) => url.origin === "https://viowrovartosrkqukjxy.supabase.co"
        && url.pathname === "/rest/v1/drivers" && url.searchParams.has("or")
      await page.route(searchUrl, async route => {
        if (route.request().method() !== "GET") return route.fallback()
        if (unavailable) failedResponses++
        else recoveredResponses++
        await route.fulfill({
          status: unavailable ? 503 : 200,
          headers: {
            "retry-after": "0",
            "access-control-allow-origin": new URL(page.url()).origin,
            "access-control-allow-credentials": "true",
            "access-control-expose-headers": "retry-after",
          },
          contentType: "application/json",
          body: unavailable ? '{"message":"Synthetic unavailable"}' : "[]",
        })
      })
      try {
        await dialog.locator("#dqu-search").fill("Release probe")
        const empty = dialog.getByText(locale === "en"
          ? "No matching drivers. Add or import drivers first."
          : "لا يوجد سائق مطابق. أضف السائقين أو استوردهم أولاً.", { exact: true })
        await expect(dialog.getByRole("alert")).toContainText(locale === "en"
          ? "Could not search drivers. Try again." : "تعذر البحث عن السائقين. أعد المحاولة.", { timeout: 15000 })
        // Prove the actual retry chain was injected, rather than accepting an unrelated error.
        expect(failedResponses).toBe(4)
        await expect(empty).toHaveCount(0)
        unavailable = false
        await dialog.getByRole("button", { name: locale === "en" ? "Try again" : "أعد المحاولة", exact: true }).click()
        await expect(empty).toBeVisible()
        await expect(dialog.getByRole("alert")).toHaveCount(0)
        expect(recoveredResponses).toBe(1)
        await page.keyboard.press("Escape")
        await expect(dialog).not.toBeVisible()
        await open.click()
        await expect(dialog.locator("#dqu-search")).toHaveValue("")
        await expect(empty).toHaveCount(0)
        await page.keyboard.press("Escape")
        await expect(dialog).not.toBeVisible()
      } finally {
        await page.unroute(searchUrl)
      }
    } finally {
      await page.goto("/auth/sign-out")
    }
  })
}
