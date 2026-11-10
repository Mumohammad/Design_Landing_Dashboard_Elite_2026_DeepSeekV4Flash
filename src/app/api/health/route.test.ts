import { afterEach, describe, expect, it, vi } from "vitest"
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => ({ select: () => ({ limit: () => ({ abortSignal: query }) }) }) }),
}))
import { GET } from "./route"
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe("readiness", () => {
  it("returns 503 without service configuration", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    expect((await GET()).status).toBe(503)
  })
  it.each([true, false])("checks the real Auth endpoint (available=%s)", async (available) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-test-key")
    query.mockResolvedValue({ error: null })
    const fetchMock = vi.fn().mockResolvedValue({ ok: available })
    vi.stubGlobal("fetch", fetchMock)
    const response = await GET()
    expect(response.status).toBe(available ? 200 : 503)
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/auth/v1/settings", expect.anything())
    expect(JSON.stringify(await response.json())).not.toContain("test-key")
  })
  it("returns 503 when the database fails even if Auth responds", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-test-key")
    query.mockResolvedValue({ error: { message: "private failure" } })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain("private failure")
  })
})
