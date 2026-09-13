// M7 regression test: `audit_log.actor_id` is `UUID REFERENCES auth.users(id)`
// (migration 007). The webhook server actions historically passed
// `currentUser.id` (the public `users` ROW id) into `writeAuditLog` — every
// insert failed the FK and `writeAuditLog` swallowed the error, so webhook
// create/update/delete/secret-rotate lost their audit trail silently.
//
// The mock here gives the two ids DELIBERATELY DIFFERENT values and asserts
// the insert payload uses the auth.users id — and never the row id.
//
// Run: pnpm exec vitest run src/lib/webhooks/actions.test.ts

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const { ROW_ID, AUTH_ID, TENANT_ID, auditInsert, currentUser } = vi.hoisted(() => {
  const ROW_ID = "11111111-1111-4111-8111-111111111111" // public.users row id (WRONG for actor_id)
  const AUTH_ID = "99999999-9999-4999-8999-999999999999" // auth.users id (CORRECT for actor_id)
  const TENANT_ID = "55555555-5555-4555-8555-555555555555"
  const auditInsert = vi.fn(async (_entry: Record<string, unknown>) => ({ error: null }))
  const currentUser = {
    id: ROW_ID,
    authUserId: AUTH_ID,
    tenantId: TENANT_ID,
    role: "general_manager",
  }
  return { ROW_ID, AUTH_ID, TENANT_ID, auditInsert, currentUser }
})

// The audit insert path: real writeAuditLog() runs and lands here via the
// service-role admin client — so the assertion covers the actorId → actor_id
// column mapping too.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => (table === "audit_log" ? { insert: auditInsert } : {}),
  }),
}))

vi.mock("@/lib/auth/authorization", () => ({
  getCurrentUser: vi.fn(async () => currentUser),
  requirePermission: vi.fn(async () => undefined),
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  rateLimitSettings: vi.fn(async () => ({
    success: true,
    remaining: 9,
    resetAt: Date.now() + 60_000,
  })),
  getClientIp: vi.fn(async () => "203.0.113.9"),
  RateLimitError: class RateLimitError extends Error {},
}))

// Avoid loading @sentry/nextjs through the real errors module (exceeds the
// vitest module budget on cold start — same reason as platform-routes.test.ts).
vi.mock("@/lib/errors", () => ({
  handleError: vi.fn((e: unknown) => ({
    message_en: e instanceof Error ? e.message : "error",
  })),
}))

vi.mock("./url-guard", () => ({
  assertSafeWebhookUrl: vi.fn(async () => ({ ok: true })),
}))

vi.mock("./store", () => ({
  listWebhooks: vi.fn(async () => []),
  getWebhook: vi.fn(async () => null),
  createWebhook: vi.fn(async () => ({
    webhook: {
      id: "wh-1",
      name: "Ops hook",
      url: "https://hooks.example.test/x",
      secret: "whsec_1",
    },
    error: null,
  })),
  updateWebhook: vi.fn(async () => ({
    webhook: { id: "wh-1", name: "Ops hook", url: "https://hooks.example.test/x" },
    error: null,
  })),
  deleteWebhook: vi.fn(async () => ({ success: true })),
  regenerateWebhookSecret: vi.fn(async () => ({ secret: "whsec_rotated" })),
  getDeliveryStats: vi.fn(async () => ({})),
}))

vi.mock("./dispatcher", () => ({
  processRetries: vi.fn(async () => ({ attempted: 0, succeeded: 0 })),
}))

import {
  createWebhookRegistration,
  updateWebhookRegistration,
  deleteWebhookRegistration,
  regenerateWebhookSecretAction,
} from "./actions"

describe("webhook actions audit-log actor (M7)", () => {
  beforeEach(() => {
    auditInsert.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("createWebhookRegistration audits actor_id = authUserId, NEVER the users row id", async () => {
    const res = await createWebhookRegistration({
      name: "Ops hook",
      url: "https://hooks.example.test/x",
      events: ["driver.created"],
    })

    expect(res.success).toBe(true)
    expect(auditInsert).toHaveBeenCalledTimes(1)

    const payload = auditInsert.mock.calls[0][0]
    expect(payload.actor_id).toBe(AUTH_ID) // auth.users UUID
    expect(payload.actor_id).not.toBe(ROW_ID) // public.users row UUID
    expect(payload.tenant_id).toBe(TENANT_ID)
    expect(payload.module).toBe("webhooks")
    expect(payload.action).toBe("created")
  })

  it("update / delete / secret-rotate audit under the auth user id too (all four call sites)", async () => {
    await updateWebhookRegistration("wh-1", { name: "Renamed" })
    await deleteWebhookRegistration("wh-1")
    await regenerateWebhookSecretAction("wh-1")

    expect(auditInsert).toHaveBeenCalledTimes(3)
    for (const call of auditInsert.mock.calls) {
      const payload = call[0]
      expect(payload.actor_id).toBe(AUTH_ID)
      expect(payload.actor_id).not.toBe(ROW_ID)
    }
  })
})
