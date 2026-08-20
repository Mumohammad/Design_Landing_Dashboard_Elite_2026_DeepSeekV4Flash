-- 009_triggers.sql
-- Auto-update updated_at on every table that has it, plus audit_log immutability.
-- Source: docs/phase-2-schema-plan.md sections 7.2, 7.3, 8.2, 8.3

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to each table with updated_at
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_system_settings_updated_at BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_user_role_assignments_updated_at BEFORE UPDATE ON user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_tenant_memberships_updated_at BEFORE UPDATE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_invites_updated_at BEFORE UPDATE ON invites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Audit log immutability: block UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable: UPDATE and DELETE are not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ═══════════════════════════════════════════════════════════════
-- auth.users → users AUTO-PROVISION + SYNC TRIGGER (M8 / ADR-019)
-- ═══════════════════════════════════════════════════════════════
-- IMPORTANT: The auth schema is MANAGED by Supabase and cannot be
-- modified via `supabase db push`. This trigger must be applied
-- SEPARATELY via the Supabase SQL Editor (Dashboard → SQL Editor)
-- using the service role. Run this AFTER migrations 001-013 are applied.
--
-- What it does:
--   INSERT  → Auto-creates users + tenant_memberships + role_assignment
--             so new auth users can log in immediately.
--   UPDATE  → Syncs banned_until → locked, email_confirmed → active.
--   DELETE  → Soft-deletes the custom users row.
--
-- The default tenant (00000000-...-0001) and general_manager role are
-- used for auto-provisioned users. To change this, edit v_default_tenant
-- and v_default_role below.
--
-- SECURITY DEFINER: trigger runs with owner privileges (needed to INSERT
-- into the public schema from an auth schema trigger).

CREATE OR REPLACE FUNCTION sync_auth_user_to_custom_users()
RETURNS TRIGGER AS $$
DECLARE
  v_default_tenant UUID := '00000000-0000-0000-0000-000000000001';
  v_default_role   TEXT  := 'general_manager';
  v_new_user_id    UUID;
  v_user_email     TEXT;
  v_user_name      TEXT;
BEGIN
  -- ── INSERT: auto-provision a new user ─────────────────────────
  IF TG_OP = 'INSERT' THEN
    -- Skip if a row already exists (defensive — shouldn't happen on INSERT
    -- but protects against replays from partial failures).
    IF EXISTS (SELECT 1 FROM public.users WHERE auth_user_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    v_user_email := NEW.email;
    v_user_name  := COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    );

    -- 1. Create the custom users row
    INSERT INTO public.users (
      auth_user_id, tenant_id, email, role,
      full_name_ar, full_name_en,
      status, must_change_password, two_factor_enabled,
      failed_login_attempts, accepted_invite_at
    ) VALUES (
      NEW.id, v_default_tenant, v_user_email, v_default_role,
      v_user_name, v_user_name,
      'active'::user_status, false, false,
      0, NOW()
    ) RETURNING id INTO v_new_user_id;

    -- 2. Create tenant_memberships row (required for the app)
    INSERT INTO public.tenant_memberships (user_id, tenant_id)
    VALUES (v_new_user_id, v_default_tenant)
    ON CONFLICT DO NOTHING;

    -- 3. Create role assignment (soft fail — not required for login)
    INSERT INTO public.user_role_assignments (user_id, role_id, tenant_id)
    SELECT v_new_user_id, r.id, v_default_tenant
    FROM public.roles r
    WHERE r.tenant_id = v_default_tenant
      AND r.name = v_default_role
    ON CONFLICT DO NOTHING;

    RETURN NEW;
  END IF;

  -- ── UPDATE: sync status changes ───────────────────────────────
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

  -- ── DELETE: soft-delete the custom users row ───────────────────
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

-- Drop old trigger if it exists, then create the new one
DROP TRIGGER IF EXISTS on_auth_user_changed ON auth.users;

CREATE TRIGGER on_auth_user_changed
  AFTER INSERT OR UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_auth_user_to_custom_users();
-- ═══════════════════════════════════════════════════════════════
