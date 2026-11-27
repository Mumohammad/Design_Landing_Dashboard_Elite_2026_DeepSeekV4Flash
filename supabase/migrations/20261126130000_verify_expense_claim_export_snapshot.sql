BEGIN;
SET LOCAL lock_timeout = '5s';

-- Confirm that independently paginated results represent one statement's
-- snapshot. Both queries use the caller's expense claim RLS policy.
CREATE FUNCTION public.expense_claims_verify_export_snapshot(p_expected_count integer, p_expected_sha256 text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF public.user_has_permission('expense_claims', 'export') IS NOT TRUE THEN
    RAISE EXCEPTION 'AUTH007: expense claim export permission required';
  END IF;
  IF p_expected_count IS NULL OR p_expected_count NOT BETWEEN 0 AND 100000
    OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'EXC001: invalid expense claim snapshot';
  END IF;
  RETURN (
    SELECT count(*) = p_expected_count AND encode(sha256(convert_to(
      coalesce(string_agg(id::text || export_revision::text, '' ORDER BY id), ''), 'UTF8')), 'hex') = p_expected_sha256
    FROM (
      SELECT id, export_revision FROM public.expense_claims ORDER BY id LIMIT 100001
    ) AS visible
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expense_claims_verify_export_snapshot(integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_claims_verify_export_snapshot(integer,text) TO authenticated;

COMMIT;
