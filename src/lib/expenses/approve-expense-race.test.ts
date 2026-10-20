// FX-06 — approveExpense concurrency tests (audit J5).
//
// The defect: the old action did check-then-insert (read is_approved →
// insert payable → update expense) across three round-trips; two concurrent
// approvals could both pass the check and create two payable rows.
// The shared transaction retains the original conditional-claim/AP guarantees
// and adds an atomic approval audit/reason. Real SQL concurrency, audit rollback
// and financial persistence are covered by the disposable database verifier.
//
// These tests mock the RPC boundary and model the DB arbitration: the first
// caller claims the expense (claim=1), the concurrent caller sees 0 rows
// claimed and receives EXP002 — exactly one payable row results.
//
// Run: pnpm exec vitest run src/lib/expenses/approve-expense-race.test.ts

import { describe, expect, it, vi, beforeEach } from "vitest"

// ── Mocks (hoisted) ────────────────────────────────────────────────────────

const { rpcMock, adminState, authState, rateLimitState, auditState, dispatcherState, emitState, postingState, postingEqMock } = vi.hoisted(() => {
  // Models the DB: is_approved flag + the claim rows each RPC call returns.
  const adminState = {
    expenseApproved: false,
    // Each call: { claimed } mirrors GET DIAGNOSTICS ROW_COUNT; a claim of 0
    // raises 'EXP002: expense already approved' (the conditional UPDATE
    // matched no row because the concurrent caller already set is_approved).
    calls: [] as Array<{ claimed: number }>,
  }
  const rpcMock = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn !== "approve_expense_with_context_atomic") throw new Error(`unexpected rpc ${fn}`)
    adminState.calls.push({ claimed: 0 })
    const idx = adminState.calls.length - 1
    // supabase-js .rpc() resolves to { data, error } — a raised DB exception
    // surfaces as error, it does NOT reject.
    if (adminState.expenseApproved) {
      // Row lock released after the winner committed; re-evaluated predicate
      // (is_approved = FALSE) matches 0 rows → EXP002.
      adminState.calls[idx].claimed = 0
      return { data: null, error: { message: "EXP002: expense already approved" } }
    }
    adminState.expenseApproved = true
    adminState.calls[idx].claimed = 1
    return {
      data: {
        expense_id: args.p_expense_id,
        expense_ref: "EXP-2026-000042",
        amount: 1000,
        vat_amount: 150,
        total: 1150,
        coa_account_code: "5200",
        vat_recoverability: "recoverable",
        event_id: "event-1",
      },
      error: null,
    }
  })
  const authState = { user: null as null | Record<string, unknown> }
  const rateLimitState = { ok: true }
  const auditState = { writeAuditLog: vi.fn(async () => undefined) }
  const dispatcherState = { runEventDispatcher: vi.fn(async () => undefined) }
  const emitState = { emit: vi.fn() }
  const postingState={status:'processed' as string|null,error:false}
  const postingEqMock=vi.fn()
  return { rpcMock, adminState, authState, rateLimitState, auditState, dispatcherState, emitState, postingState, postingEqMock }
})

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock, from:(table:string)=>{
    if(table!=='financial_events')throw Error('Unexpected posting table')
    const query={select:()=>query,eq:(...args:unknown[])=>{postingEqMock(...args);return query},
      maybeSingle:async()=>({data:postingState.status?{processing_status:postingState.status}:null,error:postingState.error?{message:'unavailable'}:null})}
    return query
  } }),
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: vi.fn(async () => undefined),
  getCurrentUser: async () => authState.user,
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  rateLimitExpenses: vi.fn(async () => ({ success: rateLimitState.ok })),
}))

vi.mock("@/lib/auth/sessions", () => ({
  writeAuditLog: (...args: unknown[]) => auditState.writeAuditLog(...(args as [])),
}))

vi.mock("@/lib/accounting/dispatcher", () => ({
  runEventDispatcher: (...args: unknown[]) => dispatcherState.runEventDispatcher(...(args as [])),
}))

vi.mock("@/lib/webhooks/events", () => ({
  emit: (...args: unknown[]) => emitState.emit(...(args as [])),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

// NOTE: @/lib/accounting/csv-utils (mapFinancialError) is NOT mocked — the
// real EXP002 taxonomy message and sanitized FX06 review message are asserted.

// ── Load the action module ─────────────────────────────────────────────────

import { approveExpense } from "./actions"

const USER = {
  id: "user-1",
  authUserId: "auth-1",
  tenantId: "00000000-0000-0000-0000-000000000001",
}

beforeEach(() => {
  adminState.expenseApproved = false
  adminState.calls = []
  authState.user = { ...USER }
  rateLimitState.ok = true
  auditState.writeAuditLog.mockClear()
  dispatcherState.runEventDispatcher.mockClear()
  emitState.emit.mockClear()
  rpcMock.mockClear()
  postingState.status='processed';postingState.error=false;postingEqMock.mockClear()
})

// ── The acceptance test: two concurrent approvals → one payable row ───────

describe("FX-06 approveExpense race", () => {
  it("two concurrent approvals of the same expense → exactly one claim, one success, one EXP002", async () => {
    // Fire both approvals simultaneously (double-click / two tabs).
    const [a, b] = await Promise.all([
      approveExpense({ id: "exp-1" }),
      approveExpense({ id: "exp-1" }),
    ])

    // Exactly one wins; the loser gets the taxonomy EXP002 message.
    const successes = [a, b].filter((r) => r.success)
    const failures = [a, b].filter((r) => !r.success)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toBe("This expense is already approved.")

    // The DB claimed the expense exactly once (one row inserted).
    expect(adminState.calls).toHaveLength(2)
    expect(adminState.calls.reduce((n, c) => n + c.claimed, 0)).toBe(1)

    // Audit is part of the database transaction, tested by the real SQL suite.
    // The winner alone attempts dispatch and the notification.
    expect(dispatcherState.runEventDispatcher).toHaveBeenCalledTimes(1)
    expect(auditState.writeAuditLog).not.toHaveBeenCalled()
    expect(emitState.emit).toHaveBeenCalledTimes(1)
    expect(emitState.emit).toHaveBeenCalledWith(
      "expense.approved",
      USER.tenantId,
      expect.objectContaining({ id: "exp-1", amount: 1150 })
    )
  }, 15_000)

  it("passes tenant scoping, actor, and VAT inputs to the atomic RPC", async () => {
    const res = await approveExpense({
      id: "exp-2",
      vat_rate: 5,
      vat_recoverability: "non_recoverable",
    })

    expect(res.success).toBe(true)
    expect(rpcMock).toHaveBeenCalledWith("approve_expense_with_context_atomic", {
      p_tenant_id: USER.tenantId,
      p_expense_id: "exp-2",
      p_vat_rate: 5,
      p_vat_recoverability: "non_recoverable",
      p_actor: USER.authUserId,
      p_reason: null,
      p_surface: "expenses",
    })
  })

  it("maps an RPC EXP002 failure to the taxonomy message", async () => {
    adminState.expenseApproved = true // already approved before this call
    const res = await approveExpense({ id: "exp-3" })
    expect(res.success).toBe(false)
    expect(res.error).toBe("This expense is already approved.")
    expect(res.alreadyApproved).toBe(true)
  })

  // Review round 2 — mapping determinism: the RPC raises EXP005 when the
  // INTO STRICT read of expense_category_mappings finds no row for the
  // expense's (tenant_id, expense_type) key. mapFinancialError resolves the
  // code against the REAL taxonomy (EXP005 = "No Chart of Accounts mapping…").
  it("maps an RPC EXP005 failure (no CoA mapping) to the taxonomy message", async () => {
    rpcMock.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "EXP005: no CoA mapping for category" },
    }))
    const res = await approveExpense({ id: "exp-5" })
    expect(res.success).toBe(false)
    expect(res.error).toBe(
      "No Chart of Accounts mapping exists for this expense category."
    )
  })

  it("passes the FX06 exactly-one assert through verbatim (not masked)", async () => {
    rpcMock.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "FX06: expected exactly 1 live payable for expense exp-4, found 0" },
    }))
    const res = await approveExpense({ id: "exp-4" })
    expect(res.success).toBe(false)
    expect(res.error).toContain("FX06")
  })

  it("rejects invalid VAT before touching the DB", async () => {
    const res = await approveExpense({ id: "exp-vat", vat_rate: 150 })
    expect(res.success).toBe(false)
    expect(res.error).toBe("Invalid VAT rate or recoverability classification.")
    expect(rpcMock).not.toHaveBeenCalled()
  })

  // Review round 2 — RPC-owned validation parity: an unvalidated value must
  // also fail at the DB layer (SECURITY DEFINER must not trust TS-only
  // checks). The RPC raises EXP003; the action maps it to the same message.
  it("maps an RPC-side EXP003 (recoverability) failure to the taxonomy message", async () => {
    rpcMock.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "EXP003: invalid recoverability" },
    }))
    const res = await approveExpense({ id: "exp-6", vat_recoverability: "recoverable" })
    expect(res.success).toBe(false)
    expect(res.error).toBe("Invalid VAT rate or recoverability classification.")
  })

  it("rejects when not authenticated", async () => {
    authState.user = null
    const res = await approveExpense({ id: "exp-7" })
    expect(res.success).toBe(false)
    expect(res.error).toBe("Not authenticated.")
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it("rejects when rate limited", async () => {
    rateLimitState.ok = false
    const res = await approveExpense({ id: "exp-8" })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/rate limit/i)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('normalizes the retained VAT rate before the RPC',async()=>{
    await approveExpense({id:'exp-rate',vat_rate:15.555})
    expect(rpcMock.mock.calls[0][1].p_vat_rate).toBe(15.56)
  })
  it('passes the inbox reason into the same approval transaction',async()=>{
    await approveExpense({id:'exp-inbox',approvalReason:'  Receipts checked  ',surface:'approvals_inbox'})
    expect(rpcMock.mock.calls[0][1]).toMatchObject({p_reason:'Receipts checked',p_surface:'approvals_inbox',p_vat_rate:null})
    expect(auditState.writeAuditLog).not.toHaveBeenCalled()
  })
  it('rejects a missing inbox reason before the RPC',async()=>{
    expect((await approveExpense({id:'exp-inbox',surface:'approvals_inbox'})).success).toBe(false)
    expect(rpcMock).not.toHaveBeenCalled()
  })
  it.each(['pending','failed',null])('keeps confirmed approval while disclosing own event status %s',async status=>{
    postingState.status=status
    const result=await approveExpense({id:'exp-posting'})
    expect(result).toEqual({success:true,postingPending:true})
    expect(postingEqMock).toHaveBeenCalledWith('tenant_id',USER.tenantId)
    expect(postingEqMock).toHaveBeenCalledWith('source_id','exp-posting')
    expect(postingEqMock).toHaveBeenCalledWith('event_id','event-1')
  })
  it('treats a posting read failure as unverified posting, not failed approval',async()=>{
    postingState.error=true
    expect(await approveExpense({id:'exp-read-failure'})).toEqual({success:true,postingPending:true})
  })
  it('retains approval confirmation if immediate dispatch throws',async()=>{
    dispatcherState.runEventDispatcher.mockRejectedValueOnce(Error('private posting diagnostic'))
    expect(await approveExpense({id:'exp-dispatch'})).toEqual({success:true,postingPending:true})
    expect(auditState.writeAuditLog).not.toHaveBeenCalled()
  })
  it('does not expose unknown RPC diagnostics',async()=>{
    rpcMock.mockImplementationOnce(async()=>({data:null,error:{message:'private database diagnostic'}}))
    const result=await approveExpense({id:'exp-failure'})
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/review/i)
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result.errorAr).toBeTruthy()
  })
})
