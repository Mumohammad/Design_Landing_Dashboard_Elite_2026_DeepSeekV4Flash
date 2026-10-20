import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { businessDateKey } from "./business-date"
import { formatDualDate, formatHijri } from "./hijri"
import { DashboardHeader } from "@/app/(dashboard)/dashboard/components/dashboard-header"
import { LocaleProvider } from "@/contexts/locale-context"

const previousZone = process.env.TZ
afterEach(() => { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; vi.useRealTimers() })

describe("Saudi dashboard calendar and hydration", () => {
  it.each([
    ["2026-10-20T20:59:59Z", "2026-10-20"],
    ["2026-10-20T21:00:00Z", "2026-10-21"],
    ["2026-12-31T21:00:00Z", "2027-01-01"],
  ])("uses the Saudi day for %s across host timezones", (instant, day) => {
    for (const zone of ["UTC", "Asia/Riyadh", "America/Los_Angeles", "Pacific/Honolulu"]) {
      process.env.TZ = zone
      expect(businessDateKey(new Date(instant))).toBe(day)
    }
  })
  it.each([false, true])("keeps Gregorian/Hijri formatting independent of the host, Arabic=%s", isAr => {
    process.env.TZ = "Asia/Riyadh"
    const instant = "2026-10-20T21:15:00Z", expected = formatDualDate(instant, isAr), hijri = formatHijri(instant, isAr)
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Honolulu"]) {
      process.env.TZ = zone
      expect(formatDualDate(instant, isAr)).toBe(expected)
      expect(formatHijri(instant, isAr)).toBe(hijri)
    }
    if (!isAr) expect(expected).toContain("21 Oct 2026")
  })
  it("does not bake a changing date into prerendered dashboard HTML", () => {
    vi.useFakeTimers()
    const dates = ["2020-01-01", "2026-10-21", "2027-01-01"].map(day => {
      vi.setSystemTime(new Date(`${day}T00:00:00Z`))
      const html = renderToString(createElement(LocaleProvider, { children: createElement(DashboardHeader, { snapshot: null, onRefresh: () => {}, refreshing: false }) }))
      return /<time\b[^>]*>[\s\S]*?<\/time>/.exec(html)?.[0]
    })
    expect(dates.every(value => value?.includes("dashboard-business-date") && value.includes("—") && !value.includes("dateTime="))).toBe(true)
    expect(new Set(dates).size).toBe(1)
  })
})
