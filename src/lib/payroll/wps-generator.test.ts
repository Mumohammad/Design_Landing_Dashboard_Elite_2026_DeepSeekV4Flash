// Financial Phase 14 — unit tests for the WPS SIF file generator
// (TEST-STRATEGY.md §3.1): header/detail/trailer layout, pipe escaping,
// SAR currency 682, bank-code map, date formatting.
import { describe, expect, it } from "vitest"
import { generateWPSSIF } from "./wps-generator"

const COMPANY = { mol_reference: "MOL-2026-000123", iban: "SA0310000000000000000000" }
const PERIOD = "2026-08"

const PAYMENT = {
  driver: { iqama_number: "1234567890", full_name_ar: "محمد أحمد" },
  iban: "SA0310000000000000000000", // Al-Rajhi (bank code 10)
  net_payroll: 5000,
  base_amount: 4000,
  housing_allowance: 500,
  other_allowances: 100,
  total_deductions: 1000,
  paid_at: "2026-08-15T12:00:00.000Z", // noon UTC — timezone-safe date
  working_days_actual: 26,
}

describe("generateWPSSIF — layout", () => {
  it("emits H (header), D (detail), T (trailer) records", () => {
    const sif = generateWPSSIF([PAYMENT], COMPANY, PERIOD)
    const lines = sif.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0].startsWith("H|")).toBe(true)
    expect(lines[1].startsWith("D|")).toBe(true)
    expect(lines[2].startsWith("T|")).toBe(true)
  })

  it("formats the header: ref, YYYYMM period, 6-digit count, total net 2dp, version 01", () => {
    const header = generateWPSSIF([PAYMENT], COMPANY, PERIOD).split("\n")[0]
    expect(header).toBe("H|MOL-2026-000123|202608|000001|5000.00|01")
  })

  it("formats the detail record with SAR 682 and payment method 01", () => {
    const detail = generateWPSSIF([PAYMENT], COMPANY, PERIOD).split("\n")[1]
    expect(detail).toBe(
      "D|1234567890|محمد أحمد|SA0310000000000000000000|1010|5000.00|4000.00|500.00|100.00|1000.00|20260815|26|682|01"
    )
  })

  it("formats the trailer with the record count", () => {
    const trailer = generateWPSSIF([PAYMENT], COMPANY, PERIOD).split("\n")[2]
    expect(trailer).toBe("T|1")
  })

  it("aggregates the header across multiple records (count padded, total summed)", () => {
    const header = generateWPSSIF([PAYMENT, { ...PAYMENT, net_payroll: 10000 }], COMPANY, PERIOD).split("\n")[0]
    expect(header).toBe("H|MOL-2026-000123|202608|000002|15000.00|01")
  })
})

describe("generateWPSSIF — escaping", () => {
  it("strips pipe characters from the driver name (SIF field delimiter)", () => {
    const sif = generateWPSSIF([{ ...PAYMENT, driver: { iqama_number: "1", full_name_ar: "Ali|Baba" } }], COMPANY, PERIOD)
    const detail = sif.split("\n")[1]
    expect(detail).not.toContain("Ali|Baba")
    expect(detail).toContain("AliBaba")
  })
})

describe("generateWPSSIF — validation", () => {
  it("throws when there are no payment records", () => {
    expect(() => generateWPSSIF([], COMPANY, PERIOD)).toThrow("no payment records")
  })
})

describe("Saudi bank-code map (IBAN positions 4-5)", () => {
  const cases: [string, string][] = [
    ["SA0310000000000000000000", "1010"], // Al-Rajhi (10)
    ["SA0520000000000000000000", "1020"], // SNB (20)
    ["SA0530000000000000000000", "1030"], // Riyad (30)
    ["SA0540000000000000000000", "1040"], // SABB (40)
    ["SA0580000000000000000000", "1080"], // Al-Jazira (80)
  ]
  it.each(cases)("maps %s → %s", (iban, expected) => {
    const detail = generateWPSSIF([{ ...PAYMENT, iban }], COMPANY, PERIOD).split("\n")[1]
    expect(detail.split("|")[4]).toBe(expected)
  })

  it("falls back to 9999 for unknown bank codes and short IBANs", () => {
    const unknown = generateWPSSIF([{ ...PAYMENT, iban: "SA0399999999999999999999" }], COMPANY, PERIOD).split("\n")[1]
    expect(unknown.split("|")[4]).toBe("9999")
    const short = generateWPSSIF([{ ...PAYMENT, iban: "SA03" }], COMPANY, PERIOD).split("\n")[1]
    expect(short.split("|")[4]).toBe("9999")
  })
})
