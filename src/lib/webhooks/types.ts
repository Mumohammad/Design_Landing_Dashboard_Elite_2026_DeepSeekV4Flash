// Webhook types for EliteDev external integrations.
//
// This module defines the schema for:
//   - Registered webhooks (subscriptions to events)
//   - Webhook deliveries (attempts to send events to subscribers)
//   - Domain events (what happened in the system)
//
// Reference: docs/final/FUTURE_EXPANSION_ROADMAP.md — Webhook Architecture
// Reference: docs/final/QUEUE_ARCHITECTURE.md — Async processing

// ── Domain Events ──────────────────────────────────────────────────────────
//
// Every significant domain action emits a WebhookEvent. The event type uses
// a `resource.action` format (e.g. "driver.created", "payroll.approved").
// This keeps event names stable and composable.

/** All supported domain event types. */
export type WebhookEventType =
  // Drivers
  | "driver.created"
  | "driver.updated"
  | "driver.deleted"
  | "driver.status_changed"
  // Vehicles
  | "vehicle.created"
  | "vehicle.updated"
  | "vehicle.assigned"
  | "vehicle.unassigned"
  // Payroll
  | "payroll.calculated"
  | "payroll.approved"
  | "payroll.cancelled"
  | "payroll.exported"
  // Expenses
  | "expense.created"
  | "expense.approved"
  | "expense.rejected"
  // Invoices
  | "invoice.created"
  | "invoice.updated"
  | "invoice.finalized"
  | "invoice.cancelled"
  // Accounting
  | "journal_entry.created"
  | "journal_entry.submitted"
  | "journal_entry.approved"
  | "journal_entry.rejected"
  | "period.closed"
  // Violations
  | "violation.created"
  | "violation.resolved"
  // Documents
  | "document.uploaded"
  | "document.deleted"
  | "document.expiring"
  // Attendance
  | "attendance.checked_in"
  | "attendance.checked_out"
  // Orders
  | "order.created"
  | "order.completed"
  | "order.cancelled"
  // Applications
  | "application.submitted"
  | "application.approved"
  | "application.rejected"
  // Settings
  | "settings.company_updated"
  | "settings.system_updated"
  // Users
  | "user.invited"
  | "user.activated"
  | "user.deactivated"
  | "user.role_changed"
  // Notifications
  | "notification.document_expiry"
  | "notification.maintenance_due"

/** The payload of a domain event sent to webhook subscribers. */
export interface WebhookEvent<T = Record<string, unknown>> {
  /** Unique event ID (for idempotency). */
  id: string
  /** Event type (e.g. "driver.created"). */
  type: WebhookEventType
  /** ISO-8601 timestamp. */
  timestamp: string
  /** The tenant/org that owns this event. */
  tenantId: string
  /** The event payload — varies by event type. */
  data: T
}

/** Typed event payloads for each event type. */
export interface WebhookEventPayloads {
  "driver.created": {
    id: string
    name: string
    code: string
    status: string
  }
  "driver.updated": {
    id: string
    name: string
    changes: Record<string, unknown>
  }
  "driver.deleted": {
    id: string
    name: string
  }
  "driver.status_changed": {
    id: string
    name: string
    previousStatus: string
    newStatus: string
  }
  "vehicle.created": {
    id: string
    name: string
    code: string
    plateNumber: string
  }
  "vehicle.updated": {
    id: string
    name: string
    changes: Record<string, unknown>
  }
  "vehicle.assigned": {
    vehicleId: string
    driverId: string
  }
  "vehicle.unassigned": {
    vehicleId: string
    driverId: string
  }
  "payroll.calculated": {
    id: string
    period: string
    totalAmount: number
    driverCount: number
  }
  "payroll.approved": {
    id: string
    period: string
    totalAmount: number
    approvedBy: string
  }
  "payroll.cancelled": {
    id: string
    period: string
  }
  "payroll.exported": {
    id: string
    period: string
    format: string
    recordCount: number
  }
  "expense.created": {
    id: string
    category: string
    amount: number
    driverId?: string
  }
  "expense.approved": {
    id: string
    amount: number
    approvedBy: string
  }
  "expense.rejected": {
    id: string
    amount: number
    rejectedBy: string
    reason?: string
  }
  "invoice.created": {
    id: string
    invoiceNumber: string
    totalAmount: number
    status: string
  }
  "invoice.updated": {
    id: string
    invoiceNumber: string
    changes: Record<string, unknown>
  }
  "invoice.finalized": {
    id: string
    invoiceNumber: string
    totalAmount: number
  }
  "invoice.cancelled": {
    id: string
    invoiceNumber: string
    reason?: string
  }
  "journal_entry.created": {
    id: string
    referenceNumber: string
    totalDebit: number
    totalCredit: number
  }
  "journal_entry.submitted": {
    id: string
    referenceNumber: string
  }
  "journal_entry.approved": {
    id: string
    referenceNumber: string
    approvedBy: string
  }
  "journal_entry.rejected": {
    id: string
    referenceNumber: string
    rejectedBy: string
    reason?: string
  }
  "period.closed": {
    id: string
    period: string
    closedBy: string
  }
  "violation.created": {
    id: string
    driverId: string
    type: string
    fineAmount?: number
  }
  "violation.resolved": {
    id: string
    driverId: string
    resolvedBy: string
  }
  "document.uploaded": {
    id: string
    documentType: string
    entityType: string
    entityId: string
  }
  "document.deleted": {
    id: string
    documentType: string
  }
  "document.expiring": {
    documentType: string
    entityType: string
    entityId: string
    expiryDate: string
    daysRemaining: number
  }
  "attendance.checked_in": {
    driverId: string
    timestamp: string
    method: string
  }
  "attendance.checked_out": {
    driverId: string
    timestamp: string
    hoursWorked?: number
  }
  "order.created": {
    id: string
    platform: string
    driverId: string
  }
  "order.completed": {
    id: string
    platform: string
    driverId: string
    revenue?: number
  }
  "order.cancelled": {
    id: string
    platform: string
    driverId: string
  }
  "application.submitted": {
    id: string
    applicantName: string
    type: string
  }
  "application.approved": {
    id: string
    applicantName: string
    reviewedBy: string
  }
  "application.rejected": {
    id: string
    applicantName: string
    reviewedBy: string
    reason?: string
  }
  "settings.company_updated": {
    changes: Record<string, unknown>
  }
  "settings.system_updated": {
    changes: Record<string, unknown>
  }
  "user.invited": {
    email: string
    role: string
  }
  "user.activated": {
    userId: string
    email: string
  }
  "user.deactivated": {
    userId: string
    email: string
  }
  "user.role_changed": {
    userId: string
    previousRole: string
    newRole: string
  }
  "notification.document_expiry": {
    documentType: string
    entityType: string
    entityId: string
    expiryDate: string
  }
  "notification.maintenance_due": {
    vehicleId: string
    maintenanceType: string
    dueDate: string
  }
}

// ── Webhook Registration ───────────────────────────────────────────────────

/** A registered webhook endpoint. */
export interface WebhookRegistration {
  id: string
  tenantId: string
  /** Human-readable name (e.g. "My Zapier hook"). */
  name: string
  /** The URL to POST events to. */
  url: string
  /** Events to subscribe to. Empty = all events. */
  events: WebhookEventType[]
  /** HMAC-SHA256 secret for signature verification. */
  secret: string
  /** Whether this webhook is active. */
  isActive: boolean
  /** Optional description. */
  description?: string
  /** ISO-8601. */
  createdAt: string
  /** ISO-8601. */
  updatedAt: string
}

/** Input for creating a webhook registration. */
export interface CreateWebhookInput {
  name: string
  url: string
  events?: WebhookEventType[]
  description?: string
}

/** Input for updating a webhook registration. */
export interface UpdateWebhookInput {
  name?: string
  url?: string
  events?: WebhookEventType[]
  isActive?: boolean
  description?: string
}

// ── Webhook Delivery ───────────────────────────────────────────────────────

/** Status of a webhook delivery attempt. */
export type WebhookDeliveryStatus = "pending" | "success" | "failed" | "retrying"

/** A single delivery attempt for a webhook event. */
export interface WebhookDelivery {
  id: string
  webhookId: string
  /** The event type that was delivered. */
  eventType: WebhookEventType
  /** The full event payload sent. */
  payload: string
  /** HTTP status code from the target (null if not yet attempted). */
  statusCode: number | null
  /** Response body from the target. */
  responseBody: string | null
  /** Delivery status. */
  status: WebhookDeliveryStatus
  /** Number of delivery attempts so far. */
  attempts: number
  /** Maximum retries allowed (default 5). */
  maxAttempts: number
  /** ISO-8601 — next retry time. */
  nextRetryAt: string | null
  /** ISO-8601. */
  createdAt: string
  /** ISO-8601. */
  updatedAt: string
}

/** Input for the webhook dispatcher. */
export interface DispatchEventInput {
  tenantId: string
  eventType: WebhookEventType
  payload: Record<string, unknown>
}

// ── Webhook Signature ──────────────────────────────────────────────────────

/** The signature header format: `sha256=<hex>`. */
export const WEBHOOK_SIGNATURE_PREFIX = "sha256="

/** All supported event categories for filtering. */
export const WEBHOOK_EVENT_CATEGORIES = [
  "drivers",
  "vehicles",
  "payroll",
  "expenses",
  "invoices",
  "accounting",
  "violations",
  "documents",
  "attendance",
  "orders",
  "applications",
  "settings",
  "users",
  "notifications",
] as const

export type WebhookEventCategory = (typeof WEBHOOK_EVENT_CATEGORIES)[number]

/**
 * Map event types to their categories.
 * Used for filtering webhooks by category.
 */
export const EVENT_CATEGORY_MAP: Record<WebhookEventCategory, WebhookEventType[]> = {
  drivers: ["driver.created", "driver.updated", "driver.deleted", "driver.status_changed"],
  vehicles: ["vehicle.created", "vehicle.updated", "vehicle.assigned", "vehicle.unassigned"],
  payroll: ["payroll.calculated", "payroll.approved", "payroll.cancelled", "payroll.exported"],
  expenses: ["expense.created", "expense.approved", "expense.rejected"],
  invoices: ["invoice.created", "invoice.updated", "invoice.finalized", "invoice.cancelled"],
  accounting: [
    "journal_entry.created",
    "journal_entry.submitted",
    "journal_entry.approved",
    "journal_entry.rejected",
    "period.closed",
  ],
  violations: ["violation.created", "violation.resolved"],
  documents: ["document.uploaded", "document.deleted", "document.expiring"],
  attendance: ["attendance.checked_in", "attendance.checked_out"],
  orders: ["order.created", "order.completed", "order.cancelled"],
  applications: ["application.submitted", "application.approved", "application.rejected"],
  settings: ["settings.company_updated", "settings.system_updated"],
  users: ["user.invited", "user.activated", "user.deactivated", "user.role_changed"],
  notifications: ["notification.document_expiry", "notification.maintenance_due"],
}

/** Default retry schedule: exponential backoff in seconds. */
export const DEFAULT_RETRY_DELAYS = [30, 120, 600, 1800, 7200] // 30s, 2m, 10m, 30m, 2h

/** Maximum delivery attempts. */
export const MAX_DELIVERY_ATTEMPTS = 5

/** HTTP timeout for webhook delivery (ms). */
export const WEBHOOK_TIMEOUT_MS = 10_000
