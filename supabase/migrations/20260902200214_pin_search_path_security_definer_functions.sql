-- ============================================================================
-- 20260902200214_pin_search_path_security_definer_functions.sql
-- RECONSTRUCTED BACKFILL (2026-09-15)
--
-- This migration was applied to production out-of-band on 2026-09-02, before
-- repo migration tracking covered it; the original SQL was never committed.
-- This body was reconstructed from the live production catalog
-- (pg_proc.proconfig) so local `supabase db reset` converges to the same
-- schema. Production is already marked applied — this file only affects fresh
-- local/CI databases.
--
-- Effect: pins an explicit search_path on every SECURITY DEFINER function
-- present at the time (helper RPCs and trigger functions), closing the
-- search-path hijacking vector.
-- Guarded via to_regprocedure(): environments lacking a function skip it with
-- a NOTICE (repo convention, cf. Track 1).
-- ============================================================================

DO $$
DECLARE
  v_fn text;
  -- Helper RPCs pinned to (public, auth) — verified pg_proc.proconfig.
  v_helpers_auth text[] := ARRAY[
    'public.compute_driver_completeness(uuid)',
    'public.get_my_tenant_id()',
    'public.sync_auth_user_to_custom_users()'
  ];
  -- Trigger functions pinned to (public) — verified pg_proc.proconfig.
  v_triggers text[] := ARRAY[
    'public.assign_application_number()',
    'public.assign_application_status_token()',
    'public.assign_generated_doc_verify_token()',
    'public.block_posted_journal_delete()',
    'public.cleanup_lookup_rate_limits()',
    'public.credit_note_number_assign()',
    'public.debit_note_number_assign()',
    'public.enforce_journal_balance()',
    'public.enforce_journal_balance_on_post()',
    'public.enforce_journal_period_open()',
    'public.enforce_payment_alloc_totals()',
    'public.guard_payment_allocation()',
    'public.invoice_number_assign()',
    'public.prevent_audit_modification()',
    'public.prevent_odometer_regression()',
    'public.prevent_posted_journal_mutation()',
    'public.prevent_user_self_escalation()',
    'public.prevent_vehicle_odometer_regression()',
    'public.protect_credit_notes()',
    'public.protect_debit_notes()',
    'public.protect_finalized_invoice()',
    'public.protect_finalized_vat_adjustment()',
    'public.protect_invoice_lines()',
    'public.protect_vat_input_reclassify()',
    'public.update_updated_at_column()',
    'public.validate_chart_account()',
    'public.validate_expense_approval()',
    'public.validate_invoice()',
    'public.validate_party()'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_helpers_auth LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, auth', v_fn);
    ELSE
      RAISE NOTICE 'backfill 20260902200214: % not present; pin skipped', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY v_triggers LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_fn);
    ELSE
      RAISE NOTICE 'backfill 20260902200214: % not present; pin skipped', v_fn;
    END IF;
  END LOOP;

  -- Public token verifiers (059) — verified per-function configs.
  IF to_regprocedure('public.public_application_status(text)') IS NOT NULL THEN
    ALTER FUNCTION public.public_application_status(text) SET search_path = public, extensions;
  ELSE
    RAISE NOTICE 'backfill 20260902200214: public_application_status(text) not present; pin skipped';
  END IF;

  IF to_regprocedure('public.public_verify_document(text)') IS NOT NULL THEN
    ALTER FUNCTION public.public_verify_document(text) SET search_path = public;
  ELSE
    RAISE NOTICE 'backfill 20260902200214: public_verify_document(text) not present; pin skipped';
  END IF;
END;
$$;
