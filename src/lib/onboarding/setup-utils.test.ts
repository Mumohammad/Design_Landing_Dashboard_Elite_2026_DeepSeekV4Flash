import { describe, expect, it } from "vitest"
import { buildSetupProgress, isCompanyProfileComplete } from "./setup-utils"

describe("setup checklist", () => {
  it("marks steps done from tenant counts", () => {
    const p = buildSetupProgress({ companyComplete: true, bankAccounts: 1, platforms: 0, drivers: 3, vehicles: 0, users: 1, invoices: 0 })
    expect(p.total).toBe(7)
    expect(p.completed).toBe(3)
    expect(p.steps.find((s) => s.key === "team")?.done).toBe(false)
  })

  it("requires name, VAT, CR and logo for the company step", () => {
    expect(isCompanyProfileComplete(null)).toBe(false)
    expect(isCompanyProfileComplete({ name_ar: "شركة", vat_number: "300000000000003", cr_number: "1010", logo_url: null })).toBe(false)
    expect(isCompanyProfileComplete({ name_ar: "شركة", vat_number: "300000000000003", cr_number: "1010", logo_url: "x.png" })).toBe(true)
  })
})
