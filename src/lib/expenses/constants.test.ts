/**
 * SSR / no-data regression tests for Package 0 build repair.
 *
 * Root cause of the /expenses prerender crash:
 *   EXPENSE_TYPES was exported from a "use server" file (actions.ts).
 *   When imported on the client, Next.js wraps every export in a
 *   server-action proxy — so .map() fails with "j.map is not a function"
 *   because the proxy is not a real Array.
 *
 * These tests verify the fix: constants live in a plain module and
 * remain real JavaScript values even if the import chain is unusual.
 */

import { describe, it, expect } from "vitest"
import {
  EXPENSE_TYPES,
  RECOVERABILITY,
  type ExpenseType,
  type ExpenseVatRecoverability,
} from "./constants"

describe("EXPENSE_TYPES (SSR regression — must be a real Array)", () => {
  it("is a real Array instance, not a server-action proxy", () => {
    expect(Array.isArray(EXPENSE_TYPES)).toBe(true)
  })

  it("has non-zero length", () => {
    expect(EXPENSE_TYPES.length).toBeGreaterThan(0)
  })

  it("supports .map() without throwing", () => {
    // This was the exact call that crashed the /expenses prerender.
    const labels = EXPENSE_TYPES.map((t: ExpenseType) => t)
    expect(labels).toHaveLength(EXPENSE_TYPES.length)
  })

  it("supports .filter() without throwing", () => {
    const fuel = EXPENSE_TYPES.filter((t: ExpenseType) => t === "fuel")
    expect(fuel).toEqual(["fuel"])
  })

  it("contains only valid ExpenseType values", () => {
    const valid: ExpenseType[] = [
      "fuel",
      "advance",
      "operational",
      "platform_commission",
      "maintenance",
      "other",
    ]
    for (const t of EXPENSE_TYPES) {
      expect(valid).toContain(t)
    }
  })
})

describe("RECOVERABILITY (SSR regression)", () => {
  it("is a real Array instance", () => {
    expect(Array.isArray(RECOVERABILITY)).toBe(true)
  })

  it("supports .map() without throwing", () => {
    const labels = RECOVERABILITY.map((r: ExpenseVatRecoverability) => r)
    expect(labels).toHaveLength(RECOVERABILITY.length)
  })
})
