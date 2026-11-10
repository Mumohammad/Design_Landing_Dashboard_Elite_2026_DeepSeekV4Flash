-- ============================================================================
-- Users Module — surface (Module 14)
-- (20260924120000_users_module_surface.sql)
--
-- Scope: schema support the Users module surface needs beyond the Phase-2
-- tables (users / roles / role_permissions / user_role_assignments /
-- tenant_memberships / invites — migrations 005 + 008; RLS hardening 058):
--
--   1. user_employee_code_seq + next_employee_code(uuid) — tenant-scoped
--      sequence-driven employee codes (per docs/phase-2-schema-plan.md 6.3:
--      sequence-driven, never COUNT(*)+1) and audit_log-style timing-safety.
--   2. user_consents — PDPL consent ledger for profile holders (the users
--      analogue of driver_consents): terms/privacy/marketing, versioned,
--      provable (accepted_at + ip_hash), append-only (no DELETE policy).
--   3. has_user_pdpl_consent(uuid, text) — PDPL masking gate for sensitive
--      profile fields (national_id, phone) — the users analogue of the
--      drivers-module has_pdpl_consent gate (20260923120000 §5).
--   4. RLS + grants per Track 1 conventions (idempotent, service-role-only
--      EXECUTE on the definer helper).
--
-- Conventions (Track 1):
--   * Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / guarded DO blocks.
--   * Append-only table: RLS enabled, tenant SELECT/INSERT policies via
--     get_my_tenant_id(), and NO hard-DELETE policy.
--   * SECURITY DEFINER helper: pinned search_path, service_role EXECUTE only.
--   * No data seeds; no production data touched.
--
-- Rollback (forward-only repo, notes only):
--   DROP FUNCTION IF EXISTS public.has_user_pdpl_consent(uuid, text);
--   DROP TABLE IF EXISTS public.user_consents;
--   DROP FUNCTION IF EXISTS public.next_employee_code(uuid);
--   DROP SEQUENCE IF EXISTS public.user_employee_code_seq;
-- ============================================================================

-- ─── 1. Employee code sequence + helper ─────────────────────────────────────
-- Sequence-driven employee codes (schema plan 6.3: NOT COUNT(*)+1).
-- next_employee_code() formats to 'EDU-000123'. SECURITY DEFINER so any
-- authenticated invite/accept path can mint a code without needing direct
-- SEQUENCE USAGE; the sequence itself is revoked from all non-owner roles.

CREATE SEQUENCE IF NOT EXISTS public.user_employee_code_seq START 1000;

CREATE OR REPLACE FUNCTION public.next_employee_code(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_code text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'next_employee_code: p_tenant_id is required';
  END IF;
  v_code := 'EDU-' || lpad(nextval('public.user_employee_code_seq')::text, 6, '0');
  RETURN v_code;
END;
$func$;

REVOKE ALL ON SEQUENCE public.user_employee_code_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.next_employee_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_employee_code(uuid) TO authenticated, service_role;

COMMENT ON SEQUENCE public.user_employee_code_seq IS
  'Users module: tenant-wide employee-code sequence (EDU-NNNNNN). Next value is only consumed via next_employee_code(); sequence is not directly grantable.';
COMMENT ON FUNCTION public.next_employee_code(uuid) IS
  'Users module: mints the next tenant-scoped employee code (EDU-NNNNNN) from user_employee_code_seq. SECURITY DEFINER; authenticated + service_role.';

-- ─── 2. user_consents — PDPL consent ledger (append-only) ───────────────────
-- Versioned, provable consent records for users-module profile holders.
-- Mirrors driver_consents (drivers-module foundation §3.1): no deleted_at
-- (append-only), no DELETE policy; UNIQUE (tenant, user, type, version).

CREATE TABLE IF NOT EXISTS public.user_consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id),
  user_id      uuid NOT NULL REFERENCES public.users (id),
  consent_type text NOT NULL CHECK (consent_type IN ('terms', 'privacy', 'marketing')),
  version      text NOT NULL,
  accepted     boolean NOT NULL DEFAULT false,
  accepted_at  timestamptz,
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  UNIQUE (tenant_id, user_id, consent_type, version)
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user   ON public.user_consents (user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_tenant ON public.user_consents (tenant_id);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS user_consents_tenant_sel ON public.user_consents';
  EXECUTE $sql$
    CREATE POLICY user_consents_tenant_sel
    ON public.user_consents
    FOR SELECT
    TO authenticated
    USING (tenant_id = get_my_tenant_id())
  $sql$;

  EXECUTE 'DROP POLICY IF EXISTS user_consents_tenant_ins ON public.user_consents';
  EXECUTE $sql$
    CREATE POLICY user_consents_tenant_ins
    ON public.user_consents
    FOR INSERT
    TO authenticated
    WITH CHECK (tenant_id = get_my_tenant_id())
  $sql$;

  -- Intentionally NO UPDATE and NO DELETE policy: the PDPL ledger is
  -- append-only (same posture as driver_consents).
END;
$$;

COMMENT ON TABLE public.user_consents IS
  'PDPL consent ledger for users-module profile holders: terms/privacy/marketing, versioned with acceptance timestamp and ip_hash. Append-only — no UPDATE/DELETE policies (same posture as driver_consents). Tenant-isolated.';

-- ─── 3. has_user_pdpl_consent — masking gate for sensitive profile fields ───
-- SECURITY DEFINER: the callers are authenticated surfaces that must not
-- depend on the caller having SELECT on user_consents. The definer-side read
-- is tenant-safe because the function only answers "did THIS user consent".

CREATE OR REPLACE FUNCTION public.has_user_pdpl_consent(
  p_user_id     uuid,
  p_consent_type text DEFAULT 'terms'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_consents c
    WHERE c.user_id = p_user_id
      AND c.consent_type = p_consent_type
      AND c.accepted IS TRUE
      AND c.version = (
        SELECT c2.version
        FROM public.user_consents c2
        WHERE c2.user_id = p_user_id
          AND c2.consent_type = p_consent_type
        ORDER BY c2.created_at DESC, c2.id DESC
        LIMIT 1
      )
  );
$func$;

REVOKE ALL ON FUNCTION public.has_user_pdpl_consent(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_user_pdpl_consent(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_user_pdpl_consent(uuid, text) IS
  'Users module PDPL gate: true when the user''s LATEST consent row of the given type is accepted. SECURITY DEFINER; authenticated + service_role. Sensitive profile fields are masked in UI until this returns true.';

-- ─── 4. Scope note ──────────────────────────────────────────────────────────
-- Not included (by design): role CRUD (roles table writes stay service-role
-- only per 058 — role changes flow through existing invite/accept actions);
-- production data; email templates. Validated by
-- supabase/tests/061_users_module_tests.sql.
