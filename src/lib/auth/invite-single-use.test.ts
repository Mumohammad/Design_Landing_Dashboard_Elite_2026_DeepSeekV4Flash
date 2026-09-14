// FX-11 (J9) — regression tests pinning audit invariant #3:
// "Invite tokens are bcrypt-hashed and single-use."
//
// invite-tokens.test.ts pins the bcrypt hashing primitives; these tests pin
// the CONSUMPTION semantics of acceptInvite (src/lib/auth/invites.ts):
//   - first acceptance with the correct token succeeds and flips the invite
//     to `accepted` exactly once;
//   - replaying the same token afterwards fails with the generic
//     anti-enumeration error and creates NO second auth user / membership;
//   - revoked and expired invites are rejected without provisioning anything.
//
// The Supabase admin client is replaced by an in-memory store so the REAL
// acceptInvite logic runs (bcrypt verification against the stored hash,
// status transition, provisioning order). No real Supabase, email, or
// network calls.
//
// Mutation check (FX-11): removing step 6 in acceptInvite (the
// `status: "accepted"` update) makes "does not provision twice" FAIL —
// the replay would create a second auth user.

import { describe, expect, it, vi, beforeEach } from "vitest"
import { hashInviteToken } from "@/lib/auth/invite-tokens"

const { adminFactory, writeAuditLogMock } = vi.hoisted(() => ({
  adminFactory: vi.fn(),
  writeAuditLogMock: vi.fn(async (..._args: unknown[]) => undefined),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => adminFactory(...args),
}))

vi.mock("@/lib/auth/sessions", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLogMock(...args),
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: vi.fn(async () => undefined),
  getCurrentUser: vi.fn(async () => null),
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ success: true, remaining: 9, resetAt: Date.now() + 60_000 })),
  getClientIp: vi.fn(async () => "10.0.0.1"),
}))

// moduleLogger may be pulled in transitively; stub to keep output clean.
vi.mock("@/lib/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logPerformance: vi.fn(),
}))

import { acceptInvite } from "./invites"

const TOKEN = "11111111-1111-4111-8111-111111111111"
const TID = "22222222-2222-4222-8222-222222222222"
const INVITE_ID = "33333333-3333-4333-8333-333333333333"
const EMAIL = "invitee@example.test"
const TENANT = "44444444-4444-4444-8444-444444444444"

type Row = Record<string, unknown>

const state = {
  invites: [] as Row[],
  users: [] as Row[],
  memberships: [] as Row[],
  authUsers: { created: [] as { id: string; email?: string }[], deleted: [] as string[] },
  inviteUpdates: [] as { id: unknown; patch: Row }[],
  userInsertError: null as { message: string } | null,
}

function futureIso(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function pastIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
}

/** Filterable select chain over a snapshot provider (rows is a closure). */
function selectChain(rows: () => Row[]) {
  const filters: Array<(r: Row) => boolean> = []
  const match = () => rows().filter((r) => filters.every((f) => f(r)))
  const b: Record<string, unknown> = {}
  b.select = vi.fn(() => b)
  b.eq = vi.fn((c: string, v: unknown) => {
    filters.push((r) => r[c] === v)
    return b
  })
  b.gt = vi.fn((c: string, v: unknown) => {
    filters.push((r) => String(r[c]) > String(v))
    return b
  })
  b.is = vi.fn((c: string, v: unknown) => {
    filters.push((r) => r[c] === v)
    return b
  })
  b.order = vi.fn(() => b)
  b.limit = vi.fn(() => b)
  b.maybeSingle = vi.fn(async () => ({ data: match()[0] ?? null, error: null }))
  b.single = vi.fn(async () => ({ data: match()[0] ?? null, error: null }))
  b.then = (resolve: (v: unknown) => void) =>
    Promise.resolve({ data: match(), error: null, count: 0 }).then(resolve)
  return b
}

function buildAdmin() {
  return {
    from: vi.fn((table: string) => {
      if (table === "invites") {
        return {
          select: () => selectChain(() => state.invites),
          insert: (row: Row) => ({
            select: () => ({
              single: async () => ({ data: { id: (row as { id: string }).id }, error: null }),
            }),
          }),
          update: (patch: Row) => {
            const node: Record<string, unknown> = {
              eq: (_c: string, id: unknown) => {
                state.inviteUpdates.push({ id, patch })
                return node
              },
              then: (resolve: (v: unknown) => void) => {
                for (const { id, patch: p } of state.inviteUpdates) {
                  const row = state.invites.find((r) => r.id === id)
                  if (row) Object.assign(row, p)
                }
                return Promise.resolve({ data: null, error: null }).then(resolve)
              },
            }
            return node
          },
        }
      }
      if (table === "users") {
        return {
          insert: (row: Row) => ({
            select: () => ({
              single: async () => {
                if (state.userInsertError) return { data: null, error: state.userInsertError }
                const id = `usr_${state.users.length + 1}`
                state.users.push({ ...row, id })
                return { data: { id }, error: null }
              },
            }),
          }),
        }
      }
      if (table === "tenant_memberships") {
        return {
          insert: (row: Row) => ({
            then: (resolve: (v: unknown) => void) => {
              state.memberships.push(row)
              return Promise.resolve({ data: null, error: null }).then(resolve)
            },
          }),
        }
      }
      if (table === "roles") {
        return { select: () => selectChain(() => []) } // no role rows → soft-fail path
      }
      if (table === "user_role_assignments") {
        return {
          insert: () => ({
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve({ data: null, error: null }).then(resolve),
          }),
        }
      }
      throw new Error(`unexpected table in test: ${table}`)
    }),
    auth: {
      admin: {
        createUser: vi.fn(async ({ email }: { email: string }) => {
          const user = { id: `auth_${state.authUsers.created.length + 1}`, email }
          state.authUsers.created.push(user)
          return { data: { user }, error: null }
        }),
        deleteUser: vi.fn(async (id: string) => {
          state.authUsers.deleted.push(id)
          return { data: {}, error: null }
        }),
      },
    },
  }
}

async function seedInvite(overrides: Row = {}): Promise<string> {
  const tokenHash = await hashInviteToken(TOKEN)
  state.invites = [
    {
      id: INVITE_ID,
      email: EMAIL,
      role: "gm",
      tenant_id: TENANT,
      token_id: TID,
      token_hash: tokenHash,
      status: "pending",
      expires_at: futureIso(),
      deleted_at: null,
      ...overrides,
    },
  ]
  return tokenHash
}

const GENERIC = "Invalid or expired invite token."

describe("acceptInvite — single-use consumption (invariant #3)", () => {
  beforeEach(() => {
    state.invites = []
    state.users = []
    state.memberships = []
    state.authUsers = { created: [], deleted: [] }
    state.inviteUpdates = []
    state.userInsertError = null
    adminFactory.mockReset()
    adminFactory.mockImplementation(() => buildAdmin())
    writeAuditLogMock.mockClear()
  })

  it("accepts a valid pending invite exactly once (status flipped to accepted)", async () => {
    await seedInvite()

    const first = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(first, JSON.stringify(first)).toEqual({ success: true })

    // Status transition happened exactly once, to "accepted".
    expect(state.inviteUpdates).toHaveLength(1)
    expect(state.inviteUpdates[0]).toEqual({
      id: INVITE_ID,
      patch: expect.objectContaining({ status: "accepted" }),
    })
    // One auth user, one users row, one membership — nothing duplicated.
    expect(state.authUsers.created).toHaveLength(1)
    expect(state.authUsers.created[0].email).toBe(EMAIL)
    expect(state.users).toHaveLength(1)
    expect(state.memberships).toHaveLength(1)
  })

  it("REPLAY of the same token is rejected and provisions nothing new", async () => {
    await seedInvite()

    const first = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(first, JSON.stringify(first)).toEqual({ success: true })
    const afterFirst = {
      auth: state.authUsers.created.length,
      users: state.users.length,
      memberships: state.memberships.length,
    }

    const replay = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(replay).toEqual({ success: false, error: GENERIC })

    // No second provisioning of any kind.
    expect(state.authUsers.created).toHaveLength(afterFirst.auth)
    expect(state.users).toHaveLength(afterFirst.users)
    expect(state.memberships).toHaveLength(afterFirst.memberships)
    // The accepted marker was written exactly once across both attempts.
    expect(state.inviteUpdates).toHaveLength(1)
  })

  it("wrong token fails with the SAME generic error (anti-enumeration)", async () => {
    await seedInvite()

    // Attempt with a wrong token: rejected with the generic error, and the
    // invite is NOT consumed (no provisioning happened).
    const wrongToken = "99999999-9999-4999-8999-999999999999"
    const wrong = await acceptInvite(wrongToken, TID, "سامي", "Str0ngPass!1")
    expect(wrong.success).toBe(false)
    expect(wrong.error).toBe(GENERIC)
    expect(state.authUsers.created).toHaveLength(0)

    // The correct token still works afterwards (wrong attempt didn't consume it).
    const valid = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(valid, JSON.stringify(valid)).toEqual({ success: true })

    // Replay after acceptance gets the SAME generic error string —
    // indistinguishable from the wrong-token failure (anti-enumeration).
    const replay = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(replay).toEqual({ success: false, error: GENERIC })
    expect(replay.error).toBe(wrong.error)
  })

  it("revoked invites are rejected without provisioning", async () => {
    await seedInvite({ status: "revoked" })

    const res = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(res).toEqual({ success: false, error: GENERIC })
    expect(state.authUsers.created).toHaveLength(0)
    expect(state.users).toHaveLength(0)
    expect(state.memberships).toHaveLength(0)
    expect(state.inviteUpdates).toHaveLength(0)
  })

  it("expired invites are rejected without provisioning", async () => {
    await seedInvite({ expires_at: pastIso() })

    const res = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(res).toEqual({ success: false, error: GENERIC })
    expect(state.authUsers.created).toHaveLength(0)
    expect(state.users).toHaveLength(0)
    expect(state.memberships).toHaveLength(0)
    expect(state.inviteUpdates).toHaveLength(0)
  })

  it("failed users-row insert compensates by deleting the auth user (no orphan)", async () => {
    await seedInvite()
    state.userInsertError = { message: "users insert failed" }

    const res = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(res.success).toBe(false)
    expect(state.authUsers.created).toHaveLength(1)
    expect(state.authUsers.deleted).toEqual([state.authUsers.created[0].id])
    expect(state.memberships).toHaveLength(0)
    // The invite was NOT consumed — the token still works after a fix.
    expect(state.inviteUpdates).toHaveLength(0)
  })
})
