// Moyasar invoice callback_url: notified when a hosted invoice changes status.
// Unauthenticated by design, so the body is used only to pick the invoice id;
// the status is re-read from Moyasar with our secret key before settling.

import { NextResponse } from "next/server"
import { moyasarConfigured } from "@/lib/billing/moyasar"
import { reconcileAttempt } from "@/lib/billing/card-payments"
import { rateLimit, getClientIp } from "@/lib/auth/rate-limit"
import { moduleLogger } from "@/lib/logger"

export const dynamic = "force-dynamic"
const log = moduleLogger("api/billing/moyasar/callback")

export async function POST(req: Request): Promise<NextResponse> {
  if (!moyasarConfigured()) return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
  const rl = await rateLimit(`moyasar-callback:${await getClientIp()}`, 60, "minute")
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  const raw = await req.text()
  if (raw.length > 64_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  let id: unknown = null
  try { id = (JSON.parse(raw) as { id?: unknown })?.id } catch { /* ignore */ }
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: true, ignored: true })
  try {
    const outcome = await reconcileAttempt({ providerInvoiceId: id })
    log.info({ outcome }, "moyasar invoice callback")
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error({ err }, "moyasar callback failed")
    return NextResponse.json({ error: "Retry later" }, { status: 500 })
  }
}
