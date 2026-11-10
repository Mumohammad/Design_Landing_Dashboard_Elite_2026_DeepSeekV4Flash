-- ============================================================================
-- 20260905091941_platform_admin_console_foundation.sql
-- RECONSTRUCTED BACKFILL (2026-09-15)
--
-- Applied to production out-of-band on 2026-09-05; original SQL was never
-- committed. Reconstructed from the live production catalog
-- (information_schema.columns, pg_constraint, pg_indexes, pg_policies,
-- pg_get_functiondef) so local `supabase db reset` converges to production.
--
-- Creates the platform admin console foundation:
--   * public.platform_admins    — who may administer the whole platform
--   * public.platform_invoices  — platform-level billing to tenants
--   * public.is_platform_admin() — SECURITY DEFINER check used by RLS
--   * initial RLS policies (rewritten to initplan form in 20260906220134)
--
-- NOTE: production holds one real admin row in platform_admins. User data is
-- deliberately NOT backfilled — seed your own admin locally, e.g.:
--   INSERT INTO public.platform_admins (user_id, email)
--   VALUES (auth.uid(), 'you@example.com');
-- ============================================================================

-- ─── platform_admins ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email      text NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_admins IS
  'Platform-level administrators (console access). Backfilled reconstruction of out-of-band production migration 20260905091941.';

-- ─── platform_invoices ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants (id),
  invoice_number text NOT NULL UNIQUE,
  period_label   text,
  amount         numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency       text NOT NULL DEFAULT 'SAR',
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status = ANY (ARRAY['pending', 'paid', 'overdue', 'void'])),
  due_date       date,
  paid_at        timestamptz,
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_invoices IS
  'Platform-level invoices billed to tenants. Backfilled reconstruction of out-of-band production migration 20260905091941.';

-- ─── is_platform_admin() ────────────────────────────────────────────────────
-- Exact production definition (pg_get_functiondef, 2026-09-15).
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$function$;

-- ─── Initial RLS policies ───────────────────────────────────────────────────
-- Original (non-initplan) form; rewritten by 20260906220134.
DROP POLICY IF EXISTS platform_admins_self_read ON public.platform_admins;
CREATE POLICY platform_admins_self_read
  ON public.platform_admins
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS platform_invoices_admin_read ON public.platform_invoices;
CREATE POLICY platform_invoices_admin_read
  ON public.platform_invoices
  FOR SELECT
  TO authenticated
  USING (is_platform_admin());
