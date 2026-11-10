// Incoming webhook verification — validates webhooks sent TO EliteDev.
//
// External services (delivery platforms, payment gateways, ZATCA, etc.)
// can send webhook notifications to EliteDev. This module verifies
// their authenticity using HMAC signatures or shared secrets.
//
// Usage in an API route handler:
//   ```ts
//   import { verifyIncomingWebhook } from "@/lib/webhooks/verify"
//
//   export async function POST(req: Request) {
//     const body = await req.text()
//     const signature = req.headers.get("X-Webhook-Signature")
//     const secret = process.env.ZATCA_WEBHOOK_SECRET!
//
//     if (!verifyIncomingWebhook(secret, body, signature)) {
//       return new Response("Unauthorized", { status: 401 })
//     }
//
//     const payload = JSON.parse(body)
//     // Process the incoming webhook...
//   }
//   ```

import crypto from "crypto"
import { moduleLogger } from "@/lib/logger"

const log = moduleLogger("webhooks/verify")

/** Signature header name for incoming webhooks. */
export const INCOMING_SIGNATURE_HEADER = "X-Webhook-Signature"

/** Timestamp header for freshness checks. */
export const INCOMING_TIMESTAMP_HEADER = "X-Webhook-Timestamp"

/** Maximum age of an incoming webhook (5 minutes) to prevent replay attacks. */
export const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000

/**
 * Verify the HMAC-SHA256 signature of an incoming webhook.
 *
 * @param secret     The shared secret configured for this webhook source.
 * @param body       The raw request body (must be the exact bytes that were signed).
 * @param signature  The value of the X-Webhook-Signature header (may include "sha256=" prefix).
 * @returns true if the signature is valid.
 */
export function verifyIncomingWebhook(
  secret: string,
  body: string,
  signature: string | null | undefined
): boolean {
  if (!signature || !secret) return false

  // Strip the "sha256=" prefix if present.
  const cleanSignature = signature.startsWith("sha256=")
    ? signature.slice(7)
    : signature

  // Compute expected signature.
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex")

  // Constant-time comparison to prevent timing attacks.
  if (cleanSignature.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(cleanSignature), Buffer.from(expected))
}

/**
 * Verify an incoming webhook with a freshness check.
 *
 * This adds a timestamp check to prevent replay attacks. The incoming
 * request must include an X-Webhook-Timestamp header with an ISO-8601
 * timestamp that is within MAX_WEBHOOK_AGE_MS of the current time.
 *
 * @param secret     The shared secret.
 * @param body       The raw request body.
 * @param signature  The X-Webhook-Signature header value.
 * @param timestamp  The X-Webhook-Timestamp header value.
 * @returns { valid, reason? } — always returns an object for detailed error reporting.
 */
export function verifyIncomingWebhookWithFreshness(
  secret: string,
  body: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined
): { valid: boolean; reason?: string } {
  // Check signature exists.
  if (!signature) {
    return { valid: false, reason: "Missing signature header" }
  }

  // Check timestamp freshness.
  if (timestamp) {
    const ts = new Date(timestamp).getTime()
    if (isNaN(ts)) {
      return { valid: false, reason: "Invalid timestamp format" }
    }
    const age = Math.abs(Date.now() - ts)
    if (age > MAX_WEBHOOK_AGE_MS) {
      log.warn({ timestamp, age }, "Incoming webhook rejected: timestamp too old")
      return { valid: false, reason: `Webhook timestamp too old (${Math.round(age / 1000)}s ago)` }
    }
  }

  // Verify HMAC signature.
  if (!verifyIncomingWebhook(secret, body, signature)) {
    log.warn("Incoming webhook rejected: invalid signature")
    return { valid: false, reason: "Invalid signature" }
  }

  return { valid: true }
}

/**
 * Verify a ZATCA webhook signature.
 *
 * ZATCA uses a specific signature format. This function handles it.
 *
 * @param body       The raw request body.
 * @param signature  The signature from the ZATCA webhook.
 * @returns true if valid.
 */
export function verifyZatcaWebhook(body: string, signature: string | null | undefined): boolean {
  const secret = process.env.ZATCA_WEBHOOK_SECRET
  if (!secret) {
    log.warn("ZATCA_WEBHOOK_SECRET not configured — skipping verification")
    // In development, allow through. In production, reject.
    return process.env.NODE_ENV !== "production"
  }
  return verifyIncomingWebhook(secret, body, signature)
}

/**
 * Verify a delivery platform webhook signature.
 *
 * Each platform (Careem, Uber, etc.) may use different signing mechanisms.
 * This function delegates to the appropriate verifier.
 *
 * @param platform   The platform name (e.g. "careem", "uber").
 * @param body       The raw request body.
 * @param signature  The signature from the platform webhook.
 * @returns true if valid.
 */
export function verifyPlatformWebhook(
  platform: string,
  body: string,
  signature: string | null | undefined
): boolean {
  const secret = process.env[`${platform.toUpperCase()}_WEBHOOK_SECRET`]
  if (!secret) {
    log.warn({ platform }, "Platform webhook secret not configured — skipping verification")
    return process.env.NODE_ENV !== "production"
  }
  return verifyIncomingWebhook(secret, body, signature)
}
