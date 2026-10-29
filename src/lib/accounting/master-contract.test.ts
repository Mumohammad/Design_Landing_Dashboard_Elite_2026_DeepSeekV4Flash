import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  MasterContractError, formatChartImportError, classifyMasterError, isMasterDate, isMasterIntent, isMasterReview, isMasterTimestamp,
  parseMasterMutationResult, parseMasterPage, readChartParentPage, readMasterPage, utf8ByteLength,
  type ChartMasterRow, type MasterKind, type PartyMasterRow,
} from "./master-contract"

const id = "18000000-0000-4000-8000-000000000001"
const parentId = "18000000-0000-4000-8000-000000000002"
const stamp = "2026-10-25T12:30:00.123456+00:00"
const party = (index = 0): PartyMasterRow => ({
  id: "18000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), code: "CUS" + String(index + 1).padStart(6, "0"),
  name_ar: "عميل", name_en: "Customer", phone: null, email: null, tax_number: null, address: null,
  credit_limit: "12.34", is_active: true, updated_at: stamp,
})
const account: ChartMasterRow = {
  id, account_code: "8301", name_ar: "حساب", name_en: "Account", account_type: "asset", normal_balance: "debit",
  parent_id: parentId, is_contra: false, is_active: true, description: null, updated_at: stamp,
  parent_code: "1000", parent_name_ar: "أصل", parent_name_en: "Parent outside page", is_canonical: false, can_archive: true,
}
const envelope = (rows: unknown[] = [party()], total = rows.length, kind: MasterKind = "customers") => ({
  rows, total, page: 1, page_size: 25, summary: kind === "accounts"
    ? { total, active: total, assets: total, income_expense: 0 }
    : { total, active: total, tax_registered: 0, avg_credit_limit: "12.34" },
})
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient

describe("accounting master response contracts", () => {
  it("preserves raw microsecond timestamps and exact credit strings", () => {
    const row = parseMasterPage<PartyMasterRow>(envelope(), "customers").rows[0]
    expect(row.updated_at).toBe(stamp)
    expect(row.credit_limit).toBe("12.34")
    expect(parseMasterMutationResult({ id, updated_at: stamp, code: "CUS001", is_active: false, archived: false }, "customers").updated_at).toBe(stamp)
  })
  it("retains joined parent labels outside the current account page", () => {
    expect(parseMasterPage<ChartMasterRow>(envelope([account], 1, "accounts"), "accounts").rows[0]).toEqual(account)
  })
  it("retains global metrics when a literal search has no matches", () => {
    const data = { ...envelope([], 0), summary: { total: 1201, active: 1100, tax_registered: 300, avg_credit_limit: "0.00" } }
    expect(parseMasterPage(data, "customers")).toMatchObject({ rows: [], total: 0, summary: data.summary })
  })
  it("accepts complete exports beyond the default REST cap and rejects truncation", () => {
    const rows = Array.from({ length: 1201 }, (_, index) => party(index))
    expect(parseMasterPage(envelope(rows), "customers", 1, 25, true).rows).toHaveLength(1201)
    expect(() => parseMasterPage(envelope(rows.slice(0, 1000), 1201), "customers", 1, 25, true)).toThrow(MasterContractError)
    expect(() => parseMasterPage(envelope(Array.from({ length: 10001 }, (_, index) => party(index))), "customers", 1, 25, true))
      .toThrow("Narrow the search")
  })
  it.each([
    { total: null }, { total: 1.5 }, { page: 2 }, { page_size: 50 }, { rows: [] }, { summary: null },
    { summary: { total: 0, active: 0, tax_registered: 0, avg_credit_limit: "0" } },
    { summary: { total: 1, active: 2, tax_registered: 0, avg_credit_limit: "0" } },
    { summary: { total: 1, active: 1, tax_registered: 0, avg_credit_limit: 1.25 } },
  ])("rejects missing/truncated page or misleading metrics: %j", invalid => {
    expect(() => parseMasterPage({ ...envelope(), ...invalid }, "customers")).toThrow(MasterContractError)
  })
  it.each([
    { id: "bad" }, { updated_at: "2026-02-30T12:00:00Z" }, { updated_at: new Date(stamp) },
    { credit_limit: 12.34 }, { credit_limit: "0.001" }, { credit_limit: "-1.00" }, { is_active: "true" },
    { name_ar: "" }, { code: "?" }, { address: undefined },
  ])("rejects malformed party fields: %j", invalid => {
    expect(() => parseMasterPage(envelope([{ ...party(), ...invalid }]), "customers")).toThrow(MasterContractError)
  })
  it("rejects duplicate IDs and an incomplete account capability", () => {
    expect(() => parseMasterPage(envelope([party(), party()]), "customers")).toThrow(MasterContractError)
    expect(() => parseMasterPage(envelope([{ ...account, can_archive: undefined }], 1, "accounts"), "accounts")).toThrow(MasterContractError)
  })
  it.each([
    { id: "bad" }, { updated_at: "2026-10-25" }, { code: "" }, { archived: undefined }, { is_active: "false" },
  ])("never confirms a malformed mutation receipt: %j", invalid => {
    expect(() => parseMasterMutationResult({ id, updated_at: stamp, code: "CUS001", is_active: true, archived: false, ...invalid }, "customers")).toThrow(MasterContractError)
  })
  it("validates request identity and calendar dates without timestamp normalization", () => {
    expect(isMasterIntent({ request_id: id })).toBe(true)
    expect(isMasterReview({ request_id: id, expected_updated_at: stamp })).toBe(true)
    for (const value of ["2026-02-30", "2026-2-01", "0000-01-01", "2025-02-29"]) expect(isMasterDate(value)).toBe(false)
    expect(isMasterDate("2028-02-29")).toBe(true)
    expect(isMasterTimestamp("2026-10-25T24:00:00Z")).toBe(false)
    expect(isMasterTimestamp(stamp)).toBe(true)
    expect(isMasterReview({ request_id: id, expected_updated_at: new Date(stamp) })).toBe(false)
    expect(utf8ByteLength("ض")).toBe(2)
  })
  it("only exposes recognized errors, including hostile property names", () => {
    expect(classifyMasterError({ message: "MASTER_STALE: private row" })).toBe("MASTER_STALE")
    expect(classifyMasterError({ code: "AUTH007", message: "private role" })).toBe("MASTER_FORBIDDEN")
    expect(classifyMasterError({ code: "constructor", message: "private token" })).toBe("MASTER_UNAVAILABLE")
    expect(classifyMasterError(new Error("private database connection"))).toBe("MASTER_UNAVAILABLE")
  })
})

describe("caller-bound master page readers", () => {
  it("passes literal search and export intent without an actor/tenant override", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: envelope(), error: null })
    const value = await readMasterPage(client(rpc), "customers", { search: "%_quoted", exporting: true })
    expect(value.total).toBe(1)
    expect(rpc).toHaveBeenCalledWith("read_my_accounting_master_page", {
      p_kind: "customers", p_search: "%_quoted", p_page: 1, p_page_size: 25, p_export: true,
    })
  })
  it("passes parent type and recursive exclusion identity to the guarded RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...envelope([account], 1, "accounts"), summary: null }, error: null })
    expect((await readChartParentPage(client(rpc), "asset", { excludeId: "18000000-0000-4000-8000-000000000009" })).rows).toEqual([account])
    expect(rpc).toHaveBeenCalledWith("read_my_chart_parent_page", {
      p_account_type: "asset", p_exclude_id: "18000000-0000-4000-8000-000000000009", p_search: "", p_page: 1, p_page_size: 25,
    })
  })
  it("rejects invalid options before querying", async () => {
    const rpc = vi.fn()
    for (const options of [{ search: "x".repeat(201) }, { page: 0 }, { pageSize: 101 }, { page: 1.5 }]) {
      await expect(readMasterPage(client(rpc), "customers", options)).rejects.toThrow()
    }
    await expect(readChartParentPage(client(rpc), "asset", { excludeId: "bad" })).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
  it("forwards cancellation and suppresses aborted response data", async () => {
    const controller = new AbortController(); controller.abort()
    const abortSignal = vi.fn().mockResolvedValue({ data: envelope(), error: null }), rpc = vi.fn(() => ({ abortSignal }))
    await expect(readMasterPage(client(rpc), "customers", { signal: controller.signal })).rejects.toThrow()
    expect(abortSignal).toHaveBeenCalledWith(controller.signal)
  })
  it("maps explicit export bounds and hides unexpected provider diagnostics", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "MASTER_EXPORT_LIMIT: internal" } })
    await expect(readMasterPage(client(rpc), "suppliers", { exporting: true })).rejects.toThrow("Narrow the search")
    rpc.mockRejectedValueOnce(new Error("private connection token"))
    await expect(readMasterPage(client(rpc), "suppliers")).rejects.toThrow("Unable to confirm")
  })
})
describe("localized chart import diagnostics", () => {
  for (const code of ["COA001", "COA002", "COA003", "COA004", "COA005", "COA006"]) {
    for (const arabic of [false, true]) it("preserves row/code and localizes " + code + " in " + (arabic ? "Arabic" : "English"), () => {
      const result = formatChartImportError("Row 12: " + code + ": raw internal database details", arabic)
      expect(result).toContain((arabic ? "الصف " : "Row ") + "12")
      expect(result).toContain(code)
      expect(result).not.toContain("raw internal database details")
      expect(/[\u0600-\u06ff]/.test(result)).toBe(arabic)
    })
  }
  it("localizes generic row errors without dropping the row", () => {
    expect(formatChartImportError("Row 4: Invalid account details", true)).toBe("الصف 4: راجع البيانات المحاسبية المدخلة وحاول مجدداً.")
    expect(formatChartImportError("Row 4: Invalid account details", false)).toBe("Row 4: Review the entered accounting details and try again.")
  })
  it("retains an unknown code while replacing raw service details", () => {
    expect(formatChartImportError("Row 8: COA999: internal table details", true)).toBe("الصف 8 (COA999): راجع البيانات المحاسبية المدخلة وحاول مجدداً.")
  })
  it("falls back to a safe translated message for an unexpected diagnostic", () => {
    expect(formatChartImportError("unstructured server details", true)).toBe("راجع البيانات المحاسبية المدخلة وحاول مجدداً.")
  })
})
