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

  const target = new URL(process.env.SUPABASE_INTEGRATION_URL!)
  if (!["127.0.0.1", "localhost"].includes(target.hostname)) throw new Error("Storage tests must use an isolated local Supabase instance")

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
  it("rejects a public signup that spoofs the provisioning marker", async () => {
    const result = await anon.auth.signUp({
      email: `spoof-${randomUUID()}@example.test`, password: "LocalFixtureOnly123!",
      options: { data: { _invite_provisioned: true } },
    })
    expect(result.error).not.toBeNull()
    expect(result.data.user).toBeNull()
  })

  it("allows server provisioning with trusted app metadata", async () => {
    const result = await service.auth.admin.createUser({
      email: `trusted-${randomUUID()}@example.test`, password: "LocalFixtureOnly123!",
      app_metadata: { _invite_provisioned: true }, email_confirm: true,
    })
    try {
      expect(result.error).toBeNull()
      expect(result.data.user?.id).toBeTruthy()
    } finally {
      if (result.data.user) await service.auth.admin.deleteUser(result.data.user.id)
    }
  })

  it("allows the Auth-managed admin invite flow", async () => {
    const result = await service.auth.admin.inviteUserByEmail(`invite-${randomUUID()}@example.test`)
    try {
      expect(result.error).toBeNull()
      expect(result.data.user?.invited_at).toBeTruthy()
    } finally {
      if (result.data.user) await service.auth.admin.deleteUser(result.data.user.id)
    }
  })
  it("accepts a server-issued signed grant and prevents overwriting it", async () => {
    const path = `drafts/${draftId}/${randomUUID()}.pdf`
    const grant = await service.storage.from(bucket).createSignedUploadUrl(path)
    expect(grant.error).toBeNull()
    const body = new Blob(["local-signed-upload"], { type: "application/pdf" })
    const result = await anon.storage.from(bucket).uploadToSignedUrl(path, grant.data!.token, body)
    expect(result.error).toBeNull()
    uploadedPaths.push(path)
    expect((await anon.storage.from(bucket).uploadToSignedUrl(path, grant.data!.token, body)).error).not.toBeNull()
  })
  it("rejects unsigned uploads even with a valid draft path", async () => {
    const path = `drafts/${draftId}/${randomUUID()}.pdf`
    const result = await upload(path, "application/pdf")

    expect(result.error).not.toBeNull()
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
