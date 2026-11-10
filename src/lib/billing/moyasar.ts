import "server-only"

// Minimal Moyasar REST client (https://docs.moyasar.com). Hosted invoice
// checkout keeps card data off our servers (mada, Visa/Mastercard, Apple Pay,
// STC Pay — as enabled on the merchant account). Never trust redirect query
// strings or webhook bodies: settlement always re-reads the invoice here.

const API = "https://api.moyasar.com/v1"

export type MoyasarInvoiceStatus = "initiated" | "paid" | "failed" | "refunded" | "canceled" | "on_hold" | "expired" | "voided"

export interface MoyasarInvoice {
  id: string
  status: MoyasarInvoiceStatus
  amount: number
  currency: string
  url: string
  metadata?: Record<string, string> | null
  payments?: { id: string; status: string; amount: number }[]
}

export function moyasarConfigured(): boolean {
  return /^sk_(test|live)_[A-Za-z0-9]+$/.test(process.env.MOYASAR_SECRET_KEY ?? "")
}

export function moyasarMode(): "test" | "live" | null {
  const key = process.env.MOYASAR_SECRET_KEY ?? ""
  return key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : null
}

function auth(): string {
  return `Basic ${Buffer.from(`${process.env.MOYASAR_SECRET_KEY ?? ""}:`).toString("base64")}`
}

export function parseMoyasarInvoice(value: unknown): MoyasarInvoice {
  const v = value as Record<string, unknown> | null
  const statuses: MoyasarInvoiceStatus[] = ["initiated", "paid", "failed", "refunded", "canceled", "on_hold", "expired", "voided"]
  if (!v || typeof v.id !== "string" || !/^[0-9a-f-]{36}$/i.test(v.id)) throw new Error("Invalid Moyasar invoice id")
  if (!statuses.includes(v.status as MoyasarInvoiceStatus)) throw new Error("Invalid Moyasar invoice status")
  if (!Number.isSafeInteger(v.amount) || (v.amount as number) <= 0) throw new Error("Invalid Moyasar amount")
  if (typeof v.currency !== "string" || typeof v.url !== "string" || !v.url.startsWith("https://")) throw new Error("Invalid Moyasar invoice")
  const metadata = v.metadata && typeof v.metadata === "object" ? Object.fromEntries(Object.entries(v.metadata as Record<string, unknown>).map(([k, x]) => [k, String(x)])) : null
  const payments = Array.isArray(v.payments)
    ? (v.payments as Record<string, unknown>[]).filter((p) => p && typeof p.id === "string").map((p) => ({ id: String(p.id), status: String(p.status), amount: Number(p.amount) }))
    : []
  return { id: v.id, status: v.status as MoyasarInvoiceStatus, amount: v.amount as number, currency: v.currency.toUpperCase(), url: v.url, metadata, payments }
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message).slice(0, 200) : `HTTP ${res.status}`
    throw new Error(`Moyasar: ${msg}`)
  }
  return body
}

export async function createMoyasarInvoice(input: {
  amountHalalas: number
  description: string
  successUrl: string
  backUrl: string
  callbackUrl: string
  metadata: Record<string, string>
  expiresAt?: string
}): Promise<MoyasarInvoice> {
  const body = {
    amount: input.amountHalalas,
    currency: "SAR",
    description: input.description.slice(0, 250),
    success_url: input.successUrl,
    back_url: input.backUrl,
    callback_url: input.callbackUrl,
    metadata: input.metadata,
    ...(input.expiresAt ? { expired_at: input.expiresAt } : {}),
  }
  return parseMoyasarInvoice(await call("/invoices", { method: "POST", body: JSON.stringify(body) }))
}

export async function fetchMoyasarInvoice(id: string): Promise<MoyasarInvoice> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid Moyasar invoice id")
  return parseMoyasarInvoice(await call(`/invoices/${encodeURIComponent(id)}`))
}

/** Payments carry `invoice_id` when made through a hosted invoice. */
export async function fetchMoyasarPaymentInvoiceId(paymentId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return null
  const p = (await call(`/payments/${encodeURIComponent(paymentId)}`)) as Record<string, unknown> | null
  return p && typeof p.invoice_id === "string" ? p.invoice_id : null
}
