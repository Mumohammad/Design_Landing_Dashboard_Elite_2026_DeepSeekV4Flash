// Route-level tests for POST /api/auth/sign-in and POST
// /api/auth/forgot-password (audit fix H2): under-threshold allow with
// session-cookie establishment, 429 over-threshold, window reset, 503
// fail-closed on limiter-backend errors, generic credential errors, and
// neutral forgot-password responses (no account enumeration).
//
// Run: pnpm exec vitest run src/app/api/auth/auth-routes.test.ts

import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ── Mocks (hoisted) ────────────────────────────────────────────────────────

const { limiterState, ssrState, resetPasswordMock, emailCallbackMock } = vi.hoisted(() => {
  const limiterState = {
    signInResult: { success: true, remaining: 9, resetAt: Date.now() + 60_000 },
    forgotResult: { success: true, remaining: 2, resetAt: Date.now() + 3_600_000 },
    throwUnavailable: false,
  }
  const ssrState = { succeed: true }
  const resetPasswordMock = vi.fn()
  return { limiterState, ssrState, resetPasswordMock, emailCallbackMock: vi.fn() }
})

vi.mock("@/lib/auth/rate-limit", () => {
  class RateLimitError extends Error {
    code = "AUTH_RATE_LIMITED"
    statusCode = 429
    messageAr = "محاولات كثيرة."
    messageEn = "Too many attempts."
    constructor(
      readonly resetAt: number,
      readonly limit: number
    ) {
      super("Too many attempts.")
    }
  }
  class RateLimitUnavailableError extends Error {
    code = "RATE_LIMIT_UNAVAILABLE"
    statusCode = 503
    messageAr = "الخدمة غير متاحة مؤقتاً."
    messageEn = "Service temporarily unavailable."
  }
  return {
    RateLimitError,
    RateLimitUnavailableError,
    rateLimitSignIn: vi.fn(async () => {
      if (limiterState.throwUnavailable) throw new RateLimitUnavailableError()
      return limiterState.signInResult
    }),
    rateLimitForgotPassword: vi.fn(async () => {
      if (limiterState.throwUnavailable) throw new RateLimitUnavailableError()
      return limiterState.forgotResult
    }),
  }
})

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (c: unknown[]) => void } }
  ) => ({
    auth: {
      signInWithPassword: async (creds: { email: string }) => {
        if (!ssrState.succeed) {
          return {
            data: { user: null },
            error: { code: "invalid_credentials", message: "Invalid login credentials" },
          }
        }
        // What the SSR client would write for a fresh session.
        options.cookies.setAll([
          { name: "sb-access-token", value: "access-123", options: { httpOnly: true, path: "/" } },
          { name: "sb-refresh-token", value: "refresh-456", options: { httpOnly: true, path: "/" } },
        ])
        return { data: { user: { id: "u1", email: creds.email } }, error: null }
      },
    },
  }),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { resetPasswordForEmail: resetPasswordMock },
  }),
}))

vi.mock("@/lib/redirects", () => ({
  authCallbackUrlWithReturn: emailCallbackMock,
}))

vi.mock("@/lib/errors", () => ({
  handleError: (e: { code?: string; messageAr?: string; messageEn?: string }) => ({
    code: e.code ?? "ERR_INTERNAL",
    message_ar: e.messageAr ?? "خطأ",
    message_en: e.messageEn ?? "error",
    statusCode: 500,
  }),
}))

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// ── Load the route modules ONCE (per-test vi.resetModules() re-imports the
//    whole next/server graph and blows the 5s default timeout) ─────────────

let signIn: typeof import("./sign-in/route").POST
let forgot: typeof import("./forgot-password/route").POST

beforeAll(async () => {
  signIn = (await import("./sign-in/route")).POST
  forgot = (await import("./forgot-password/route")).POST
})

function jsonPost(url: string, body: unknown, ip = "203.0.113.7"): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  limiterState.signInResult = { success: true, remaining: 9, resetAt: Date.now() + 60_000 }
  limiterState.forgotResult = { success: true, remaining: 2, resetAt: Date.now() + 3_600_000 }
  limiterState.throwUnavailable = false
  ssrState.succeed = true
  emailCallbackMock.mockReset().mockReturnValue("https://dashboard.example.test/auth/confirm")
  resetPasswordMock.mockReset().mockResolvedValue({ error: null })
})

// ── POST /api/auth/sign-in ─────────────────────────────────────────────────

describe("POST /api/auth/sign-in", () => {
  it("200 under threshold AND establishes the session cookies on the response", async () => {
    const res = await signIn(jsonPost("/api/auth/sign-in", { email: "user@example.com", password: "secret1" }))
    expect(res.status).toBe(200)

    // Acceptance (amendment 1): the sb-* cookies MUST be written by the route
    // response so /dashboard loads without a redirect back to /auth/sign-in.
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c) => c.startsWith("sb-access-token=access-123"))).toBe(true)
    expect(setCookies.some((c) => c.startsWith("sb-refresh-token=refresh-456"))).toBe(true)
    expect(setCookies.some((c) => c.includes("HttpOnly"))).toBe(true)
  }, 15_000)

  it("429 over threshold with AUTH_RATE_LIMITED envelope + Retry-After", async () => {
    limiterState.signInResult = {
      success: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    }
    const res = await signIn(jsonPost("/api/auth/sign-in", { email: "user@example.com", password: "secret1" }))
    expect(res.status).toBe(429)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("AUTH_RATE_LIMITED")
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
  })

  it("503 fail-closed when the limiter backend errors (never fail-open)", async () => {
    limiterState.throwUnavailable = true
    const res = await signIn(jsonPost("/api/auth/sign-in", { email: "user@example.com", password: "secret1" }))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("RATE_LIMIT_UNAVAILABLE")
  })

  it("window reset: allow → deny → allow again (route-level)", async () => {
    const req = () =>
      jsonPost("/api/auth/sign-in", { email: "user@example.com", password: "secret1" })

    expect((await signIn(req())).status).toBe(200) // window 1: allowed
    limiterState.signInResult = { success: false, remaining: 0, resetAt: Date.now() + 60_000 }
    expect((await signIn(req())).status).toBe(429) // exhausted
    limiterState.signInResult = { success: true, remaining: 9, resetAt: Date.now() + 60_000 }
    expect((await signIn(req())).status).toBe(200) // window reset
  })

  it("401 generic AUTH004 on bad credentials (no enumeration), no cookies", async () => {
    ssrState.succeed = false
    const res = await signIn(jsonPost("/api/auth/sign-in", { email: "nosuch@example.com", password: "wrong12" }))
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string; message_en: string }
    expect(body.code).toBe("AUTH004")
    expect(body.message_en).toMatch(/invalid email or password/i)
    expect(res.headers.getSetCookie()).toHaveLength(0)
  })

  it("400 on malformed input", async () => {
    const res = await signIn(jsonPost("/api/auth/sign-in", { email: "not-an-email", password: "x" }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("ERR_VALIDATION")
  })
})

// ── POST /api/auth/forgot-password ─────────────────────────────────────────

describe("POST /api/auth/forgot-password", () => {
  it("200 neutral success and sends the email server-side", async () => {
    const res = await forgot(jsonPost("/api/auth/forgot-password", { email: "user@example.com" }))
    expect(res.status).toBe(200)
    expect(resetPasswordMock).toHaveBeenCalledWith(
      "user@example.com",
      { redirectTo: "https://dashboard.example.test/auth/confirm" }
    )
  })

  it("503 when the configured email origin is invalid, before sending a recovery request", async () => {
    emailCallbackMock.mockImplementation(() => { throw new Error("Invalid email origin: private config") })
    const res = await forgot(jsonPost("/api/auth/forgot-password", { email: "user@example.com" }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "Password recovery temporarily unavailable" })
    expect(resetPasswordMock).not.toHaveBeenCalled()
  })

  it("200 even when Supabase errors (no account enumeration in the response)", async () => {
    resetPasswordMock.mockResolvedValue({ error: { message: "User not found" } })
    const res = await forgot(jsonPost("/api/auth/forgot-password", { email: "nosuch@example.com" }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(true)
  })

  it("429 over threshold with AUTH_RATE_LIMITED envelope", async () => {
    limiterState.forgotResult = { success: false, remaining: 0, resetAt: Date.now() + 120_000 }
    const res = await forgot(jsonPost("/api/auth/forgot-password", { email: "user@example.com" }))
    expect(res.status).toBe(429)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("AUTH_RATE_LIMITED")
    expect(resetPasswordMock).not.toHaveBeenCalled()
  })

  it("503 fail-closed when the limiter backend errors", async () => {
    limiterState.throwUnavailable = true
    const res = await forgot(jsonPost("/api/auth/forgot-password", { email: "user@example.com" }))
    expect(res.status).toBe(503)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("RATE_LIMIT_UNAVAILABLE")
    expect(resetPasswordMock).not.toHaveBeenCalled()
  })

  it("400 on malformed input", async () => {
    const res = await forgot(jsonPost("/api/auth/forgot-password", { email: "nope" }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("ERR_VALIDATION")
  })
})
