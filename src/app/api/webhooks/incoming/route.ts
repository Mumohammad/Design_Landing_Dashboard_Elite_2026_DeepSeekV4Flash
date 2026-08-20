// Incoming webhook handler for external services.
//
// This endpoint receives webhook notifications from external services:
//   - Delivery platforms (Careem, Uber, etc.)
//   - Payment gateways
//   - ZATCA (Saudi tax authority)
//   - HR systems
//   - Custom integrations
//
// Each webhook source should be configured with:
//   - A shared secret (env var: {PLATFORM}_WEBHOOK_SECRET)
//   - HMAC-SHA256 signature verification
//
// Security:
//   - All incoming webhooks are verified via HMAC signature.
//   - Timestamps are checked to prevent replay attacks.
//   - Invalid signatures are rejected with 401.
//
// Usage:
//   POST /api/webhooks/incoming
//   Headers:
//     X-Webhook-Source: careem | uber | zatca | payment | custom
//     X-Webhook-Signature: sha256=<hex>
//     X-Webhook-Timestamp: <ISO-8601>

import { NextResponse } from "next/server"
import { verifyIncomingWebhookWithFreshness } from "@/lib/webhooks/verify"
import { moduleLogger } from "@/lib/logger"

const log = moduleLogger("api/webhooks/incoming")

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Parse the incoming webhook.
    const source = req.headers.get("x-webhook-source") ?? "unknown"
    const signature = req.headers.get("x-webhook-signature")
    const timestamp = req.headers.get("x-webhook-timestamp")
    const body = await req.text()

    log.info({ source, contentLength: body.length }, "Incoming webhook received")

    // Get the secret for this source.
    const secretKey = `${source.toUpperCase()}_WEBHOOK_SECRET`
    const secret = process.env[secretKey]

    if (!secret) {
      // In development, allow through without verification.
      if (process.env.NODE_ENV === "production") {
        log.warn({ source }, "No webhook secret configured for source — rejecting")
        return NextResponse.json({ error: "Webhook source not configured" }, { status: 400 })
      }
      log.warn({ source }, "No webhook secret configured (dev mode) — allowing through")
    }

    // Verify the webhook signature.
    if (secret) {
      const verification = verifyIncomingWebhookWithFreshness(secret, body, signature, timestamp)
      if (!verification.valid) {
        log.warn({ source, reason: verification.reason }, "Incoming webhook rejected")
        return NextResponse.json({ error: verification.reason }, { status: 401 })
      }
    }

    // Parse the payload.
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(body)
    } catch {
      log.warn({ source }, "Incoming webhook rejected: invalid JSON")
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
    }

    // Process the incoming webhook based on source.
    // This is where you'd route to specific handlers for each platform.
    const result = await processIncomingWebhook(source, payload)

    log.info({ source, result }, "Incoming webhook processed successfully")
    return NextResponse.json({ received: true, processed: result })
  } catch (err) {
    log.error({ err }, "Failed to process incoming webhook")
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

/**
 * Route an incoming webhook to the appropriate handler.
 */
async function processIncomingWebhook(
  source: string,
  payload: Record<string, unknown>
): Promise<string> {
  switch (source.toLowerCase()) {
    case "careem":
    case "uber":
    case "hungerstation":
    case "jahez":
    case "talabat":
      return processDeliveryPlatformWebhook(source, payload)

    case "zatca":
      return processZatcaWebhook(payload)

    case "payment":
    case "moyasar":
    case "tap":
      return processPaymentWebhook(source, payload)

    default:
      log.info({ source }, "Unknown webhook source — stored but not processed")
      return "received"
  }
}

/**
 * Process a delivery platform webhook (order updates, payment confirmations, etc.).
 */
async function processDeliveryPlatformWebhook(
  platform: string,
  payload: Record<string, unknown>
): Promise<string> {
  log.info({ platform, eventType: payload.event_type }, "Processing delivery platform webhook")

  // TODO: Implement platform-specific webhook processing.
  // Examples:
  //   - Order status updates (completed, cancelled, etc.)
  //   - Payment confirmations
  //   - Driver assignment changes
  //
  // Implementation would typically:
  //   1. Map the platform event to an EliteDev event type.
  //   2. Look up the related driver/order in the database.
  //   3. Update the database.
  //   4. Emit an EliteDev webhook event for subscribers.

  return "processed"
}

/**
 * Process a ZATCA (Saudi tax authority) webhook.
 */
async function processZatcaWebhook(payload: Record<string, unknown>): Promise<string> {
  log.info({ eventType: payload.event_type }, "Processing ZATCA webhook")

  // TODO: Implement ZATCA webhook processing.
  // Examples:
  //   - Invoice clearance status updates
  //   - Reporting notifications
  //   - Compliance alerts

  return "processed"
}

/**
 * Process a payment gateway webhook.
 */
async function processPaymentWebhook(
  gateway: string,
  payload: Record<string, unknown>
): Promise<string> {
  log.info({ gateway, eventType: payload.event_type }, "Processing payment webhook")

  // TODO: Implement payment webhook processing.
  // Examples:
  //   - Payment success/failure notifications
  //   - Refund confirmations
  //   - Subscription status changes

  return "processed"
}
