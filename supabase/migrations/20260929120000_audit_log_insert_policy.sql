-- ============================================================================
-- Driver photo workflow — audit trail INSERT policy
-- (20260929120000_audit_log_insert_policy.sql)
--
-- Root cause this fixes: server actions that record audit entries through the
-- AUTHENTICATED supabase client (driver photo update/remove, driver documents,
-- driver cards, compliance overrides) were silently RLS-denied — audit_log
-- carried only a SELECT policy (010_rls_policies.sql, ADR-007 comment said
-- inserts happen via service role), so every photo_updated / photo_removed /
-- document audit row vanished without an error.
--
-- Policy (still ADR-007-safe — immutability is preserved by the UPDATE/DELETE
-- trigger in 009 and by granting no UPDATE/DELETE policies):
--   * authenticated may INSERT a row only when
--       - tenant_id is their own tenant (get_my_tenant_id()), AND
--       - actor_id is their own auth uid (no forging someone else's trail)
--   * anon and service_role are unaffected (service_role bypasses RLS).
--   * UPDATE/DELETE stay impossible for authenticated (no policy + trigger).
--
-- Guarded for idempotent re-runs (fresh CI DBs and long-lived local DBs).
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. INSERT policy: own tenant + own actor only
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'audit_log'
      AND policyname = 'audit_log_insert_own_actor'
  ) THEN
    CREATE POLICY "audit_log_insert_own_actor" ON public.audit_log
      FOR INSERT TO authenticated
      WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND actor_id = (SELECT auth.uid())
      );
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Immutability guard still in place (no UPDATE/DELETE policies, trigger on)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  v_policies int;
BEGIN
  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'audit_log'
    AND cmd IN ('UPDATE', 'DELETE');

  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'audit_log must not carry UPDATE/DELETE policies (ADR-007)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.audit_log'::regclass
      AND tgname  = 'trg_audit_log_immutable'
      AND tgenabled <> 'D' -- 'D' = disabled
  ) THEN
    RAISE EXCEPTION 'trg_audit_log_immutable trigger missing or disabled on audit_log';
  END IF;
END
$$;
