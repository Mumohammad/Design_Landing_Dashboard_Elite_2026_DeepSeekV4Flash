-- Business authorization must bind an active user to an active, undeleted tenant.
-- Keep low-assurance self-profile reads and has_required_assurance unchanged:
-- MFA enrollment/challenge needs identity before business authorization succeeds.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.tenant_id
  FROM public.users u
    JOIN public.tenants t ON t.id=u.tenant_id AND t.status='active'::public.tenant_status AND t.deleted_at IS NULL
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND u.status = 'active'::public.user_status
      AND public.has_required_assurance()
    AND u.deleted_at IS NULL
    AND (u.locked_until IS NULL OR u.locked_until <= now())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_has_permission(
  p_module text,
  p_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.tenants t ON t.id=u.tenant_id AND t.status='active'::public.tenant_status AND t.deleted_at IS NULL
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.status = 'active'::public.user_status
      AND public.has_required_assurance()
      AND u.deleted_at IS NULL
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND (
        u.role = 'general_manager'::public.user_role
        OR EXISTS (
          SELECT 1
          FROM public.roles r
          JOIN public.role_permissions rp ON rp.role_id = r.id
          JOIN public.permissions p ON p.id = rp.permission_id
          WHERE r.tenant_id = u.tenant_id
            AND r.name = u.role
            AND r.deleted_at IS NULL
            AND p.module = p_module
            AND p.action = p_action
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_permission(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_permission(text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.storage_path_in_current_tenant(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.tenants t ON t.id=u.tenant_id AND t.status='active'::public.tenant_status AND t.deleted_at IS NULL
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.status = 'active'::public.user_status
      AND public.has_required_assurance()
      AND u.deleted_at IS NULL
      AND (u.locked_until IS NULL OR u.locked_until <= now())
      AND p_name ~ (
        '^' || u.tenant_id::text || '/[^/]+(/[^/]+)*$'
      )
      AND p_name !~ '(^|/)\.\.?(/|$)'
      AND strpos(p_name, E'\\') = 0
  );
$$;

REVOKE ALL ON FUNCTION public.storage_path_in_current_tenant(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_path_in_current_tenant(text)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.is_callers_role(p_role_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM public.users u JOIN public.roles r
 ON r.tenant_id=u.tenant_id AND r.name=u.role AND r.deleted_at IS NULL
 JOIN public.tenants t ON t.id=u.tenant_id AND t.status='active'::public.tenant_status AND t.deleted_at IS NULL
 WHERE u.auth_user_id=(SELECT auth.uid()) AND u.status='active'::public.user_status
 AND u.deleted_at IS NULL AND (u.locked_until IS NULL OR u.locked_until<=now())
 AND public.has_required_assurance() AND r.id=p_role_id);
$$;

REVOKE ALL ON FUNCTION public.is_callers_role(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_callers_role(uuid) TO authenticated,service_role;
COMMIT;
