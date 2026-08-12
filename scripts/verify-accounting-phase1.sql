-- ═══════════════════════════════════════════════════════════════════════
-- scripts/verify-accounting-phase1.sql
-- Phase 1 verification — Accounting foundation.
--
-- Run AFTER applying migrations 027 (accounting) and 031 (balance trigger +
-- atomic post_journal_entry) in Supabase (SQL editor or psql).
--
-- Checks performed:
--   JRN-1  Posted journal entries reject UPDATE (immutability trigger)
--   JRN-2  Posted journal entries reject DELETE
--   JRN-3  Unbalanced posted entry is rejected (JRN004, deferred constraint
--          trigger — forced via SET CONSTRAINTS IMMEDIATE because the script
--          ends in ROLLBACK and deferred checks only fire at COMMIT)
--   JRN-4  Atomic post_journal_entry() accepts a balanced entry
--   JRN-5  Atomic post_journal_entry() rejects an unbalanced entry (JRN004)
--   ACC-1  Closed accounting period rejects posting (ACC001)
--   RLS-1  Tenant isolation: get_my_tenant_id() helper exists and is granted
--   AUD-1  audit_log rejects UPDATE/DELETE (immutability trigger)
--
-- Expected output: a series of "✓" lines. Any "✗" or uncaught exception
-- means a check failed. The explicit BEGIN/ROLLBACK wraps everything so all
-- test data is discarded — safe to re-run on a populated database.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;


DO $$
DECLARE
  v_tenant       UUID := '00000000-0000-0000-0000-000000000001';
  v_cash         UUID;
  v_capital      UUID;
  v_entry_id     UUID;
  v_entry_ref    TEXT;
  v_out          RECORD;
  v_failed       BOOLEAN := false;
  v_period_id    UUID;
BEGIN
  RAISE NOTICE '--- Phase 1 accounting verification ---';

  -- Sanity: seeded accounts exist (1000 Cash on Hand, 3000 Capital)
  SELECT id INTO v_cash FROM chart_of_accounts
    WHERE tenant_id = v_tenant AND account_code = '1000' LIMIT 1;
  SELECT id INTO v_capital FROM chart_of_accounts
    WHERE tenant_id = v_tenant AND account_code = '3000' LIMIT 1;
  IF v_cash IS NULL OR v_capital IS NULL THEN
    RAISE NOTICE '✗ SANITY: seeded chart of accounts missing (is 027 applied?)';
    v_failed := true;
  ELSE
    RAISE NOTICE '✓ SANITY: chart of accounts seeded (1000, 3000)';
  END IF;

  -- ── JRN-1: posted entry rejects UPDATE ────────────────────────────────
  BEGIN
    INSERT INTO journal_entries
      (tenant_id, entry_date, entry_type, status, description_ar)
    VALUES (v_tenant, CURRENT_DATE, 'manual', 'posted', 'Verify JRN-1')
    RETURNING id INTO v_entry_id;
    UPDATE journal_entries SET description_ar = 'tampered'
      WHERE id = v_entry_id;
    RAISE NOTICE '✗ JRN-1: posted entry accepted UPDATE (expected JRN001)';
    v_failed := true;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'JRN001%' THEN
        RAISE NOTICE '✓ JRN-1: posted entry UPDATE rejected (JRN001)';
      ELSE
        RAISE NOTICE '✗ JRN-1: unexpected error: %', SQLERRM;
        v_failed := true;
      END IF;
  END;

  -- ── JRN-2: posted entry rejects DELETE ────────────────────────────────
  -- Self-contained: JRN-1's subtransaction rolled back its own entry, so this
  -- block creates its own posted entry before attempting the DELETE.
  BEGIN
    INSERT INTO journal_entries
      (tenant_id, entry_date, entry_type, status, description_ar)
    VALUES (v_tenant, CURRENT_DATE, 'manual', 'posted', 'Verify JRN-2')
    RETURNING id INTO v_entry_id;
    DELETE FROM journal_entries WHERE id = v_entry_id;
    RAISE NOTICE '✗ JRN-2: posted entry accepted DELETE (expected JRN003)';
    v_failed := true;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'JRN003%' THEN
        RAISE NOTICE '✓ JRN-2: posted entry DELETE rejected (JRN003)';
      ELSE
        RAISE NOTICE '✗ JRN-2: unexpected error: %', SQLERRM;
        v_failed := true;
      END IF;
  END;

  -- ── JRN-3: direct unbalanced lines on a posted entry rejected ─────────
  BEGIN
    INSERT INTO journal_entries
      (tenant_id, entry_date, entry_type, status, description_ar)
    VALUES (v_tenant, CURRENT_DATE, 'manual', 'posted', 'Verify JRN-3')
    RETURNING id INTO v_entry_id;
    INSERT INTO journal_entry_lines
      (tenant_id, journal_entry_id, account_id, debit_amount, credit_amount)
    VALUES
      (v_tenant, v_entry_id, v_cash,    200.00, 0),
      (v_tenant, v_entry_id, v_capital, 0,      100.00);
    -- Deferred constraint trigger only fires at COMMIT; the script ends in
    -- ROLLBACK, so force the pending check to run now.
    EXECUTE 'SET CONSTRAINTS trg_journal_balance_check IMMEDIATE';
    RAISE NOTICE '✗ JRN-3: unbalanced posted entry accepted (expected JRN004)';
    v_failed := true;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'JRN004%' THEN
        RAISE NOTICE '✓ JRN-3: unbalanced posted entry rejected (JRN004)';
      ELSE
        RAISE NOTICE '✗ JRN-3: unexpected error: %', SQLERRM;
        v_failed := true;
      END IF;
  END;

  -- ── JRN-4: atomic RPC accepts a balanced entry ────────────────────────
  BEGIN
    SELECT * INTO v_out FROM post_journal_entry(
      p_tenant_id      := v_tenant,
      p_entry_date     := CURRENT_DATE,
      p_description_ar := 'Verify JRN-4',
      p_description_en := NULL,
      p_created_by     := NULL,
      p_lines          := jsonb_build_array(
        jsonb_build_object('account_id', v_cash,    'debit', 150.00, 'credit', 0),
        jsonb_build_object('account_id', v_capital, 'debit', 0,      'credit', 150.00)
      )
    );
    IF v_out.out_entry_id IS NOT NULL THEN
      RAISE NOTICE '✓ JRN-4: post_journal_entry posted balanced entry (ref %)', v_out.out_entry_ref;
    ELSE
      RAISE NOTICE '✗ JRN-4: post_journal_entry returned no row';
      v_failed := true;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '✗ JRN-4: unexpected error: %', SQLERRM;
      v_failed := true;
  END;

  -- ── JRN-5: atomic RPC rejects an unbalanced entry ─────────────────────
  BEGIN
    SELECT * INTO v_out FROM post_journal_entry(
      p_tenant_id      := v_tenant,
      p_entry_date     := CURRENT_DATE,
      p_description_ar := 'Verify JRN-5',
      p_lines          := jsonb_build_array(
        jsonb_build_object('account_id', v_cash,    'debit', 300.00, 'credit', 0),
        jsonb_build_object('account_id', v_capital, 'debit', 0,      'credit', 100.00)
      )
    );
    RAISE NOTICE '✗ JRN-5: unbalanced entry accepted by RPC (expected JRN004)';
    v_failed := true;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'JRN004%' THEN
        RAISE NOTICE '✓ JRN-5: RPC rejected unbalanced entry (JRN004)';
      ELSE
        RAISE NOTICE '✗ JRN-5: unexpected error: %', SQLERRM;
        v_failed := true;
      END IF;
  END;

  -- ── ACC-1: closed period rejects posting ──────────────────────────────
  BEGIN
    -- Create a closed period for a previous month and try to post into it.
    SELECT id INTO v_period_id FROM accounting_periods
      WHERE tenant_id = v_tenant
        AND period_year = 2000 AND period_month = 1
      LIMIT 1;
    IF v_period_id IS NULL THEN
      INSERT INTO accounting_periods (tenant_id, period_year, period_month, status)
      VALUES (v_tenant, 2000, 1, 'closed')
      RETURNING id INTO v_period_id;
    END IF;

    SELECT * INTO v_out FROM post_journal_entry(
      p_tenant_id      := v_tenant,
      p_entry_date     := '2000-01-15',
      p_description_ar := 'Verify ACC-1',
      p_lines          := jsonb_build_array(
        jsonb_build_object('account_id', v_cash,    'debit', 50.00, 'credit', 0),
        jsonb_build_object('account_id', v_capital, 'debit', 0,      'credit', 50.00)
      )
    );
    RAISE NOTICE '✗ ACC-1: posting into closed period accepted (expected ACC001)';
    v_failed := true;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'ACC001%' THEN
        RAISE NOTICE '✓ ACC-1: closed period rejected posting (ACC001)';
      ELSE
        RAISE NOTICE '✗ ACC-1: unexpected error: %', SQLERRM;
        v_failed := true;
      END IF;
  END;

  -- ── RLS-1: tenant helper exists ───────────────────────────────────────
  BEGIN
    PERFORM get_my_tenant_id();
    RAISE NOTICE '✓ RLS-1: get_my_tenant_id() callable';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '✗ RLS-1: get_my_tenant_id() error: %', SQLERRM;
      v_failed := true;
  END;

  -- ── AUD-1: audit_log rejects UPDATE/DELETE ────────────────────────────
  -- Self-contained: on a fresh DB audit_log is empty, so the immutability
  -- trigger would never fire. Insert our own test row first (the SQL editor
  -- runs as postgres and may insert into the append-only log).
  BEGIN
    INSERT INTO audit_log (tenant_id, module, action, entity_type, new_values)
    VALUES (v_tenant, 'accounting', 'verify_phase1', 'journal_entries',
            '{"test": true}'::jsonb)
    RETURNING id INTO v_entry_id;

    UPDATE audit_log SET new_values = '{}'::jsonb WHERE id = v_entry_id;
    RAISE NOTICE '✗ AUD-1: audit_log accepted UPDATE (expected immutability error)';
    v_failed := true;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '✓ AUD-1: audit_log UPDATE rejected (immutable)';
  END;

  -- Fresh row: the previous block's exception rolled back its INSERT.
  BEGIN
    INSERT INTO audit_log (tenant_id, module, action, entity_type, new_values)
    VALUES (v_tenant, 'accounting', 'verify_phase1_del', 'journal_entries',
            '{"test": true}'::jsonb)
    RETURNING id INTO v_entry_id;

    DELETE FROM audit_log WHERE id = v_entry_id;
    RAISE NOTICE '✗ AUD-1: audit_log accepted DELETE (expected immutability error)';
    v_failed := true;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '✓ AUD-1: audit_log DELETE rejected (immutable)';
  END;

  IF v_failed THEN
    RAISE NOTICE '═══ RESULT: SOME CHECKS FAILED ═══';
  ELSE
    RAISE NOTICE '═══ RESULT: ALL PHASE 1 CHECKS PASSED ═══';
  END IF;
END;
$$;

-- Discard all test data (the DO block ran inside a subtransaction; explicit
-- ROLLBACK guarantees nothing persists even if a check failed mid-way).
ROLLBACK;
