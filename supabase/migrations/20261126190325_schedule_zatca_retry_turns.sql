BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.zatca_automation
  ADD COLUMN last_scheduled_at timestamptz,
  ADD COLUMN scheduled_token uuid,
  ADD COLUMN scheduled_scan jsonb CHECK (scheduled_scan IS NULL OR jsonb_typeof(scheduled_scan) = 'object');

CREATE INDEX zatca_automation_schedule_order
  ON public.zatca_automation (last_scheduled_at ASC NULLS FIRST, tenant_id)
  WHERE enabled;

CREATE INDEX financial_events_zatca_retry_order
  ON public.financial_events (tenant_id, created_at, id)
  WHERE event_type IN ('InvoiceFinalizedEvent', 'CreditNoteIssuedEvent', 'DebitNoteIssuedEvent');

-- Bound the indexed event read before checking which documents are pending.
-- Even a window containing only settled history supplies a resume cursor.
CREATE FUNCTION public.list_zatca_scheduled_events(
  p_tenant uuid, p_environment text, p_through timestamptz,
  p_cursor_at timestamptz, p_cursor_id uuid, p_limit integer
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH settings AS (
    SELECT min(s.created_at) AS go_live, greatest(1, least(512, coalesce(p_limit, 1))) AS window_size
    FROM public.zatca_issuance_streams AS s
    WHERE s.tenant_id = p_tenant AND s.environment = p_environment AND p_environment IN ('sandbox', 'simulation')
  ), raw AS MATERIALIZED (
    SELECT e.id, e.event_type, e.source_id, e.created_at
    FROM public.financial_events AS e
    WHERE e.tenant_id = p_tenant
      AND e.event_type IN ('InvoiceFinalizedEvent', 'CreditNoteIssuedEvent', 'DebitNoteIssuedEvent')
      AND e.created_at <= p_through AND e.created_at >= (SELECT go_live FROM settings)
      AND (e.created_at, e.id) > (
        coalesce(p_cursor_at, '-infinity'::timestamptz),
        coalesce(p_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
    ORDER BY e.created_at, e.id
    LIMIT (SELECT window_size + 1 FROM settings)
  ), event_window AS MATERIALIZED (
    SELECT * FROM raw ORDER BY created_at, id LIMIT (SELECT window_size FROM settings)
  )
  SELECT CASE WHEN settings.go_live IS NULL THEN NULL ELSE jsonb_build_object(
    'events', coalesce((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
      FROM event_window AS e
      WHERE (
        SELECT true FROM public.zatca_transmissions AS t
        WHERE t.tenant_id = p_tenant AND t.source_id = e.source_id
          AND t.doc_type = CASE e.event_type WHEN 'InvoiceFinalizedEvent' THEN 'invoice'
            WHEN 'CreditNoteIssuedEvent' THEN 'credit_note' ELSE 'debit_note' END
          AND t.status IN ('reported','cleared') AND t.response->>'environment' = p_environment
          AND t.response->'sandbox' IS DISTINCT FROM 'true'::jsonb
          AND t.response->'mock' IS DISTINCT FROM 'true'::jsonb
        LIMIT 1
      ) IS DISTINCT FROM true
    ), '[]'::jsonb),
    'after', (SELECT jsonb_build_object('created_at', created_at, 'id', id)
      FROM event_window ORDER BY created_at DESC, id DESC LIMIT 1),
    'has_more', (SELECT count(*) FROM raw) > settings.window_size
  ) END
  FROM settings;
$$;

-- A turn moves to the back of the queue at claim time. This also rotates
-- tenants whose worker fails, loses its response, or runs out of time.
CREATE FUNCTION public.claim_zatca_scheduled_tenant()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claim jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  WITH candidate AS (
    SELECT tenant_id
    FROM public.zatca_automation
    WHERE enabled AND (last_scheduled_at IS NULL OR last_scheduled_at <= v_now - interval '5 minutes')
    ORDER BY last_scheduled_at ASC NULLS FIRST, tenant_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.zatca_automation AS job
  SET last_scheduled_at = v_now, scheduled_token = gen_random_uuid()
  FROM candidate
  WHERE job.tenant_id = candidate.tenant_id
  RETURNING jsonb_build_object('tenant_id', job.tenant_id, 'token', job.scheduled_token, 'scan', job.scheduled_scan)
    INTO v_claim;
  RETURN v_claim;
END $$;

CREATE FUNCTION public.finish_zatca_scheduled_tenant(p_tenant uuid, p_token uuid, p_progress jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_scan jsonb;
  v_cursor jsonb;
  v_environment text;
  v_through timestamptz;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
BEGIN
  -- SQL NULL preserves the prior scan after a failed or unstarted turn.
  -- A checkpoint containing a JSON null scan opens a new sweep next time.
  IF p_progress IS NOT NULL THEN
    IF jsonb_typeof(p_progress) IS DISTINCT FROM 'object' OR NOT (p_progress ? 'scan')
      OR octet_length(p_progress::text) > 1024 THEN
      RAISE EXCEPTION 'ZTC_SCHEDULE: invalid retry checkpoint' USING ERRCODE = '22023';
    END IF;
    v_scan := nullif(p_progress->'scan', 'null'::jsonb);
    IF v_scan IS NOT NULL THEN
      v_environment := v_scan->>'environment';
      v_through := (v_scan->>'through')::timestamptz;
      v_cursor := nullif(v_scan->'cursor', 'null'::jsonb);
      IF jsonb_typeof(v_scan) IS DISTINCT FROM 'object'
        OR v_environment IS NULL OR v_environment NOT IN ('sandbox', 'simulation')
        OR v_through IS NULL OR NOT isfinite(v_through)
        OR v_through > clock_timestamp() + interval '1 minute'
        OR NOT (v_scan ? 'cursor') THEN
        RAISE EXCEPTION 'ZTC_SCHEDULE: invalid retry scan' USING ERRCODE = '22023';
      END IF;
      IF v_cursor IS NOT NULL THEN
        v_cursor_at := (v_cursor->>'created_at')::timestamptz;
        v_cursor_id := (v_cursor->>'id')::uuid;
        IF jsonb_typeof(v_cursor) IS DISTINCT FROM 'object' OR v_cursor_id IS NULL
          OR v_cursor_at IS NULL OR NOT isfinite(v_cursor_at) OR v_cursor_at > v_through THEN
          RAISE EXCEPTION 'ZTC_SCHEDULE: invalid retry cursor' USING ERRCODE = '22023';
        END IF;
        v_cursor := jsonb_build_object('created_at', v_cursor_at, 'id', v_cursor_id);
      END IF;
      v_scan := jsonb_build_object('environment', v_environment, 'through', v_through, 'cursor', v_cursor);
    END IF;
  END IF;

  UPDATE public.zatca_automation
  SET scheduled_token = NULL,
      scheduled_scan = CASE WHEN p_progress IS NULL THEN scheduled_scan ELSE v_scan END
  WHERE tenant_id = p_tenant AND scheduled_token = p_token;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.claim_zatca_scheduled_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_zatca_scheduled_tenant(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_zatca_scheduled_events(uuid, text, timestamptz, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_zatca_scheduled_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_zatca_scheduled_tenant(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_zatca_scheduled_events(uuid, text, timestamptz, timestamptz, uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
