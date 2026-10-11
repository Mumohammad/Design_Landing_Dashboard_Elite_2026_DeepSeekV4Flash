import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import { localeInitScript } from "./locale-init"

function initialize(search: string, saved: string | null, cookie = "", blockedStorage = false) {
  const document = { documentElement: { lang: "ar", dir: "rtl" }, cookie }
  const localStorage = {
    getItem: () => { if (blockedStorage) throw new Error("Blocked"); return saved },
    setItem: (_key: string, value: string) => { if (blockedStorage) throw new Error("Blocked"); saved = value },
  }
  runInNewContext(localeInitScript, { document, localStorage, location: { search, protocol: "https:" }, URLSearchParams })
  return { document, saved }
}
describe("pre-hydration language persistence", () => {
  it("restores English without overwriting it with the Arabic default", () => {
    const result = initialize("", "en")
    expect(result.document.documentElement).toEqual({ lang: "en", dir: "ltr" })
    expect(result.saved).toBe("en")
  })
  it("prioritizes an explicit cross-host language handoff", () => {
    const result = initialize("?lang=ar", "en")
    expect(result.document.documentElement).toEqual({ lang: "ar", dir: "rtl" })
    expect(result.saved).toBe("ar")
    expect(result.document.cookie).toContain("SameSite=Lax; Secure")
  })
  it("uses the cookie when localStorage is unavailable", () => {
    expect(initialize("", null, "other=x; elite-locale=en", true).document.documentElement).toEqual({ lang: "en", dir: "ltr" })
  })
  it("ignores unsupported or injected language values", () => {
    expect(initialize("?lang=<script>", null).document.documentElement).toEqual({ lang: "ar", dir: "rtl" })
  })
})
