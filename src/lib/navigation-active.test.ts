import { describe, expect, it } from "vitest"
import { activeNavigationUrl } from "./navigation-active"

const accounting = ["/accounting", "/accounting?tab=zatca", "/invoices"]
describe("sidebar route context", () => {
  it.each([
    ["/accounting", "", "/accounting"],
    ["/accounting", "lang=en&tab=zatca", "/accounting?tab=zatca"],
    ["/accounting", "tab=journal&lang=ar", "/accounting"],
    ["/accounting", "tab=unknown", "/accounting"],
    ["/invoices", "tab=zatca", "/invoices"],
    ["/invoices/123", "lang=ar", "/invoices"],
    ["/accounting-other", "", null],
  ])("selects one correct current link for %s?%s", (path, query, expected) => {
    expect(activeNavigationUrl(path, query, accounting)).toBe(expected)
  })
  it("keeps nested detail context and prefers a more specific internal route", () => {
    expect(activeNavigationUrl("/drivers/123", "", ["/", "/drivers", "/drivers/123"])).toBe("/drivers/123")
    expect(activeNavigationUrl("/drivers/123", "", ["/drivers/"])).toBe("/drivers/")
  })
  it("does not mark non-navigation links or a partial query match as current", () => {
    expect(activeNavigationUrl("/", "", ["#", "https://other.invalid/", "//other.invalid/"])).toBeNull()
    expect(activeNavigationUrl("/accounting", "tab=zatca&mode=other", ["/accounting?tab=zatca&mode=setup"])).toBeNull()
  })
})
