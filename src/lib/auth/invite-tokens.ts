// Pure invite-token hashing + verification (auth plan 6.3 step 7 / 6.8).
//
// New invites are hashed with bcrypt (cost 10) — intentionally slow and
// timing-safe, so a leaked `token_hash` column is not brute-forceable.
// Pre-upgrade invites were SHA-256 hashed; `verifyInviteToken` detects the
// stored format (bcrypt hashes start with `$2`, SHA-256 is 64 hex chars) and
// verifies accordingly, so old emailed links keep working after migration 057.
//
// The plaintext token NEVER touches the DB (only the hash is stored). This
// module is a plain (non-"use server") module so it is unit-testable and
// import-safe anywhere — same pattern as csv-utils.ts.
//
// No auth-plan compliance claim beyond what is implemented here.

import bcrypt from "bcryptjs"
import crypto from "crypto"

/** bcrypt cost factor per auth plan 6.3 step 7. */
export const INVITE_BCRYPT_ROUNDS = 10

/** Legacy SHA-256 hash (pre-057 invites) — kept for backward compatibility. */
export function hashTokenLegacy(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/** bcrypt hash of the plaintext invite token (current storage format). */
export async function hashInviteToken(token: string): Promise<string> {
  return bcrypt.hash(token, INVITE_BCRYPT_ROUNDS)
}

/**
 * Verify a plaintext token against a stored hash, supporting BOTH formats:
 * - bcrypt (`$2a$`/`$2b$`/`$2y$` prefix) — current invites.
 * - SHA-256 hex (64 chars) — pre-057 invites, timing-safe via
 *   `crypto.timingSafeEqual` so the legacy path does not leak length.
 * Returns false for any unrecognized hash format (never throws).
 */
export async function verifyInviteToken(token: string, storedHash: string): Promise<boolean> {
  if (!token || !storedHash) return false
  if (/^\$2[aby]\$/.test(storedHash)) {
    try {
      return await bcrypt.compare(token, storedHash)
    } catch {
      return false
    }
  }
  if (/^[0-9a-f]{64}$/i.test(storedHash)) {
    const candidate = Buffer.from(hashTokenLegacy(token), "utf8")
    const stored = Buffer.from(storedHash.toLowerCase(), "utf8")
    return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)
  }
  return false
}
