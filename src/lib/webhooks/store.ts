// Webhook CRUD operations against the Supabase database.
//
// Uses the admin client (service-role) for webhook management because
// webhook registrations are tenant-level configuration. The functions
// verify the caller's tenant ID to prevent cross-tenant access.
//
// Database tables required:
//   - webhook_registrations (id, tenant_id, name, url, events, secret, is_active, ...)
//   - webhook_deliveries (id, webhook_id, event_type, payload, status, attempts, ...)

import { createAdminClient } from "@/lib/supabase/admin"
import { moduleLogger } from "@/lib/logger"
import {
  type WebhookRegistration,
  type WebhookDelivery,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookEventType,
  type WebhookDeliveryStatus,
  MAX_DELIVERY_ATTEMPTS,
  DEFAULT_RETRY_DELAYS,
} from "./types"

const log = moduleLogger("webhooks")

// ── Helpers ────────────────────────────────────────────────────────────────

function generateSecret(): string {
  const bytes = new Uint8Array(32)
  // Node 19+ has globalThis.crypto; older Node uses require("crypto").randomBytes
  if (typeof globalThis.crypto !== "undefined") {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("crypto").randomBytes(32).copy(Buffer.from(bytes))
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function mapRegistration(row: Record<string, unknown>): WebhookRegistration {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    url: row.url as string,
    events: (row.events as WebhookEventType[]) ?? [],
    secret: row.secret as string,
    isActive: row.is_active as boolean,
    description: (row.description as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function mapDelivery(row: Record<string, unknown>): WebhookDelivery {
  return {
    id: row.id as string,
    webhookId: row.webhook_id as string,
    eventType: row.event_type as WebhookEventType,
    payload: row.payload as string,
    statusCode: row.status_code as number | null,
    responseBody: row.response_body as string | null,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts as number,
    maxAttempts: (row.max_attempts as number) ?? MAX_DELIVERY_ATTEMPTS,
    nextRetryAt: row.next_retry_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

// ── Registration CRUD ──────────────────────────────────────────────────────

/**
 * List all webhook registrations for a tenant.
 */
export async function listWebhooks(tenantId: string): Promise<WebhookRegistration[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("webhook_registrations")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })

  if (error) {
    log.error({ err: error, tenantId }, "Failed to list webhook registrations")
    return []
  }
  return (data ?? []).map(mapRegistration)
}

/**
 * Get a single webhook registration by ID, scoped to tenant.
 */
export async function getWebhook(
  tenantId: string,
  webhookId: string
): Promise<WebhookRegistration | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("webhook_registrations")
    .select("*")
    .eq("id", webhookId)
    .eq("tenant_id", tenantId)
    .single()

  if (error || !data) return null
  return mapRegistration(data)
}

/**
 * Create a new webhook registration.
 */
export async function createWebhook(
  tenantId: string,
  input: CreateWebhookInput
): Promise<{ webhook: WebhookRegistration | null; error?: string }> {
  const admin = createAdminClient()
  const secret = generateSecret()

  const { data, error } = await admin
    .from("webhook_registrations")
    .insert({
      tenant_id: tenantId,
      name: input.name,
      url: input.url,
      events: input.events ?? [],
      secret,
      is_active: true,
      description: input.description ?? null,
    })
    .select()
    .single()

  if (error) {
    log.error({ err: error, tenantId }, "Failed to create webhook registration")
    return { webhook: null, error: error.message }
  }

  log.info({ webhookId: data.id, tenantId, name: input.name }, "Webhook registration created")
  return { webhook: mapRegistration(data) }
}

/**
 * Update an existing webhook registration.
 */
export async function updateWebhook(
  tenantId: string,
  webhookId: string,
  input: UpdateWebhookInput
): Promise<{ webhook: WebhookRegistration | null; error?: string }> {
  const admin = createAdminClient()

  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.url !== undefined) updates.url = input.url
  if (input.events !== undefined) updates.events = input.events
  if (input.isActive !== undefined) updates.is_active = input.isActive
  if (input.description !== undefined) updates.description = input.description
  updates.updated_at = new Date().toISOString()

  const { data, error } = await admin
    .from("webhook_registrations")
    .update(updates)
    .eq("id", webhookId)
    .eq("tenant_id", tenantId)
    .select()
    .single()

  if (error) {
    log.error({ err: error, tenantId, webhookId }, "Failed to update webhook registration")
    return { webhook: null, error: error.message }
  }

  log.info({ webhookId, tenantId }, "Webhook registration updated")
  return { webhook: mapRegistration(data) }
}

/**
 * Delete a webhook registration and its delivery history.
 */
export async function deleteWebhook(
  tenantId: string,
  webhookId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = createAdminClient()

  // Delete deliveries first (child rows)
  await admin.from("webhook_deliveries").delete().eq("webhook_id", webhookId)

  const { error } = await admin
    .from("webhook_registrations")
    .delete()
    .eq("id", webhookId)
    .eq("tenant_id", tenantId)

  if (error) {
    log.error({ err: error, tenantId, webhookId }, "Failed to delete webhook registration")
    return { success: false, error: error.message }
  }

  log.info({ webhookId, tenantId }, "Webhook registration deleted")
  return { success: true }
}

/**
 * Regenerate the secret for a webhook registration.
 */
export async function regenerateWebhookSecret(
  tenantId: string,
  webhookId: string
): Promise<{ secret: string | null; error?: string }> {
  const admin = createAdminClient()
  const secret = generateSecret()

  const { error } = await admin
    .from("webhook_registrations")
    .update({ secret, updated_at: new Date().toISOString() })
    .eq("id", webhookId)
    .eq("tenant_id", tenantId)

  if (error) {
    log.error({ err: error, tenantId, webhookId }, "Failed to regenerate webhook secret")
    return { secret: null, error: error.message }
  }

  log.info({ webhookId, tenantId }, "Webhook secret regenerated")
  return { secret }
}

// ── Delivery CRUD ──────────────────────────────────────────────────────────

/**
 * Get all active webhooks for a tenant that are subscribed to the given event type.
 * Returns webhooks where `events` is empty (all events) or contains the event type.
 */
export async function getWebhooksForEvent(
  tenantId: string,
  eventType: WebhookEventType
): Promise<WebhookRegistration[]> {
  const admin = createAdminClient()

  // Fetch active webhooks for this tenant.
  // PostgREST doesn't support array-contains-OR-empty natively, so we
  // fetch all active webhooks and filter in JS. This is fine because the
  // number of webhooks per tenant is typically small (<50).
  const { data, error } = await admin
    .from("webhook_registrations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)

  if (error || !data) return []

  return data
    .map(mapRegistration)
    .filter((wh) => wh.events.length === 0 || wh.events.includes(eventType))
}

/**
 * Create a delivery record for a pending webhook event.
 */
export async function createDelivery(
  webhookId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>
): Promise<WebhookDelivery | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("webhook_deliveries")
    .insert({
      webhook_id: webhookId,
      event_type: eventType,
      payload: JSON.stringify(payload),
      status: "pending",
      attempts: 0,
      max_attempts: MAX_DELIVERY_ATTEMPTS,
    })
    .select()
    .single()

  if (error) {
    log.error({ err: error, webhookId, eventType }, "Failed to create webhook delivery")
    return null
  }
  return mapDelivery(data)
}

/**
 * Update a delivery record after an attempt.
 */
export async function updateDelivery(
  deliveryId: string,
  update: {
    status?: WebhookDeliveryStatus
    statusCode?: number
    responseBody?: string
    attempts?: number
    nextRetryAt?: string | null
  }
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from("webhook_deliveries")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", deliveryId)

  if (error) {
    log.error({ err: error, deliveryId }, "Failed to update webhook delivery")
  }
}

/**
 * Get deliveries pending retry (where nextRetryAt is in the past).
 */
export async function getPendingRetries(limit = 50): Promise<WebhookDelivery[]> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from("webhook_deliveries")
    .select("*")
    .eq("status", "retrying")
    .lte("next_retry_at", now)
    .lt("attempts", MAX_DELIVERY_ATTEMPTS)
    .order("next_retry_at", { ascending: true })
    .limit(limit)

  if (error || !data) return []
  return data.map(mapDelivery)
}

/**
 * Calculate the next retry time using exponential backoff.
 */
export function calculateNextRetryAt(attemptNumber: number): string | null {
  if (attemptNumber >= DEFAULT_RETRY_DELAYS.length) return null
  const delayMs = DEFAULT_RETRY_DELAYS[attemptNumber] * 1000
  return new Date(Date.now() + delayMs).toISOString()
}

/**
 * Get delivery statistics for a webhook.
 */
export async function getDeliveryStats(
  webhookId: string
): Promise<{
  total: number
  success: number
  failed: number
  pending: number
  retrying: number
}> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("webhook_deliveries")
    .select("status")
    .eq("webhook_id", webhookId)

  if (error || !data) return { total: 0, success: 0, failed: 0, pending: 0, retrying: 0 }

  const stats = { total: data.length, success: 0, failed: 0, pending: 0, retrying: 0 }
  for (const row of data) {
    const status = row.status as WebhookDeliveryStatus
    if (status in stats) {
      stats[status as keyof typeof stats]++
    }
  }
  return stats
}

/**
 * Clean up old delivery records (older than retention days).
 */
export async function cleanOldDeliveries(retentionDays = 30): Promise<number> {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString()

  const { data, error } = await admin
    .from("webhook_deliveries")
    .delete()
    .lt("created_at", cutoff)
    .select("id")

  if (error) {
    log.error({ err: error }, "Failed to clean old webhook deliveries")
    return 0
  }
  return data?.length ?? 0
}
