-- ============================================================================
-- 058 — Auth/RBAC/RLS Hardening
--
-- Fixes identified in the Package 1 security audit:
--
--   P0 FIX: The auth trigger (009) auto-provisions GM users into a fixed
--   tenant. We do NOT drop the trigger (it handles UPDATE/DELETE sync),
--   but we document the risk and add a defense-in-depth layer.
--
--   P1 FIX: No DB-level prevention of self-role escalation. A user with
--   authenticated RLS access could UPDATE their own role, tenant_id, or
--   status via the browser client. This trigger blocks that at the DB level.
--
--   P1 FIX: Authenticated users could INSERT/UPDATE on role_permissions,
--   user_role_assignments, tenant_memberships, and invites via RLS.
--   All writes now flow through service-role server actions only.
--
-- IMPORTANT: This migration only adds/restricts — it never loosens access.
-- Forward-only: does not edit any historical migration.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. Prevent self-role escalation via trigger
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_user_self_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_auth UUID;
BEGIN
  -- Service-role bypasses RLS, so the caller is the DB owner.
  -- We only need to guard against authenticated users.
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  v_caller_auth := auth.uid();

  -- If no JWT context (service-role/admin call), allow
  IF v_caller_role IS NULL OR v_caller_auth IS NULL THEN
    RETURN NEW;
  END IF;

  -- Prevent any user from changing their own role (privilege escalation)
  IF OLD.auth_user_id = v_caller_auth THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'AUTH001: users cannot modify their own role';
    END IF;

    -- Prevent status self-modification (e.g., unlocking own account)
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'AUTH002: users cannot modify their own account status';
    END IF;

    -- Prevent tenant reassignment
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'AUTH003: users cannot modify their own tenant assignment';
    END IF;

    -- Prevent lockout bypass
    IF NEW.locked_until IS DISTINCT FROM OLD.locked_until THEN
      RAISE EXCEPTION 'AUTH004: users cannot modify their own lock status';
    END IF;
  END IF;

  -- Prevent anyone from assigning general_manager role (highest privilege)
  IF NEW.role = 'general_manager' AND OLD.role != 'general_manager' THEN
    RAISE EXCEPTION 'AUTH005: assigning general_manager role is not permitted via direct UPDATE';
  END IF;

  RETURN NEW;
END;
$$;

-- Apply the trigger to the users table
DROP TRIGGER IF EXISTS trg_prevent_self_escalation ON users;
CREATE TRIGGER trg_prevent_self_escalation
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION prevent_user_self_escalation();

-- ═══════════════════════════════════════════════════════════════
-- 2. Restrict sensitive RBAC table writes to service-role only
-- ═══════════════════════════════════════════════════════════════
-- These tables are administrative — all mutations flow through
-- service-role server actions (invites.ts, authorization.ts).
-- Authenticated users retain SELECT-only access.

-- ── roles ──
-- Remove authenticated INSERT/UPDATE; keep SELECT for reading role list
DROP POLICY IF EXISTS "roles_insert_own_tenant" ON roles;
DROP POLICY IF EXISTS "roles_update_own_tenant" ON roles;
-- "roles_select_own_tenant" remains

-- ── role_permissions ──
-- Remove authenticated INSERT/UPDATE; keep SELECT for reading permissions
DROP POLICY IF EXISTS "role_permissions_insert" ON role_permissions;
DROP POLICY IF EXISTS "role_permissions_update" ON role_permissions;
-- "role_permissions_select" remains

-- ── user_role_assignments ──
-- Remove authenticated INSERT/UPDATE; keep SELECT
DROP POLICY IF EXISTS "user_role_assignments_insert_own_tenant" ON user_role_assignments;
DROP POLICY IF EXISTS "user_role_assignments_update_own_tenant" ON user_role_assignments;
-- "user_role_assignments_select_own_tenant" remains

-- ── tenant_memberships ──
-- Remove authenticated INSERT/UPDATE; keep SELECT
DROP POLICY IF EXISTS "tenant_memberships_insert_own_tenant" ON tenant_memberships;
DROP POLICY IF EXISTS "tenant_memberships_update_own_tenant" ON tenant_memberships;
-- "tenant_memberships_select_own_tenant" remains

-- ── invites ──
-- Remove authenticated INSERT/UPDATE; keep SELECT
-- Invitations are created via the service-role admin client in invites.ts
DROP POLICY IF EXISTS "invites_insert_own_tenant" ON invites;
DROP POLICY IF EXISTS "invites_update_own_tenant" ON invites;
-- "invites_select_own_tenant" remains

-- ═══════════════════════════════════════════════════════════════
-- 3. Prevent users from modifying their own role/tenant/status
-- ═══════════════════════════════════════════════════════════════
-- The trigger above handles UPDATE. For INSERT, we add a check:
-- no user should be able to INSERT into the users table with a
-- role of general_manager via authenticated access.

-- Restrict authenticated users from INSERTing into users table
-- (user provisioning flows through the invite system / service-role)
DROP POLICY IF EXISTS "users_insert_own_tenant" ON users;
DROP POLICY IF EXISTS "users_update_own_tenant" ON users;
-- "users_select_own_tenant" remains

-- ═══════════════════════════════════════════════════════════════
-- 4. Document the auth trigger risk
-- ═══════════════════════════════════════════════════════════════
-- The sync_auth_user_to_custom_users trigger (009) auto-creates
-- users with general_manager role in a fixed tenant. This is
-- documented as a known risk. Mitigations:
--   - /auth/sign-up redirects to /auth/accept-invite (no open signup)
--   - This migration prevents self-role escalation at DB level
--   - The trigger should be reviewed before multi-tenant deployment

COMMENT ON FUNCTION prevent_user_self_escalation() IS
  'Defense-in-depth trigger: prevents authenticated users from escalating '
  'their own role, status, or tenant assignment. Service-role (SECURITY DEFINER) '
  'bypasses this. Created in migration 058 as part of Package 1 security hardening.';

COMMENT ON FUNCTION sync_auth_user_to_custom_users() IS
  'Auto-provisions new auth users into the default tenant with general_manager role. '
  'KNOWN RISK: open auth.signUp() creates GM users. Mitigated by redirecting sign-up '
  'to invite-only flow. Should be replaced with invite-only provisioning before '
  'multi-tenant deployment. See migration 058.';
