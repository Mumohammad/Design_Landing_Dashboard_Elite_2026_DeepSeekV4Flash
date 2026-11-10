"use server"

import { randomUUID } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getClientIp, rateLimit } from "@/lib/auth/rate-limit"
import { getUploadDraft } from "./draft"

const extensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
}

export async function authorizeApplicationUpload(mimeType: string, size: number) {
  if (!Object.prototype.hasOwnProperty.call(extensions, mimeType) || !Number.isInteger(size) || size <= 0 || size > 5 * 1024 * 1024) return null
  const ip = await getClientIp()
  if (!(await rateLimit(`driver-upload:${ip}`, 20, "hour")).success) return null
  const draft = await getUploadDraft(true)
  if (!draft) return null
  const path = `drafts/${draft}/${randomUUID()}.${extensions[mimeType]}`
  const { data, error } = await createAdminClient().storage.from("driver-applications").createSignedUploadUrl(path)
  if (error || !data) return null
  return { path, token: data.token }
}
