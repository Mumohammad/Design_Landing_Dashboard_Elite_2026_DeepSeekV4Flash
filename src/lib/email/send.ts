import "server-only"

// Minimal transactional email sender (Resend HTTP API). Server-only; never
// throws — callers get a typed result and decide how to record it.

export type SendEmailResult = { ok: true; id: string | null } | { ok: false; error: string; configured: boolean }

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function sendEmail(input: {
  to: string[]
  subject: string
  html: string
  text?: string
  idempotencyKey?: string
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: "Email provider is not configured (RESEND_API_KEY).", configured: false }
  const to = [...new Set(input.to.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (to.length === 0) return { ok: false, error: "No recipients.", configured: true }
  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev"
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey.slice(0, 256) } : {}),
      },
      // Recipients go in BCC-style individual "to" entries only when there is
      // one; multiple managers share one message (internal, same company).
      body: JSON.stringify({ from, to, subject: input.subject, html: input.html, text: input.text }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return { ok: false, error: `Email provider rejected the message (${res.status}). ${body.slice(0, 160)}`, configured: true }
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: json?.id ?? null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : "Email send failed", configured: true }
  }
}
