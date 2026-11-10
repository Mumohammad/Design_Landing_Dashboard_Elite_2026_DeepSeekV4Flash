// Unit tests for monthBounds (audit fix FX-04): the orders CSV export
// previously hardcoded the end day to "-31", which Postgres rejects for
// every month that doesn't have 31 days. The boundaries must be derived
// from real calendar values.
//
// Run: pnpm exec vitest run src/lib/orders/month-boundaries.test.ts

import { describe, expect, it } from "vitest"
import { monthBounds } from "./month-boundaries"

describe("monthBounds", () => {
  it("February 2026 (non-leap) ends on the 28th", () => {
    expect(monthBounds(2026, 2)).toEqual({ start: "2026-02-01", end: "2026-02-28" })
  })

  it("February 2028 (leap) ends on the 29th", () => {
    expect(monthBounds(2028, 2)).toEqual({ start: "2028-02-01", end: "2028-02-29" })
  })

  it("February 2000 (divisible by 400) is a leap year", () => {
    expect(monthBounds(2000, 2).end).toBe("2000-02-29")
  })

  it("February 1900 (divisible by 100 but not 400) is not a leap year", () => {
    expect(monthBounds(1900, 2).end).toBe("1900-02-28")
  })

  it("April (30 days) ends on the 30th", () => {
    expect(monthBounds(2026, 4)).toEqual({ start: "2026-04-01", end: "2026-04-30" })
  })

  it("June (30 days) ends on the 30th", () => {
    expect(monthBounds(2026, 6)).toEqual({ start: "2026-06-01", end: "2026-06-30" })
  })

  it("September (30 days) ends on the 30th", () => {
    expect(monthBounds(2026, 9)).toEqual({ start: "2026-09-01", end: "2026-09-30" })
  })

  it("November (30 days) ends on the 30th", () => {
    expect(monthBounds(2026, 11)).toEqual({ start: "2026-11-01", end: "2026-11-30" })
  })

  it("December ends on the 31st", () => {
    expect(monthBounds(2026, 12)).toEqual({ start: "2026-12-01", end: "2026-12-31" })
  })

  it("31-day months end on the 31st", () => {
    for (const m of [1, 3, 5, 7, 8, 10]) {
      expect(monthBounds(2026, m).end).toBe(`2026-${String(m).padStart(2, "0")}-31`)
    }
  })

  it("zero-pads the month component", () => {
    expect(monthBounds(2026, 1).start).toBe("2026-01-01")
    expect(monthBounds(2026, 1).end).toBe("2026-01-31")
  })

  it("never emits an invalid ISO date for any month of a nearby year span", () => {
    for (let y = 2024; y <= 2030; y++) {
      for (let m = 1; m <= 12; m++) {
        const { start, end } = monthBounds(y, m)
        const startDay = new Date(`${start}T00:00:00Z`).getUTCDate()
        const endDay = new Date(`${end}T00:00:00Z`).getUTCDate()
        expect(startDay).toBe(1)
        expect(Number(end.slice(5, 7))).toBe(m)
        expect(endDay).toBeGreaterThanOrEqual(28)
        // Round-tripping end through Date must not shift the month:
        // an invalid "2026-02-31" would parse as March 3rd.
        expect(new Date(`${end}T00:00:00Z`).getUTCMonth() + 1).toBe(m)
      }
    }
  })
})
