import { describe, expect, it } from "vitest"
import { formatAccountingDate, formatAmount } from "./format"
describe("accounting display localization", () => {
  it("formats English and Arabic decimal numbers without changing their value", () => {
    expect(formatAmount("1234.50", "en")).toBe("1,234.50")
    expect(formatAmount("1234.50", "ar")).toBe("١٬٢٣٤٫٥٠")
  })
  it("keeps financial dates Gregorian in both locales", () => {
    expect(formatAccountingDate("2026-10-11", "en")).toContain("2026")
    expect(formatAccountingDate("2026-10-11", "ar")).toContain("٢٠٢٦")
  })
  it("does not disguise missing or invalid values as zero", () => {
    expect(formatAmount(null, "ar")).toBe("—")
    expect(formatAmount(NaN, "en")).toBe("—")
    expect(formatAccountingDate("invalid", "en")).toBe("—")
  })
})
