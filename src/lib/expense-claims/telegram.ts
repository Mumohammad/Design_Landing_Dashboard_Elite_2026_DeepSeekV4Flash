import "server-only"
// Minimal Telegram Bot API client for the expense receipt bot. The bot token
// and webhook secret live only in server env vars and are never logged,
// returned to the browser or stored in the database.

const API = "https://api.telegram.org"

export function telegramConfigured(): { token: boolean; secret: boolean } {
  return { token: Boolean(process.env.TELEGRAM_BOT_TOKEN), secret: (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").length >= 24 }
}

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN
  if (!t || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(t)) throw new Error("TELEGRAM_NOT_CONFIGURED")
  return t
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}, timeoutMs = 8000): Promise<T> {
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  })
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
  // Never include the request URL (it contains the token) in errors.
  if (!json?.ok) throw new Error(`TELEGRAM_API_ERROR:${method}:${String(json?.description ?? res.status).slice(0, 120)}`)
  return json.result as T
}

let botUsername: string | null = null
export async function getBotUsername(): Promise<string | null> {
  if (botUsername) return botUsername
  try { botUsername = (await tg<{ username?: string }>("getMe")).username ?? null } catch { botUsername = null }
  return botUsername
}

export async function sendMessage(chatId: number, text: string): Promise<void> {
  try { await tg("sendMessage", { chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true }) } catch { /* best effort */ }
}

/** Downloads a Telegram file (≤ maxBytes). Returns null when too large or unavailable. */
export async function downloadTelegramFile(fileId: string, maxBytes: number): Promise<Uint8Array | null> {
  const f = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId })
  if (!f.file_path || (f.file_size ?? 0) > maxBytes || !/^[\w\-./]+$/.test(f.file_path) || f.file_path.includes("..")) return null
  const res = await fetch(`${API}/file/bot${token()}/${f.file_path}`, { signal: AbortSignal.timeout(20000), cache: "no-store" })
  if (!res.ok || !res.body) return null
  const declared = Number(res.headers.get("content-length") ?? 0)
  if (declared > maxBytes) return null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.byteLength }
  return out
}

export function webhookUrl(): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
  return /^https:\/\//.test(base) ? `${base}/api/telegram/expenses` : null
}
