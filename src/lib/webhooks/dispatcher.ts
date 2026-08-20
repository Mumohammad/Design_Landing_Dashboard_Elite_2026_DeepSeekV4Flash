// Webhook dispatcher — sends domain events to registered webhook endpoints.
//
// Architecture:
//   1. A domain action calls `emitWebhookEvent()` (fire-and-forget).
//   2. The dispatcher fetches all active webhooks for the tenant subscribed
//      to that event type.
//   3. For each webhook, it creates a delivery record and POSTs the event
//      payload with an HMAC-SHA256 signature header.
//   4. On failure, the delivery is marked for retry with exponential backoff.
//   5. A `processRetries()` function can be called from a cron job or
//      background worker to re-deliver failed webhooks.
//
// Signature verification:
//   The `X-Webhook-Signature` header contains `sha256=<hex-digest>`.
//   Recipients compute `HMAC-SHA256(secret, body)` and compare.

import crypto from "crypto"
import { moduleLogger, logPerformance } from "@/lib/logger"
import {
  type WebhookEvent,
  type WebhookEventType,
  type WebhookRegistration,
  type DispatchEventInput,
  type WebhookDelivery,
  WEBHOOK_SIGNATURE_PREFIX,
  WEBHOOK_TIMEOUT_MS,
} from "./types"
import {
  getWebhooksForEvent,
  createDelivery,
  updateDelivery,
  getPendingRetries,
  calculateNextRetryAt,
} from "./store"

const log = moduleLogger("webhooks/dispatcher")

// ── Event Emission ─────────────────────────────────────────────────────────

/**
 * Emit a domain event to all subscribed webhooks for a tenant.
 *
 * This is designed to be called from server actions after a successful
 * database operation. It runs asynchronously and does NOT block the caller.
 *
 * Usage in a server action:
 *   ```ts
 *   await emitWebhookEvent({
 *     tenantId: currentUser.tenantId,
 *     eventType: "driver.created",
 *     payload: { id: driver.id, name: driver.name, code: driver.code, status: driver.status },
 *   })
 *   ```
 */
export async function emitWebhookEvent(input: DispatchEventInput): Promise<void> {
  const startTime = Date.now()

  try {
    const event: WebhookEvent = {
      id: crypto.randomUUID(),
      type: input.eventType,
      timestamp: new Date().toISOString(),
      tenantId: input.tenantId,
      data: input.payload,
    }

    // Find all active webhooks subscribed to this event.
    const webhooks = await getWebhooksForEvent(input.tenantId, input.eventType)

    if (webhooks.length === 0) {
      log.debug({ eventType: input.eventType, tenantId: input.tenantId }, "No webhooks subscribed")
      return
    }

    log.info(
      {
        eventType: input.eventType,
        tenantId: input.tenantId,
        webhookCount: webhooks.length,
        eventId: event.id,
      },
      `Dispatching ${input.eventType} to ${webhooks.length} webhook(s)`
    )

    // Dispatch to all webhooks in parallel (fire-and-forget).
    const results = await Promise.allSettled(
      webhooks.map((wh) => deliverEvent(wh, event))
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.length - succeeded

    log.info(
      { eventType: input.eventType, tenantId: input.tenantId, succeeded, failed },
      `Webhook dispatch complete: ${succeeded} succeeded, ${failed} failed`
    )

    logPerformance("webhook.dispatch", Date.now() - startTime, {
      eventType: input.eventType,
      webhookCount: webhooks.length,
      succeeded,
      failed,
    })
  } catch (err) {
    log.error({ err, eventType: input.eventType, tenantId: input.tenantId }, "Webhook dispatch failed")
  }
}

// ── Delivery ───────────────────────────────────────────────────────────────

/**
 * Deliver a single webhook event to a specific endpoint.
 * Creates a delivery record and attempts the HTTP POST.
 */
async function deliverEvent(
  webhook: WebhookRegistration,
  event: WebhookEvent
): Promise<void> {
  // Create a delivery record.
  const delivery = await createDelivery(webhook.id, event.type, event as unknown as Record<string, unknown>)
  if (!delivery) {
    log.error({ webhookId: webhook.id, eventId: event.id }, "Failed to create delivery record")
    return
  }

  await attemptDelivery(webhook, delivery, event)
}

/**
 * Attempt an HTTP POST to the webhook endpoint.
 */
async function attemptDelivery(
  webhook: WebhookRegistration,
  delivery: WebhookDelivery,
  event: WebhookEvent
): Promise<void> {
  const startTime = Date.now()

  try {
    // Compute HMAC-SHA256 signature.
    const body = JSON.stringify(event)
    const signature = computeSignature(webhook.secret, body)

    // Prepare the HTTP request.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Id": webhook.id,
        "X-Webhook-Event": event.type,
        "X-Webhook-Signature": `${WEBHOOK_SIGNATURE_PREFIX}${signature}`,
        "X-Webhook-Timestamp": event.timestamp,
        "User-Agent": "EliteDev-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const responseBody = await response.text().catch(() => "")
    const durationMs = Date.now() - startTime

    if (response.ok) {
      // Success — mark delivery as completed.
      await updateDelivery(delivery.id, {
        status: "success",
        statusCode: response.status,
        responseBody: responseBody.slice(0, 1000), // Truncate long responses
        attempts: delivery.attempts + 1,
      })

      log.info(
        {
          webhookId: webhook.id,
          deliveryId: delivery.id,
          eventType: event.type,
          statusCode: response.status,
          durationMs,
        },
        "Webhook delivered successfully"
      )
    } else {
      // Non-2xx response — schedule retry.
      log.warn(
        {
          webhookId: webhook.id,
          deliveryId: delivery.id,
          eventType: event.type,
          statusCode: response.status,
          responseBody: responseBody.slice(0, 500),
        },
        `Webhook delivery returned ${response.status}`
      )

      await scheduleRetry(delivery, webhook, event, response.status, responseBody)
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const isTimeout = err instanceof Error && err.name === "AbortError"

    log.error(
      {
        err,
        webhookId: webhook.id,
        deliveryId: delivery.id,
        eventType: event.type,
        durationMs,
        isTimeout,
      },
      `Webhook delivery failed: ${isTimeout ? "timeout" : err instanceof Error ? err.message : "unknown"}`
    )

    await scheduleRetry(delivery, webhook, event, 0, isTimeout ? "timeout" : String(err))
  }
}

/**
 * Schedule a retry for a failed delivery using exponential backoff.
 */
async function scheduleRetry(
  delivery: WebhookDelivery,
  webhook: WebhookRegistration,
  event: WebhookEvent,
  statusCode: number,
  responseBody: string
): Promise<void> {
  const newAttempts = delivery.attempts + 1
  const nextRetryAt = calculateNextRetryAt(delivery.attempts)

  if (!nextRetryAt || newAttempts >= delivery.maxAttempts) {
    // Exhausted all retries — mark as permanently failed.
    await updateDelivery(delivery.id, {
      status: "failed",
      statusCode,
      responseBody: responseBody.slice(0, 1000),
      attempts: newAttempts,
      nextRetryAt: null,
    })

    log.error(
      {
        webhookId: webhook.id,
        deliveryId: delivery.id,
        eventType: event.type,
        attempts: newAttempts,
      },
      "Webhook delivery permanently failed after max retries"
    )
  } else {
    // Schedule next retry.
    await updateDelivery(delivery.id, {
      status: "retrying",
      statusCode,
      responseBody: responseBody.slice(0, 1000),
      attempts: newAttempts,
      nextRetryAt,
    })

    log.info(
      {
        webhookId: webhook.id,
        deliveryId: delivery.id,
        eventType: event.type,
        attempt: newAttempts,
        nextRetryAt,
      },
      `Webhook delivery scheduled for retry #${newAttempts}`
    )
  }
}

// ── Retry Processing ───────────────────────────────────────────────────────

/**
 * Process all pending webhook retries.
 *
 * This function should be called periodically by a cron job or background
 * worker (e.g., every 5 minutes via Vercel Cron, Inngest, or a simple
 * setInterval in a long-running process).
 *
 * Example cron configuration (vercel.json):
 *   vercel.json: crons -> path: /api/webhooks/cron, schedule: every 5 minutes
 */
export async function processRetries(): Promise<{
  processed: number
  succeeded: number
  failed: number
}> {
  const startTime = Date.now()
  const pendingRetries = await getPendingRetries(50)

  if (pendingRetries.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 }
  }

  log.info({ count: pendingRetries.length }, "Processing pending webhook retries")

  let succeeded = 0
  let failed = 0

  // Group deliveries by webhook to fetch webhook details once.
  const webhookIds = new Set(pendingRetries.map((d) => d.webhookId))
  const webhookCache = new Map<string, WebhookRegistration>()

  // Fetch webhook details for each unique webhook.
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const admin = createAdminClient()

  for (const whId of webhookIds) {
    const { data } = await admin
      .from("webhook_registrations")
      .select("*")
      .eq("id", whId)
      .single()
    if (data) {
      webhookCache.set(whId, data as unknown as WebhookRegistration)
    }
  }

  // Process each retry.
  const results = await Promise.allSettled(
    pendingRetries.map(async (delivery) => {
      const webhook = webhookCache.get(delivery.webhookId)
      if (!webhook || !webhook.isActive) {
        await updateDelivery(delivery.id, { status: "failed" })
        return false
      }

      const event: WebhookEvent = JSON.parse(delivery.payload)
      await attemptDelivery(webhook, delivery, event)

      // Check if delivery succeeded after the attempt.
      const { data: updated } = await admin
        .from("webhook_deliveries")
        .select("status")
        .eq("id", delivery.id)
        .single()

      return (updated?.status as string) === "success"
    })
  )

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) succeeded++
    else failed++
  }

  logPerformance("webhook.retry", Date.now() - startTime, {
    processed: pendingRetries.length,
    succeeded,
    failed,
  })

  return { processed: pendingRetries.length, succeeded, failed }
}

// ── Signature Utilities ────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 signature for a webhook payload.
 *
 * @param secret   The webhook's signing secret.
 * @param payload  The raw JSON string that was sent.
 * @returns Hex-encoded signature.
 */
export function computeSignature(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

/**
 * Verify a webhook signature.
 *
 * Use this in incoming webhook handlers to verify that the request
 * came from EliteDev and was not tampered with.
 *
 * @param secret      The webhook's signing secret.
 * @param payload     The raw request body.
 * @param signature   The value of the X-Webhook-Signature header.
 * @returns true if the signature is valid.
 */
export function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = `${WEBHOOK_SIGNATURE_PREFIX}${computeSignature(secret, payload)}`
  // Constant-time comparison to prevent timing attacks.
  if (expected.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

/**
 * Generate a new webhook signing secret.
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex")
}
