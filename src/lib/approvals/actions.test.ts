import { beforeEach, describe, expect, it, vi } from "vitest"

// Decision transition guards + audit serialization — the approvals inbox's
// write path. These tests pin the SERVER-layer contract:
//   * zod rejects malformed input before any DB call (parity with the client
//     dialog's identical schema),
//   * the atomic RPC receives exactly the documented arguments (tenant from
//     getCurrentUser(), never the browser),
//   * double-decision guard codes (EXP002 / LVE002 / APP002) surface as
//     alreadyDecided — graceful, not a 500,
//   * every decision writes an audit_log row with from/to/reason/surface,
//   * permission gates run BEFORE any DB access.

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requirePermission: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => ({
      id: "user-row-1",
      authUserId: "auth-user-1",
      tenantId: "tenant-1",
      role: "general_manager",
    })),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      return { data: (fn === "decide_expense_reviewed_atomic" ? {expense_id:args.p_id,decision:"rejected"} : {}) as unknown, error: null } as { data: unknown; error: { message: string } | null }
    }),
    updateChain: {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn(async () => ({ data: [{ id: "exp-1" }], error: null })),
    },
    auditInserts: [] as Record<string, unknown>[],
    emit: vi.fn(),
    leaveDecision: vi.fn(),
    applicationDecision: vi.fn(),
    rateLimitExpenses: vi.fn(async () => ({ success: true, remaining: 9, resetAt: Date.now() + 60_000 })),
    revalidatePath: vi.fn(),
    approveExpense: vi.fn(async (_input: unknown):Promise<{success:boolean;alreadyApproved?:boolean;alreadyDecided?:boolean;error?:string;errorAr?:string;postingPending?:boolean}>=>({success:true,postingPending:false})),
  },
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.requirePermission,
  getCurrentUser: mocks.getCurrentUser,
}))
vi.mock("@/lib/drivers/leave-actions",()=>({mutateDriverLeave:mocks.leaveDecision}))
vi.mock("@/lib/applications/review-actions",()=>({mutateApplicationReview:mocks.applicationDecision}))
vi.mock("@/lib/expenses/actions",()=>({approveExpense:mocks.approveExpense}))

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ update: () => mocks.updateChain }),
  }),
}))

vi.mock("@/lib/auth/sessions", () => ({
  writeAuditLog: (entry: Record<string, unknown>) => {
    mocks.auditInserts.push(entry)
    return Promise.resolve()
  },
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  rateLimitExpenses: mocks.rateLimitExpenses,
}))

vi.mock("@/lib/webhooks/events", () => ({
  emit: mocks.emit,
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

import {
  decideApplication,
  decideExpense,
  decideLeaveRequest,
} from "./actions"

// RFC-4122-valid fixture UUID (zod v4 enforces version/variant nibbles).
const UUID = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  for (const m of Object.values(mocks)) {
    if (typeof m === "function" && "mockClear" in m) m.mockClear()
  }
  mocks.updateChain.eq.mockReturnThis()
  mocks.updateChain.is.mockReturnThis()
  mocks.updateChain.select.mockResolvedValue({ data: [{ id: "exp-1" }], error: null })
  mocks.rpc.mockImplementation(async (fn,args) =>
    ({ data: (fn === "decide_expense_reviewed_atomic" ? {expense_id:args.p_id,decision:"rejected"} : {}) as unknown, error: null }) as unknown as ReturnType<typeof mocks.rpc>
  )
  mocks.auditInserts.length = 0
  mocks.approveExpense.mockResolvedValue({success:true,postingPending:false})
  mocks.leaveDecision.mockResolvedValue({success:true})
  mocks.applicationDecision.mockResolvedValue({success:true})
})

describe("input validation (zod, server-side)", () => {
  it("rejects malformed UUIDs before any DB access", async () => {
    const res = await decideLeaveRequest({ requestId: "not-a-uuid", decision: "approved", reason: "ok reason" })
    expect(res.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects decisions outside the enum", async () => {
    const res = await decideApplication({ applicationId: UUID, decision: "maybe", reason: "ok reason" })
    expect(res.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects reasons shorter than 5 chars (mandatory-reason contract)", async () => {
    const res = await decideExpense({ expectedVersion: 1, expenseId: UUID, decision: "rejected", reason: "no" })
    expect(res.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects VAT rates outside 0–100", async () => {
    const res = await decideExpense({ expectedVersion: 1, expenseId: UUID, decision: "approved", reason: "ok reason", vat_rate: 150 })
    expect(res.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe("expense decisions (FX-06 RPC reuse)", () => {
  it("delegates approval and its reason to the shared transaction path", async () => {
    const res = await decideExpense({ expectedVersion: 1, expenseId: UUID, decision: "approved", reason: "receipts verified" })
    expect(res.success).toBe(true)
    expect(mocks.approveExpense).toHaveBeenCalledWith({
      id: UUID,expectedVersion:1,vat_rate:undefined,approvalReason:"receipts verified",surface:"approvals_inbox",
    })
    expect(mocks.auditInserts).toHaveLength(0)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("surfaces EXP002 as alreadyDecided, not a 500", async () => {
    mocks.approveExpense.mockResolvedValueOnce({success:false,alreadyApproved:true,error:'This expense is already approved.'})
    const res = await decideExpense({ expectedVersion: 1, expenseId: UUID, decision: "approved", reason: "receipts verified" })
    expect(res.success).toBe(false)
    expect(res.alreadyDecided).toBe(true)
  })
  it('retains the accounting-posting warning from shared approval',async()=>{
    mocks.approveExpense.mockResolvedValueOnce({success:true,postingPending:true})
    expect((await decideExpense({ expectedVersion: 1,expenseId:UUID,decision:'approved',reason:'receipts verified'})).postingPending).toBe(true)
    expect(mocks.auditInserts).toHaveLength(0)
  })

  it("delegates rejection and its reason/audit to one private transaction", async () => {
    const res = await decideExpense({ expectedVersion: 1, expenseId: UUID, decision: "rejected", reason: "duplicate receipt" })
    expect(res.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("decide_expense_reviewed_atomic",{
      p_id:UUID,p_expected_version:1,p_decision:"rejected",p_vat_rate:null,p_recoverability:null,p_reason:"duplicate receipt",p_surface:"approvals_inbox",
    })
    expect(mocks.auditInserts).toHaveLength(0)
  })

  it.each(["EXP002: expense already approved","EXP_REJECTED: expense already rejected"])("surfaces %s as an existing decision", async message => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message}})
    const res = await decideExpense({ expectedVersion: 1, expenseId: UUID, decision: "rejected", reason: "duplicate receipt" })
    expect(res.alreadyDecided).toBe(true)
    expect(mocks.auditInserts).toHaveLength(0)
  })
  it('retains rejected state when a stale inbox attempts approval',async()=>{
    mocks.approveExpense.mockResolvedValueOnce({success:false,alreadyDecided:true,error:'Expense was rejected.'})
    expect((await decideExpense({ expectedVersion: 1,expenseId:UUID,decision:'approved',reason:'Receipts checked'})).alreadyDecided).toBe(true)
  })
  it('rate limits rejection before its transaction',async()=>{
    mocks.rateLimitExpenses.mockResolvedValueOnce({success:false,remaining:0,resetAt:Date.now()})
    expect((await decideExpense({ expectedVersion: 1,expenseId:UUID,decision:'rejected',reason:'Duplicate receipt'})).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not expose private rejection diagnostics',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'private database diagnostic'}})
    const result=await decideExpense({ expectedVersion: 1,expenseId:UUID,decision:'rejected',reason:'Duplicate receipt'})
    expect(result.success).toBe(false);expect(result.error).toMatch(/Reload and review/)
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('does not report an unrelated receipt as a confirmed rejection',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{expense_id:'another-expense',decision:'rejected'},error:null})
    expect((await decideExpense({ expectedVersion: 1,expenseId:UUID,decision:'rejected',reason:'Duplicate receipt'})).success).toBe(false)
  })
  it('retains a confirmed rejection despite a cache refresh failure',async()=>{
    mocks.revalidatePath.mockImplementationOnce(()=>{throw Error('cache unavailable')})
    expect((await decideExpense({ expectedVersion: 1,expenseId:UUID,decision:'rejected',reason:'Duplicate receipt'})).success).toBe(true)
  })
})

describe("reviewed leave and application decisions",()=>{
 it("forwards the exact leave revision and review reason to the shared caller workflow",async()=>{
  expect(await decideLeaveRequest({requestId:UUID,expectedVersion:3,decision:"rejected",reason:"staffing review"})).toEqual({success:true})
  expect(mocks.leaveDecision).toHaveBeenCalledWith({action:"rejected",requestId:UUID,expectedVersion:3,reason:"staffing review",surface:"approvals_inbox"})
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.auditInserts).toHaveLength(0)
 })
 it("forwards the exact application revision to the same workflow as its detail screen",async()=>{
  expect(await decideApplication({applicationId:UUID,expectedVersion:4,decision:"approved",reason:"documents reviewed"})).toEqual({success:true})
  expect(mocks.applicationDecision).toHaveBeenCalledWith({applicationId:UUID,expectedVersion:4,action:"approved",reason:"documents reviewed",surface:"approvals_inbox"})
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.auditInserts).toHaveLength(0)
 })
 it("preserves existing decision and authentication errors from the guarded workflows",async()=>{
  const denied={success:false,error:"Review denied",errorAr:"المراجعة غير مسموحة",alreadyDecided:true}
  mocks.leaveDecision.mockResolvedValue(denied);mocks.applicationDecision.mockResolvedValue(denied)
  expect(await decideLeaveRequest({requestId:UUID,expectedVersion:1,decision:"approved",reason:"review reason"})).toEqual(denied)
  expect(await decideApplication({applicationId:UUID,expectedVersion:1,decision:"approved",reason:"review reason"})).toEqual(denied)
 })
 it("rejects old dialogs without a reviewed version before invoking either workflow",async()=>{
  expect((await decideLeaveRequest({requestId:UUID,decision:"approved",reason:"review reason"})).success).toBe(false)
  expect((await decideApplication({applicationId:UUID,decision:"approved",reason:"review reason"})).success).toBe(false)
  expect(mocks.leaveDecision).not.toHaveBeenCalled();expect(mocks.applicationDecision).not.toHaveBeenCalled()
 })
})
