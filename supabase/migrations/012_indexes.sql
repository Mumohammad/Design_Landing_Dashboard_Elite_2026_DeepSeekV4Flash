-- 012_indexes.sql
-- Universal soft-delete partial indexes. IF NOT EXISTS makes this idempotent
-- (some indexes were created inline in migrations 004-008).
-- Source: docs/phase-2-schema-plan.md section 11

CREATE INDEX IF NOT EXISTS idx_users_active
  ON users(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_system_settings_active
  ON system_settings(tenant_id, key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_roles_active
  ON roles(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_active
  ON user_role_assignments(tenant_id, user_id) WHERE deleted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_active
  ON tenant_memberships(tenant_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invites_active
  ON invites(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_active
  ON tenants(status) WHERE deleted_at IS NULL;
