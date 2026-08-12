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
-- auth.users ↔ users SYNC TRIGGER (M8 / ADR-019)
-- ═══════════════════════════════════════════════════════════════
-- IMPORTANT: The auth schema is MANAGED by Supabase and cannot be
-- modified via `supabase db push`. This trigger must be applied
-- SEPARATELY via the Supabase SQL Editor (Dashboard → SQL Editor)
-- using the service role. Run this AFTER migrations 001-013 are applied.
--
-- CREATE OR REPLACE FUNCTION sync_auth_user_to_custom_users()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF TG_OP = 'UPDATE' THEN
--     UPDATE users
--     SET status = CASE
--       WHEN NEW.banned_until IS NOT NULL AND NEW.banned_until > NOW()
--         THEN 'locked'::user_status
--       WHEN NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL
--         THEN 'active'::user_status
--       ELSE status
--     END,
--     updated_at = NOW()
--     WHERE auth_user_id = NEW.id;
--   END IF;
--   IF TG_OP = 'DELETE' THEN
--     UPDATE users
--     SET status = 'inactive'::user_status,
--         deleted_at = NOW(),
--         updated_at = NOW()
--     WHERE auth_user_id = OLD.id;
--   END IF;
--   RETURN COALESCE(NEW, OLD);
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;
--
-- CREATE TRIGGER on_auth_user_changed
--   AFTER UPDATE OR DELETE ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION sync_auth_user_to_custom_users();
-- ═══════════════════════════════════════════════════════════════
