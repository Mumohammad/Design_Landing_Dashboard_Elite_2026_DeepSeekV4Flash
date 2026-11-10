-- Reopened periods remain writable and must be closeable again through the same
-- service-only operation. Preserve pending-draft checks, actor fields and grants.
-- No historical period or business record is changed by this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';
CREATE OR REPLACE FUNCTION public.close_accounting_period(
  p_tenant_id  UUID,
  p_period_id  UUID,
  p_closed_by  UUID DEFAULT NULL
)
RETURNS TABLE (out_period_id UUID, out_status public.accounting_period_status)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status  accounting_period_status;
  v_drafts  BIGINT;
BEGIN
  SELECT status INTO v_status
  FROM accounting_periods
  WHERE id = p_period_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'ACC003: accounting period not found or does not belong to this tenant';
  END IF;
  IF v_status NOT IN ('open', 'closing', 'reopened') THEN
    RAISE EXCEPTION 'ACC005: only open, closing or reopened periods can be closed';
  END IF;

  -- A period with pending drafts cannot be closed: drafts must be posted,
  -- reversed or deleted first (they would otherwise be stuck forever).
  SELECT COUNT(*) INTO v_drafts
  FROM journal_entries
  WHERE period_id = p_period_id AND status = 'draft' AND deleted_at IS NULL;
  IF v_drafts > 0 THEN
    RAISE EXCEPTION 'ACC004: period has % pending draft entries; post or remove them before closing', v_drafts;
  END IF;

  UPDATE accounting_periods
    SET status = 'closed',
        closing_started_at = COALESCE(closing_started_at, now()),
        closed_at = now(),
        closed_by = p_closed_by,
        updated_by = p_closed_by
  WHERE id = p_period_id;

  out_period_id := p_period_id;
  out_status    := 'closed';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.close_accounting_period(UUID, UUID, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.close_accounting_period(UUID, UUID, UUID) TO service_role;
COMMIT;
