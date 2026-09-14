-- ============================================================================
-- Track 1 — RPC EXECUTE grants & RLS policy hardening
-- (20260914141547_track1_rpc_grants_and_system_settings_policy.sql)
--
-- Scope: privilege boundaries only. No function bodies, no table data,
-- no API response shapes, no INSERT/UPDATE policy changes.
--
-- Principles (mirrors 062/063 conventions):
--   * REVOKE from PUBLIC/anon/authenticated first, GRANT narrowly after.
--   * Exact function signatures in every GRANT/REVOKE (overload safety).
--   * Idempotent: DROP POLICY IF EXISTS guards each policy create.
--   * Every function-level REVOKE/GRANT is guarded via to_regprocedure():
--     on environments where the function is absent (e.g. a clean/reduced
--     `supabase db reset`) the statements are skipped with a NOTICE
--     instead of failing the migration. When the function exists, the
--     revokes, grants, and (for the public verifiers) comments are
--     re-applied idempotently as a group.
--
-- ⚠️  NEVER applied by this task: no SQL/DDL was executed against any
--     Supabase project. This file is applied only by the normal migration
--     pipeline (supabase db reset / CI pgtap job / production release).
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════
-- 1. Internal SECURITY DEFINER functions — service-role only EXECUTE
-- ═══════════════════════════════════════════════════════════════════

-- compute_driver_completeness(uuid): created in 015 (driver compliance),
-- search_path pinned in 061. SECURITY DEFINER helper; no client needs it.
-- Guarded: the function may be absent on a fresh/reset database.
DO $$
BEGIN
  IF to_regprocedure('public.compute_driver_completeness(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.compute_driver_completeness(uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.compute_driver_completeness(uuid)
      TO service_role;
  ELSE
    RAISE NOTICE 'track1: public.compute_driver_completeness(uuid) not present; grants/revokes skipped';
  END IF;
END;
$$;

-- validate_chart_account(): trigger function (033) attached to
-- chart_of_accounts. Trigger invocation does NOT require EXECUTE for the
-- firing role — only the table owner needs it. It must remain un-granted
-- to anon/authenticated/service_role RPC callers.
-- Guarded: the function may be absent on a fresh/reset database.
DO $$
BEGIN
  IF to_regprocedure('public.validate_chart_account()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.validate_chart_account()
      FROM PUBLIC, anon, authenticated;
  ELSE
    RAISE NOTICE 'track1: public.validate_chart_account() not present; revoke skipped';
  END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RLS helper functions — authenticated + service_role only
-- ═══════════════════════════════════════════════════════════════════

-- get_my_tenant_id(): used by tenant RLS policies throughout (010).
-- anon/PUBLIC lose EXECUTE; authenticated keeps it — the RLS policies
-- themselves call this function on behalf of authenticated callers.
REVOKE EXECUTE ON FUNCTION public.get_my_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id()
  TO authenticated, service_role;

-- is_platform_admin(): production-only helper used by the platform invoice
-- RLS policy. Not present in repo migrations (fresh reset DBs may lack it),
-- so guard with to_regprocedure(). PUBLIC is revoked; authenticated and
-- service_role keep EXECUTE because the platform invoice policy evaluates
-- it for authenticated callers.
DO $$
BEGIN
  IF to_regprocedure('public.is_platform_admin()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_platform_admin()
      TO authenticated, service_role;
  ELSE
    RAISE NOTICE 'track1: public.is_platform_admin() not present; grants/revokes skipped';
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Intentional public token-verification functions
-- ═══════════════════════════════════════════════════════════════════
-- public_verify_document(text) / public_application_status(text) (059) are
-- SECURITY DEFINER endpoints behind opaque 256-bit tokens. Rate limiting:
-- public_application_status(text) rate-limits per IP inside the function;
-- public_verify_document(text) has no in-function rate limiter (any
-- rate-limiting for it would have to come from a proven external guard).
-- Anonymous execution is INTENTIONAL: they power the unauthenticated
-- /verify-document and application-status pages.
-- Guarded as a group: REVOKE, GRANT, and COMMENT on each verifier are all
-- inside one to_regprocedure() block — clean/reduced reset databases may
-- not contain these functions at all.

DO $$
BEGIN
  IF to_regprocedure('public.public_verify_document(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.public_verify_document(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.public_verify_document(text)
      TO anon, authenticated, service_role;
    COMMENT ON FUNCTION public.public_verify_document(text) IS
      'Track 1: anonymous EXECUTE is intentional — public QR/document verification by opaque high-entropy token, SECURITY DEFINER, returns minimum safe fields. No per-IP rate limiter inside the function.';
  ELSE
    RAISE NOTICE 'track1: public.public_verify_document(text) not present; grants/revokes/comment skipped';
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.public_application_status(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.public_application_status(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.public_application_status(text)
      TO anon, authenticated, service_role;
    COMMENT ON FUNCTION public.public_application_status(text) IS
      'Track 1: anonymous EXECUTE is intentional — public application status lookup by opaque high-entropy token, SECURITY DEFINER, rate-limited per IP, returns minimum safe fields.';
  ELSE
    RAISE NOTICE 'track1: public.public_application_status(text) not present; grants/revokes/comment skipped';
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Direct table grants — backend/service-role operational tables
-- ═══════════════════════════════════════════════════════════════════

-- public_lookup_rate_limits (059): per-IP rate-limit counters written only
-- inside the public_* RPCs (SECURITY DEFINER). No client touches it directly.
REVOKE ALL ON TABLE public.public_lookup_rate_limits
  FROM PUBLIC, anon, authenticated;

-- zatca_csids (055/056): live ZATCA credentials (CSID certificate + secret).
-- RLS enabled with ZERO policies; direct client access must stay denied.
REVOKE ALL ON TABLE public.zatca_csids
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.public_lookup_rate_limits IS
  'Track 1: backend/service-role operational table — per-IP counters for the public token-verification RPCs. Direct client access revoked; written only by the SECURITY DEFINER RPCs.';

COMMENT ON TABLE public.zatca_csids IS
  'Track 1: backend/service-role operational table — live ZATCA CSID credentials (055/056). RLS with zero policies; direct client access revoked; read/written only by service-role server actions.';

-- ═══════════════════════════════════════════════════════════════════
-- 5. system_settings policy consolidation (010 → here)
-- ═══════════════════════════════════════════════════════════════════
-- The two 010 policies (select_public / select_private) are a split by the
-- is_public column whose union is a tautology over the shared predicates.
-- One policy preserves the combined effective predicate exactly:
--   tenant_id = get_my_tenant_id() AND deleted_at IS NULL
-- INSERT/UPDATE policies (system_settings_insert_own_tenant /
-- system_settings_update_own_tenant) are NOT touched.

DROP POLICY IF EXISTS system_settings_select_private ON public.system_settings;
DROP POLICY IF EXISTS system_settings_select_public ON public.system_settings;
-- Drop-then-create makes this migration re-runnable (CREATE POLICY has no
-- IF NOT EXISTS); the definition is deterministic, so a re-apply converges
-- to the same policy rather than failing on an existing one.
DROP POLICY IF EXISTS system_settings_select_own_tenant ON public.system_settings;

CREATE POLICY system_settings_select_own_tenant
  ON public.system_settings
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_my_tenant_id()
    AND deleted_at IS NULL
  );

COMMENT ON POLICY system_settings_select_own_tenant ON public.system_settings IS
  'Track 1: consolidation of 010 system_settings_select_public + system_settings_select_private. Combined effective predicate preserved: own tenant AND not soft-deleted. is_public no longer gates SELECT; role-gating on private settings remains enforced in server actions (010 note).';
