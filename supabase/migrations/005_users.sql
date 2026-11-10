-- 005_users.sql
-- Custom users table extending Supabase auth.users (one-to-one via auth_user_id).
-- Holds auth-adjacent state Supabase Auth does not model: lockout, 2FA, password rotation, invite acceptance.
-- Source: docs/phase-2-schema-plan.md section 6.3

CREATE TABLE users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id            UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  employee_code           TEXT,                              -- tenant-scoped HR code (sequence-driven, not COUNT+1)
  full_name_ar            TEXT,
  full_name_en            TEXT,
  preferred_name          TEXT,
  email                   TEXT NOT NULL,
  phone                   TEXT,
  role                    user_role NOT NULL DEFAULT 'readonly_auditor',
  status                  user_status NOT NULL DEFAULT 'pending_invite',
  avatar_url              TEXT,
  must_change_password    BOOLEAN NOT NULL DEFAULT true,
  two_factor_enabled      BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret       TEXT,
  locked_until            TIMESTAMPTZ,
  failed_login_attempts   SMALLINT NOT NULL DEFAULT 0,
  last_login_at           TIMESTAMPTZ,
  last_login_ip           INET,
  password_changed_at     TIMESTAMPTZ,
  invited_by              UUID REFERENCES auth.users(id),
  invited_at              TIMESTAMPTZ,
  accepted_invite_at      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID REFERENCES auth.users(id),
  updated_by              UUID REFERENCES auth.users(id),
  deleted_at              TIMESTAMPTZ,
  CONSTRAINT chk_users_failed_login CHECK (failed_login_attempts >= 0)
);

CREATE UNIQUE INDEX idx_users_auth_user_id ON users(auth_user_id) WHERE deleted_at IS NULL;
CREATE INDEX        idx_users_email        ON users(lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX        idx_users_employee_code ON users(tenant_id, employee_code) WHERE deleted_at IS NULL;
