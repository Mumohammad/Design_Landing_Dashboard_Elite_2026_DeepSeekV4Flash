-- 002_enums.sql
CREATE TYPE user_role AS ENUM (
  'general_manager', 'admin', 'accountant', 'supervisor',
  'hr_officer', 'operations_officer', 'payroll_officer',
  'platform_coordinator', 'readonly_auditor'
);

CREATE TYPE user_status AS ENUM (
  'active', 'inactive', 'locked', 'pending_invite', 'terminated'
);

CREATE TYPE invite_status AS ENUM (
  'pending', 'accepted', 'expired', 'revoked'
);

CREATE TYPE tenant_status AS ENUM (
  'active', 'suspended', 'terminated'
);

CREATE TYPE tenant_plan AS ENUM (
  'single_tenant', 'multi_tenant'
);
