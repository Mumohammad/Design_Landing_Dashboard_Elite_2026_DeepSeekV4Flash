import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
import { moyasarConfigured } from "./moyasar"
afterEach(() => vi.unstubAllEnvs())
describe("provider mode isolation", () => {
  it.each(["production", "preview"])("refuses test mode against production Supabase in %s", environment => {
    vi.stubEnv("VERCEL_ENV", environment)
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://wwfnsbilmyxeawgzicmv.supabase.co")
    vi.stubEnv("MOYASAR_SECRET_KEY", "sk_test_synthetic")
    expect(moyasarConfigured()).toBe(false)
  })
  it("allows test mode only outside the production deployment and database", () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://viowrovartosrkqukjxy.supabase.co")
    vi.stubEnv("MOYASAR_SECRET_KEY", "sk_test_synthetic")
    expect(moyasarConfigured()).toBe(true)
    vi.stubEnv("VERCEL_ENV", "production")
    expect(moyasarConfigured()).toBe(false)
  })
})
