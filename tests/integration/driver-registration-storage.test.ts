import { randomUUID } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const bucket = "driver-applications"
const required = [
  "SUPABASE_INTEGRATION_URL",
  "SUPABASE_INTEGRATION_ANON_KEY",
  "SUPABASE_INTEGRATION_SERVICE_ROLE_KEY",
] as const

let anon: SupabaseClient
let service: SupabaseClient
let draftId: string
const uploadedPaths: string[] = []

beforeAll(() => {
  const missing = required.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `Local Supabase integration environment is required: ${missing.join(", ")}`
    )
  }

  anon = createClient(
    process.env.SUPABASE_INTEGRATION_URL!,
    process.env.SUPABASE_INTEGRATION_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  service = createClient(
    process.env.SUPABASE_INTEGRATION_URL!,
    process.env.SUPABASE_INTEGRATION_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  draftId = randomUUID()
})

afterAll(async () => {
  if (service && uploadedPaths.length > 0) {
    await service.storage.from(bucket).remove(uploadedPaths)
  }
})

async function upload(path: string, contentType: string) {
  const result = await anon.storage
    .from(bucket)
    .upload(path, new Blob(["launch-security-test"], { type: contentType }), {
      contentType,
      upsert: false,
    })
  if (!result.error) uploadedPaths.push(path)
  return result
}

describe("anonymous driver-application Storage policy", () => {
  it("accepts drafts/<draft UUID>/<file UUID>.pdf", async () => {
    const path = `drafts/${draftId}/${randomUUID()}.pdf`
    const result = await upload(path, "application/pdf")

    expect(result.error).toBeNull()
    expect(result.data?.path).toBe(path)
  })

  it("rejects paths outside drafts", async () => {
    const result = await upload(
      `other/${draftId}/${randomUUID()}.pdf`,
      "application/pdf"
    )

    expect(result.error).not.toBeNull()
  })

  it("rejects disallowed extensions", async () => {
    const result = await upload(
      `drafts/${draftId}/${randomUUID()}.exe`,
      "application/pdf"
    )

    expect(result.error).not.toBeNull()
  })

  it("rejects disallowed MIME types", async () => {
    const result = await upload(
      `drafts/${draftId}/${randomUUID()}.pdf`,
      "application/x-msdownload"
    )

    expect(result.error).not.toBeNull()
  })
})
