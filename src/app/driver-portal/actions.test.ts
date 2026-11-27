import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), rpc: vi.fn(), signed: vi.fn(), list: vi.fn(), download: vi.fn(), prior: { data: null as unknown, error: null as unknown } }))
vi.mock("@/lib/driver-portal/server", () => ({ resolvePortalLink: mocks.resolve }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => mocks.prior }
  return chain
}, storage: { from: () => ({ createSignedUploadUrl: mocks.signed, list: mocks.list, download: mocks.download }) } }) }))
import { finishPortalUpload, startPortalUpload } from "./actions"
import { hashPortalToken } from "@/lib/driver-portal/token"
const token = "a".repeat(64), tenant = "20000000-0000-4000-8000-000000000001", driver = "20000000-0000-4000-8000-000000000002", id = "20000000-0000-4000-8000-000000000003", link = "20000000-0000-4000-8000-000000000004"
const path = `${tenant}/${driver}/iqama-${id}.pdf`, name = `iqama-${id}.pdf`
const startInput = { token, docType: "iqama", mime: "application/pdf", size: 6 }
const finishInput = { token, path, docType: "iqama", docNumber: "DOC-1" }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.prior = { data: null, error: null }
  mocks.resolve.mockResolvedValue({ id: link, tenant_id: tenant, driver_id: driver, expires_at: "2099-01-01T00:00:00Z" })
  mocks.rpc.mockImplementation(async operation => ({ data: operation === "complete_driver_portal_upload" ? { id, replayed: false } : { id, path }, error: null }))
  mocks.signed.mockResolvedValue({ data: { token: "signed-capability", path }, error: null })
  mocks.list.mockResolvedValue({ data: [{ name, metadata: { size: 6, mimetype: "application/pdf" } }], error: null })
  mocks.download.mockResolvedValue({ data: new Blob(["%PDF-1"], { type: "application/pdf" }), error: null })
})
describe("public portal capability issuance", () => {
  it("reserves quota before signing and acknowledges activation before returning a capability", async () => {
    expect(await startPortalUpload(startInput)).toEqual({ ok: true, path, uploadToken: "signed-capability" })
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["reserve_driver_portal_upload", "activate_driver_portal_upload"])
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "reserve_driver_portal_upload", { p_token_hash: hashPortalToken(token), p_doc_type: "iqama", p_size: 6, p_mime: "application/pdf" })
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.signed.mock.invocationCallOrder[0])
    expect(mocks.signed.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1])
    expect(mocks.signed).toHaveBeenCalledWith(path, { upsert: false })
  })
  it.each(["DPU002", "DPU003", "private SQL failure"])("never signs when quota reservation fails: %s", async message => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } })
    expect(await startPortalUpload(startInput)).toMatchObject({ ok: false })
    expect(mocks.signed).not.toHaveBeenCalled()
  })
  it("does not sign unknown or foreign reservation responses", async () => {
    mocks.rpc.mockResolvedValue({ data: { id, path: `foreign/${name}` }, error: null })
    expect(await startPortalUpload(startInput)).toMatchObject({ ok: false })
    expect(mocks.signed).not.toHaveBeenCalled()
  })
  it("returns no capability after an unknown signing outcome, without releasing the charged attempt", async () => {
    mocks.signed.mockRejectedValue(new Error("timeout after signing"))
    expect(await startPortalUpload(startInput)).toMatchObject({ ok: false })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it.each(["revoked", "unknown", "throw"])("does not return a minted capability after %s activation", async outcome => {
    mocks.rpc.mockImplementation(async operation => {
      if (operation === "reserve_driver_portal_upload") return { data: { id, path }, error: null }
      if (outcome === "throw") throw new Error("timeout after activation")
      return outcome === "revoked" ? { data: null, error: { message: "DPU001" } } : { data: null, error: null }
    })
    const result = await startPortalUpload(startInput)
    expect(result).toMatchObject({ ok: false })
    expect(result).not.toHaveProperty("uploadToken")
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
  it("does not reach storage when current scope is unavailable", async () => {
    mocks.resolve.mockResolvedValue(null)
    expect(await startPortalUpload(startInput)).toMatchObject({ ok: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.signed).not.toHaveBeenCalled()
  })
})
describe("public portal completion", () => {
  it("verifies bytes and delegates the final active-scope check and insertion to one RPC", async () => {
    expect(await finishPortalUpload(finishInput)).toEqual({ ok: true })
    expect(mocks.download).toHaveBeenCalledWith(path)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith("complete_driver_portal_upload", { p_token_hash: hashPortalToken(token), p_path: path, p_doc_type: "iqama", p_doc_number: "DOC-1", p_expiry_date: null, p_note: null })
  })
  it("rejects revocation that happened during the storage check", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "DPU001" } })
    expect(await finishPortalUpload(finishInput)).toMatchObject({ ok: false, error: expect.stringContaining("revoked") })
  })
  it("does not mistake a failed duplicate lookup for an absent record", async () => {
    mocks.prior.error = { message: "private SQL failure" }
    expect(await finishPortalUpload(finishInput)).toMatchObject({ ok: false })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("validates a replay atomically without downloading the file again", async () => {
    mocks.prior.data = { id }
    mocks.rpc.mockResolvedValue({ data: { id, replayed: true }, error: null })
    expect(await finishPortalUpload(finishInput)).toEqual({ ok: true })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it("rejects a replay with changed metadata", async () => {
    mocks.prior.data = { id }
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "DPU006" } })
    expect(await finishPortalUpload({ ...finishInput, docNumber: "changed" })).toMatchObject({ ok: false })
  })
  it.each(["bad bytes", "wrong size", "list failure", "unknown completion"])("fails closed on %s", async fault => {
    if (fault === "bad bytes") mocks.download.mockResolvedValue({ data: new Blob(["script"], { type: "application/pdf" }), error: null })
    if (fault === "wrong size") mocks.download.mockResolvedValue({ data: new Blob(["%PDF-bigger"], { type: "application/pdf" }), error: null })
    if (fault === "list failure") mocks.list.mockResolvedValue({ data: null, error: { message: "storage unavailable" } })
    if (fault === "unknown completion") mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await finishPortalUpload(finishInput)).toMatchObject({ ok: false })
    if (fault !== "unknown completion") expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("rejects invalid dates before resolving the bearer", async () => {
    expect(await finishPortalUpload({ ...finishInput, expiryDate: "2026-02-31" })).toMatchObject({ ok: false })
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
