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

import { integrationAvailable, INTEGRATION_UNAVAILABLE } from "@/lib/release/integrations"
import crypto from "crypto"
import { moduleLogger, logPerformance } from "@/lib/logger"
import {
  type WebhookEvent,
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
import { assertSafeWebhookUrl } from "./url-guard"

const log = moduleLogger("webhooks/dispatcher")

/** Redirect hops followed per delivery — every hop is SSRF-re-validated. */
const MAX_REDIRECT_HOPS = 3

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
  if (!integrationAvailable("webhooks")) return
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
    // SSRF guard at DELIVERY time (audit H3): the registration-time check is
    // not enough — DNS records can change between registration and delivery
    // (a public domain can start resolving to 169.254.169.254). A blocked
    // URL is a policy violation, not a transient failure: mark the delivery
    // permanently failed instead of scheduling retries.
    const startVerdict = await assertSafeWebhookUrl(webhook.url)
    if (!startVerdict.ok) {
      log.error(
        { webhookId: webhook.id, deliveryId: delivery.id, reason: startVerdict.reason },
        "Webhook URL blocked by SSRF guard"
      )
      await updateDelivery(delivery.id, {
        status: "failed",
        statusCode: 0,
        responseBody: `Blocked by SSRF guard: ${startVerdict.reason}`.slice(0, 1000),
        attempts: delivery.attempts + 1,
        nextRetryAt: null,
      })
      return
    }

    // Compute HMAC-SHA256 signature.
    const body = JSON.stringify(event)
    const signature = computeSignature(webhook.secret, body)

    const headers = {
      "Content-Type": "application/json",
      "X-Webhook-Id": webhook.id,
      "X-Webhook-Event": event.type,
      "X-Webhook-Signature": `${WEBHOOK_SIGNATURE_PREFIX}${signature}`,
      "X-Webhook-Timestamp": event.timestamp,
      "User-Agent": "EliteDev-Webhook/1.0",
    }

    // Never follow redirects blindly: `redirect: "manual"` + re-validate
    // every followed Location hop through the SSRF guard (a public URL can
    // 302 into the cloud metadata endpoint). Only method-preserving 307/308
    // hops are followed — the signed POST body must never be replayed as a
    // GET (301/302/303 semantics); those come back as the final response and
    // are handled as a normal non-2xx failure below. The timeout budget
    // covers all hops.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

    let post: GuardedPostResult
    try {
      post = await postFollowingRedirects(startVerdict.url, headers, body, controller.signal)
    } finally {
      clearTimeout(timeout)
    }

    if (post.kind === "blocked") {
      log.error(
        { webhookId: webhook.id, deliveryId: delivery.id, reason: post.reason },
        "Webhook redirect blocked by SSRF guard"
      )
      await updateDelivery(delivery.id, {
        status: "failed",
        statusCode: 0,
        responseBody: `Blocked by SSRF guard: ${post.reason}`.slice(0, 1000),
        attempts: delivery.attempts + 1,
        nextRetryAt: null,
      })
      return
    }

    const response = post.response

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

type GuardedPostResult =
  | { kind: "response"; response: Response }
  | { kind: "blocked"; reason: string }

/** 3xx statuses that preserve method+body (the only hops we follow). */
const METHOD_PRESERVING_REDIRECTS = new Set([307, 308])

/**
 * POST with redirects handled MANUALLY: only method-preserving 307/308 hops
 * are followed, and every Location target is resolved and re-validated
 * through the SSRF guard before the next request is sent. Any other status
 * (including 301/302/303) is returned as the final response so the caller
 * treats it as a normal delivery outcome — the signed POST is never replayed
 * as a GET, and never lands on an unvalidated host.
 */
export async function postFollowingRedirects(
  startUrl: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal
): Promise<GuardedPostResult> {
  let currentUrl = startUrl

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const response = await fetch(currentUrl, {
      method: "POST",
      headers,
      body,
      signal,
      redirect: "manual",
    })

    if (!METHOD_PRESERVING_REDIRECTS.has(response.status) || hop === MAX_REDIRECT_HOPS) {
      return { kind: "response", response }
    }

    const location = response.headers.get("location")
    if (!location) return { kind: "response", response }

    const nextUrl = new URL(location, currentUrl).toString()
    const verdict = await assertSafeWebhookUrl(nextUrl)
    if (!verdict.ok) {
      return { kind: "blocked", reason: `redirect to ${nextUrl}: ${verdict.reason}` }
    }

    currentUrl = verdict.url
  }

  // Unreachable (loop returns on the last hop).
  return { kind: "blocked", reason: "too many redirects" }
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
  if (!integrationAvailable("webhooks")) throw new Error(INTEGRATION_UNAVAILABLE)
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
