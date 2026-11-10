import { beforeEach, describe, expect, it, vi } from "vitest"
const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
}) }))
import { getUploadDraft, ownsUploadPath } from "./draft"
beforeEach(() => { jar.clear(); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "isolated-test-key") })
describe("draft ownership", () => {
  it("requires a server issued cookie and retains the same draft", async () => {
    expect(await getUploadDraft()).toBeNull()
    const id = await getUploadDraft(true)
    expect(await getUploadDraft()).toBe(id)
    expect(ownsUploadPath(id!, `drafts/${id}/11111111-1111-4111-8111-111111111111.pdf`)).toBe(true)
    expect(ownsUploadPath(id!, "drafts/11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111.pdf")).toBe(false)
    expect(ownsUploadPath(id!, `drafts/${id}/../another.pdf`)).toBe(false)
  })
  it("rejects a forged or expired cookie", async () => {
    await getUploadDraft(true)
    const valid = jar.get("driver-upload-draft")!
    jar.set("driver-upload-draft", valid.replace(/^[^.]+/, "11111111-1111-4111-8111-111111111111"))
    expect(await getUploadDraft()).toBeNull()
    jar.set("driver-upload-draft", valid)
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 60 * 60 * 1000)
    expect(await getUploadDraft()).toBeNull()
    now.mockRestore()
  })
})
