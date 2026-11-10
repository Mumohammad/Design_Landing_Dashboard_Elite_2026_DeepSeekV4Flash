import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), client: vi.fn(), admin: vi.fn(), permission: vi.fn(), user: vi.fn(), rate: vi.fn(),
  audit: vi.fn(), dispatch: vi.fn(), zatca: vi.fn(), cache: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.cache }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitAccounting: mocks.rate }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/accounting/dispatcher", () => ({ runEventDispatcher: mocks.dispatch }))
vi.mock("@/lib/accounting/zatca", () => ({ runZatcaAdapter: mocks.zatca }))
vi.mock("@/lib/accounting/zatca-adapter-core", () => ({ runZatcaForTenant: vi.fn(async () => ({ success: false })) }))
import { issueCreditNote, issueDebitNote } from "./invoices"
import { getErrorDefinition } from "@/lib/errors/error-codes"

type Kind = "credit" | "debit"
const reviewed = {
  request_id: "81111111-1111-4111-8111-111111111111",
  reference_invoice_id: "81222222-2222-4222-8222-222222222222",
  expected_updated_at: "2026-10-21T00:00:00.123456+00:00",
  reason: "  Correct the agreed charge  ",
  issue_date: "2026-10-20",
}
const noteId = "81333333-3333-4333-8333-333333333333"
const eventId = "81444444-4444-4444-8444-444444444444"
const receipt = (kind: Kind) => ({
  id: noteId, event_id: eventId, kind, reference_invoice_id: reviewed.reference_invoice_id,
  replayed: false, posting_status: "posted",
})

// Invalid inputs deliberately pass through the runtime entry point: client-side
// TypeScript cannot protect a publicly callable Server Action.
function issue(kind: Kind, overrides: Record<string, unknown> = {}) {
  const input = { ...reviewed, ...(kind === "debit" ? { amount: 12.34 } : {}), ...overrides }
  return kind === "credit"
    ? issueCreditNote(input as Parameters<typeof issueCreditNote>[0])
    : issueDebitNote(input as Parameters<typeof issueDebitNote>[0])
}

function expectPublicFailure(result: Awaited<ReturnType<typeof issueCreditNote>>) {
  expect(result).toMatchObject({ success: false, error: expect.any(String), errorAr: expect.any(String) })
  expect(JSON.stringify(result)).not.toContain("private diagnostic")
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: "staff", authUserId: "actor", tenantId: "tenant" })
  mocks.rate.mockResolvedValue({ success: true })
  mocks.client.mockResolvedValue({ rpc: mocks.rpc })
})

describe.each(["credit", "debit"] as const)("atomic %s note action", (kind) => {
  beforeEach(() => {
    mocks.rpc.mockResolvedValue({ data: receipt(kind), error: null })
  })

  it("uses the session RPC with the exact reviewed version, date and request identity", async () => {
    const result = await issue(kind)
    expect(result).toEqual({ success: true, id: noteId, replayed: false, postingPending: false })
    expect(mocks.permission).toHaveBeenCalledWith("invoices", "create")
    expect(mocks.permission).toHaveBeenCalledWith("invoices", "approve")
    expect(mocks.rate).toHaveBeenCalledWith("staff")
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    const [name, args] = mocks.rpc.mock.calls[0]
    expect(name).toBe("create_invoice_note_atomic")
    expect(args).toEqual({
      p_request_id: reviewed.request_id,
      p_invoice_id: reviewed.reference_invoice_id,
      p_expected_updated_at: reviewed.expected_updated_at,
      p_kind: kind,
      p_input: kind === "credit"
        ? { reason: reviewed.reason.trim(), issue_date: reviewed.issue_date }
        : { reason: reviewed.reason.trim(), issue_date: reviewed.issue_date, amount: 12.34, vat_rate: 15, description: reviewed.reason.trim() },
    })
    expect(args.p_input).not.toHaveProperty("tenant_id")
    expect(args.p_input).not.toHaveProperty("actor_id")
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it("retries an uncertain response using the same request, date and precision-preserving timestamp", async () => {
    mocks.rpc.mockRejectedValueOnce(Error("private diagnostic: transport lost after commit"))
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt(kind), replayed: true }, error: null })
    expectPublicFailure(await issue(kind))
    expect(await issue(kind)).toEqual({ success: true, id: noteId, replayed: true, postingPending: false })
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0])
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it.each(["create", "approve"])("requires the %s permission before committing", async (deniedPermission) => {
    mocks.permission.mockImplementation(async (_module: string, operation: string) => {
      if (operation === deniedPermission) throw Error("private diagnostic: permission denied")
    })
    expectPublicFailure(await issue(kind))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.zatca).not.toHaveBeenCalled()
  })

  it("retains the committed posting when ZATCA and cache refresh fail", async () => {
    mocks.zatca.mockRejectedValue(Error("private diagnostic: adapter failed"))
    mocks.cache.mockImplementation(() => { throw Error("private diagnostic: refresh failed") })
    expect(await issue(kind)).toEqual({ success: true, id: noteId, replayed: false, postingPending: false })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    ["INV001", "reference visibility"], ["INV004", "invoice math"],
    ["INV005", "reference party"], ["INV007", "paid invoice"], ["INV009", "existing full credit"],
    ["INV015", "stale reviewed version"], ["AUTH007", "database authorization"],
    ["ACC001", "accounting period"], ["VAT001", "VAT period"],
  ])("maps the %s SQL guard (%s) to its public bilingual definition", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: `${code}: private diagnostic` } })
    const result = await issue(kind)
    const publicError = getErrorDefinition(code)
    expect(result).toMatchObject({ success: false, error: publicError.messageEn, errorAr: publicError.messageAr })
    expect(JSON.stringify(result)).not.toContain("private diagnostic")
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.zatca).not.toHaveBeenCalled()
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it.each([
    ["INV_NOTE_INPUT", "reason, date or money", "note date"],
    ["INV_NOTE_REFERENCE", "finalized SAR sales reference", "finalized SAR sales invoice"],
    ["INV_NOTE_POSTING", "original journal and VAT posting", "original invoice"],
    ["INV_NOTE_RESERVED", "payment reservation", "payment"],
    ["INV_NOTE_RETRY", "request payload or actor conflict", "another note decision"],
    ["INV_NOTE_REVIEW", "historical effects requiring review", "evidence requires review"],
  ])("redacts the %s transaction guard (%s) into a public bilingual error", async (code, _guard, publicHint) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: `${code}: private diagnostic` } })
    const result = await issue(kind)
    expectPublicFailure(result)
    expect(result.error).toContain(publicHint)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.zatca).not.toHaveBeenCalled()
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it.each([
    "private diagnostic: unknown database failure",
    "private diagnostic: INV015: code appears only inside provider detail",
  ])("redacts unknown provider errors (%s)", async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } })
    expectPublicFailure(await issue(kind))
    expect(mocks.zatca).not.toHaveBeenCalled()
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it("does not accept receipt data accompanied by an RPC error", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt(kind), error: { message: "private diagnostic" } })
    expectPublicFailure(await issue(kind))
    expect(mocks.zatca).not.toHaveBeenCalled()
  })

  it.each([
    ["absent receipt", null],
    ["invalid note id", { id: "invalid" }],
    ["missing event", { event_id: null }],
    ["invalid event", { event_id: "invalid" }],
    ["wrong reference", { reference_invoice_id: eventId }],
    ["wrong note kind", { kind: "other" }],
    ["untyped replay flag", { replayed: "false" }],
    ["unconfirmed posting", { posting_status: "pending" }],
    ["missing posting confirmation", { posting_status: undefined }],
  ] as const)("requires a complete matching receipt: %s", async (_label, invalid) => {
    mocks.rpc.mockResolvedValue({ data: invalid === null ? null : { ...receipt(kind), ...invalid }, error: null })
    expectPublicFailure(await issue(kind))
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.zatca).not.toHaveBeenCalled()
    expect(mocks.cache).not.toHaveBeenCalled()
  })

  it("rejects a receipt for the opposite note kind", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt(kind === "credit" ? "debit" : "credit"), error: null })
    expectPublicFailure(await issue(kind))
    expect(mocks.zatca).not.toHaveBeenCalled()
  })

  it.each([
    ["missing request identity", { request_id: undefined }],
    ["invalid request identity", { request_id: "invalid" }],
    ["invalid reference", { reference_invoice_id: "invalid" }],
    ["missing reviewed version", { expected_updated_at: undefined }],
    ["invalid reviewed version", { expected_updated_at: "invalid" }],
    ["blank reason", { reason: " \n " }],
    ["too short reason", { reason: "four" }],
    ["too long reason", { reason: "r".repeat(501) }],
    ["missing reason", { reason: undefined }],
    ["missing explicit issue date", { issue_date: undefined }],
    ["timestamp instead of date", { issue_date: "2026-10-20T00:00:00Z" }],
    ["impossible issue date", { issue_date: "2026-02-30" }],
  ] as const)("rejects %s before RPC", async (_label, invalid) => {
    expectPublicFailure(await issue(kind, invalid))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it.each(["missing user", "user lookup", "rate lookup", "rate exceeded", "session client"])("fails closed for %s", async (failure) => {
    if (failure === "missing user") mocks.user.mockResolvedValue(null)
    if (failure === "user lookup") mocks.user.mockRejectedValue(Error("private diagnostic"))
    if (failure === "rate lookup") mocks.rate.mockRejectedValue(Error("private diagnostic"))
    if (failure === "rate exceeded") mocks.rate.mockResolvedValue({ success: false })
    if (failure === "session client") mocks.client.mockRejectedValue(Error("private diagnostic"))
    expectPublicFailure(await issue(kind))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})

describe("full credit and debit money validation", () => {
  it.each([{ lines: [] }, { lines: null }, { lines: [{ description: "Partial correction", quantity: 1, unit_price: 10, vat_rate: 15 }] }])("rejects supplied credit lines %j rather than partially reversing the reference", async ({ lines }) => {
    expectPublicFailure(await issue("credit", { lines }))
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it("preserves a zero VAT rate and caller description in the debit RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt("debit"), error: null })
    expect((await issue("debit", { amount: 0.29, vat_rate: 0, description: "No VAT additional charge" })).success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("create_invoice_note_atomic", {
      p_request_id: reviewed.request_id, p_invoice_id: reviewed.reference_invoice_id,
      p_expected_updated_at: reviewed.expected_updated_at, p_kind: "debit",
      p_input: { reason: reviewed.reason.trim(), issue_date: reviewed.issue_date, amount: 0.29, vat_rate: 0, description: "No VAT additional charge" },
    })
  })

  it.each([0, -1, 1.001, NaN, Infinity, -Infinity, "12.34", null, undefined])("rejects invalid debit amount %s without rounding or coercion", async (amount) => {
    expectPublicFailure(await issue("debit", { amount }))
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([-0.01, 100.01, 1.001, NaN, Infinity, "15", null])("rejects invalid debit VAT rate %s without rounding or coercion", async (vat_rate) => {
    expectPublicFailure(await issue("debit", { vat_rate }))
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
