import { describe, expect, it } from "vitest"

import { formatDualDate, formatHijri, formatHijriLong } from "@/lib/formatting/hijri"

describe("hijri formatting", () => {
  it("formats numeric Hijri date with H suffix", () => {
    const out = formatHijri("2026-09-15")
    expect(out).toMatch(/^\d{4}\/\d{2}\/\d{2} H$/)
  })

  it("formats long Hijri date with a known month name", () => {
    const out = formatHijriLong("2026-09-15")
    // 2026-09-15 falls in Rabi al-Awwal / Rabi al-Thani 1448
    expect(out).toMatch(/1448 H$/)
    expect(out).toMatch(/Rabi al-(Awwal|Thani)/)
  })

  it("dual date contains both Gregorian and Hijri parts", () => {
    const out = formatDualDate("2026-09-15")
    expect(out).toMatch(/Sept? 2026/)
    expect(out).toContain("1448 H")
    expect(out).toContain("·")
  })

  it("returns em dash for null/undefined/invalid", () => {
    expect(formatHijri(null)).toBe("—")
    expect(formatDualDate(undefined)).toBe("—")
    expect(formatHijri("not-a-date")).toBe("not-a-date")
  })
})
