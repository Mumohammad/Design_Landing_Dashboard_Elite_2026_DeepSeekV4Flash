-- 006_system_settings.sql
-- Tenant-scoped key/value configuration store.
-- Replaces the hardcoded defaults in the dead src/lib/tenancy/tenant.ts stub (ADR-014).
-- Source: docs/phase-2-schema-plan.md section 6.4

CREATE TABLE system_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  key            TEXT NOT NULL,                -- e.g. 'security.max_failed_login_attempts'
  value          TEXT NOT NULL,                -- stored as text; parsed by consumer
  category       TEXT NOT NULL,                -- 'security' | 'attendance' | 'payroll' | 'violations' | 'orders' | 'system'
  description_ar TEXT,
  description_en TEXT,
  is_public      BOOLEAN NOT NULL DEFAULT false,  -- true = readable by any authenticated tenant user; false = GM/admin only
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES auth.users(id),
  updated_by     UUID REFERENCES auth.users(id),
  deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_system_settings_tenant_key
  ON system_settings(tenant_id, key) WHERE deleted_at IS NULL;
CREATE INDEX idx_system_settings_category
  ON system_settings(tenant_id, category) WHERE deleted_at IS NULL;
