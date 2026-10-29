-- ZATCA production readiness behind a per-tenant switch.
--
-- 1. The issuance ledger and submission attempts accept the production
--    (core) environment. Production rows are only written once a tenant's
--    administrator switched production ON and onboarded a production EGS
--    unit; the deployment additionally needs ZATCA_MODE=production and
--    ZATCA_PRODUCTION_ENABLED=true (src/lib/accounting/zatca-config.ts).
-- 2. zatca_tenant_environment stores that per-tenant switch. OFF by default:
--    every tenant keeps working on the simulation gateway until it opts in.
BEGIN;

ALTER TABLE public.zatca_issuance_streams DROP CONSTRAINT IF EXISTS zatca_issuance_streams_environment_check;
ALTER TABLE public.zatca_issuance_streams ADD CONSTRAINT zatca_issuance_streams_environment_check
  CHECK (environment IN ('sandbox','simulation','production'));

ALTER TABLE public.zatca_document_issuances DROP CONSTRAINT IF EXISTS zatca_document_issuances_environment_check;
ALTER TABLE public.zatca_document_issuances ADD CONSTRAINT zatca_document_issuances_environment_check
  CHECK (environment IN ('sandbox','simulation','production'));

ALTER TABLE public.zatca_submission_attempts DROP CONSTRAINT IF EXISTS zatca_submission_attempts_environment_check;
ALTER TABLE public.zatca_submission_attempts ADD CONSTRAINT zatca_submission_attempts_environment_check
  CHECK (environment IN ('sandbox','simulation','production'));

CREATE TABLE IF NOT EXISTS public.zatca_tenant_environment (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  production_enabled boolean NOT NULL DEFAULT false,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  -- Explicit taxpayer acknowledgement captured when switching ON.
  acknowledgement text CHECK (acknowledgement IS NULL OR length(acknowledgement) <= 500)
);
CREATE INDEX IF NOT EXISTS zatca_tenant_environment_changed_by ON public.zatca_tenant_environment(changed_by);
ALTER TABLE public.zatca_tenant_environment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_tenant_environment FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.zatca_tenant_environment TO service_role;

COMMIT;
