BEGIN;
SET LOCAL lock_timeout = '5s';

-- Keep existing rows cheap to migrate. New rows and every subsequent update
-- get a fresh token, including duplicate detection and service-side changes
-- that intentionally do not update the workflow version.
ALTER TABLE public.expense_claims ADD COLUMN export_revision uuid NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.expense_claim_attachments ADD COLUMN export_revision uuid NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000000';
CREATE FUNCTION expense_claims_private.rotate_export_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.export_revision := gen_random_uuid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION expense_claims_private.rotate_export_revision() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER rotate_claim_export_revision BEFORE INSERT OR UPDATE ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION expense_claims_private.rotate_export_revision();
CREATE TRIGGER rotate_attachment_export_revision BEFORE INSERT OR UPDATE ON public.expense_claim_attachments
  FOR EACH ROW EXECUTE FUNCTION expense_claims_private.rotate_export_revision();

CREATE TABLE expense_claims_private.export_receipts (
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  fingerprint bytea NOT NULL,
  marked integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, actor_id, request_id)
);
ALTER TABLE expense_claims_private.export_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON expense_claims_private.export_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION expense_claims_private.commit_export(
  p_request_id uuid, p_exported_at timestamptz, p_mark_exported boolean, p_claims jsonb, p_attachments jsonb, p_workbook_sha256 text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  tenant uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  expected_claims jsonb;
  expected_attachments jsonb;
  actual_rows jsonb;
  claim_ids uuid[];
  request_hash bytea;
  receipt expense_claims_private.export_receipts;
  may_read_all boolean := public.user_has_permission('expense_claims', 'read') IS TRUE
    OR public.user_has_permission('expense_claims', 'approve') IS TRUE;
  may_read_own boolean := public.user_has_permission('expense_claims', 'create') IS TRUE;
  marked_count integer := 0;
BEGIN
  IF actor IS NULL OR tenant IS NULL
    OR public.user_has_permission('expense_claims', 'export') IS NOT TRUE
    OR NOT (may_read_all OR may_read_own) THEN
    RAISE EXCEPTION 'AUTH007: expense claim read and export permissions required';
  END IF;
  -- Evidence is read in a fresh statement after acquiring all parent locks.
  IF current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION 'EXC_EXPORT_CONFLICT: export requires read committed isolation';
  END IF;
  IF p_request_id IS NULL OR p_exported_at IS NULL OR NOT isfinite(p_exported_at) OR p_mark_exported IS NULL
    OR jsonb_typeof(p_claims) IS DISTINCT FROM 'array' OR jsonb_typeof(p_attachments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'EXC001: invalid export request';
  END IF;
  IF p_workbook_sha256 IS NULL OR p_workbook_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'EXC001: invalid workbook digest';
  END IF;
  IF jsonb_array_length(p_claims) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'EXC001: invalid export claim count';
  END IF;
  IF jsonb_array_length(p_attachments) > 200000 THEN
    RAISE EXCEPTION 'EXC001: too many receipt attachments';
  END IF;

  SELECT array_agg((item->>'id')::uuid), jsonb_agg(item ORDER BY (item->>'id')::uuid)
    INTO claim_ids, expected_claims FROM jsonb_array_elements(p_claims) AS items(item);
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'id')::uuid), '[]'::jsonb)
    INTO expected_attachments FROM jsonb_array_elements(p_attachments) AS items(item);
  request_hash := sha256(convert_to(jsonb_build_array(
    p_exported_at, p_mark_exported, expected_claims, expected_attachments, p_workbook_sha256
  )::text, 'UTF8'));

  -- A concurrent retry waits for the first transaction here. Failed exports
  -- roll back the receipt along with all claim, event and audit writes.
  INSERT INTO expense_claims_private.export_receipts (tenant_id, actor_id, request_id, fingerprint)
    VALUES (tenant, actor, p_request_id, request_hash) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO STRICT receipt FROM expense_claims_private.export_receipts
      WHERE tenant_id = tenant AND actor_id = actor AND request_id = p_request_id;
    IF receipt.fingerprint <> request_hash THEN
      RAISE EXCEPTION 'EXC_EXPORT_CONFLICT: request was used for different export data';
    END IF;
    IF (SELECT count(*) FROM public.expense_claims c
        WHERE c.id = ANY(claim_ids) AND c.tenant_id = tenant AND c.deleted_at IS NULL
          AND (may_read_all OR (may_read_own AND c.submitter_id = actor))) <> cardinality(claim_ids) THEN
      RAISE EXCEPTION 'EXC_EXPORT_CONFLICT: selected claims changed or are unavailable';
    END IF;
    RETURN receipt.marked;
  END IF;
  IF p_exported_at < clock_timestamp() - interval '1 hour' OR p_exported_at > clock_timestamp() + interval '1 minute' THEN
    RAISE EXCEPTION 'EXC_EXPORT_CONFLICT: export preparation timestamp expired';
  END IF;

  -- FOR UPDATE conflicts with the FK key-share lock required to add or move
  -- evidence to any selected claim. A completed competing insert is visible
  -- in the next statement. Lock evidence as well to serialize edits/deletes.
  WITH locked AS MATERIALIZED (
    SELECT c.id, c.version, c.export_revision FROM public.expense_claims c
    WHERE c.id = ANY(claim_ids) AND c.tenant_id = tenant AND c.deleted_at IS NULL
      AND (may_read_all OR (may_read_own AND c.submitter_id = actor))
    ORDER BY c.id FOR UPDATE
  )
  SELECT coalesce(jsonb_agg(to_jsonb(locked) ORDER BY id), '[]'::jsonb)
    INTO actual_rows FROM locked;
  IF actual_rows <> expected_claims THEN
    RAISE EXCEPTION 'EXC_EXPORT_CONFLICT: selected claims changed or are unavailable';
  END IF;
  WITH locked AS MATERIALIZED (
    SELECT a.id, a.claim_id, a.export_revision, a.tenant_id FROM public.expense_claim_attachments a
    WHERE a.claim_id = ANY(claim_ids) ORDER BY a.id FOR SHARE
  )
  SELECT coalesce(jsonb_agg(to_jsonb(locked) - 'tenant_id' ORDER BY id), '[]'::jsonb)
    INTO actual_rows FROM locked HAVING bool_and(tenant_id = tenant) IS NOT FALSE;
  IF actual_rows IS DISTINCT FROM expected_attachments THEN
    RAISE EXCEPTION 'EXC_EXPORT_CONFLICT: selected receipt evidence changed or is unavailable';
  END IF;

  INSERT INTO public.expense_claim_events (tenant_id, claim_id, actor_id, action, from_status, to_status, created_at)
    SELECT tenant, c.id, actor, 'exported', c.status,
      CASE WHEN p_mark_exported AND c.status = 'approved' THEN 'exported' ELSE c.status END, p_exported_at
    FROM public.expense_claims c WHERE c.id = ANY(claim_ids) AND c.tenant_id = tenant;
  IF p_mark_exported THEN
    UPDATE public.expense_claims SET status = 'exported', exported_at = p_exported_at, exported_by = actor,
      version = version + 1, updated_at = clock_timestamp(), updated_by = actor
      WHERE id = ANY(claim_ids) AND tenant_id = tenant AND status = 'approved';
    GET DIAGNOSTICS marked_count = ROW_COUNT;
  END IF;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, action, new_values, request_id)
    VALUES (tenant, actor, 'expense_claims', 'expense_claims', 'expense_claims_exported',
      jsonb_build_object('rows', cardinality(claim_ids), 'marked_exported', marked_count, 'exported_at', p_exported_at,
        'workbook_sha256', p_workbook_sha256),
      p_request_id::text);
  UPDATE expense_claims_private.export_receipts SET marked = marked_count
    WHERE tenant_id = tenant AND actor_id = actor AND request_id = p_request_id;
  RETURN marked_count;
END;
$$;

-- Bind the private function at definition time. Authenticated users can
-- call the public invoker without USAGE on the existing private schema.
CREATE FUNCTION public.expense_claims_commit_export(
  p_request_id uuid, p_exported_at timestamptz, p_mark_exported boolean, p_claims jsonb, p_attachments jsonb, p_workbook_sha256 text
) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = ''
RETURN expense_claims_private.commit_export(p_request_id, p_exported_at, p_mark_exported, p_claims, p_attachments, p_workbook_sha256);

REVOKE ALL ON FUNCTION expense_claims_private.commit_export(uuid,timestamptz,boolean,jsonb,jsonb,text),
  public.expense_claims_commit_export(uuid,timestamptz,boolean,jsonb,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION expense_claims_private.commit_export(uuid,timestamptz,boolean,jsonb,jsonb,text),
  public.expense_claims_commit_export(uuid,timestamptz,boolean,jsonb,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.expense_claims_record_export(uuid[],boolean,jsonb) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
