-- Aggregate the caller's complete VAT position before Data API row limits.
-- Read-only, one snapshot, and the canonical reconciliation view retains RLS.
CREATE OR REPLACE FUNCTION public.read_my_vat_position()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL OR NOT COALESCE(public.user_has_permission('accounting', 'read'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'VAT access denied';
  END IF;
  SELECT jsonb_build_object(
    'output_vat', COALESCE(SUM(r.output_vat), 0)::text,
    'recoverable_input_vat', COALESCE(SUM(r.recoverable_input_vat), 0)::text,
    'non_recoverable_vat', COALESCE(SUM(r.non_recoverable_vat), 0)::text,
    'pending_review_vat', COALESCE(SUM(r.pending_review_vat), 0)::text,
    'adjustments_output', COALESCE(SUM(r.adjustments_output), 0)::text,
    'adjustments_input', COALESCE(SUM(r.adjustments_input), 0)::text,
    'net_position', COALESCE(SUM(r.net_position), 0)::text,
    'period_count', COUNT(*)
  ) INTO v_result
  FROM public.vat_reconciliation r WHERE r.tenant_id = v_tenant;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_my_vat_position() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_my_vat_position() TO authenticated, service_role;
COMMENT ON FUNCTION public.read_my_vat_position() IS
  'Caller-bound read-only VAT totals across all recorded periods; finalized adjustments only; exact decimal strings.';
