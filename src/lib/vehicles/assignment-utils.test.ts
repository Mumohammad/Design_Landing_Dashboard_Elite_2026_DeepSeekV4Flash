// Unit tests for the vehicle-side wiring (Prompt F): the assignment
// terminal-state guard and the docs-expiry chip classifier — the pure
// client-safe helpers in assignment-utils.ts (the "use server" sibling
// re-exports the guard for its own use).
import { describe, expect, it } from "vitest"
import {
  ALLOWED_ASSIGNMENT_TRANSITIONS,
  isAssignmentTransitionAllowed,
  isIsoDate,
  worstDocsExpiryState,
} from "./assignment-utils"

describe("assignment terminal-state guard", () => {
  it("allows active → ended and nothing else", () => {
    expect(ALLOWED_ASSIGNMENT_TRANSITIONS.active).toEqual(["ended"])
    expect(isAssignmentTransitionAllowed("active", "ended")).toBe(true)
  })

  it("treats ended as terminal (history rows never re-end)", () => {
    expect(ALLOWED_ASSIGNMENT_TRANSITIONS.ended).toEqual([])
    expect(isAssignmentTransitionAllowed("ended", "active")).toBe(false)
    expect(isAssignmentTransitionAllowed("ended", "ended")).toBe(false)
  })

  it("refuses self-transitions on active", () => {
    expect(isAssignmentTransitionAllowed("active", "active")).toBe(false)
  })
})

describe("isIsoDate", () => {
  it("accepts yyyy-mm-dd and empty values", () => {
    expect(isIsoDate("2026-09-27")).toBe(true)
    expect(isIsoDate("2026-01-01")).toBe(true)
    expect(isIsoDate(null)).toBe(true)
    expect(isIsoDate(undefined)).toBe(true)
    expect(isIsoDate("")).toBe(true)
  })

  it("rejects other formats", () => {
    expect(isIsoDate("27/09/2026")).toBe(false)
    expect(isIsoDate("2026-9-27")).toBe(false)
    expect(isIsoDate("not a date")).toBe(false)
  })
})

describe("worstDocsExpiryState", () => {
  const now = new Date("2026-09-27T12:00:00Z")

  it("returns none when no expiry dates exist", () => {
    expect(
      worstDocsExpiryState(
        { insurance_expiry: null, registration_expiry: null, inspection_expiry: null },
        now
      )
    ).toBe("none")
  })

  it("flags expired as the worst state even when another is valid", () => {
    expect(
      worstDocsExpiryState(
        {
          insurance_expiry: "2026-09-01", // expired
          registration_expiry: "2027-01-01", // ok
          inspection_expiry: "2027-06-01", // ok
        },
        now
      )
    ).toBe("expired")
  })

  it("flags soon when one doc is inside the 30-day window", () => {
    expect(
      worstDocsExpiryState(
        {
          insurance_expiry: null,
          registration_expiry: "2026-10-15", // 18 days out
          inspection_expiry: "2027-01-01",
        },
        now
      )
    ).toBe("soon")
  })

  it("returns ok when all present docs are beyond the window", () => {
    expect(
      worstDocsExpiryState(
        {
          insurance_expiry: "2027-09-01",
          registration_expiry: "2027-01-01",
          inspection_expiry: "2027-06-01",
        },
        now
      )
    ).toBe("ok")
  })

  it("honours a custom soon-window", () => {
    expect(
      worstDocsExpiryState(
        { insurance_expiry: "2026-11-01", registration_expiry: null, inspection_expiry: null },
        now,
        60
      )
    ).toBe("soon")
    expect(
      worstDocsExpiryState(
        { insurance_expiry: "2026-11-01", registration_expiry: null, inspection_expiry: null },
        now,
        7
      )
    ).toBe("ok")
  })

  it("ignores unparseable dates", () => {
    expect(
      worstDocsExpiryState(
        { insurance_expiry: "garbage", registration_expiry: null, inspection_expiry: null },
        now
      )
    ).toBe("none")
  })
})
