-- ============================================================================
-- 20260907183752_pin_search_path_and_revoke_internal_triggers.sql
-- RECONSTRUCTED BACKFILL (2026-09-15)
--
-- Applied to production out-of-band on 2026-09-07; original SQL was never
-- committed. Reconstructed from the live production catalog (pg_proc
-- proconfig + role EXECUTE privileges).
--
-- Effect:
--   1. Pins search_path on SECURITY DEFINER functions created after
--      20260902200214 (is_platform_admin from the platform console
--      foundation; approve_expense_atomic / check_rate_limit once their
--      migrations land).
--   2. Revokes direct EXECUTE on internal trigger functions. Trigger firing
--      does NOT require EXECUTE for the firing role, so any client-callable
--      trigger function is pure attack surface.
--
-- Verified production state (2026-09-15):
--   * is_platform_admin(): search_path=public
--   * approve_expense_atomic(uuid,uuid,numeric,text,uuid): search_path=public
--   * check_rate_limit(text,integer,integer): search_path="" (deliberate
--     empty pin — reproduced via SET search_path = '')
--   * EXECUTE revoked from PUBLIC/anon/authenticated on:
--     sync_auth_user_to_custom_users, prevent_user_self_escalation,
--     enforce_payment_alloc_totals, guard_payment_allocation
--     (attribution of the two payment guards is best-effort — they may
--     duplicate a repo 050 revoke; REVOKE is idempotent so both converge.
--     validate_chart_account was revoked later by Track 1 / 20260914141547.)
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.is_platform_admin()') IS NOT NULL THEN
    ALTER FUNCTION public.is_platform_admin() SET search_path = public;
  ELSE
    RAISE NOTICE 'backfill 20260907183752: is_platform_admin() not present; pin skipped';
  END IF;

  IF to_regprocedure('public.approve_expense_atomic(uuid,uuid,numeric,text,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.approve_expense_atomic(uuid,uuid,numeric,text,uuid) SET search_path = public;
  ELSE
    RAISE NOTICE 'backfill 20260907183752: approve_expense_atomic(...) not present; pin skipped';
  END IF;

  IF to_regprocedure('public.check_rate_limit(text,integer,integer)') IS NOT NULL THEN
    ALTER FUNCTION public.check_rate_limit(text,integer,integer) SET search_path = '';
  ELSE
    RAISE NOTICE 'backfill 20260907183752: check_rate_limit(...) not present; pin skipped';
  END IF;
END;
$$;

DO $$
DECLARE
  v_fn text;
  v_internal_triggers text[] := ARRAY[
    'public.sync_auth_user_to_custom_users()',
    'public.prevent_user_self_escalation()',
    'public.enforce_payment_alloc_totals()',
    'public.guard_payment_allocation()'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_internal_triggers LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    ELSE
      RAISE NOTICE 'backfill 20260907183752: % not present; revoke skipped', v_fn;
    END IF;
  END LOOP;
END;
$$;
