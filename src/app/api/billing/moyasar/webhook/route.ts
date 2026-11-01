// Moyasar dashboard webhook (Settings → Webhooks → payment_paid, etc.).
// Authenticated by the endpoint's secret_token (MOYASAR_WEBHOOK_SECRET); even
// then the body is only a hint — settlement re-reads the invoice from the API.
// FAILS CLOSED (503) when the secret or API key is missing.

import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { fetchMoyasarPaymentInvoiceId, moyasarConfigured } from "@/lib/billing/moyasar"
import { reconcileAttempt } from "@/lib/billing/card-payments"
import { moduleLogger } from "@/lib/logger"

export const dynamic = "force-dynamic"
const log = moduleLogger("api/billing/moyasar/webhook")

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.MOYASAR_WEBHOOK_SECRET
  if (!secret || secret.length < 16 || !moyasarConfigured()) return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
  const raw = await req.text()
  if (raw.length > 64_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  let body: { secret_token?: unknown; type?: unknown; data?: { id?: unknown; invoice_id?: unknown } } | null = null
  try { body = JSON.parse(raw) } catch { /* handled below */ }
  if (!body || typeof body.secret_token !== "string" || !same(body.secret_token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const type = typeof body.type === "string" ? body.type : ""
  try {
    let invoiceId = typeof body.data?.invoice_id === "string" ? body.data.invoice_id : null
    if (!invoiceId && typeof body.data?.id === "string") invoiceId = await fetchMoyasarPaymentInvoiceId(body.data.id)
    if (!invoiceId) return NextResponse.json({ ok: true, ignored: "no invoice" })
    const outcome = await reconcileAttempt({ providerInvoiceId: invoiceId })
    log.info({ type, outcome }, "moyasar webhook")
    return NextResponse.json({ ok: true, outcome })
  } catch (err) {
    log.error({ err, type }, "moyasar webhook failed")
    // 500 → Moyasar retries with backoff; settlement is idempotent.
    return NextResponse.json({ error: "Retry later" }, { status: 500 })
  }
}
