// Session helpers for the EliteDev Phase 2 application layer.
//
// - `getCurrentSession()` reads the Supabase session from the cookie-bound
//   server client.
// - `signOut()` clears the session cookie and redirects to /auth/sign-in.
// - `writeAuditLog()` inserts an immutable audit_log row via the service-role
//   admin client (audit_log INSERT is service-role-only — schema plan 6.5).
//
// Reference: docs/phase-2-auth-plan.md section 9 (Session management).
//
// Server-side only. `signOut` uses `redirect()` from `next/navigation`.

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { moduleLogger } from "@/lib/logger"

type SupabaseSession = {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at?: number
  user?: {
    id: string
    email?: string
  }
}

/**
 * Read the current Supabase session from the request cookies, or `null` when
 * the user is not signed in.
 *
 * NOTE: `getSession()` reads from the cookie and does NOT re-validate the JWT
 * server-side. For authorization decisions, use `getUser()` (via
 * `@/lib/auth/authorization`) — it validates the JWT against Supabase Auth.
 */
export async function getCurrentSession(): Promise<SupabaseSession | null> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session as SupabaseSession | null
}

/**
 * Sign the current user out and redirect to the sign-in page.
 *
 * `supabase.auth.signOut()` clears the `sb-*-auth-token` cookies (the SSR
 * client writes expired cookies back via `setAll`). There is no `returnTo` on
 * logout — the user is always sent to /auth/sign-in (auth plan 9.4).
 *
 * `redirect()` throws internally, so this function never returns.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/auth/sign-in")
}

/**
 * Insert an immutable row into the `audit_log` table.
 *
 * Uses the service-role admin client because `audit_log` has a SELECT-only RLS
 * policy and INSERT is service-role-only (schema plan 6.5 / 10). This also
 * ensures the audit row is written even if the actor's session has expired.
 *
 * Sensitive fields (passwords, 2FA secrets) MUST be redacted by the caller
 * before being passed in `oldValues` / `newValues`.
 */
export type AuditLogEntry = {
  tenantId: string
  actorId?: string | null
  module: string
  action: string
  entityType?: string | null
  entityId?: string | null
  oldValues?: Record<string, unknown> | null
  newValues?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from("audit_log").insert({
    tenant_id: entry.tenantId,
    actor_id: entry.actorId ?? null,
    module: entry.module,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    old_values: entry.oldValues ?? null,
    new_values: entry.newValues ?? null,
    ip_address: entry.ipAddress ?? null,
    user_agent: entry.userAgent ?? null,
    request_id: entry.requestId ?? null,
  })
  if (error) {
    // Audit failures are surfaced but not thrown — they must not break the
    // user-facing operation that triggered them. Log for monitoring.
    moduleLogger("audit").error(
      { err: error, module: entry.module, action: entry.action, entityType: entry.entityType, entityId: entry.entityId },
      "[audit_log] insert failed"
    )
  }
}
