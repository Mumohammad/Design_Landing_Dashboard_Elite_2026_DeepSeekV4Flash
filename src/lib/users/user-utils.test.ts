import { describe, it, expect } from "vitest"
import {
  STATUS_META,
  ROLE_META,
  USER_ROLES,
  isStatusTransitionAllowed,
  maskSensitiveValue,
  userInitial,
  usersToCsv,
} from "./user-utils"

describe("isStatusTransitionAllowed", () => {
  it("allows active → locked", () => {
    expect(isStatusTransitionAllowed("active", "locked")).toBe(true)
  })

  it("allows locked → active (unlock)", () => {
    expect(isStatusTransitionAllowed("locked", "active")).toBe(true)
  })

  it("allows pending_invite → active (invite acceptance)", () => {
    expect(isStatusTransitionAllowed("pending_invite", "active")).toBe(true)
  })

  it("rejects terminated as an origin (terminal status)", () => {
    expect(isStatusTransitionAllowed("terminated", "active")).toBe(false)
    expect(isStatusTransitionAllowed("terminated", "inactive")).toBe(false)
  })

  it("rejects identity transitions", () => {
    expect(isStatusTransitionAllowed("active", "active")).toBe(false)
  })

  it("does not throw for any known status", () => {
    for (const s of Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>) {
      expect(typeof isStatusTransitionAllowed(s, "inactive")).toBe("boolean")
    }
  })
})

describe("maskSensitiveValue", () => {
  it("returns a dash for empty values", () => {
    expect(maskSensitiveValue(null, true)).toBe("—")
    expect(maskSensitiveValue("  ", true)).toBe("—")
    expect(maskSensitiveValue(undefined, false)).toBe("—")
  })

  it("fully masks without consent regardless of value", () => {
    expect(maskSensitiveValue("0551234567", false)).toBe("••••••")
  })

  it("shows the last two digits with consent", () => {
    expect(maskSensitiveValue("0551234567", true)).toBe("••••••••67")
  })

  it("never leaks short values beyond their length", () => {
    expect(maskSensitiveValue("ab", true)).toBe("ab")
  })
})

describe("userInitial", () => {
  it("takes the first character of the name", () => {
    expect(userInitial("عبدالله")).toBe("ع")
    expect(userInitial("Sara")).toBe("S")
  })

  it("falls back to ? for empty names", () => {
    expect(userInitial(null)).toBe("?")
    expect(userInitial("   ")).toBe("?")
  })
})

describe("usersToCsv", () => {
  it("builds BOM-prefixed CSV rows", () => {
    const csv = usersToCsv(["Code", "Name"], [["EDU-000001", "سارة"]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain("Code,Name")
    expect(csv).toContain("EDU-000001,سارة")
  })

  it("escapes commas, quotes and newlines", () => {
    const csv = usersToCsv(["v"], [['a,"b"', 5]])
    expect(csv).toContain('"a,""b"""')
    expect(csv).toContain("5")
  })
})

describe("role metadata", () => {
  it("has bilingual metadata for every enum role", () => {
    for (const r of USER_ROLES) {
      expect(ROLE_META[r].ar.length).toBeGreaterThan(0)
      expect(ROLE_META[r].en.length).toBeGreaterThan(0)
    }
  })
})
