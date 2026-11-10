import { describe, expect, it } from "vitest"
import { isValidNewPassword, newPasswordHint } from "./password-policy"

describe("new-password policy", () => {
  it.each([
    ["minimum", "a1" + "x".repeat(8)],
    ["maximum", "a1" + "x".repeat(126)],
    ["passphrase", "A long passphrase with 2 words"],
  ])("accepts a valid %s", (_label, value) => { expect(isValidNewPassword(value)).toBe(true) })
  it.each([
    ["short", "a1" + "x".repeat(7)], ["long", "a1" + "x".repeat(127)],
    ["letters only", "x".repeat(12)], ["numbers only", "1".repeat(12)],
    ["spaces only", " ".repeat(12)], ["empty", ""], ["null", null],
    ["object", {}], ["number", 1234567890],
  ])("rejects %s without coercion", (_label, value) => { expect(isValidNewPassword(value)).toBe(false) })
  it("explains the same policy in Arabic and English", () => {
    expect(newPasswordHint("en")).toContain("10–128")
    expect(newPasswordHint("en")).toContain("letter")
    expect(newPasswordHint("ar")).toContain("10 إلى 128")
    expect(newPasswordHint("ar")).toContain("ورقم")
  })
})
