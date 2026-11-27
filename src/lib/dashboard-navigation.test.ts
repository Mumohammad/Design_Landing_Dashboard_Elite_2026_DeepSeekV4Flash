import { describe, expect, it } from "vitest"
import { translations } from "./i18n/translations"
import { dashboardNavigation } from "./dashboard-navigation"

describe.each(["ar", "en"] as const)("workspace navigation in %s", (locale) => {
  const t = translations[locale]

  it("exposes each live finance and operations destination once", () => {
    const items = dashboardNavigation(t, locale).flatMap(group => group.items)
    const urls = items.map(item => item.url)
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls).toEqual(expect.arrayContaining([
      "/orders", "/applications", "/expenses/claims", "/violations/fines",
      "/payroll", "/invoices", "/payments", "/accounting", "/accounting?tab=zatca",
    ]))
    expect(items.find(item => item.url === "/accounting?tab=zatca")?.title).toBe(t.nav.einvoicing)
    for (const retired of ["/templates", "/pricing", "/faqs"]) expect(urls).not.toContain(retired)
  })
})
