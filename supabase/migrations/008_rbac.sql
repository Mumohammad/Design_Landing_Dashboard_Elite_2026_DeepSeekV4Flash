-- 008_rbac.sql
-- Role-Based Access Control tables (ADR-006): roles, permissions, role_permissions,
-- user_role_assignments, tenant_memberships, invites.
-- Source: docs/phase-2-schema-plan.md sections 6.6 and 6.7

-- =====================================================================
-- Part 1: roles, permissions, role_permissions (section 6.6)
-- =====================================================================

CREATE TABLE roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  name            user_role NOT NULL,
  name_ar         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  description     TEXT,
  is_system_role  BOOLEAN NOT NULL DEFAULT false,   -- system roles cannot be deleted
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_roles_tenant_name ON roles(tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX        idx_roles_active      ON roles(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module       TEXT NOT NULL,            -- 'drivers' | 'vehicles' | 'payroll' | ... (catalog of module+action pairs)
  action       TEXT NOT NULL,            -- 'read' | 'create' | 'update' | 'delete' | 'approve' | 'export' | 'print' | 'manage'
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NOTE: permissions are GLOBAL (no tenant_id). This is a catalog of module+action pairs.
);

CREATE UNIQUE INDEX idx_permissions_module_action ON permissions(module, action);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),
  PRIMARY KEY (role_id, permission_id)
  -- NOTE: no tenant_id; derivable via role_id -> roles.tenant_id. RLS applies via the roles join (section 10).
);

CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);

-- =====================================================================
-- Part 2: user_role_assignments, tenant_memberships, invites (section 6.7)
-- =====================================================================

CREATE TABLE user_role_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id      UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by  UUID REFERENCES auth.users(id),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,                  -- NULL = active assignment
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES auth.users(id),
  updated_by   UUID REFERENCES auth.users(id),
  deleted_at   TIMESTAMPTZ
);

-- One active (non-revoked, non-deleted) assignment per (tenant, user, role).
CREATE UNIQUE INDEX idx_user_role_assignments_active
  ON user_role_assignments(tenant_id, user_id, role_id)
  WHERE deleted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_user_role_assignments_user
  ON user_role_assignments(tenant_id, user_id) WHERE deleted_at IS NULL;

CREATE TABLE tenant_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT true,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  deleted_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_tenant_memberships_active
  ON tenant_memberships(tenant_id, user_id) WHERE deleted_at IS NULL;

CREATE TABLE invites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  email            TEXT NOT NULL,
  role             user_role NOT NULL,
  token_hash       TEXT UNIQUE NOT NULL,        -- hash of the invite token; never store raw token
  invited_by       UUID REFERENCES auth.users(id),
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  accepted_by      UUID REFERENCES auth.users(id),
  status           invite_status NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX idx_invites_active      ON invites(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invites_email       ON invites(tenant_id, lower(email)) WHERE deleted_at IS NULL;
-- token_hash already UNIQUE via column constraint.
