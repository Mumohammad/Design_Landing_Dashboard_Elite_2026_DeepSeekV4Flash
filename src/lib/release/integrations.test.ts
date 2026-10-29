import { afterEach, describe, expect, it, vi } from "vitest"
import { integrationAvailable, INTEGRATION_UNAVAILABLE } from "./integrations"

const { admin } = vi.hoisted(() => ({ admin: vi.fn(() => { throw new Error("Unexpected database access") }) }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }))
vi.mock("@/lib/auth/authorization", () => ({ getCurrentUser: vi.fn(), requirePermission: vi.fn() }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: vi.fn() }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitPayroll: vi.fn(), rateLimitSettings: vi.fn(), getClientIp: vi.fn(), RateLimitError: class extends Error {} }))

import { generateWpsFile } from "@/lib/payroll/actions"
import { runZatcaAdapter } from "@/lib/accounting/zatca"
import { onboardZatcaCsids } from "@/lib/accounting/zatca-csid"
import { listWebhookRegistrations, createWebhookRegistration, triggerWebhookRetries } from "@/lib/webhooks/actions"
import { emitWebhookEvent, processRetries } from "@/lib/webhooks/dispatcher"
import { POST } from "@/app/api/webhooks/incoming/route"
import { GET } from "@/app/api/webhooks/cron/route"

afterEach(() => { vi.unstubAllEnvs(); expect(admin).not.toHaveBeenCalled() })

describe("release integration boundaries", () => {
  it("WPS/webhooks stay off; ZATCA production needs the explicit operator flag", () => {
    vi.stubEnv("ZATCA_MODE", "production")
    for (const name of ["wps", "zatca", "webhooks"] as const) expect(integrationAvailable(name)).toBe(false)
    vi.stubEnv("ZATCA_PRODUCTION_ENABLED", "true")
    expect(integrationAvailable("zatca")).toBe(true)
    expect(integrationAvailable("wps")).toBe(false)
    expect(integrationAvailable("webhooks")).toBe(false)
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation")
    expect(integrationAvailable("zatca")).toBe(false) // production mode accepts only the core URL
  })

  it("enables ZATCA only for an explicit, valid non-production gateway", () => {
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
    expect(integrationAvailable("zatca")).toBe(true)
    expect(integrationAvailable("wps")).toBe(false)
    expect(integrationAvailable("webhooks")).toBe(false)
    vi.stubEnv("ZATCA_MODE", "simulation")
    expect(integrationAvailable("zatca")).toBe(false) // URL does not match the simulation portal
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation")
    expect(integrationAvailable("zatca")).toBe(true)
    vi.stubEnv("ZATCA_API_BASE_URL", "https://evil.example/e-invoicing/simulation")
    expect(integrationAvailable("zatca")).toBe(false)
  })

  it("rejects WPS generation and ZATCA submission/onboarding before database access", async () => {
    const denied = { success: false, error: INTEGRATION_UNAVAILABLE }
    expect(await generateWpsFile(2026, 10)).toEqual(denied)
    expect(await runZatcaAdapter()).toEqual(denied)
    expect(await onboardZatcaCsids({ environment: "production", otp: "unused" })).toEqual(denied)
  })

  it("rejects webhook management and does not dispatch business events", async () => {
    const denied = { success: false, error: INTEGRATION_UNAVAILABLE }
    expect(await listWebhookRegistrations()).toEqual(denied)
    expect(await createWebhookRegistration({ name: "Disabled test", url: "https://example.test", events: [] })).toEqual(denied)
    expect(await triggerWebhookRetries()).toEqual(denied)
    await emitWebhookEvent({ tenantId: "unused", eventType: "driver.created", payload: {} })
    await expect(processRetries()).rejects.toThrow(INTEGRATION_UNAVAILABLE)
  })

  it("does not acknowledge incoming payloads or run an authorized cron", async () => {
    expect((await POST()).status).toBe(503)
    vi.stubEnv("CRON_SECRET", "test-only-cron")
    const response = await GET(new Request("https://example.test/api/webhooks/cron", { headers: { authorization: "Bearer test-only-cron" } }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: INTEGRATION_UNAVAILABLE })
  })
})
