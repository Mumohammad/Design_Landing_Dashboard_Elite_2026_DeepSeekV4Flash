// Server actions for webhook management.
//
// These actions are used by the webhook settings UI to allow admins
// to register, update, and manage webhook subscriptions.
//
// All actions require the "settings.manage" permission.

"use server"

import { getCurrentUser } from "@/lib/auth/authorization"
import { requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitSettings, getClientIp } from "@/lib/auth/rate-limit"
import { RateLimitError } from "@/lib/auth/rate-limit"
import { handleError } from "@/lib/errors"
import { moduleLogger } from "@/lib/logger"
import {
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookEventType,
} from "./types"
import {
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  regenerateWebhookSecret,
  getDeliveryStats,
} from "./store"
import { processRetries } from "./dispatcher"

const log = moduleLogger("webhooks/actions")

// ── Webhook CRUD ───────────────────────────────────────────────────────────

/**
 * List all webhook registrations for the current tenant.
 */
export async function listWebhookRegistrations(): Promise<
  { success: true; data: Awaited<ReturnType<typeof listWebhooks>> } |
  { success: false; error?: string }
> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) throw new RateLimitError(rl.resetAt, 10)

    const webhooks = await listWebhooks(currentUser.tenantId)
    return { success: true, data: webhooks }
  } catch (e) {
    const err = handleError(e)
    return { success: false, error: err.message_en }
  }
}

/**
 * Get a single webhook registration with delivery stats.
 */
export async function getWebhookRegistration(webhookId: string): Promise<
  { success: true; data: { webhook: Awaited<ReturnType<typeof getWebhook>>; stats: Awaited<ReturnType<typeof getDeliveryStats>> } } |
  { success: false; error?: string }
> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) throw new RateLimitError(rl.resetAt, 10)

    const webhook = await getWebhook(currentUser.tenantId, webhookId)
    if (!webhook) return { success: false, error: "Webhook not found." }

    const stats = await getDeliveryStats(webhookId)
    return { success: true, data: { webhook, stats } }
  } catch (e) {
    const err = handleError(e)
    return { success: false, error: err.message_en }
  }
}

/**
 * Create a new webhook registration.
 */
export async function createWebhookRegistration(input: CreateWebhookInput): Promise<
  { success: true; data: Awaited<ReturnType<typeof createWebhook>>["webhook"]; secret: string } |
  { success: false; error?: string }
> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    await requirePermission("settings", "manage")
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) throw new RateLimitError(rl.resetAt, 10)

    // Validate URL.
    try {
      new URL(input.url)
    } catch {
      return { success: false, error: "Invalid webhook URL." }
    }

    // Validate event types.
    if (input.events) {
      for (const evt of input.events) {
        if (!isValidEventType(evt)) {
          return { success: false, error: `Invalid event type: ${evt}` }
        }
      }
    }

    const result = await createWebhook(currentUser.tenantId, input)
    if (!result.webhook) return { success: false, error: result.error }

    // Log audit trail.
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "webhooks",
      action: "created",
      entityType: "webhook_registration",
      entityId: result.webhook.id,
      newValues: { name: input.name, url: input.url, events: input.events },
      ipAddress: await getClientIp(),
    })

    log.info({ webhookId: result.webhook.id, tenantId: currentUser.tenantId }, "Webhook registration created")

    // Return the secret only on creation — it won't be retrievable later.
    return { success: true, data: result.webhook, secret: result.webhook.secret }
  } catch (e) {
    const err = handleError(e)
    return { success: false, error: err.message_en }
  }
}

/**
 * Update a webhook registration.
 */
export async function updateWebhookRegistration(
  webhookId: string,
  input: UpdateWebhookInput
): Promise<
  { success: true; data: Awaited<ReturnType<typeof updateWebhook>>["webhook"] } |
  { success: false; error?: string }
> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    await requirePermission("settings", "manage")
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) throw new RateLimitError(rl.resetAt, 10)

    // Validate URL if provided.
    if (input.url) {
      try {
        new URL(input.url)
      } catch {
        return { success: false, error: "Invalid webhook URL." }
      }
    }

    // Validate event types if provided.
    if (input.events) {
      for (const evt of input.events) {
        if (!isValidEventType(evt)) {
          return { success: false, error: `Invalid event type: ${evt}` }
        }
      }
    }

    const result = await updateWebhook(currentUser.tenantId, webhookId, input)
    if (!result.webhook) return { success: false, error: result.error }

    // Log audit trail.
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "webhooks",
      action: "updated",
      entityType: "webhook_registration",
      entityId: webhookId,
      newValues: input as Record<string, unknown>,
      ipAddress: await getClientIp(),
    })

    log.info({ webhookId, tenantId: currentUser.tenantId }, "Webhook registration updated")
    return { success: true, data: result.webhook }
  } catch (e) {
    const err = handleError(e)
    return { success: false, error: err.message_en }
  }
}

/**
 * Delete a webhook registration.
 */
export async function deleteWebhookRegistration(webhookId: string): Promise<
  { success: true } | { success: false; error?: string }
> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    await requirePermission("settings", "manage")
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) throw new RateLimitError(rl.resetAt, 10)

    const result = await deleteWebhook(currentUser.tenantId, webhookId)
    if (!result.success) return { success: false, error: result.error }

    // Log audit trail.
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "webhooks",
      action: "deleted",
      entityType: "webhook_registration",
      entityId: webhookId,
      ipAddress: await getClientIp(),
    })

    log.info({ webhookId, tenantId: currentUser.tenantId }, "Webhook registration deleted")
    return { success: true }
  } catch (e) {
    const err = handleError(e)
    return { success: false, error: err.message_en }
  }
}

/**
 * Regenerate the signing secret for a webhook registration.
 */
export async function regenerateWebhookSecretAction(webhookId: string): Promise<
  { success: true; secret: string } | { success: false; error?: string }
> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    await requirePermission("settings", "manage")
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) throw new RateLimitError(rl.resetAt, 10)

    const result = await regenerateWebhookSecret(currentUser.tenantId, webhookId)
    if (!result.secret) return { success: false, error: result.error }

    // Log audit trail (secret itself is NOT logged).
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "webhooks",
      action: "secret_regenerated",
      entityType: "webhook_registration",
      entityId: webhookId,
      ipAddress: await getClientIp(),
    })

    log.info({ webhookId, tenantId: currentUser.tenantId }, "Webhook secret regenerated")
    return { success: true, secret: result.secret }
  } catch (e) {
    const err = handleError(e)
    return { success: false, error: err.message_en }
  }
}

// ── Retry Management ───────────────────────────────────────────────────────

/**
 * Manually trigger retry processing for failed webhook deliveries.
 * Admin-only action.
 */
export async function triggerWebhookRetries(): Promise<
  { success: true; data: Awaited<ReturnType<typeof processRetries>> } |
  { success: false; error?: string }
> {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    await requirePermission("settings", "manage")

    const result = await processRetries()
    log.info(
      { tenantId: currentUser.tenantId, ...result },
      "Webhook retries processed"
    )
    return { success: true, data: result }
  } catch (e) {
    const err = handleError(e)
    return { success: false, error: err.message_en }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Runtime check for valid event types. */
function isValidEventType(eventType: string): boolean {
  const VALID = new Set<string>([
    "driver.created", "driver.updated", "driver.deleted", "driver.status_changed",
    "vehicle.created", "vehicle.updated", "vehicle.assigned", "vehicle.unassigned",
    "payroll.calculated", "payroll.approved", "payroll.cancelled", "payroll.exported",
    "expense.created", "expense.approved", "expense.rejected",
    "invoice.created", "invoice.updated", "invoice.finalized", "invoice.cancelled",
    "journal_entry.created", "journal_entry.submitted", "journal_entry.approved",
    "journal_entry.rejected", "period.closed",
    "violation.created", "violation.resolved",
    "document.uploaded", "document.deleted", "document.expiring",
    "attendance.checked_in", "attendance.checked_out",
    "order.created", "order.completed", "order.cancelled",
    "application.submitted", "application.approved", "application.rejected",
    "settings.company_updated", "settings.system_updated",
    "user.invited", "user.activated", "user.deactivated", "user.role_changed",
    "notification.document_expiry", "notification.maintenance_due",
  ])
  return VALID.has(eventType)
}
