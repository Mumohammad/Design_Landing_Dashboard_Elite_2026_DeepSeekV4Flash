import { describe, expect, it } from "vitest"
import { buildCsp, LOCAL_SUPABASE_ORIGIN, supabaseOriginFromEnv } from "./csp"

/** Parse a CSP header string into directive → value map (Prompt M2 helper). */
function parseCsp(csp: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const directive of csp.split(";")) {
    const trimmed = directive.trim()
    if (!trimmed) continue
    const [name, ...rest] = trimmed.split(/\s+/)
    map.set(name, rest.join(" "))
  }
  return map
}

const PROD = { isDev: false, supabaseUrl: "https://wwfnsbilmyxeawgzicmv.supabase.co" }
const DEV = {
  isDev: true,
  supabaseUrl: LOCAL_SUPABASE_ORIGIN,
}

describe("buildCsp (Prompt M2 regression guard)", () => {
  it("PRODUCTION: img-src contains the wildcard supabase origin AND the project origin", () => {
    const imgSrc = parseCsp(buildCsp(PROD)).get("img-src") ?? ""
    expect(imgSrc).toContain("https://*.supabase.co")
    expect(imgSrc).toContain("https://wwfnsbilmyxeawgzicmv.supabase.co")
    // The design contract: private bucket + signed URLs must render.
    expect(imgSrc).toContain("blob:") // optimistic preview
    expect(imgSrc).toContain("'self'")
  })

  it("PRODUCTION: connect-src keeps the storage/API origin and drops the local stack", () => {
    const csp = buildCsp(PROD)
    const connectSrc = parseCsp(csp).get("connect-src") ?? ""
    expect(connectSrc).toContain("https://*.supabase.co")
    expect(connectSrc).not.toContain("127.0.0.1")
    // no unsafe-eval outside dev
    const scriptSrc = parseCsp(csp).get("script-src") ?? ""
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it("DEV: local stack origins are allowlisted for connect-src and img-src", () => {
    const map = parseCsp(buildCsp(DEV))
    expect(map.get("connect-src")).toContain("http://127.0.0.1:54321")
    expect(map.get("img-src")).toContain("http://127.0.0.1:54321")
    expect(map.get("script-src")).toContain("'unsafe-eval'")
  })

  it("handles an unset/empty Supabase URL without crashing", () => {
    expect(() => buildCsp({ isDev: false, supabaseUrl: null })).not.toThrow()
    expect(() => buildCsp({ isDev: false, supabaseUrl: "" })).not.toThrow()
    // fallback origin + wildcard still present
    const imgSrc = parseCsp(buildCsp({ isDev: false, supabaseUrl: "" })).get("img-src") ?? ""
    expect(imgSrc).toContain("https://*.supabase.co")
  })

  it("supabaseOriginFromEnv is defensive", () => {
    expect(supabaseOriginFromEnv("https://abc.supabase.co/")).toBe("https://abc.supabase.co")
    expect(supabaseOriginFromEnv(null)).toBe("https://localhost")
    expect(supabaseOriginFromEnv("::garbage::")).toBe("https://localhost")
  })

  it("every directive is well-formed (name + space-separated sources)", () => {
    const csp = buildCsp(PROD)
    for (const directive of csp.split(";")) {
      const name = directive.trim().split(/\s+/)[0]
      expect(name).toMatch(/^[a-z-]+$/)
    }
  })
})
