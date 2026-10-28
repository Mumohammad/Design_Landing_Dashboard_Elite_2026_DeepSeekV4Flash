import { describe, expect, it } from "vitest"
import { buyerParty, invoiceKindFor, missingNationalAddress, sellerParty, transmissionStatusFor } from "./zatca-adapter-input"

const tenant = {
  name_ar: "شركة", name_en: "Co", legal_name: "Synthetic Co LLC", vat_number: "399999999900003", cr_number: "1010010000",
  address: "King Fahd Road", city: "Riyadh", region: "Riyadh", district: "Olaya", building_number: "1234",
  additional_number: "5678", postal_code: "12345", country: "SA",
}

describe("ZATCA adapter parties", () => {
  it("maps the tenant National Address onto the seller party", () => {
    const seller = sellerParty(tenant)
    expect(seller).toMatchObject({ name: "Synthetic Co LLC", vatNumber: "399999999900003", buildingNumber: "1234", district: "Olaya", postalCode: "12345", additionalNumber: "5678", countryCode: "SA" })
    expect(missingNationalAddress(seller, "seller", "standard")).toEqual([])
  })

  it("reports every missing seller field, including the VAT identity", () => {
    const seller = sellerParty({ ...tenant, vat_number: "123", building_number: null, district: null, postal_code: "1234" })
    expect(missingNationalAddress(seller, "seller", "simplified")).toEqual(["building_number", "district", "postal_code", "vat_number"])
  })

  it("classifies B2B (valid buyer VAT) as standard and B2C as simplified", () => {
    expect(invoiceKindFor(buyerParty({ name_ar: "عميل", name_en: null, tax_number: "399999999800003", address: null }))).toBe("standard")
    expect(invoiceKindFor(buyerParty({ name_ar: "عميل", name_en: null, tax_number: "12345", address: null }))).toBe("simplified")
    expect(invoiceKindFor(buyerParty(null))).toBe("simplified")
  })

  it("requires a Saudi buyer address only on standard invoices", () => {
    const buyer = buyerParty({ name_ar: "عميل", name_en: null, tax_number: "399999999800003", address: null })
    expect(missingNationalAddress(buyer, "buyer", "standard")).toEqual(["street", "building_number", "city", "district", "postal_code"])
    expect(missingNationalAddress(buyer, "buyer", "simplified")).toEqual([])
    expect(missingNationalAddress({ ...buyer, countryCode: "AE" }, "buyer", "standard")).toEqual([])
  })

  it("never maps a gateway failure to a reported/cleared status", () => {
    expect(transmissionStatusFor({ success: true, status: "cleared" })).toBe("cleared")
    expect(transmissionStatusFor({ success: true, status: "reported" })).toBe("reported")
    expect(transmissionStatusFor({ success: false, status: "rejected" })).toBe("rejected")
    expect(transmissionStatusFor({ success: false, error: "ZATCA gateway unavailable (TIMEOUT)." })).toBe("failed")
  })
})
