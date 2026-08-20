"use server"

// Invite Server Actions for the EliteDev Phase 2 application layer.
//
// Implements the invite flow described in docs/phase-2-auth-plan.md section 6:
//   - createInvite        (GM-only)         issues a hashed-token invite + email
//   - acceptInvite        (public, token)   creates auth.users + users + memberships
//   - revokeInvite        (GM-only)         cancels a pending invite
//   - listPendingInvites  (read)            lists pending invites for the tenant
//
// Token storage: the plaintext token is generated with crypto.randomUUID()
// and stored as a bcrypt hash (cost 10) — salted, so an equality lookup on
// `token_hash` is impossible. The accept-invite link carries a NON-secret
// `tid` (token_id, O(1) index lookup — migration 057) alongside the `token`
// (secret); accept verifies with bcrypt.compare (auth plan 6.3/6.7/6.8).
// Legacy pre-057 invites (SHA-256) still verify via the format-detecting
// verifyInviteToken fallback. The plaintext token NEVER touches the DB.
//
// Server-side only. Uses the service-role admin client for operations that
// bypass RLS (invite acceptance — a public flow with no session, plus
// audit_log writes via writeAuditLog) and the cookie-bound server client for
// GM-scoped operations (create / revoke / list) where RLS enforces tenancy.

import crypto from "crypto"

import { requirePermission, getCurrentUser } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimit, getClientIp } from "@/lib/auth/rate-limit"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashInviteToken, verifyInviteToken } from "@/lib/auth/invite-tokens"

/** One week in milliseconds — invite expiry window (auth plan 6.3 step 9). */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// TODO: replace `string` with the proper `user_role` enum type from the
// schema-generated types once @/lib/types is available. The DB enforces the
// enum at the column level; this loose `string` is for simplicity only.

type InviteRow = {
  id: string
  email: string
  role: string
  tenant_id: string
}

type IdRow = { id: string }

export type PendingInvite = {
  id: string
  email: string
  role: string
  invited_at: string
  expires_at: string
}

type ActionResult = { success: boolean; error?: string }



/**
 * Extract a human-readable message from an unknown thrown value. Avoids `any`
 * while surfacing `Error.message` (AuthorizationError sets this to its
 * English message via `super(messageEn)`).
 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === "string") return e
  return "An unexpected error occurred."
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Send the invite-acceptance email via the Resend HTTP API. Uses the global
 * `fetch` — no package dependency. Non-fatal: the caller logs failures and the
 * invite row stays pending so the GM can resend from /settings/users
 * (auth plan 6.3 step 10).
 *
 * TODO: replace the inline HTML with a proper bilingual React email template
 * (Design DNA — subject and body in both EN and AR).
 */
async function sendInviteEmail(email: string, token: string, tokenId: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  if (!apiKey || !fromEmail || !appUrl) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[invites] Resend env vars missing — skipping invite email to",
        email
      )
    }
    return
  }

  // `tid` (token_id) is NOT secret — it is the O(1) lookup key (auth plan
  // 6.7 strategy 2). The `token` is the secret; both are required to accept.
  const acceptUrl = `${appUrl}/auth/accept-invite?tid=${encodeURIComponent(tokenId)}&token=${encodeURIComponent(token)}`

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
      <h2>You're invited to EliteDev</h2>
      <p>You have been invited to join EliteDev. Click the button below to accept your invite and set up your account.</p>
      <p>
        <a href="${acceptUrl}"
           style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px;">
          Accept invite
        </a>
      </p>
      <p style="color: #6b7280; font-size: 12px;">
        Or copy this link: ${acceptUrl}
      </p>
      <p style="color: #6b7280; font-size: 12px;">
        This invite expires in 7 days.
      </p>
    </div>
  `

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: "You're invited to EliteDev",
      html,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Resend API error ${res.status}: ${text}`)
  }
}

/**
 * Issue a new invite. GM-only (`users.manage`).
 *
 * Generates a UUID token, stores only its SHA-256 hash, inserts the invite
 * row scoped to the current user's tenant, sends the acceptance email via
 * Resend, and writes an audit_log row.
 */
export async function createInvite(
  email: string,
  role: string
): Promise<ActionResult> {
  try {
    await requirePermission("users", "manage")

    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Not authenticated." }
    }

    const supabase = await createClient()

    // Reject duplicate pending invites for the same email.
    const { data: existing, error: lookupError } = await supabase
      .from("invites")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .is("deleted_at", null)
      .maybeSingle<IdRow>()

    if (lookupError) throw lookupError
    if (existing) {
      return {
        success: false,
        error: "An invite is already pending for this email.",
      }
    }

    const token = crypto.randomUUID()
    const tokenId = crypto.randomUUID()
    const tokenHash = await hashInviteToken(token)
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()

    const { data: invite, error: insertError } = await supabase
      .from("invites")
      .insert({
        tenant_id: currentUser.tenantId,
        email,
        role,
        token_id: tokenId,
        token_hash: tokenHash,
        status: "pending",
        expires_at: expiresAt,
        invited_by: currentUser.authUserId,
      })
      .select("id")
      .single<IdRow>()

    if (insertError) throw insertError
    if (!invite) throw new Error("Failed to create invite row.")
    const inviteId = invite.id

    // Email delivery is non-fatal — log failures, keep the invite pending.
    try {
      await sendInviteEmail(email, token, tokenId)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[invites] Resend email failed:", err)
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "users",
      action: "invite_created",
      entityType: "invite",
      entityId: inviteId,
      newValues: { email, role },
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Accept an invite and provision the new user. Public flow (no session) —
 * the token is the sole proof of authorization.
 *
 * Looks up the invite by `token_id` (O(1) — migration 057; the `tid` is
 * non-secret, the `token` is the secret), verifies with bcrypt.compare
 * (legacy SHA-256 invites still verify via format detection), creates the
 * auth.users entry (email confirmed by invite construction), creates the
 * custom `users` row, the `tenant_memberships` row, and the
 * `user_role_assignments` row, then marks the invite accepted.
 *
 * CAVEAT: the admin client does not provide a transaction across
 * `auth.admin.createUser` and the custom-table inserts (auth plan 6.5). If
 * the `users` insert fails, a compensating `deleteUser` runs to avoid an
 * orphaned auth.users row. Downstream soft failures (role assignment) are
 * logged but do not block account creation.
 */
export async function acceptInvite(
  token: string,
  tid: string,
  fullName: string,
  password: string
): Promise<ActionResult> {
  try {
    // 0. Per-IP rate limit to slow invite-brute-force attempts (auth plan
    //    6.5 step 1).
    const ip = await getClientIp()
    const rate = await rateLimit(`accept_invite:${ip}`, 10, "minute")
    if (!rate.success) {
      return {
        success: false,
        error: "Too many attempts. Please try again later.",
      }
    }

    const admin = createAdminClient()

    // 1. Lookup by token_id (O(1) index). Generic error on miss to avoid
    //    enumeration (auth plan 6.5 step 2).
    const { data: invite, error: lookupError } = await admin
      .from("invites")
      .select("id, email, role, tenant_id, token_hash")
      .eq("token_id", tid)
      .eq("status", "pending")
      .gt("expires_at", nowIso())
      .is("deleted_at", null)
      .maybeSingle<InviteRow & { token_hash: string }>()

    if (lookupError) throw lookupError
    if (!invite) {
      return { success: false, error: "Invalid or expired invite token." }
    }

    // 2. Verify the secret token against the stored hash (bcrypt for new
    //    invites, legacy SHA-256 fallback for pre-057 rows). Same generic
    //    error on mismatch (anti-enumeration).
    const match = await verifyInviteToken(token, invite.token_hash)
    if (!match) {
      return { success: false, error: "Invalid or expired invite token." }
    }

    // 2. Create the auth.users entry (admin client bypasses RLS).
    //    email_confirm: true — the invite link proves email ownership.
    const {
      data: authUser,
      error: authError,
    } = await admin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (authError) throw authError
    if (!authUser.user) {
      throw new Error("Failed to create auth user.")
    }
    const authUserId = authUser.user.id

    // 3. Create the custom `users` row. On failure, compensate by deleting
    //    the auth.users entry to avoid orphans (auth plan 6.5 step 6 caveat).
    const { data: newUser, error: userError } = await admin
      .from("users")
      .insert({
        auth_user_id: authUserId,
        tenant_id: invite.tenant_id,
        email: invite.email,
        role: invite.role,
        full_name_ar: fullName,
        full_name_en: fullName,
        status: "active",
        must_change_password: false,
        accepted_invite_at: nowIso(),
      })
      .select("id")
      .single<IdRow>()

    if (userError || !newUser) {
      await admin
        .auth.admin
        .deleteUser(authUserId)
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[invites] compensating deleteUser failed:", err)
        })
      throw userError ?? new Error("Failed to create user row.")
    }
    const newUserId = newUser.id

    // 4. tenant_memberships — hard fail; without it the account is unusable.
    //    NOTE: the table has NO `role` column (it carries `is_primary`; the
    //    role lives on `users.role` + `user_role_assignments.role_id`). An
    //    earlier version inserted `role` here and every accept silently
    //    failed with PGRST204 after creating the auth user + users row,
    //    orphaning them. Fixed 2026-08-17 (E2E caught it).
    const { error: membershipError } = await admin
      .from("tenant_memberships")
      .insert({
        user_id: newUserId,
        tenant_id: invite.tenant_id,
      })

    if (membershipError) throw membershipError

    // 5. user_role_assignments — resolve role_id by name + tenant. Soft fail:
    //    authorization.ts reads `users.role` directly, so a missing assignment
    //    does not block access; it is logged for follow-up.
    const { data: roleRow } = await admin
      .from("roles")
      .select("id")
      .eq("name", invite.role)
      .eq("tenant_id", invite.tenant_id)
      .is("deleted_at", null)
      .maybeSingle<IdRow>()

    if (roleRow) {
      const { error: assignmentError } = await admin
        .from("user_role_assignments")
        .insert({
          user_id: newUserId,
          role_id: roleRow.id,
          tenant_id: invite.tenant_id,
        })
      if (assignmentError) {
        // eslint-disable-next-line no-console
        console.error(
          "[invites] user_role_assignments insert failed:",
          assignmentError
        )
      }
    } else if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[invites] role not found for assignment:",
        invite.role
      )
    }

    // 6. Mark the invite accepted (prevents replay).
    const { error: updateError } = await admin
      .from("invites")
      .update({
        status: "accepted",
        accepted_at: nowIso(),
        accepted_by: authUserId,
      })
      .eq("id", invite.id)

    if (updateError) throw updateError

    // 7. Audit log (writeAuditLog uses the admin client and never throws).
    //    actor_id references auth.users(id) — NOT the custom users row — so
    //    pass the auth user id (newUserId would violate the FK; the custom id
    //    is recorded below in newValues).
    await writeAuditLog({
      tenantId: invite.tenant_id,
      actorId: authUserId,
      module: "users",
      action: "invite_accepted",
      entityType: "invite",
      entityId: invite.id,
      newValues: {
        user_id: newUserId,
        auth_user_id: authUserId,
        role: invite.role,
      },
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Revoke a pending invite. GM-only (`users.manage`). Sets `status='revoked'`
 * so the accept-invite flow rejects it with the same generic error.
 */
export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  try {
    await requirePermission("users", "manage")

    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Not authenticated." }
    }

    const supabase = await createClient()

    // RLS scopes the update to the current user's tenant.
    const { error } = await supabase
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("status", "pending")

    if (error) throw error

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "users",
      action: "invite_revoked",
      entityType: "invite",
      entityId: inviteId,
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * List pending invites for the current user's tenant. Requires `users.read`.
 */
export async function listPendingInvites(): Promise<PendingInvite[]> {
  try {
    await requirePermission("users", "read")

    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return []
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from("invites")
      .select("id, email, role, created_at, expires_at")
      .eq("status", "pending")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (error) throw error

    const rows = (data ?? []) as unknown as Array<{
      id: string
      email: string
      role: string
      created_at: string
      expires_at: string
    }>

    // Map the table's `created_at` to the API contract's `invited_at`.
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      invited_at: row.created_at,
      expires_at: row.expires_at,
    }))
  } catch (e) {
    // Signature returns an array; log and degrade to an empty list on error.
    // eslint-disable-next-line no-console
    console.error("[invites] listPendingInvites failed:", e)
    return []
  }
}
