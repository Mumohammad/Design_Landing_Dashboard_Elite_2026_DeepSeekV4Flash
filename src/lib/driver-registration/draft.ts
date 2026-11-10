import "server-only"
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"

const COOKIE = "driver-upload-draft"
const TTL = 2 * 60 * 60

function signature(value: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error("Upload signing is not configured")
  return createHmac("sha256", key).update(`driver-upload-v1:${value}`).digest("hex")
}

export async function getUploadDraft(create = false): Promise<string | null> {
  const jar = await cookies()
  const value = jar.get(COOKIE)?.value
  if (value) {
    const [id, expires, mac] = value.split(".")
    if (/^[0-9a-f-]{36}$/.test(id ?? "") && /^\d+$/.test(expires ?? "") && /^[0-9a-f]{64}$/.test(mac ?? "")) {
      const expected = signature(`${id}.${expires}`)
      if (Number(expires) > Date.now() && timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return id
    }
  }
  if (!create) return null
  const id = randomUUID()
  const payload = `${id}.${Date.now() + TTL * 1000}`
  jar.set(COOKIE, `${payload}.${signature(payload)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: TTL,
  })
  return id
}

export function ownsUploadPath(draft: string, path: string): boolean {
  return path.startsWith(`drafts/${draft}/`) && /^drafts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(path)
}
