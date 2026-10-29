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
  writeAuditLogMock: vi.fn(async (...args: unknown[]) => { void args }),
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
  authUsers: { created: [] as Array<{id:string;email?:string;email_confirmed_at?:string;app_metadata?:Record<string,unknown>;password?:string}>, deleted: [] as string[] },
  inviteUpdates: [] as { id: unknown; patch: Row }[],
  roles: [] as Row[],
  userInsertError: null as { message: string; code?: string } | null,
  rpcLoss: "none" as "none"|"after_commit"|"before_commit"|"unavailable",
  authLoss: "none" as "none"|"after_commit_throw"|"after_commit_error"|"before_commit"|"duplicate_race",
  authReadFailuresAfterCreate:0,
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
        return { select: () => selectChain(() => state.roles) }
      }
      if(table === "tenants") return {select:()=>selectChain(()=>[{id:TENANT,status:"active",deleted_at:null}])}
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
    rpc:vi.fn(async(name:string,input:Row)=>{
      if(name==="reserve_managed_invite_identity"){
        const invite=state.invites.find(row=>row.id===input.p_invite_id)
        if(!invite||!(invite.status==="pending"||invite.status==="accepted"&&invite.provisioning_auth_user_id===invite.accepted_by))return{data:null,error:{code:"P0001",message:"Invalid invite"}}
        invite.provisioning_auth_user_id??=input.p_candidate_auth_user_id
        return{data:{auth_user_id:invite.provisioning_auth_user_id},error:null}
      }
      if(name!=="accept_managed_invite")throw new Error("Unexpected RPC")
      if(state.rpcLoss==="unavailable")throw Error("Transport unavailable")
      if(state.rpcLoss==="before_commit"){state.rpcLoss="none";throw Error("Request lost")}
      if(state.userInsertError)return{data:null,error:state.userInsertError}
      const invite=state.invites.find(row=>row.id===input.p_invite_id)
      if(invite?.status==="accepted"&&invite.accepted_by===input.p_auth_user_id)return{data:{id:state.users.find(row=>row.auth_user_id===input.p_auth_user_id)?.id},error:null}
      if(!invite||invite.status!=="pending")return{data:null,error:{code:"P0001",message:"Invalid invite"}}
      const id="usr_"+(state.users.length+1)
      state.users.push({id,auth_user_id:input.p_auth_user_id,role:invite.role});state.memberships.push({user_id:id})
      const patch={status:"accepted",accepted_by:input.p_auth_user_id};state.inviteUpdates.push({id:invite.id,patch});Object.assign(invite,patch)
      if(state.rpcLoss==="after_commit"){state.rpcLoss="none";throw Error("Response lost")}
      return{data:{id},error:null}
    }),
    auth: {
      admin: {
        getUserById:vi.fn(async(id:string)=>{
          if(state.authUsers.created.length&&state.authReadFailuresAfterCreate>0){state.authReadFailuresAfterCreate--;throw Error("Auth lookup unavailable")}
          const user=state.authUsers.created.find(row=>row.id===id)
          return user?{data:{user},error:null}:{data:{user:null},error:{code:"user_not_found",status:404}}
        }),
        createUser: vi.fn(async (attributes:{id:string;email:string;password:string;app_metadata:Record<string,unknown>}) => {
          if(state.authLoss==="before_commit"){state.authLoss="none";throw Error("Auth request lost")}
          if(state.authUsers.created.some(user=>user.id===attributes.id))return{data:{user:null},error:{status:422,code:"email_exists"}}
          const user={...attributes,email_confirmed_at:futureIso()}
          state.authUsers.created.push(user)
          if(state.authLoss==="after_commit_throw"){state.authLoss="none";throw Error("Auth response lost")}
          if(state.authLoss==="after_commit_error"){state.authLoss="none";return{data:{user:null},error:{status:503,message:"Ambiguous Auth response"}}}
          if(state.authLoss==="duplicate_race"){state.authLoss="none";user.password="FirstAttempt!1";return{data:{user:null},error:{status:422,code:"email_exists"}}}
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
      role: "accountant",
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
    state.rpcLoss="none"
    state.authLoss="none";state.authReadFailuresAfterCreate=0
    state.roles=[{id:"55555555-5555-4555-8555-555555555555",tenant_id:TENANT,name:"accountant",deleted_at:null}]
    adminFactory.mockReset()
    adminFactory.mockImplementation(() => buildAdmin())
    writeAuditLogMock.mockClear()
  })

  it("rejects a weak password before provisioning or consuming the invite", async () => {
    await seedInvite()
    const result = await acceptInvite(TOKEN,TID,"سامي","short1")
    expect(result.success).toBe(false)
    expect(result.error).toContain("10–128")
    expect(result.errorAr).toContain("10 إلى 128")
    expect(state.authUsers.created).toHaveLength(0)
    expect(state.users).toHaveLength(0)
    expect(state.inviteUpdates).toHaveLength(0)
    expect((await acceptInvite(TOKEN,TID,"سامي","Str0ngPass!1")).success).toBe(true)
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

  it.each(["general_manager","gm","unsupported"])("rejects legacy %s role invites before external provisioning",async(role)=>{await seedInvite({role});expect(await acceptInvite(TOKEN,TID,"Fixture","Str0ngPass!1")).toEqual({success:false,error:GENERIC});expect(state.authUsers.created).toHaveLength(0)})
  it("rejects an archived, missing or foreign-tenant preset before external provisioning",async()=>{await seedInvite();for(const roles of [[],[{id:"role",tenant_id:TENANT,name:"accountant",deleted_at:futureIso()}],[{id:"role",tenant_id:"foreign",name:"accountant",deleted_at:null}]]){state.roles=roles;expect(await acceptInvite(TOKEN,TID,"Fixture","Str0ngPass!1")).toEqual({success:false,error:GENERIC})}expect(state.authUsers.created).toHaveLength(0)})
  it.each(["after_commit","before_commit"] as const)("reconciles %s without deleting a committed or retried login",async(mode)=>{
    await seedInvite();state.rpcLoss=mode
    expect(await acceptInvite(TOKEN,TID,"Fixture","Str0ngPass!1")).toEqual({success:true})
    expect(state.authUsers.created).toHaveLength(1);expect(state.authUsers.deleted).toHaveLength(0)
    expect(state.users).toHaveLength(1);expect(state.memberships).toHaveLength(1);expect(state.inviteUpdates).toHaveLength(1)
  })
  it("preserves the login when both provisioning responses are uncertain",async()=>{
    await seedInvite();state.rpcLoss="unavailable"
    const result=await acceptInvite(TOKEN,TID,"Fixture","Str0ngPass!1")
    expect(result.success).toBe(false);expect(result.error).toContain("could not be confirmed")
    expect(state.authUsers.created).toHaveLength(1);expect(state.authUsers.deleted).toHaveLength(0)
    expect(state.inviteUpdates).toHaveLength(0)
  })
  it("retains the bound identity on database rejection so a retry cannot delete a concurrent login", async () => {
    await seedInvite()
    state.userInsertError = { code: "23514", message: "users insert failed" }

    const res = await acceptInvite(TOKEN, TID, "سامي", "Str0ngPass!1")
    expect(res.success).toBe(false)
    expect(state.authUsers.created).toHaveLength(1)
    expect(state.authUsers.deleted).toHaveLength(0)
    expect(state.memberships).toHaveLength(0)
    // The pending token and exact bound identity remain recoverable after a fix.
    expect(state.inviteUpdates).toHaveLength(0)
    state.userInsertError=null
    expect(await acceptInvite(TOKEN,TID,"Fixture","Different!Pass2")).toMatchObject({success:true,passwordPreserved:true})
    expect(state.authUsers.created).toHaveLength(1)
    expect(state.authUsers.created[0].password).toBe("Str0ngPass!1")
  })
  it.each(["after_commit_throw","after_commit_error","duplicate_race"] as const)("recovers %s by exact bound identity with the original password preserved",async(mode)=>{
    await seedInvite();state.authLoss=mode
    const result=await acceptInvite(TOKEN,TID,"Fixture","Str0ngPass!1")
    expect(result).toMatchObject({success:true,passwordPreserved:true})
    expect(result.notice).toContain("Forgot password");expect(result.noticeAr).toBeTruthy()
    expect(state.authUsers.created).toHaveLength(1);expect(state.authUsers.deleted).toHaveLength(0)
    expect(state.users).toHaveLength(1);expect(state.inviteUpdates).toHaveLength(1)
  })
  it("uses the same persisted UUID on a later attempt after creation never reached Auth",async()=>{
    await seedInvite();state.authLoss="before_commit"
    expect((await acceptInvite(TOKEN,TID,"Fixture","Str0ngPass!1")).success).toBe(false)
    const bound=state.invites[0].provisioning_auth_user_id
    expect(bound).toMatch(/^[0-9a-f-]{36}$/);expect(state.authUsers.created).toHaveLength(0)
    expect(await acceptInvite(TOKEN,TID,"Fixture","NextValid!1")).toEqual({success:true})
    expect(state.authUsers.created[0].id).toBe(bound);expect(state.authUsers.created).toHaveLength(1)
  })
  it("recovers on a public retry after both creation response and immediate identity lookup were lost",async()=>{
    await seedInvite();state.authLoss="after_commit_throw";state.authReadFailuresAfterCreate=1
    const first=await acceptInvite(TOKEN,TID,"Fixture","Original!Pass1")
    expect(first.success).toBe(false);expect(first.error).toContain("password from your first attempt")
    expect(await acceptInvite(TOKEN,TID,"Fixture","NewSubmitted!2")).toMatchObject({success:true,passwordPreserved:true})
    expect(state.authUsers.created).toHaveLength(1);expect(state.authUsers.created[0].password).toBe("Original!Pass1")
    expect(state.authUsers.deleted).toHaveLength(0)
  })
  it.each(["email","invite","tenant","confirmed","marker"])("does not adopt a bound UUID with mismatched %s proof",async(kind)=>{
    await seedInvite({provisioning_auth_user_id:TID})
    const identity={id:TID,email:EMAIL,email_confirmed_at:futureIso(),app_metadata:{_invite_provisioned:true,_invite_id:INVITE_ID,_invite_tenant_id:TENANT}}
    if(kind==="email")identity.email="different@example.test"
    if(kind==="invite")identity.app_metadata._invite_id="different-invite"
    if(kind==="tenant")identity.app_metadata._invite_tenant_id="different-tenant"
    if(kind==="confirmed")identity.email_confirmed_at=""
    if(kind==="marker")identity.app_metadata._invite_provisioned=false
    state.authUsers.created.push(identity)
    expect((await acceptInvite(TOKEN,TID,"Fixture","Str0ngPass!1")).success).toBe(false)
    expect(state.users).toHaveLength(0);expect(state.inviteUpdates).toHaveLength(0);expect(state.authUsers.deleted).toHaveLength(0)
  })

  it("concurrent token-verified requests converge on one identity and membership without deletion",async()=>{
    await seedInvite()
    const results=await Promise.all([acceptInvite(TOKEN,TID,"Fixture","FirstValid!1"),acceptInvite(TOKEN,TID,"Fixture","OtherValid!2")])
    expect(results.every(result=>result.success)).toBe(true)
    expect(state.authUsers.created).toHaveLength(1);expect(state.users).toHaveLength(1);expect(state.memberships).toHaveLength(1)
    expect(state.inviteUpdates).toHaveLength(1);expect(state.authUsers.deleted).toHaveLength(0)
    expect(results.some(result=>result.passwordPreserved)).toBe(true)
  })

})
