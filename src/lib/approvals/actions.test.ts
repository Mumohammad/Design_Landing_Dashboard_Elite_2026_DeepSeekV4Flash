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
/* eslint-disable @typescript-eslint/no-unused-vars -- mock-fn params document the mocked signature */
    rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>) => {
      return { data: {} as unknown, error: null } as { data: unknown; error: { message: string } | null }
    }),
    updateChain: {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn(async () => ({ data: [{ id: "exp-1" }], error: null })),
    },
    auditInserts: [] as Record<string, unknown>[],
    emit: vi.fn(),
    rateLimitExpenses: vi.fn(async () => ({ success: true, remaining: 9, resetAt: Date.now() + 60_000 })),
    revalidatePath: vi.fn(),
  },
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.requirePermission,
  getCurrentUser: mocks.getCurrentUser,
}))

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
  mocks.rpc.mockImplementation(async () =>
    ({ data: {} as unknown, error: null }) as unknown as ReturnType<typeof mocks.rpc>
  )
  mocks.auditInserts.length = 0
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
    const res = await decideExpense({ expenseId: UUID, decision: "rejected", reason: "no" })
    expect(res.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("rejects VAT rates outside 0–100", async () => {
    const res = await decideExpense({ expenseId: UUID, decision: "approved", reason: "ok reason", vat_rate: 150 })
    expect(res.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe("expense decisions (FX-06 RPC reuse)", () => {
  it("approves through approve_expense_atomic with the canonical args", async () => {
    const res = await decideExpense({ expenseId: UUID, decision: "approved", reason: "receipts verified" })
    expect(res.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("approve_expense_atomic", {
      p_tenant_id: "tenant-1",
      p_expense_id: UUID,
      p_vat_rate: 15,
      p_vat_recoverability: null,
      p_actor: "auth-user-1",
    })
    expect(mocks.auditInserts).toHaveLength(1)
    expect(mocks.auditInserts[0]).toMatchObject({
      module: "expenses",
      action: "expense_approved",
      entityId: UUID,
      newValues: expect.objectContaining({ from: "pending", to: "approved", reason: "receipts verified" }),
    })
  })

  it("surfaces EXP002 as alreadyDecided, not a 500", async () => {
    mocks.rpc.mockImplementation(async () => ({
      data: null,
      error: { message: "EXP002: expense already approved" },
    }))
    const res = await decideExpense({ expenseId: UUID, decision: "approved", reason: "receipts verified" })
    expect(res.success).toBe(false)
    expect(res.alreadyDecided).toBe(true)
  })

  it("rejects via the guarded conditional UPDATE and audits the decision", async () => {
    const res = await decideExpense({ expenseId: UUID, decision: "rejected", reason: "duplicate receipt" })
    expect(res.success).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.updateChain.eq).toHaveBeenCalledWith("is_approved", false)
    expect(mocks.auditInserts[0]).toMatchObject({
      module: "expenses",
      action: "expense_rejected",
      newValues: expect.objectContaining({ from: "pending", to: "rejected", reason: "duplicate receipt" }),
    })
  })

  it("surfaces a lost claim (already approved meanwhile) as alreadyDecided", async () => {
    mocks.updateChain.select.mockResolvedValue({ data: [], error: null })
    const res = await decideExpense({ expenseId: UUID, decision: "rejected", reason: "duplicate receipt" })
    expect(res.alreadyDecided).toBe(true)
    expect(mocks.auditInserts).toHaveLength(0)
  })
})

describe("leave decisions (atomic RPC)", () => {
  it("calls decide_leave_request_atomic with tenant + reviewer + reason", async () => {
    const res = await decideLeaveRequest({ requestId: UUID, decision: "rejected", reason: "staffing freeze" })
    expect(res.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("decide_leave_request_atomic", {
      p_tenant_id: "tenant-1",
      p_request_id: UUID,
      p_decision: "rejected",
      p_reason: "staffing freeze",
      p_reviewer: "auth-user-1",
    })
    expect(mocks.auditInserts[0]).toMatchObject({
      module: "attendance",
      action: "leave_reviewed",
      entityType: "leave_request",
      newValues: expect.objectContaining({ to: "rejected", reason: "staffing freeze" }),
    })
  })

  it("surfaces LVE002 as alreadyDecided with no audit row", async () => {
    mocks.rpc.mockImplementation(async () => ({
      data: null,
      error: { message: "LVE002: leave request already decided" },
    }))
    const res = await decideLeaveRequest({ requestId: UUID, decision: "approved", reason: "ok reason" })
    expect(res.alreadyDecided).toBe(true)
    expect(mocks.auditInserts).toHaveLength(0)
  })
})

describe("application decisions (atomic RPC)", () => {
  it("calls decide_application_atomic with the users.id reviewer (030 convention)", async () => {
    const res = await decideApplication({ applicationId: UUID, decision: "approved", reason: "docs complete" })
    expect(res.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("decide_application_atomic", {
      p_tenant_id: "tenant-1",
      p_application_id: UUID,
      p_decision: "approved",
      p_note: "docs complete",
      p_reviewer: "user-row-1",
    })
    expect(mocks.auditInserts[0]).toMatchObject({
      module: "hr",
      action: "application_reviewed",
      entityType: "driver_application",
      newValues: expect.objectContaining({ to: "approved" }),
    })
  })

  it("surfaces APP002 as alreadyDecided with no audit row", async () => {
    mocks.rpc.mockImplementation(async () => ({
      data: null,
      error: { message: "APP002: application already decided" },
    }))
    const res = await decideApplication({ applicationId: UUID, decision: "rejected", reason: "incomplete docs" })
    expect(res.alreadyDecided).toBe(true)
    expect(mocks.auditInserts).toHaveLength(0)
  })
})

describe("permission gating", () => {
  it("runs requirePermission before any DB access", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error("AUTH007"))
    const res = await decideLeaveRequest({ requestId: UUID, decision: "approved", reason: "ok reason" })
    expect(res.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
