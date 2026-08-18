-- ============================================================================
-- 057 — Invite token_id for bcrypt lookup (auth plan 6.7)
--
-- The invite flow upgrades token storage from SHA-256 to bcrypt (auth plan
-- 6.3 step 7 / 6.8). bcrypt hashes are salted, so an equality lookup on
-- `token_hash` is impossible — the plan's recommended strategy is a
-- non-secret `token_id` (UUID) alongside the hash: the accept-invite link
-- carries `tid` (public) + `token` (secret), the lookup is an O(1) index hit
-- on token_id, and the token is verified with a single bcrypt.compare.
--
-- Backfill: pre-existing pending invites (SHA-256 hashed) get a generated
-- token_id so the column is NOT NULL going forward. Their already-emailed
-- links (which carry only `?token=`) still verify via the legacy SHA-256
-- fallback in the app (verifyInviteToken detects the hash format).
--
-- No RLS changes — invites keeps its existing 4-policy pattern.
-- ============================================================================

ALTER TABLE invites ADD COLUMN token_id UUID;

-- Backfill existing rows (idempotent: only rows without a token_id).
UPDATE invites SET token_id = gen_random_uuid() WHERE token_id IS NULL;

-- O(1) accept lookup by token_id.
CREATE UNIQUE INDEX idx_invites_token_id ON invites(token_id)
  WHERE token_id IS NOT NULL AND deleted_at IS NULL;

-- The app now always writes token_id; make it required going forward.
ALTER TABLE invites ALTER COLUMN token_id SET NOT NULL;
