import { beforeEach, describe, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ permission: vi.fn(), user: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mock.permission, getCurrentUser: mock.user }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mock.rpc }) }))
import { createViolationFromFine } from "./fines"
const fineId = "17200000-0000-4000-8000-000000000021"
const violationId = "17200000-0000-4000-8000-000000000031"
beforeEach(() => {
  vi.resetAllMocks()
  mock.permission.mockResolvedValue(undefined)
  mock.user.mockResolvedValue({ id: "actor" })
})
describe("atomic imported fine conversion", () => {
  it.each([false, true])("uses one caller transaction and recovers a committed replay=%s", async replayed => {
    mock.rpc.mockResolvedValue({ data: { violation_id: violationId, replayed }, error: null })
    expect(await createViolationFromFine(fineId)).toEqual({ ok: true, data: { violationId } })
    expect(mock.permission.mock.calls).toEqual([["violations", "create"], ["violations", "update"]])
    expect(mock.rpc.mock.calls).toEqual([["convert_my_external_fine", { p_id: fineId }]])
    expect(mock.revalidate).toHaveBeenCalledWith("/violations/fines")
  })
  it.each([
    { data: null, error: { message: "Synthetic failure" } },
    { data: { violation_id: "invalid", replayed: false }, error: null },
    { data: { violation_id: violationId }, error: null },
  ])("does not report unknown or malformed conversion as success", async result => {
    mock.rpc.mockResolvedValue(result)
    expect((await createViolationFromFine(fineId)).ok).toBe(false)
    expect(mock.rpc).toHaveBeenCalledTimes(1)
    expect(mock.revalidate).not.toHaveBeenCalled()
  })
  it("does not retry an unknown transport outcome or start a separate creation/link", async () => {
    mock.rpc.mockRejectedValue(new Error("Synthetic lost response"))
    expect((await createViolationFromFine(fineId)).ok).toBe(false)
    expect(mock.rpc).toHaveBeenCalledTimes(1)
    expect(mock.revalidate).not.toHaveBeenCalled()
  })
  it("checks both current permissions before any write", async () => {
    mock.permission.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("permission"))
    expect((await createViolationFromFine(fineId)).ok).toBe(false)
    expect(mock.rpc).not.toHaveBeenCalled()
  })
})
