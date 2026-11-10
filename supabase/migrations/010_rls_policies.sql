-- 010_rls_policies.sql
-- Row Level Security policies (ADR-019 / M8 correction): deny-by-default
-- tenant isolation with WITH CHECK on INSERT/UPDATE to prevent forged tenant_id.
-- Source: docs/phase-2-schema-plan.md sections 7.1, 10.1-10.5

-- =====================================================================
-- Helper: get_my_tenant_id() — SECURITY DEFINER STABLE (section 7.1)
-- =====================================================================
-- Returns the tenant_id for the current auth.uid(). SECURITY DEFINER is
-- required because the users table itself has RLS; without it the function
-- would recurse through RLS and see no rows. Returns NULL for unauthenticated
-- or soft-deleted users, which makes every policy evaluate to false (deny).

CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM users
  WHERE auth_user_id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

REVOKE ALL ON FUNCTION get_my_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_my_tenant_id() TO authenticated;

-- =====================================================================
-- Enable RLS on every table (section 10.2)
-- =====================================================================
ALTER TABLE tenants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites                ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- tenants (no tenant_id column — IS the tenant; policies use id)
-- =====================================================================
CREATE POLICY "tenants_select_own" ON tenants
  FOR SELECT TO authenticated
  USING (id = get_my_tenant_id());

CREATE POLICY "tenants_insert_own" ON tenants
  FOR INSERT TO authenticated
  WITH CHECK (id = get_my_tenant_id());

CREATE POLICY "tenants_update_own" ON tenants
  FOR UPDATE TO authenticated
  USING (id = get_my_tenant_id())
  WITH CHECK (id = get_my_tenant_id());

-- No DELETE policy: soft-delete via UPDATE deleted_at (service-role for hard purge).

-- =====================================================================
-- users
-- =====================================================================
CREATE POLICY "users_select_own_tenant" ON users
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);

CREATE POLICY "users_insert_own_tenant" ON users
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "users_update_own_tenant" ON users
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- No DELETE policy: soft-delete via UPDATE deleted_at.

-- =====================================================================
-- system_settings (split SELECT: public vs private — section 10.3)
-- =====================================================================
CREATE POLICY "system_settings_select_public" ON system_settings
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_my_tenant_id()
    AND deleted_at IS NULL
    AND is_public = true
  );

CREATE POLICY "system_settings_select_private" ON system_settings
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_my_tenant_id()
    AND deleted_at IS NULL
    AND is_public = false
  );

CREATE POLICY "system_settings_insert_own_tenant" ON system_settings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "system_settings_update_own_tenant" ON system_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- No DELETE policy: soft-delete via UPDATE deleted_at.
-- NOTE: GM/admin role-gating on private SELECT and UPDATE is enforced at
-- the application layer (Server Actions) per section 10.5; RLS handles
-- tenant isolation only.

-- =====================================================================
-- roles
-- =====================================================================
CREATE POLICY "roles_select_own_tenant" ON roles
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);

CREATE POLICY "roles_insert_own_tenant" ON roles
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "roles_update_own_tenant" ON roles
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- No DELETE policy: system roles protected; custom roles soft-deleted.

-- =====================================================================
-- role_permissions (no tenant_id — resolved via role join, section 10.4)
-- =====================================================================
CREATE POLICY "role_permissions_select" ON role_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND r.tenant_id = get_my_tenant_id()
        AND r.deleted_at IS NULL
    )
  );

CREATE POLICY "role_permissions_insert" ON role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND r.tenant_id = get_my_tenant_id()
        AND r.deleted_at IS NULL
    )
  );

CREATE POLICY "role_permissions_update" ON role_permissions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.tenant_id = get_my_tenant_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.tenant_id = get_my_tenant_id())
  );

-- No DELETE policy: rows removed via ON DELETE CASCADE when role is hard-deleted (service role).

-- =====================================================================
-- user_role_assignments
-- =====================================================================
CREATE POLICY "user_role_assignments_select_own_tenant" ON user_role_assignments
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);

CREATE POLICY "user_role_assignments_insert_own_tenant" ON user_role_assignments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "user_role_assignments_update_own_tenant" ON user_role_assignments
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- No DELETE policy: soft-delete via UPDATE deleted_at / revoke via revoked_at.

-- =====================================================================
-- tenant_memberships
-- =====================================================================
CREATE POLICY "tenant_memberships_select_own_tenant" ON tenant_memberships
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);

CREATE POLICY "tenant_memberships_insert_own_tenant" ON tenant_memberships
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "tenant_memberships_update_own_tenant" ON tenant_memberships
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- No DELETE policy: soft-delete via UPDATE deleted_at.

-- =====================================================================
-- invites
-- =====================================================================
CREATE POLICY "invites_select_own_tenant" ON invites
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id() AND deleted_at IS NULL);

CREATE POLICY "invites_insert_own_tenant" ON invites
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "invites_update_own_tenant" ON invites
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- No DELETE policy: soft-delete via UPDATE deleted_at; status='revoked' for revocation.

-- =====================================================================
-- audit_log (SELECT only — INSERT is service-role / SECURITY DEFINER;
-- UPDATE/DELETE blocked by trigger 009 + no policy here)
-- =====================================================================
CREATE POLICY "audit_log_select_own_tenant" ON audit_log
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());

-- No INSERT/UPDATE/DELETE policies: audit_log is immutable (ADR-007).
-- Inserts happen via service role or SECURITY DEFINER functions only.

-- =====================================================================
-- permissions (global catalog — read-only for all authenticated)
-- =====================================================================
CREATE POLICY "permissions_select_all" ON permissions
  FOR SELECT TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE: permissions catalog is service-role managed.
