import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  vi.resetModules()
  for (const name of ["DEPLOYMENT_ROLE", "NEXT_PUBLIC_DASHBOARD_URL", "NEXT_PUBLIC_LANDING_URL", "PUBLIC_DASHBOARD_URL", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_URL"]) vi.stubEnv(name, "")
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const callback = async () => (await import("./redirects")).authCallbackUrlWithReturn()

describe("configured absolute authentication email origins", () => {
  it("uses the explicit server app origin and canonical confirmation path", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.test/dashboard")
    expect(await callback()).toBe("https://staging.example.test/auth/confirm")
  })
  it("uses the configured site origin only if the app origin is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined)
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test/landing")
    expect(await callback()).toBe("https://app.example.test/auth/confirm")
  })
  it.each([undefined, "", "/auth/confirm", "javascript:alert(1)", "http://external.example", "https://user:password@app.example", "https://app.example/?next=evil", "https://app.example/#token", "//evil.example"])("fails closed for unsafe or missing configured origin %s", async value => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", value)
    await expect(callback()).rejects.toThrow(/Authentication email origin/)
  })
  it.each(["http://localhost:3107", "http://127.0.0.1:58321", "http://[::1]:3000"])("allows explicit local test origin %s", async origin => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", origin)
    expect(await callback()).toBe(origin+"/auth/confirm")
  })
  it("keeps the configured multi-host dashboard as the sole email session owner", async () => {
    vi.stubEnv("DEPLOYMENT_ROLE", "landing")
    vi.stubEnv("PUBLIC_DASHBOARD_URL", "https://dashboard.example.test")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://landing.example.test")
    expect(await callback()).toBe("https://dashboard.example.test/auth/confirm")
  })
  it("uses current browser origin for a single-host browser flow", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://other.example.test")
    vi.stubGlobal("window", { location: { origin: "https://preview.example.test" } })
    expect(await callback()).toBe("https://preview.example.test/auth/confirm")
  })
})
