import { describe, expect, it } from "vitest"
import { translations } from "./translations"
import { platformContent } from "./platform-content"

function leaves(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    Object.entries(leaves(child, prefix ? `${prefix}.${key}` : key))))
}
describe("English/Arabic translation catalog", () => {
  it("has identical, non-empty keys in both supported languages", () => {
    const ar = leaves(translations.ar), en = leaves(translations.en)
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
    for (const [key, text] of Object.entries({ ...ar, ...en })) expect(text.trim(), key).not.toBe("")
  })
  it("covers every platform entry string in both languages", () => {
    expect(Object.keys(platformContent.ar).sort()).toEqual(Object.keys(platformContent.en).sort())
    for (const text of Object.values(platformContent.en)) expect(text.trim()).not.toBe("")
  })
})
