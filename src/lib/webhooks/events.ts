// Webhook event bus — the single entry point for emitting domain events.
//
// This module provides `emit()` which:
//   1. Validates the event type against the registered list.
//   2. Fires the event asynchronously via the dispatcher.
//   3. Optionally logs the event to a structured audit trail.
//
// Usage in server actions:
//   ```ts
//   import { emit } from "@/lib/webhooks/events"
//
//   // After a successful DB insert/update/delete:
//   emit("driver.created", currentUser.tenantId, {
//     id: driver.id,
//     name: driver.name,
//     code: driver.code,
//     status: driver.status,
//   })
//   ```
//
// The `emit()` call is fire-and-forget — it does NOT block the response.
// Failures are logged but never propagated to the caller.

import { logger } from "@/lib/logger"
import { emitWebhookEvent } from "./dispatcher"
import type { WebhookEventType, WebhookEventPayloads } from "./types"

const log = logger.child({ module: "webhooks/events" })

/** All valid event types (runtime check). */
const VALID_EVENT_TYPES = new Set<string>([
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

/**
 * Emit a domain event to all subscribed webhooks.
 *
 * This function is fire-and-forget — it spawns an async dispatch
 * that runs in the background. The caller's response is never delayed.
 *
 * @param eventType  The event type (e.g. "driver.created").
 * @param tenantId   The tenant/org that owns this event.
 * @param payload    The event payload (varies by event type).
 */
export function emit<T extends WebhookEventType>(
  eventType: T,
  tenantId: string,
  payload: WebhookEventPayloads[T]
): void {
  // Validate event type at runtime.
  if (!VALID_EVENT_TYPES.has(eventType)) {
    log.warn({ eventType, tenantId }, "Unknown webhook event type — ignoring")
    return
  }

  // Fire-and-forget: dispatch asynchronously.
  // We intentionally do NOT await. Errors are caught inside the dispatcher.
  emitWebhookEvent({
    tenantId,
    eventType,
    payload: payload as Record<string, unknown>,
  }).catch((err) => {
    log.error({ err, eventType, tenantId }, "Unhandled error in webhook dispatch")
  })
}

/**
 * Check if an event type is valid.
 */
export function isValidEventType(eventType: string): eventType is WebhookEventType {
  return VALID_EVENT_TYPES.has(eventType)
}

/**
 * Get all supported event types.
 */
export function getSupportedEventTypes(): WebhookEventType[] {
  return Array.from(VALID_EVENT_TYPES) as WebhookEventType[]
}
