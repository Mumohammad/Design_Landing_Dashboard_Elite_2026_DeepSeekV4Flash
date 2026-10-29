BEGIN;
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
COMMIT;
