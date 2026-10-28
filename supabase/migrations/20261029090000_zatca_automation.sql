-- Scheduled ZATCA submission backstop. Documents are prepared and submitted
-- when they are finalized; this table names the tenant user on whose behalf
-- the scheduled run retries documents that could not be submitted then
-- (gateway outage, missing permission). Service-role only; no client access.
CREATE TABLE public.zatca_automation (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES auth.users(id),
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_result jsonb CHECK (last_result IS NULL OR jsonb_typeof(last_result) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zatca_automation_operator ON public.zatca_automation(operator_id);
ALTER TABLE public.zatca_automation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_automation FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.zatca_automation TO service_role;

-- Whether a tenant user may still act as the ZATCA operator: active,
-- unlocked, in the tenant, with accounting:approve (or general manager).
-- Session assurance (MFA) cannot apply to a scheduled run; the operator's
-- grant is re-checked on every run so revoking the role stops automation.
CREATE FUNCTION public.zatca_operator_authorized(p_tenant uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = p_user AND u.tenant_id = p_tenant
      AND u.status = 'active'::public.user_status AND u.deleted_at IS NULL
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND (u.role = 'general_manager'::public.user_role OR EXISTS (
        SELECT 1 FROM public.roles r
        JOIN public.role_permissions rp ON rp.role_id = r.id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE r.tenant_id = u.tenant_id AND r.name = u.role AND r.deleted_at IS NULL
          AND p.module = 'accounting' AND p.action = 'approve'))
  );
$$;
REVOKE ALL ON FUNCTION public.zatca_operator_authorized(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zatca_operator_authorized(uuid, uuid) TO service_role;
