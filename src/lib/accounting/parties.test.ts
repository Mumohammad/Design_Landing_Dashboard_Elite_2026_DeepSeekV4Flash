import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PartyInput } from "./parties"

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), user: vi.fn(), rate: vi.fn(), caller: vi.fn(), rpc: vi.fn(),
  admin: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), invalidate: vi.fn(), cache: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.caller }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitAccounting: mocks.rate }))
vi.mock("@/lib/cache", () => ({ cacheInvalidate: mocks.invalidate, cacheGet: mocks.cache }))
import {
  createCustomer, createSupplier, updateCustomer, updateSupplier, setCustomerActive, setSupplierActive,
  deleteCustomer, deleteSupplier, exportCustomersCsv, exportSuppliersCsv,
} from "./parties"

const id = "18100000-0000-4000-8000-000000000001"
const requestId = "18100000-0000-4000-8000-000000000002"
const stamp = "2026-10-25T12:30:00.123456+00:00"
const intent = { request_id: requestId }, review = { ...intent, expected_updated_at: stamp }
const input: PartyInput = { code: " cus-001 ", name_ar: " عميل ", name_en: " Customer ", credit_limit: 12.34 }
const receipt = { id, updated_at: stamp, code: "CUS-001", is_active: true, archived: false }
const partyRow = (index: number, address: string | null = null) => ({
  id: "18100000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), code: "CUS" + String(index + 1).padStart(6, "0"),
  name_ar: "عميل", name_en: index === 0 ? "=SUM(A1)" : "Customer", phone: null, email: null, tax_number: null,
  address, credit_limit: "12.34", is_active: true, updated_at: stamp,
})
const page = (rows: unknown[], total = rows.length) => ({
  rows, total, page: 1, page_size: 25, summary: { total, active: total, tax_registered: 0, avg_credit_limit: "12.34" },
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({ id: "profile", authUserId: "actor", tenantId: "current-tenant" })
  mocks.rate.mockResolvedValue({ success: true })
  mocks.caller.mockResolvedValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: receipt, error: null })
  mocks.admin.mockImplementation(() => { throw new Error("Unexpected service-role write") })
  mocks.invalidate.mockResolvedValue(0)
})
afterEach(() => {
  expect(mocks.admin).not.toHaveBeenCalled()
  expect(mocks.audit).not.toHaveBeenCalled()
  expect(mocks.cache).not.toHaveBeenCalled()
})

for (const kind of ["customers", "suppliers"] as const) describe(kind + " caller-bound lifecycle", () => {
  const create = kind === "customers" ? createCustomer : createSupplier
  const update = kind === "customers" ? updateCustomer : updateSupplier
  const active = kind === "customers" ? setCustomerActive : setSupplierActive
  const archive = kind === "customers" ? deleteCustomer : deleteSupplier
  it("normalizes allowed business fields and preserves one request identity", async () => {
    const injected = { ...input, tenant_id: "other-tenant", created_by: "spoofed", updated_at: "spoofed" }
    expect(await create(injected, intent)).toEqual({ success: true, ...receipt })
    expect(mocks.permission).toHaveBeenCalledWith("accounting", "create")
    expect(mocks.rpc).toHaveBeenCalledWith("mutate_my_accounting_master", {
      p_kind: kind, p_action: "create", p_id: null, p_expected_updated_at: null, p_request_id: requestId,
      p_input: { code: "CUS-001", name_ar: "عميل", name_en: "Customer", phone: null, email: null, tax_number: null, address: null, credit_limit: 12.34 },
    })
    expect(mocks.revalidate).toHaveBeenCalledWith("/accounting")
  })
  it("uses exact raw review timestamps on edits, status changes and archive", async () => {
    expect((await update(id, input, review)).success).toBe(true)
    expect(mocks.permission).toHaveBeenLastCalledWith("accounting", "update")
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_my_accounting_master", expect.objectContaining({
      p_kind: kind, p_action: "update", p_id: id, p_expected_updated_at: stamp, p_request_id: requestId,
    }))
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, is_active: false }, error: null })
    expect((await active(id, false, review)).success).toBe(true)
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_my_accounting_master", expect.objectContaining({ p_action: "set_active", p_input: { is_active: false }, p_expected_updated_at: stamp }))
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, is_active: false, archived: true }, error: null })
    expect((await archive(id, review)).success).toBe(true)
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_my_accounting_master", expect.objectContaining({ p_action: "archive", p_input: {}, p_id: id, p_expected_updated_at: stamp }))
  })
  it("retains the same intent for confirmed retries", async () => {
    expect((await create(input, intent)).success).toBe(true)
    expect((await create(input, intent)).success).toBe(true)
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1])
  })
  it("denies permission, absent authentication and rate limits before database access", async () => {
    mocks.permission.mockRejectedValueOnce(Object.assign(new Error("private permission detail"), { code: "AUTH007" }))
    expect(await create(input, intent)).toMatchObject({ success: false, errorCode: "MASTER_FORBIDDEN" })
    mocks.user.mockResolvedValueOnce(null)
    expect((await update(id, input, review)).success).toBe(false)
    mocks.rate.mockResolvedValueOnce({ success: false })
    expect(await active(id, true, review)).toMatchObject({ success: false, errorCode: "MASTER_RATE_LIMIT" })
    expect(mocks.caller).not.toHaveBeenCalled()
  })
  it("rejects missing intent and review identities before writes", async () => {
    expect((await create(input, { request_id: "" })).success).toBe(false)
    expect((await update(id, input, { ...review, expected_updated_at: "2026-10-25" })).success).toBe(false)
    expect((await active("bad", false, review)).success).toBe(false)
    expect((await archive(id, { ...review, expected_updated_at: "" })).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(["MASTER_STALE", "MASTER_REQUEST_CONFLICT", "MASTER_REFERENCED", "MASTER_DUPLICATE", "MASTER_ASSURANCE_REQUIRED"])("returns safe actionable %s without confirming or refreshing", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: code + ": private diagnostic" } })
    const result = await update(id, input, review)
    expect(result).toMatchObject({ success: false, errorCode: code })
    if (result.success) throw Error("Expected rejection")
    expect(result.error).not.toContain("private")
    expect(result.errorAr).toBeTruthy()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe("party validation and confirmation", () => {
  it.each([
    { name_ar: " " }, { name_ar: "ع".repeat(201) }, { name_en: "a".repeat(201) }, { phone: "1".repeat(51) },
    { email: "a".repeat(255) }, { address: "x".repeat(2001) }, { code: "AB" }, { code: "+123" },
    { tax_number: "1".repeat(14) }, { tax_number: "a".repeat(15) }, { credit_limit: -1 },
    { credit_limit: Number.NaN }, { credit_limit: Infinity }, { credit_limit: 0.001 },
  ])("rejects invalid party details before RPC: %j", async invalid => {
    expect((await createCustomer({ ...input, ...invalid }, intent)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("allows an automatic code and explicit zero/null credit limits", async () => {
    expect((await createCustomer({ name_ar: "عميل", credit_limit: 0 }, intent)).success).toBe(true)
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_my_accounting_master", expect.objectContaining({ p_input: expect.objectContaining({ code: null, credit_limit: 0 }) }))
    expect((await createCustomer({ name_ar: "عميل", credit_limit: null }, intent)).success).toBe(true)
  })
  it.each([
    null, { ...receipt, id: "bad" }, { ...receipt, code: "OTHER" }, { ...receipt, updated_at: "2026-10-25" },
    { ...receipt, archived: undefined }, { ...receipt, is_active: "true" },
  ])("never confirms a malformed or mismatching receipt: %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect((await createCustomer(input, intent)).success).toBe(false)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("does not disguise confirmed data as rolled back when cache refresh fails", async () => {
    mocks.invalidate.mockRejectedValue(new Error("private Redis detail"))
    mocks.revalidate.mockImplementation(() => { throw new Error("private cache detail") })
    expect(await createCustomer(input, intent)).toEqual({ success: true, ...receipt })
  })
  it("keeps transport uncertainty safe and replayable", async () => {
    mocks.rpc.mockRejectedValue(new Error("private token detail"))
    const result = await createCustomer(input, intent)
    expect(result.success).toBe(false)
    if (result.success) throw Error("Expected uncertainty")
    expect(result.error).toContain("Retry with unchanged details")
    expect(result.error).not.toContain("private")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

for (const [kind, action] of [["customers", exportCustomersCsv], ["suppliers", exportSuppliersCsv]] as const) describe(kind + " complete CSV", () => {
  it("exports all 1201 caller-bound rows with a BOM and existing safe CSV encoding", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => partyRow(index))
    mocks.rpc.mockResolvedValue({ data: page(rows), error: null })
    const result = await action("%_literal")
    expect(result.success).toBe(true)
    if (!result.success) throw Error("Expected export")
    expect(result.csv.startsWith("\uFEFFcode,")).toBe(true)
    expect(result.csv.trim().split(/\r?\n/)).toHaveLength(1202)
    expect(result.csv).toContain("CUS001201")
    expect(result.csv).toContain('"\t=SUM(A1)"')
    expect(mocks.permission.mock.calls).toEqual([["accounting", "export"], ["accounting", "read"]])
    expect(mocks.rpc).toHaveBeenCalledWith("read_my_accounting_master_page", { p_kind: kind, p_search: "%_literal", p_page: 1, p_page_size: 25, p_export: true })
  })
  it("fails closed on a truncated snapshot", async () => {
    mocks.rpc.mockResolvedValue({ data: page(Array.from({ length: 1000 }, (_, index) => partyRow(index)), 1201), error: null })
    expect(await action()).toMatchObject({ success: false })
  })
  it("counts UTF8 bytes and never slices a large export", async () => {
    mocks.rpc.mockResolvedValue({ data: page(Array.from({ length: 200 }, (_, index) => partyRow(index, "ض".repeat(2000)))), error: null })
    const result = await action()
    expect(result).toMatchObject({ success: false, errorCode: "MASTER_EXPORT_LIMIT" })
    if (result.success) throw Error("Expected export limit")
    expect("csv" in result).toBe(false)
    expect(result.errorAr).toBeTruthy()
  })
  it("requires read permission even for an export-authorized caller", async () => {
    mocks.permission.mockImplementation(async (_module, permission) => { if (permission === "read") throw Object.assign(new Error("private role"), { code: "AUTH007" }) })
    expect((await action()).success).toBe(false)
    expect(mocks.caller).not.toHaveBeenCalled()
  })
})