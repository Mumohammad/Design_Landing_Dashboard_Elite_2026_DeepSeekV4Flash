import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS } from "./constants"

const m = vi.hoisted(() => ({
  claims: vi.fn(), names: vi.fn(), attachments: vi.fn(), rpc: vi.fn(),
  workbook: vi.fn(), allow: vi.fn(), adminFrom: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/authorization", () => ({
  getCurrentUser: async () => ({ tenantId: "tenant", authUserId: "actor" }), can: m.allow,
}))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: m.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: DEFAULT_SETTINGS, error: null }) }) }) }),
  }),
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.adminFrom }) }))
vi.mock("./complete-reads", () => ({
  readCompleteClaims: m.claims, readClaimDisplayNames: m.names, readCompleteAttachments: m.attachments,
}))
vi.mock("./attachments", () => ({ registerStoredAttachment: vi.fn() }))
vi.mock("./telegram", () => ({ getBotUsername: vi.fn(), telegramConfigured: vi.fn(), tg: vi.fn(), webhookUrl: vi.fn() }))
vi.mock("./export-xlsx", () => ({ exportFilename: () => "claims.xlsx", writeExpenseWorkbook: m.workbook }))
import { exportExpenseClaims } from "./actions"

const claim = { id: "claim-1", version: 4, export_revision: "rev-1", status: "approved", submitter_id: "actor", expense_date: "2026-01-02" }
beforeEach(() => {
  vi.resetAllMocks()
  m.claims.mockResolvedValue([claim])
  m.names.mockResolvedValue({ actor: "Accountant" })
  m.attachments.mockResolvedValue([])
  m.allow.mockResolvedValue({ allowed: true })
  m.adminFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
    data: { name_ar: "شركة", name_en: "Company" }, error: null,
  }) }) }) })
  m.rpc.mockResolvedValue({ data: 1, error: null })
  m.workbook.mockReturnValue(Uint8Array.of(80, 75))
})

describe("expense workbook delivery", () => {
  it("leaves the claims and audit untouched when workbook generation fails", async () => {
    m.workbook.mockImplementation(() => { throw Error("Workbook generation failed") })
    expect((await exportExpenseClaims({}, true)).ok).toBe(false)
    expect(m.rpc).not.toHaveBeenCalled()
  })

  it("reads visible claims once and prepares the file before recording the export", async () => {
    const result = await exportExpenseClaims({}, true)
    expect(result).toMatchObject({ ok: true, base64: "UEs=", rows: 1, marked: 1 })
    expect(m.claims).toHaveBeenCalledTimes(1)
    expect(m.workbook.mock.invocationCallOrder[0]).toBeLessThan(m.rpc.mock.invocationCallOrder[0])
  })

  it("withholds the file after a concurrent change", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "EXC_EXPORT_CONFLICT: stale" }, status: 400 })
    expect(await exportExpenseClaims({}, true)).toMatchObject({ ok: false, error: expect.stringContaining("changed") })
    expect(m.workbook).toHaveBeenCalledTimes(1)
    expect(m.rpc).toHaveBeenCalledTimes(1)
  })

  it("recovers a lost confirmation using the same workbook, revisions and receipt", async () => {
    m.attachments.mockResolvedValue([{ id: "evidence", claim_id: claim.id, export_revision: "rev-2" }])
    m.rpc.mockRejectedValueOnce(new TypeError("fetch failed"))
    expect(await exportExpenseClaims({}, true)).toMatchObject({ ok: true, marked: 1 })
    expect(m.rpc).toHaveBeenCalledTimes(2)
    expect(m.rpc.mock.calls[0]).toEqual(m.rpc.mock.calls[1])
    expect(m.rpc.mock.calls[1]).toEqual(["expense_claims_commit_export", {
      p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/), p_exported_at: expect.any(String),
      p_mark_exported: true, p_claims: [{ id: claim.id, version: 4, export_revision: "rev-1" }],
      p_attachments: [{ id: "evidence", claim_id: claim.id, export_revision: "rev-2" }],
      p_workbook_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }])
  })

  it("withholds an unconfirmed workbook and explains how to reconcile", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "", message: "fetch failed" }, status: 0 })
    expect(await exportExpenseClaims({}, true)).toMatchObject({ ok: false, error: expect.stringContaining("claim history") })
    expect(m.rpc).toHaveBeenCalledTimes(2)
  })

  it("withholds a workbook if its transition count differs from the database", async () => {
    m.rpc.mockResolvedValue({ data: 0, error: null })
    expect(await exportExpenseClaims({}, true)).toMatchObject({ ok: false })
    expect(m.rpc).toHaveBeenCalledTimes(1)
  })

  it("rejects an oversized workbook before recording any changes", async () => {
    m.workbook.mockReturnValue(new Uint8Array(3 * 1024 * 1024 + 1))
    expect(await exportExpenseClaims({}, true)).toMatchObject({ ok: false, error: expect.stringContaining("Narrow") })
    expect(m.rpc).not.toHaveBeenCalled()
  })
})
