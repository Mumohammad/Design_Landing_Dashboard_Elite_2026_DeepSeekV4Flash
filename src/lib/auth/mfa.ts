"use server"

// MFA (Multi-Factor Authentication) server actions.
//
// Uses Supabase Auth HTTP API for TOTP-based MFA:
//   POST /auth/v1/mfa/enroll   — generate TOTP secret + QR code URI
//   POST /auth/v1/mfa/challenge — create a challenge for verification
//   POST /auth/v1/mfa/verify   — verify a TOTP code against a challenge
//   DELETE /auth/v1/mfa/factors/{id} — unenroll a factor
//   GET /auth/v1/mfa/factors   — list enrolled factors
//
// MFA is enforced for general_manager and admin roles.
// Other roles can optionally enable MFA.

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { moduleLogger } from "@/lib/logger"
import { ERROR_CODES } from "@/lib/errors/error-codes"

const log = moduleLogger("mfa")

type MfaActionResult = {
  success: boolean
  error?: string
  /** TOTP URI for QR code generation (enrollment only) */
  totpUri?: string
  /** Base32-encoded secret for manual entry (enrollment only) */
  secret?: string
  /** Factor ID (enrollment/verification) */
  factorId?: string
  /** Whether MFA is now enabled */
  enabled?: boolean
}

/**
 * Check if the current user's role requires MFA.
 * general_manager and admin roles MUST have MFA enabled.
 */
export async function isMfaRequired(): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  return user.role === "general_manager" || user.role === "admin"
}

/**
 * Enroll a new TOTP factor for the current user.
 *
 * Returns a TOTP URI that can be rendered as a QR code,
 * and a base32 secret for manual entry.
 *
 * The factor is NOT verified yet — the user must call verifyMfaCode()
 * with the first code from their authenticator app.
 */
export async function enrollMfa(): Promise<MfaActionResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated." }

    const supabase = await createClient()

    // Use Supabase Auth HTTP API for MFA enrollment
    // The session cookie provides the auth context
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return { success: false, error: "Supabase configuration missing." }
    }

    // Get the current session access token
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: "No active session." }
    }

    // Enroll TOTP factor via HTTP API
    const response = await fetch(`${supabaseUrl}/auth/v1/mfa/enroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseAnonKey,
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        factor_type: "totp",
        issuer: "EliteDev",
        friendly_name: `EliteDev-${user.id.slice(0, 8)}`,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      log.error({ userId: user.id, status: response.status, error: errorData }, "MFA enrollment failed")
      return { success: false, error: errorData.error?.message ?? "MFA enrollment failed." }
    }

    const data = await response.json()

    log.info({ userId: user.id, factorId: data.id }, "MFA factor enrolled")

    return {
      success: true,
      totpUri: data.totp?.uri,
      secret: data.totp?.secret,
      factorId: data.id,
    }
  } catch (e) {
    log.error({ error: e }, "MFA enrollment error")
    return { success: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Verify a TOTP code against an enrolled factor.
 *
 * On first verification (after enrollment), this activates the factor.
 * On subsequent verifications, this is used during login.
 */
export async function verifyMfaCode(
  factorId: string,
  code: string
): Promise<MfaActionResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated." }

    const supabase = await createClient()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return { success: false, error: "Supabase configuration missing." }
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: "No active session." }
    }

    // Step 1: Create a challenge
    const challengeResponse = await fetch(
      `${supabaseUrl}/auth/v1/mfa/challenge`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ factor_id: factorId }),
      }
    )

    if (!challengeResponse.ok) {
      const errorData = await challengeResponse.json().catch(() => ({}))
      return { success: false, error: errorData.error?.message ?? "Challenge creation failed." }
    }

    const challenge = await challengeResponse.json()

    // Step 2: Verify the code against the challenge
    const verifyResponse = await fetch(
      `${supabaseUrl}/auth/v1/mfa/verify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          factor_id: factorId,
          challenge_id: challenge.id,
          code,
        }),
      }
    )

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json().catch(() => ({}))
      log.warn({ userId: user.id, factorId }, "MFA verification failed")
      return { success: false, error: errorData.error?.message ?? "Invalid code." }
    }

    const verifyData = await verifyResponse.json()

    // Update the user's two_factor_enabled flag in our users table
    const admin = createAdminClient()
    await admin
      .from("users")
      .update({ two_factor_enabled: true, updated_at: new Date().toISOString() })
      .eq("id", user.id)

    // Audit log
    await writeAuditLog({
      tenantId: user.tenantId,
      actorId: user.authUserId,
      module: "security",
      action: "mfa_enabled",
      entityType: "user",
      entityId: user.id,
      newValues: { factorId },
    })

    log.info({ userId: user.id, factorId }, "MFA verified and enabled")

    return {
      success: true,
      enabled: true,
      factorId,
    }
  } catch (e) {
    log.error({ error: e }, "MFA verification error")
    return { success: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * Unenroll (disable) a TOTP factor for the current user.
 *
 * If MFA is required for the user's role, this will be rejected.
 */
export async function unenrollMfa(factorId: string): Promise<MfaActionResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated." }

    // Block unenrollment if MFA is required for this role
    if (await isMfaRequired()) {
      return {
        success: false,
        error: "MFA is required for your role and cannot be disabled.",
      }
    }

    const supabase = await createClient()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return { success: false, error: "Supabase configuration missing." }
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: "No active session." }
    }

    const response = await fetch(
      `${supabaseUrl}/auth/v1/mfa/factors/${factorId}`,
      {
        method: "DELETE",
        headers: {
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${session.access_token}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return { success: false, error: errorData.error?.message ?? "Unenrollment failed." }
    }

    // Update the user's two_factor_enabled flag
    const admin = createAdminClient()
    await admin
      .from("users")
      .update({ two_factor_enabled: false, two_factor_secret: null, updated_at: new Date().toISOString() })
      .eq("id", user.id)

    // Audit log
    await writeAuditLog({
      tenantId: user.tenantId,
      actorId: user.authUserId,
      module: "security",
      action: "mfa_disabled",
      entityType: "user",
      entityId: user.id,
      newValues: { factorId },
    })

    log.info({ userId: user.id, factorId }, "MFA factor unenrolled")

    return { success: true, enabled: false }
  } catch (e) {
    log.error({ error: e }, "MFA unenrollment error")
    return { success: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}

/**
 * List all enrolled MFA factors for the current user.
 */
export async function listMfaFactors(): Promise<{
  success: boolean
  factors?: Array<{ id: string; type: string; friendly_name?: string; status: string }>
  error?: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: "Not authenticated." }

    const supabase = await createClient()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return { success: false, error: "Supabase configuration missing." }
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: "No active session." }
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/mfa/factors`, {
      headers: {
        "apikey": supabaseAnonKey,
        "Authorization": `Bearer ${session.access_token}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return { success: false, error: errorData.error?.message ?? "Failed to list factors." }
    }

    const data = await response.json()

    return {
      success: true,
      factors: (data.data ?? []).map((f: Record<string, unknown>) => ({
        id: f.id as string,
        type: f.factor_type as string,
        friendly_name: f.friendly_name as string | undefined,
        status: f.status as string,
      })),
    }
  } catch (e) {
    log.error({ error: e }, "MFA list factors error")
    return { success: false, error: e instanceof Error ? e.message : "Unknown error." }
  }
}
