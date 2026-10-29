BEGIN;

-- Platform-level admin allowlist (separate from tenant roles; service-role managed)
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Admins can read only their own row (used by UI gate); all writes are service-role only
DROP POLICY IF EXISTS platform_admins_self_read ON public.platform_admins;
CREATE POLICY platform_admins_self_read ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Server-side admin check used by API routes
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

COMMIT;
