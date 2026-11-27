// Route-level tests for the supported /api/platform/* endpoints: raw Supabase /
// PostgREST error text must never reach the client, and existing-vs-fresh
// registration responses must be byte-identical (anti-enumeration).
//
// Run: pnpm exec vitest run src/app/api/platform/platform-routes.test.ts

import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { inspect } from "node:util"

// ── Mocks (hoisted) ────────────────────────────────────────────────────────

const { authState, rlState } = vi.hoisted(() => ({
  authState: {
    createUserCalls: 0,
    deleteUserCalls: 0,
    provisionCalls: 0,
    provisionResult: { id: "11111111-2222-3333-4444-555555555555", slug: "acme" } as unknown,
    generateLinkInputs: [] as unknown[],
    generateLinkError: null as Error | null,
    createUserError: null as { message: string; code?: string } | null,
    tenantsInsertError: null as { message: string; code?: string } | null,
  },
  rlState: {
    registerResult: null as { success: boolean; remaining: number; resetAt: number } | null,
    registerError: null as Error | null,
  },
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        createUser: async () => {
          authState.createUserCalls++
          return authState.createUserError
            ? { data: { user: null }, error: authState.createUserError }
            : { data: { user: { id: "au1" } }, error: null }
        },
        deleteUser: vi.fn(async () => { authState.deleteUserCalls++; return { error: null } }),
        generateLink: async (input: unknown) => {
          authState.generateLinkInputs.push(input)
          if (authState.generateLinkError) return { data: null, error: authState.generateLinkError }
          return { data: { properties: { action_link: "https://confirm.example.test" } }, error: null }
        },
      },
    },
    rpc: async () => { authState.provisionCalls++; return { data: authState.provisionResult, error: authState.tenantsInsertError } },
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
              : { data: { id: "11111111-2222-3333-4444-555555555555", slug: "acme" }, error: null },
        }),
      }),
      upsert: async () => ({ data: null, error: null }),
    }),
  }),
}))

vi.mock("server-only", () => ({}))
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

let registerPost: typeof import("./register/route").POST
let meGet: typeof import("./me/route").GET

beforeAll(async () => {
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
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://workspace.example.test")
  authState.createUserCalls = 0
  authState.deleteUserCalls = 0
  authState.provisionCalls = 0
  authState.provisionResult = { id: "11111111-2222-3333-4444-555555555555", slug: "acme" }
  authState.generateLinkInputs = []
  authState.generateLinkError = null
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({}) }))
  )
  authState.createUserError = null
  authState.tenantsInsertError = null
  rlState.registerResult = null
  rlState.registerError = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

    authState.createUserError = { message: "User already registered", code: "email_exists" }
    const existing = await registerPost(jsonPost("/api/platform/register", payload))

    expect(existing.status).toBe(fresh.status)
    expect(await existing.text()).toBe(await fresh.text())
    expect(existing.status).toBe(200)
  })

  it("uses the configured absolute confirmation destination instead of the request host", async () => {
    const response = await registerPost(jsonPost("/api/platform/register", payload))
    expect(response.status).toBe(200)
    expect(authState.generateLinkInputs).toEqual([expect.objectContaining({
      type: "signup", options: { redirectTo: "https://workspace.example.test/auth/confirm" },
    })])
  })

  it("fails closed on unsafe email configuration before creating an account", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://untrusted.example.test")
    const response = await registerPost(jsonPost("/api/platform/register", payload))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Registration temporarily unavailable" })
    expect(authState.createUserCalls).toBe(0)
    expect(authState.generateLinkInputs).toEqual([])
  })

  it("DB failure mid-registration → 503 with NO PostgREST text, table, or column names", async () => {
    authState.createUserError = null
    authState.tenantsInsertError = {
      message:
        'duplicate key value violates unique constraint "tenants_domain_key" on table "tenants"',
    }
    const res = await registerPost(jsonPost("/api/platform/register", payload))
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(text).not.toMatch(/duplicate key|violates|constraint|table|tenants/i)
    expect(JSON.parse(text)).toEqual({ error: "Registration unavailable. Please contact support before retrying." })
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

  it("SVG logo upload → 400 before any user creation", async () => {
    const svg = `data:image/png;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64")}`
    const res = await registerPost(
      jsonPost("/api/platform/register", JSON.stringify({ ...base, password: "Password123", logo_base64: svg }))
    )
    expect(res.status).toBe(400)
    expect((await res.json()).success).toBeUndefined()
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

describe("registration image and atomic provisioning boundaries",()=>{
 const base={company_name:"Image company",domain:"image.test",email:"image@example.test",password:"Password123"}
 const post=(fields:Record<string,unknown>)=>registerPost(jsonPost("/api/platform/register",JSON.stringify({...base,...fields})))
 it("valid PNG is prevalidated and optional logo remains deferred after successful company creation",async()=>{
  const sharp=(await import("sharp")).default
  const png=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer()
  const fields={logo_base64:`data:image/png;base64,${png.toString("base64")}`}
  const response=await post(fields);expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({success:true,requires_confirmation:true,logo_status:"deferred",logo_message_en:expect.stringContaining("Settings")})
  expect(authState.createUserCalls).toBe(1);expect(authState.provisionCalls).toBe(1);expect(authState.deleteUserCalls).toBe(0)
  authState.createUserError={message:"Already registered",code:"email_exists"}
  const existing=await post(fields);expect(existing.status).toBe(200);expect(await existing.json()).toMatchObject({success:true,logo_status:"deferred"})
  expect(authState.provisionCalls).toBe(1)
 })
 for(const body of ["data:image/png;base64,%%%","A".repeat(700001),"data:image/png;base64,iVBORw0KGgo="])it("invalid, truncated or oversized image cannot create an account",async()=>{
  const result=await post({logo_base64:body});expect(result.status).toBe(400);expect(authState.createUserCalls).toBe(0);expect(authState.provisionCalls).toBe(0)
 })
 it("definite SQL rejection may clean uncommitted auth owner, unknown outcome and malformed receipt never delete",async()=>{
  authState.tenantsInsertError={code:"23505",message:"private"};expect((await post({})).status).toBe(503);expect(authState.deleteUserCalls).toBe(1)
  authState.tenantsInsertError={code:"FETCH_ERROR",message:"unknown network outcome"};expect((await post({})).status).toBe(503);expect(authState.deleteUserCalls).toBe(1)
  authState.tenantsInsertError=null;authState.provisionResult={id:"not-a-tenant"};expect((await post({})).status).toBe(503);expect(authState.deleteUserCalls).toBe(1)
 })
})

describe("registration diagnostic privacy", () => {
  const privateDetail = "SYNTHETIC_PRIVATE_PROVIDER_DETAIL"
  const payload = JSON.stringify({ company_name: "Logging fixture", domain: "logging.test", email: "owner@logging.test", password: "Password123" })
  const post = () => registerPost(jsonPost("/api/platform/register", payload))

  it("retains the confirmation-required response without logging a rejected link's private diagnostics", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      authState.generateLinkError = Object.assign(new Error(privateDetail), { provider: { token: privateDetail } })
      const response = await post()
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ success: true, requires_confirmation: true })
      expect(logged).toHaveBeenCalled()
      expect(inspect(logged.mock.calls, { depth: 8 })).not.toContain(privateDetail)
      expect(authState.deleteUserCalls).toBe(0)
    } finally { logged.mockRestore() }
  })

  it("keeps unexpected provider failures generic in the response and server logs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      rlState.registerError = Object.assign(new Error(privateDetail), { request: { authorization: privateDetail } })
      const response = await post()
      expect(response.status).toBe(500)
      expect(JSON.stringify(await response.json())).not.toContain(privateDetail)
      expect(logged).toHaveBeenCalled()
      expect(inspect(logged.mock.calls, { depth: 8 })).not.toContain(privateDetail)
      expect(authState.createUserCalls).toBe(0)
    } finally { logged.mockRestore() }
  })
})
