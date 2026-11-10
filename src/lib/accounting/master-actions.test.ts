import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChartMasterRow } from "./master-contract"
const mocks = vi.hoisted(() => ({
  permission: vi.fn(), user: vi.fn(), rate: vi.fn(), importRate: vi.fn(), caller: vi.fn(), rpc: vi.fn(),
  admin: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), invalidate: vi.fn(), cache: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.caller }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitAccounting: mocks.rate, rateLimitAccountingImport: mocks.importRate }))
vi.mock("@/lib/logger", () => ({ moduleLogger: () => ({ info: vi.fn() }), logPerformance: vi.fn() }))
vi.mock("@/lib/webhooks/events", () => ({ emit: vi.fn() }))
vi.mock("@/lib/cache", () => ({ cacheInvalidate: mocks.invalidate, cacheGet: mocks.cache, CACHE_TTL: {} }))
import {
  createChartAccount, updateChartAccount, deactivateChartAccount, archiveChartAccount, exportChartAccountsCsv,
  importChartAccountsCsv, initializeDefaultCoa, postOpeningBalances, type ChartAccountInput,
} from "./actions"

const id = "18200000-0000-4000-8000-000000000001"
const otherId = "18200000-0000-4000-8000-000000000002"
const requestId = "18200000-0000-4000-8000-000000000003"
const stamp = "2026-10-25T12:30:00.123456+00:00"
const intent = { request_id: requestId }, review = { ...intent, expected_updated_at: stamp }
const accountInput: ChartAccountInput = { account_code: " 8301 ", name_ar: " حساب ", name_en: " Account ", account_type: "asset", normal_balance: "debit" }
const receipt = { id, updated_at: stamp, code: "8301", is_active: true, archived: false }
const header = "account_code,name_ar,name_en,account_type,normal_balance,parent_code,is_contra,is_active,description"
const csv = header + "\n8301,حساب,Account,asset,debit,,false,true,First\n8302,دخل,Income,income,credit,8301,false,true,Second"
const opening = { ...intent, entry_date: "2026-10-25", lines: [
  { account_id: id, description: " Debit ", debit: 12.34, credit: 0 },
  { account_id: otherId, debit: 0, credit: 12.34 },
] }
const accountRow = (index: number): ChartMasterRow => ({
  id: "18200000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), account_code: String(100000 + index),
  name_ar: "حساب", name_en: "Account", account_type: "asset", normal_balance: "debit", parent_id: null,
  is_contra: false, is_active: true, description: null, updated_at: stamp,
  parent_code: null, parent_name_ar: null, parent_name_en: null, is_canonical: false, can_archive: true,
})
const page = (rows: unknown[], total = rows.length) => ({
  rows, total, page: 1, page_size: 25, summary: { total, active: total, assets: total, income_expense: 0 },
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: "profile", authUserId: "actor", tenantId: "current-tenant" })
  mocks.rate.mockResolvedValue({ success: true }); mocks.importRate.mockResolvedValue({ success: true })
  mocks.caller.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: receipt, error: null })
  mocks.admin.mockImplementation(() => { throw new Error("Unexpected service-role mutation") })
  mocks.invalidate.mockResolvedValue(0)
})
afterEach(() => {
  expect(mocks.admin).not.toHaveBeenCalled()
  expect(mocks.audit).not.toHaveBeenCalled()
  expect(mocks.cache).not.toHaveBeenCalled()
})

describe("chart master reviewed atomic boundary", () => {
  it("creates through the caller and strips untrusted identity fields", async () => {
    expect(await createChartAccount({ ...accountInput, ...intent, tenant_id: "spoofed", created_by: "spoofed" } as ChartAccountInput & typeof intent)).toEqual({ success: true, ...receipt })
    expect(mocks.rpc).toHaveBeenCalledWith("mutate_my_accounting_master", {
      p_kind: "accounts", p_action: "create", p_id: null, p_expected_updated_at: null, p_request_id: requestId,
      p_input: { account_code: "8301", name_ar: "حساب", name_en: "Account", account_type: "asset", normal_balance: "debit", is_contra: false, parent_id: null, description: null },
    })
  })
  it("passes raw reviewed timestamps on edits, deactivation and retained archive", async () => {
    expect((await updateChartAccount({ account_id: id, name_en: "Updated", ...review })).success).toBe(true)
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_my_accounting_master", expect.objectContaining({ p_action: "update", p_input: { name_en: "Updated" }, p_expected_updated_at: stamp }))
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, is_active: false }, error: null })
    expect((await deactivateChartAccount({ account_id: id, ...review })).success).toBe(true)
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_my_accounting_master", expect.objectContaining({ p_action: "set_active", p_input: { is_active: false } }))
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, is_active: false, archived: true }, error: null })
    expect((await archiveChartAccount({ account_id: id, ...review })).success).toBe(true)
    expect(mocks.permission).toHaveBeenLastCalledWith("accounting", "update")
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_my_accounting_master", expect.objectContaining({ p_action: "archive", p_id: id, p_input: {}, p_expected_updated_at: stamp }))
  })
  it("keeps the request identity unchanged when an archive is retried", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, archived: true, is_active: false }, error: null })
    expect((await archiveChartAccount({ account_id: id, ...review })).success).toBe(true)
    expect((await archiveChartAccount({ account_id: id, ...review })).success).toBe(true)
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1])
  })
  it.each([
    { account_code: "12" }, { account_code: "1234567" }, { name_ar: " " }, { name_en: "x".repeat(201) },
    { description: "x".repeat(1001) }, { parent_id: "bad" }, { account_type: "invalid" }, { normal_balance: "invalid" },
    { account_type: "income", normal_balance: "debit" }, { is_contra: "true" },
  ])("rejects invalid input without database writes: %j", async invalid => {
    expect((await createChartAccount({ ...accountInput, ...intent, ...invalid } as ChartAccountInput & typeof intent)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("allows explicit contra balance and delegates current-row merge validation to SQL", async () => {
    expect((await createChartAccount({ ...accountInput, normal_balance: "credit", is_contra: true, ...intent })).success).toBe(true)
    expect((await updateChartAccount({ account_id: id, parent_id: null, ...review })).success).toBe(true)
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_my_accounting_master", expect.objectContaining({ p_input: { parent_id: null } }))
  })
  it("rejects self parent, absent request identity and stale/invalid reviews", async () => {
    expect((await createChartAccount({ ...accountInput, request_id: "" })).success).toBe(false)
    expect((await updateChartAccount({ account_id: id, parent_id: id, ...review })).success).toBe(false)
    expect((await deactivateChartAccount({ account_id: id, ...intent, expected_updated_at: "" })).success).toBe(false)
    expect((await archiveChartAccount({ account_id: "bad", ...review })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(["COA002", "COA004", "COA005", "MASTER_STALE", "MASTER_REQUEST_CONFLICT", "MASTER_REFERENCED", "MASTER_ASSURANCE_REQUIRED"])("fails safely on protected/stale SQL decisions: %s", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: code + ": private row detail" } })
    const result = await updateChartAccount({ account_id: id, name_en: "Updated", ...review })
    expect(result.success).toBe(false)
    if (result.success) throw Error("Expected protected decision")
    expect(result.error).not.toContain("private"); expect(result.errorAr).toBeTruthy()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("never confirms mismatching receipts or unexpected transport diagnostics", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, id: otherId }, error: null })
    expect((await updateChartAccount({ account_id: id, name_en: "Updated", ...review })).success).toBe(false)
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, code: "9999" }, error: null })
    expect((await createChartAccount({ ...accountInput, ...intent })).success).toBe(false)
    mocks.rpc.mockRejectedValueOnce(new Error("private database token"))
    const result = await archiveChartAccount({ account_id: id, ...review })
    expect(result.success).toBe(false)
    if (result.success) throw Error("Expected uncertainty")
    expect(result.error).toContain("Retry with unchanged details")
    expect(result.error).not.toContain("private")
  })
  it("preserves a confirmed result even if ancillary refresh fails", async () => {
    mocks.invalidate.mockRejectedValue(new Error("private cache error"))
    mocks.revalidate.mockImplementation(() => { throw Error("private refresh error") })
    expect(await createChartAccount({ ...accountInput, ...intent })).toEqual({ success: true, ...receipt })
  })
})

describe("complete chart CSV export", () => {
  it("exports all1201 rows and joined parents beyond a filtered page", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => accountRow(index))
    rows[0] = { ...rows[0], parent_id: otherId, parent_code: "1000", parent_name_ar: "أصل", parent_name_en: "Parent" }
    mocks.rpc.mockResolvedValue({ data: page(rows), error: null })
    const result = await exportChartAccountsCsv("%_")
    expect(result.success).toBe(true)
    if (!result.success) throw Error("Expected complete export")
    expect(result.csv.startsWith("\uFEFFaccount_code,")).toBe(true)
    expect(result.csv.trim().split(/\r?\n/)).toHaveLength(1202)
    expect(result.csv).toContain("101200")
    expect(result.csv).toContain("asset,debit,1000,false,true")
    expect(mocks.rpc).toHaveBeenCalledWith("read_my_accounting_master_page", { p_kind: "accounts", p_search: "%_", p_page: 1, p_page_size: 25, p_export: true })
    expect(mocks.permission.mock.calls).toEqual([["accounting", "export"], ["accounting", "read"]])
  })
  it("rejects incomplete or oversized UTF8 results with no partial CSV", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: page([accountRow(0)], 1201), error: null })
    expect((await exportChartAccountsCsv()).success).toBe(false)
    const rows = Array.from({ length: 300 }, (_, index) => ({ ...accountRow(index), description: "ض".repeat(1000) }))
    mocks.rpc.mockResolvedValueOnce({ data: page(rows), error: null })
    expect(await exportChartAccountsCsv()).toMatchObject({ success: false, errorCode: "MASTER_EXPORT_LIMIT" })
  })
})

describe("partial chart import transaction", () => {
  it("submits one complete batch, retains per-row errors and refreshes accepted rows", async () => {
    mocks.rpc.mockResolvedValue({ data: { imported: 1, skipped: 0, errors: ["Row 3: parent type differs"] }, error: null })
    expect(await importChartAccountsCsv(csv, intent)).toEqual({ success: false, imported: 1, skipped: 0, errors: ["Row 3: parent type differs"] })
    expect(mocks.importRate).toHaveBeenCalledWith("profile")
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith("import_my_chart_accounts", { p_request_id: requestId, p_rows: [
      { account_code: "8301", name_ar: "حساب", name_en: "Account", account_type: "asset", normal_balance: "debit", parent_code: null, is_contra: false, is_active: true, description: "First" },
      { account_code: "8302", name_ar: "دخل", name_en: "Income", account_type: "income", normal_balance: "credit", parent_code: "8301", is_contra: false, is_active: true, description: "Second" },
    ] })
    expect(mocks.revalidate).toHaveBeenCalledWith("/accounting")
  })
  it("passes invalid rows for explicit partial results rather than dropping them", async () => {
    mocks.rpc.mockResolvedValue({ data: { imported: 0, skipped: 0, errors: ["Row 2: invalid boolean"] }, error: null })
    const value = header + "\n8301,حساب,Account,asset,debit,,garbage,true,Description"
    expect((await importChartAccountsCsv(value, intent)).errors).toEqual(["Row 2: invalid boolean"])
    expect(mocks.rpc.mock.calls[0][1].p_rows[0].is_contra).toBe("garbage")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("accepts a full1000-row batch and leaves duplicate decisions to the transaction", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => String(100000 + index) + ",حساب,Account,asset,debit,,false,true,")
    mocks.rpc.mockResolvedValue({ data: { imported: 1000, skipped: 0, errors: [] }, error: null })
    expect(await importChartAccountsCsv(header + "\n" + rows.join("\n"), intent)).toMatchObject({ success: true, imported: 1000 })
    expect(mocks.rpc.mock.calls[0][1].p_rows).toHaveLength(1000)
  })
  it.each([
    "", "account_code\n8301", "account_code,account_code,name_ar,name_en,account_type,normal_balance\n8301,8301,حساب,Account,asset,debit",
    header + "\n" + Array.from({ length: 1001 }, () => "8301,حساب,Account,asset,debit,,false,true,").join("\n"),
    header + "\n8301,حساب,Account,asset,debit,,false,true," + "ض".repeat(270000),
  ])("bounds malformed/large input before any RPC", async value => {
    expect((await importChartAccountsCsv(value, intent)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    null, { imported: 1, skipped: 0, errors: [] }, { imported: -1, skipped: 3, errors: [] },
    { imported: 1, skipped: 0, errors: [123] }, { imported: 1.5, skipped: 0.5, errors: [] },
  ])("never confirms an invalid or incomplete batch receipt: %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect(await importChartAccountsCsv(csv, intent)).toMatchObject({ success: false, errorCode: "MASTER_UNAVAILABLE" })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("retains the same batch request on replay and fails closed on audit/RPC errors", async () => {
    mocks.rpc.mockResolvedValue({ data: { imported: 0, skipped: 2, errors: [] }, error: null })
    expect((await importChartAccountsCsv(csv, intent)).success).toBe(true)
    expect((await importChartAccountsCsv(csv, intent)).success).toBe(true)
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1])
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "private audit failure" } })
    const result = await importChartAccountsCsv(csv, intent)
    expect(result.success).toBe(false); expect(result.error).not.toContain("private")
  })
})

describe("defaults and opening balances", () => {
  it("initializes through a caller-bound receipt and accepts an unchanged zero-insert result", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { inserted: 28 }, error: null }).mockResolvedValueOnce({ data: { inserted: 0 }, error: null })
    expect(await initializeDefaultCoa(intent)).toEqual({ success: true, inserted: 28 })
    expect(await initializeDefaultCoa(intent)).toEqual({ success: true, inserted: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith("initialize_my_chart_accounts", { p_request_id: requestId })
  })
  it.each([null, { inserted: -1 }, { inserted: 1.5 }, { inserted: 29 }])("rejects malformed initializer results: %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect((await initializeDefaultCoa(intent)).success).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("posts exact balanced inputs and retains request identity without supplying an actor or tenant", async () => {
    mocks.rpc.mockResolvedValue({ data: { out_entry_id: id, out_entry_ref: "OPEN-001" }, error: null })
    expect(await postOpeningBalances(opening)).toEqual({ success: true, out_entry_id: id, out_entry_ref: "OPEN-001" })
    expect(mocks.permission).toHaveBeenCalledWith("accounting", "create")
    expect(mocks.rpc).toHaveBeenCalledWith("post_my_opening_balances", { p_request_id: requestId, p_entry_date: "2026-10-25", p_lines: [
      { account_id: id, description: "Debit", debit: 12.34, credit: 0 }, { account_id: otherId, description: null, debit: 0, credit: 12.34 },
    ] })
  })
  it("balances decimal cents exactly and ignores only genuinely empty zero rows", async () => {
    mocks.rpc.mockResolvedValue({ data: { out_entry_id: id, out_entry_ref: "OPEN-002" }, error: null })
    const lines = [
      { account_id: id, debit: 0.1, credit: 0 }, { account_id: id, debit: 0.2, credit: 0 },
      { account_id: otherId, debit: 0, credit: 0.3 }, { account_id: "", debit: 0, credit: 0 },
    ]
    expect((await postOpeningBalances({ ...opening, lines })).success).toBe(true)
    expect(mocks.rpc.mock.calls[0][1].p_lines).toHaveLength(3)
  })
  it.each([
    { entry_date: "2026-02-30" }, { entry_date: "" }, { request_id: "" }, { lines: [] },
    { lines: [{ account_id: id, debit: Number.NaN, credit: 0 }, { account_id: otherId, debit: 0, credit: 1 }] },
    { lines: [{ account_id: id, debit: Infinity, credit: 0 }, { account_id: otherId, debit: 0, credit: 1 }] },
    { lines: [{ account_id: id, debit: -1, credit: 0 }, { account_id: otherId, debit: 0, credit: 1 }] },
    { lines: [{ account_id: id, debit: 1.001, credit: 0 }, { account_id: otherId, debit: 0, credit: 1.001 }] },
    { lines: [{ account_id: id, debit: 1, credit: 1 }, { account_id: otherId, debit: 0, credit: 1 }] },
    { lines: [{ account_id: id, debit: 1, credit: 0 }, { account_id: "bad", debit: 0, credit: 1 }] },
    { lines: [{ account_id: id, debit: 1, credit: 0 }, { account_id: otherId, debit: 0, credit: 2 }] },
  ])("rejects invalid opening details before a transaction: %j", async invalid => {
    expect((await postOpeningBalances({ ...opening, ...invalid })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("explains a closed posting period without exposing database details", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "ACC001: private accounting period detail" } })
    expect(await postOpeningBalances(opening)).toMatchObject({ success: false, errorCode: "MASTER_PERIOD_CLOSED" })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("rejects malformed posting acknowledgements and maps conflicts safely", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { out_entry_id: "bad", out_entry_ref: "OPEN" }, error: null })
    expect((await postOpeningBalances(opening)).success).toBe(false)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "MASTER_REQUEST_CONFLICT: private detail" } })
    expect(await postOpeningBalances(opening)).toMatchObject({ success: false, errorCode: "MASTER_REQUEST_CONFLICT" })
  })
})

describe("all master operation gates", () => {
  const actions = [
    () => createChartAccount({ ...accountInput, ...intent }), () => updateChartAccount({ account_id: id, name_en: "Updated", ...review }),
    () => archiveChartAccount({ account_id: id, ...review }), () => exportChartAccountsCsv(),
    () => importChartAccountsCsv(csv, intent), () => initializeDefaultCoa(intent), () => postOpeningBalances(opening),
  ]
  it("requires current permission before every database client", async () => {
    mocks.permission.mockRejectedValue(Object.assign(new Error("private permission"), { code: "AUTH007" }))
    for (const action of actions) expect(await action()).toMatchObject({ success: false, errorCode: "MASTER_FORBIDDEN" })
    expect(mocks.caller).not.toHaveBeenCalled()
  })
  it("requires authentication and rate approval before writes", async () => {
    mocks.user.mockResolvedValue(null)
    for (const action of actions) expect((await action()).success).toBe(false)
    expect(mocks.caller).not.toHaveBeenCalled()
    mocks.user.mockResolvedValue({ id: "profile", tenantId: "current-tenant" })
    mocks.rate.mockResolvedValue({ success: false }); mocks.importRate.mockResolvedValue({ success: false })
    for (const action of actions) expect(await action()).toMatchObject({ success: false, errorCode: "MASTER_RATE_LIMIT" })
    expect(mocks.caller).not.toHaveBeenCalled()
  })
})