-- 007_audit_log.sql
-- Immutable audit trail (ADR-007). Append-only: NO updated_at, NO deleted_at.
-- Immutability enforced by trigger (009_triggers.sql) AND by RLS (no UPDATE/DELETE policy).
-- Source: docs/phase-2-schema-plan.md section 6.5

CREATE TABLE audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  actor_id     UUID REFERENCES auth.users(id),  -- NULL = system/service-role action
  module       TEXT NOT NULL,                  -- 'users' | 'roles' | 'settings' | 'drivers' | 'payroll' | ... (1-18 module list)
  entity_type  TEXT,                            -- 'user' | 'tenant' | 'role' | 'payroll_run' | ...
  entity_id    UUID,                            -- the affected row's id
  action       TEXT NOT NULL,                  -- TEXT not enum (see 4.2): 'created' | 'updated' | 'deleted' | 'role_assigned' | ...
  old_values   JSONB,
  new_values   JSONB,
  ip_address   INET,
  user_agent   TEXT,
  request_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant_created ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_actor           ON audit_log(actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_log_entity          ON audit_log(entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_audit_log_module_action   ON audit_log(tenant_id, module, action);
