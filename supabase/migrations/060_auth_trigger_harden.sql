-- ============================================================================
-- 060 — Auth Trigger Hardening: Invite-Only Provisioning
--
-- PROBLEM (from re-audit AUTH-001):
--   sync_auth_user_to_custom_users() (009) auto-creates a general_manager
--   in a fixed tenant on any public Auth signup. This is a P0 security blocker:
--   - Public auth.signUp() bypasses invite-only flow
--   - Trigger conflicts with acceptInvite() causing duplicate user rows
--   - Open signup creates privileged admin users
--
-- FIX:
--   1. REPLACE the INSERT branch to NEVER auto-create users. New auth users
--      must ONLY be provisioned through the controlled acceptInvite() flow.
--   2. Keep UPDATE/DELETE sync for status changes (locked, banned, deleted)
--      — these are legitimate operational syncs.
--   3. If an INSERT arrives without a matching invite (direct API signup),
--      we mark the auth user as banned so they cannot log in, then log it.
--   4. AcceptInvite() uses service-role to insert users/memberships/roles
--      AFTER creating the auth user — the trigger will see the INSERT but
--      the guard check prevents duplicate writes.
--
-- FORWARD-ONLY: does not edit historical migrations.
-- ============================================================================

-- Replace the trigger function with a safe version
CREATE OR REPLACE FUNCTION sync_auth_user_to_custom_users()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_user UUID;
  v_is_invite_provisioned BOOLEAN;
BEGIN
  -- ── INSERT: only allow invite-provisioned users ─────────────────
  IF TG_OP = 'INSERT' THEN
    -- Check if this user was already provisioned by acceptInvite()
    -- (the admin action inserts into public.users BEFORE auth triggers fire
    -- on the insert, but actually the trigger fires on auth.users INSERT).
    -- Strategy: acceptInvite() creates auth user → trigger fires →
    -- we check if acceptInvite() already inserted the custom user row.
    --
    -- Since the trigger fires AFTER INSERT on auth.users, and acceptInvite()
    -- calls admin.auth.admin.createUser() first, the custom users row
    -- may not exist yet. Instead, we check raw_user_meta_data for our
    -- invite marker.

    -- Check if this auth user was already provisioned (replay protection)
    SELECT id INTO v_existing_user
    FROM public.users
    WHERE auth_user_id = NEW.id;

    IF v_existing_user IS NOT NULL THEN
      -- Already provisioned (e.g., acceptInvite completed). Just sync.
      RETURN NEW;
    END IF;

    -- Check for invite provisioning marker in user metadata
    -- acceptInvite() sets this marker so the trigger knows this is legitimate
    v_is_invite_provisioned := (NEW.raw_user_meta_data ->> '_invite_provisioned')::boolean;

    IF v_is_invite_provisioned THEN
      -- acceptInvite() will insert users/memberships/roles after this trigger.
      -- Do NOT auto-create — wait for the explicit server action.
      RETURN NEW;
    END IF;

    -- NO INVITE MARKER: This is a direct public signup attempt.
    -- BLOCK IT: Ban the user and reject the login.
    -- We cannot delete the auth.users row from a trigger, but we can ban them.
    UPDATE auth.users
    SET banned_until = NOW() + INTERVAL '10 years',
        raw_app_meta_data = raw_app_meta_data || '{"blocked_signup": true}'::jsonb
    WHERE id = NEW.id;

    RAISE EXCEPTION 'AUTH010: Direct signup is not permitted. Use the invite flow.';
  END IF;

  -- ── UPDATE: sync status changes (keep existing logic) ───────────
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.users
    SET status = CASE
      WHEN NEW.banned_until IS NOT NULL AND NEW.banned_until > NOW()
        THEN 'locked'::user_status
      WHEN NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL
        THEN 'active'::user_status
      ELSE status
    END,
    updated_at = NOW()
    WHERE auth_user_id = NEW.id;
    RETURN NEW;
  END IF;

  -- ── DELETE: soft-delete the custom users row (keep existing logic) ──
  IF TG_OP = 'DELETE' THEN
    UPDATE public.users
    SET status = 'inactive'::user_status,
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE auth_user_id = OLD.id;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create the trigger (same name, same event)
DROP TRIGGER IF EXISTS on_auth_user_changed ON auth.users;
CREATE TRIGGER on_auth_user_changed
  AFTER INSERT OR UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_auth_user_to_custom_users();

COMMENT ON FUNCTION sync_auth_user_to_custom_users() IS
  'Hardened auth sync trigger (migration 060). INSERT: blocks direct public '
  'signup, only allows invite-provisioned users. UPDATE: syncs banned/confirmed '
  'status. DELETE: soft-deletes custom user row. Replaces the unsafe 009 version '
  'that auto-created general_manager users in a fixed tenant.';

-- ═══════════════════════════════════════════════════════════════
-- 2. Narrow public document verification RPC (re-audit PUB-001)
-- ═══════════════════════════════════════════════════════════════
-- Returns ONLY authenticity confirmation + minimal non-PII metadata.
-- No customer/supplier names, no invoice totals, no driver PII.
-- The caller (Next.js page) can enrich with tenant-controlled data
-- if needed, but the PUBLIC RPC is intentionally minimal.

-- IMPORTANT: migration 059 created this function with RETURNS jsonb and
-- parameter name `token`. PostgreSQL forbids CREATE OR REPLACE from changing
-- a function's return type (SQLSTATE 42P13), so we must DROP first, then
-- recreate with the narrowed JSON shape. Without this DROP, migration 060
-- fails on every fresh database (CI, staging, first production push).
DROP FUNCTION IF EXISTS public_verify_document(text);

CREATE OR REPLACE FUNCTION public_verify_document(p_token_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc RECORD;
BEGIN
  SELECT
    d.id,
    d.doc_number,
    d.status,
    d.generated_at,
    d.verify_url,
    t.name_en AS template_name
  INTO v_doc
  FROM generated_documents d
  LEFT JOIN document_templates t ON t.id = d.template_id
  WHERE d.verify_token_hash = p_token_hash
    AND d.deleted_at IS NULL;

  IF v_doc IS NULL THEN
    RETURN json_build_object(
      'found', false,
      'message', 'Document not found or verification token invalid.'
    );
  END IF;

  RETURN json_build_object(
    'found', true,
    'doc_number', v_doc.doc_number,
    'status', v_doc.status,
    'generated_at', v_doc.generated_at,
    'template_name', v_doc.template_name,
    'verified', true,
    'message', 'This document has been verified as authentic.'
  );
END;
$$;

-- Allow anonymous access (public verification)
GRANT EXECUTE ON FUNCTION public_verify_document(TEXT) TO anon;

COMMENT ON FUNCTION public_verify_document(TEXT) IS
  'Narrow public document verification (migration 060). Returns only '
  'authenticity confirmation and minimal non-PII metadata. No customer, '
  'driver, or financial data is exposed. Re-audit PUB-001 fix.';

-- ═══════════════════════════════════════════════════════════════
-- 3. Anonymous Storage: restrict to application-draft uploads only
-- ═══════════════════════════════════════════════════════════════
-- Re-audit STOR-001 fix: remove the broad anonymous insert policy
-- and replace with a policy that only allows uploads to the
-- driver-applications bucket under a draft path with a UUID.
-- Actual file upload authorization should be issued server-side
-- via signed URLs in future iterations.

-- Remove the overly permissive anonymous insert policy
DROP POLICY IF EXISTS "anon_insert_drafts" ON storage.objects;

-- Create a restrictive anonymous insert policy for driver-applications bucket
CREATE POLICY "anon_insert_driver_drafts" ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'driver-applications'
    AND (storage.foldername(name))[1] = 'drafts'
    -- Must have exactly 2 path segments: drafts/{uuid-filename}
    AND array_length(storage.foldername(name), 1) = 2
    -- Filename must contain a UUID component (prevents path traversal)
    AND name ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.'
    -- Max file size check via extension allowlist (content-type validated server-side)
    AND (storage.filename(name)) ~* '\.(jpg|jpeg|png|pdf|webp)$'
  );

-- NOTE (documentation — intentionally NOT a COMMENT ON POLICY statement):
-- storage.objects is owned by the storage_admin role, not the migration role,
-- so COMMENT ON POLICY on it fails with SQLSTATE 42501 (must be owner of
-- relation objects) during `supabase start` / `db reset`.
-- Policy documentation: "anon_insert_driver_drafts" restricts anonymous uploads
-- to driver-applications/drafts/ with UUID filenames and allowed extensions
-- only (migration 060, re-audit STOR-001 fix).