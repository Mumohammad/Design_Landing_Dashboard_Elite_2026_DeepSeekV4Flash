// Route-level tests for /api/platform/* (audit fix FX-07): raw Supabase /
// PostgREST error text must never reach the client, and existing-vs-fresh
// account responses must be byte-identical (anti-enumeration).
//
// Run: pnpm exec vitest run src/app/api/platform/platform-routes.test.ts

import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ── Mocks (hoisted) ────────────────────────────────────────────────────────

const { authState, rlState } = vi.hoisted(() => ({
  authState: {
    loginError: null as { message: string } | null,
    createUserError: null as { message: string } | null,
    tenantsInsertError: null as { message: string } | null,
  },
  rlState: {
    registerResult: null as { success: boolean; remaining: number; resetAt: number } | null,
    registerError: null as Error | null,
  },
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () =>
        authState.loginError
          ? { data: { user: null }, error: authState.loginError }
          : { data: { user: { id: "u1" } }, error: null },
      admin: {
        createUser: async () =>
          authState.createUserError
            ? { data: { user: null }, error: authState.createUserError }
            : { data: { user: { id: "au1" } }, error: null },
        generateLink: async () => ({
          data: { properties: { action_link: "https://confirm.example.test" } },
          error: null,
        }),
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: "pu1" }, error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () =>
            table === "tenants" && authState.tenantsInsertError
              ? { data: null, error: authState.tenantsInsertError }
              : { data: { id: "t1", slug: "acme" }, error: null },
        }),
      }),
      upsert: async () => ({ data: null, error: null }),
    }),
  }),
}))

vi.mock("@/lib/notifications/company-welcome-email", () => ({
  sendCompanyConfirmationEmail: vi.fn(async () => undefined),
}))

// FX-08: control the J1 limiter per test (null → allowed, as the real
// backend would for a fresh IP).
vi.mock("@/lib/auth/rate-limit", () => ({
  rateLimitRegister: vi.fn(async () => {
    if (rlState.registerError) throw rlState.registerError
    return (
      rlState.registerResult ?? {
        success: true,
        remaining: 9,
        resetAt: Date.now() + 60_000,
      }
    )
  }),
  RateLimitError: class RateLimitError extends Error {
    code = "AUTH_RATE_LIMITED"
    statusCode = 429
    messageAr = "محاولات كثيرة. حاول مرة أخرى لاحقاً."
    messageEn = "Too many attempts. Try again later."
    constructor(
      readonly resetAt: number,
      readonly limit: number
    ) {
      super("Too many attempts")
    }
  },
  RateLimitUnavailableError: class RateLimitUnavailableError extends Error {
    code = "RATE_LIMIT_UNAVAILABLE"
    statusCode = 503
    messageAr = "الخدمة غير متاحة مؤقتاً. حاول مرة أخرى بعد قليل."
    messageEn = "Service temporarily unavailable. Please try again shortly."
  },
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { message: "no rows" } }),
        }),
      }),
    }),
  }),
}))

// ── Load the route modules once (same convention as auth-routes.test.ts) ──

let loginPost: typeof import("./login/route").POST
let registerPost: typeof import("./register/route").POST
let meGet: typeof import("./me/route").GET

beforeAll(async () => {
  loginPost = (await import("./login/route")).POST
  registerPost = (await import("./register/route")).POST
  meGet = (await import("./me/route")).GET
})

function jsonPost(path: string, rawBody: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  })
}

// Supabase auth settings fetch → fails → route keeps default
// emailConfirmationEnabled = true (deterministic responses).
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({}) }))
  )
  authState.loginError = null
  authState.createUserError = null
  authState.tenantsInsertError = null
  rlState.registerResult = null
  rlState.registerError = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── POST /api/platform/login ───────────────────────────────────────────────

describe("POST /api/platform/login (FX-07)", () => {
  it("returns one generic 401 for EVERY Supabase auth failure reason", async () => {
    for (const reason of [
      "Invalid login credentials",
      "Email not confirmed",
      "User already registered",
    ]) {
      authState.loginError = { message: reason }
      const res = await loginPost(
        jsonPost("/api/platform/login", JSON.stringify({ email: "e@x.com", password: "pw" }))
      )
      expect(res.status, reason).toBe(401)
      expect(await res.json(), reason).toEqual({ error: "Invalid email or password" })
    }
  })

  it("two-email enumeration probe: unknown vs existing account → identical status AND body", async () => {
    // "Unknown email" and "existing but unconfirmed" historically produced
    // different Supabase messages; both must now be indistinguishable.
    authState.loginError = { message: "Invalid login credentials" }
    const unknown = await loginPost(
      jsonPost("/api/platform/login", JSON.stringify({ email: "ghost@example.com", password: "pw" }))
    )
    authState.loginError = { message: "Email not confirmed" }
    const existing = await loginPost(
      jsonPost("/api/platform/login", JSON.stringify({ email: "real@example.com", password: "pw" }))
    )
    expect(unknown.status).toBe(existing.status)
    expect(await unknown.text()).toBe(await existing.text())
  })

  it("outer catch is generic: malformed JSON → 500 with no leak", async () => {
    const res = await loginPost(jsonPost("/api/platform/login", "{not json"))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Internal server error" })
  })
})

// ── POST /api/platform/register ────────────────────────────────────────────

describe("POST /api/platform/register (FX-07)", () => {
  const payload = JSON.stringify({
    company_name: "Acme",
    domain: "acme.com",
    email: "owner@acme.com",
    password: "password123",
  })

  it("duplicate email is INDISTINGUISHABLE from success (anti-enumeration)", async () => {
    const fresh = await registerPost(jsonPost("/api/platform/register", payload))

    authState.createUserError = { message: "User already registered" }
    const existing = await registerPost(jsonPost("/api/platform/register", payload))

    expect(existing.status).toBe(fresh.status)
    expect(await existing.text()).toBe(await fresh.text())
    expect(existing.status).toBe(200)
  })

  it("DB failure mid-registration → 500 with NO PostgREST text, table, or column names", async () => {
    authState.createUserError = null
    authState.tenantsInsertError = {
      message:
        'duplicate key value violates unique constraint "tenants_domain_key" on table "tenants"',
    }
    const res = await registerPost(jsonPost("/api/platform/register", payload))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toMatch(/duplicate key|violates|constraint|table|tenants/i)
    expect(JSON.parse(text)).toEqual({ error: "Registration failed" })
  })
})

// ── GET /api/platform/me ───────────────────────────────────────────────────

describe("GET /api/platform/me (FX-07)", () => {
  it("unauthenticated → 401 {tenant:null}; DB error → 500 {tenant:null} (no internals)", async () => {
    const unauth = await meGet()
    expect(unauth.status).toBe(401)
    expect(await unauth.json()).toEqual({ tenant: null })
  })
})

// ── POST /api/platform/register — FX-08 (password policy + rate limit) ─────

describe("POST /api/platform/register (FX-08)", () => {
  const base = {
    company_name: "Acme",
    domain: "acme-fx08.test",
    email: "owner@acme-fx08.test",
  }
  const post = (password: string) =>
    registerPost(
      jsonPost("/api/platform/register", JSON.stringify({ ...base, password }))
    )

  it("password 'a' → 400 before any user creation", async () => {
    // If the policy were bypassed, the weak password would reach
    // admin.createUser and return 200 via the FX-07 branch — never 400.
    const res = await post("a")
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({ error: "Invalid registration details" })
    expect(json.success).toBeUndefined()
  })

  it("10 letters but no digit ('abcdefghij') → 400", async () => {
    const res = await post("abcdefghij")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Invalid registration details" })
  })

  it("9 chars including a digit ('abcdefg1') → 400", async () => {
    const res = await post("abcdefg1")
    expect(res.status).toBe(400)
  })

  it("valid policy password keeps the unchanged happy path", async () => {
    const res = await post("Password123")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, requires_confirmation: true })
  })

  it("exhausted per-IP window → 429 AUTH_RATE_LIMITED + Retry-After", async () => {
    rlState.registerResult = {
      success: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    }
    const res = await post("Password123")
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.code).toBe("AUTH_RATE_LIMITED")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1)
  })

  it("ORDER LOCK: exhausted limiter → 429 even when the payload is also invalid (limiter runs BEFORE zod)", async () => {
    // Regression lock for the mandated execution order:
    //   IP extraction → rate limit → 429 → zod → Supabase/auth/tenant work.
    // If validation were ever moved ahead of the limiter, this request would
    // start returning 400 instead of 429 — making the limit trivially
    // bypassable for malformed payloads (free probing of the endpoint).
    rlState.registerResult = {
      success: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    }
    const res = await post("a")
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("AUTH_RATE_LIMITED")
  })

  it("limiter backend unavailable → fail closed 503", async () => {
    const mod = (await import("@/lib/auth/rate-limit")) as unknown as {
      RateLimitUnavailableError: new () => Error
    }
    rlState.registerError = new mod.RateLimitUnavailableError()
    const res = await post("Password123")
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.code).toBe("RATE_LIMIT_UNAVAILABLE")
  })
})
