import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), user: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn(), audit: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/accounting/dispatcher", () => ({ runEventDispatcher: vi.fn() }))
vi.mock("@/lib/accounting/zatca", () => ({ runZatcaAdapter: vi.fn() }))
import { createInvoiceDraft, updateInvoiceDraft } from "./invoices"

const draft = {
  invoice_type: "sales" as const, customer_id: "customer-a", issue_date: "2026-10-11", due_date: "2026-10-12",
  lines: [{ description: "Service", quantity: 1, unit_price: 4.1 }],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ tenantId: "tenant-a", authUserId: "auth-a" })
  mocks.rpc.mockResolvedValue({ data: { id: "invoice-a" }, error: null })
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "invoice-a", status: "draft", invoice_type: "sales" }, error: null }),
  }
  mocks.from.mockReturnValue(chain)
})

describe("invoice draft transactional actions", () => {
  it("creates through JWT-bound RPC without supplied actor, tenant or totals", async () => {
    expect(await createInvoiceDraft(draft)).toEqual({ success: true, id: "invoice-a" })
    expect(mocks.permission).toHaveBeenCalledWith("invoices", "create")
    expect(mocks.rpc).toHaveBeenCalledWith("save_invoice_draft_atomic", {
      p_document: { invoice_type: "sales", customer_id: "customer-a", supplier_id: null,
        issue_date: "2026-10-11", due_date: "2026-10-12", currency: "SAR", vat_rate: 15, notes: null },
      p_lines: [expect.objectContaining({ amount: 4.1, vat_amount: 0.62 })],
    })
    expect(mocks.audit).not.toHaveBeenCalled() // Audit is committed by the same DB transaction.
  })
  it("replaces lines in one guarded RPC, not separate header/delete/insert writes", async () => {
    expect(await updateInvoiceDraft({ ...draft, id: "invoice-a" })).toEqual({ success: true })
    expect(mocks.rpc).toHaveBeenCalledWith("save_invoice_draft_atomic", expect.objectContaining({ p_invoice_id: "invoice-a" }))
    expect(mocks.from).toHaveBeenCalledTimes(1) // Preflight read only.
  })
  it("never reports success or revalidates after database failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "injected line failure" } })
    expect((await createInvoiceDraft(draft)).success).toBe(false)
    expect((await updateInvoiceDraft({ ...draft, id: "invoice-a" })).success).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("requires a committed identifier in the response", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect((await createInvoiceDraft(draft)).success).toBe(false)
    expect((await updateInvoiceDraft({ ...draft, id: "invoice-a" })).success).toBe(false)
  })
  it("stops before RPC when server permission fails", async () => {
    mocks.permission.mockRejectedValue(new Error("Forbidden"))
    expect((await createInvoiceDraft(draft)).success).toBe(false)
    expect((await updateInvoiceDraft({ ...draft, id: "invoice-a" })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("does not allow a signed-out caller", async () => {
    mocks.user.mockResolvedValue(null)
    expect((await createInvoiceDraft(draft)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("validates line math before issuing a save request", async () => {
    expect((await createInvoiceDraft({ ...draft, lines: [{ description: "Service", quantity: 1, unit_price: 1, discount: 2 }] })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
