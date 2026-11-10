-- Read-only queue definitions. No application/financial records or grants to source tables change.
CREATE OR REPLACE FUNCTION public.pending_approval_rows(
  p_tenant_id uuid,
  p_type      text        DEFAULT NULL,
  p_from      timestamptz DEFAULT NULL,
  p_to        timestamptz DEFAULT NULL
)
RETURNS TABLE (
  item_type    text,
  item_id      uuid,
  subject      text,
  subject_meta jsonb,
  requester    text,
  requested_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH caller AS (
    SELECT public.get_my_tenant_id() AS tenant_id
  )
  SELECT *
  FROM (
    SELECT
      'expense'::text AS item_type,
      e.id AS item_id,
      COALESCE(e.expense_code, 'EXP-' || LEFT(e.id::text, 8)) AS subject,
      jsonb_build_object(
        'amount', e.amount,
        'currency', e.currency,
        'expense_type', e.expense_type,
        'category', e.category,
        'vendor', e.vendor,
        'expense_date', e.expense_date
      ) AS subject_meta,
      COALESCE(e.vendor, '') AS requester,
      e.created_at AS requested_at
    FROM public.expenses e
    CROSS JOIN caller c
    WHERE c.tenant_id IS NOT NULL
      AND p_tenant_id = c.tenant_id
      AND public.user_has_permission('expenses', 'approve')
      AND e.tenant_id = c.tenant_id
      AND e.deleted_at IS NULL
      AND e.is_approved = FALSE AND e.rejected_at IS NULL
      AND (p_type IS NULL OR p_type = 'expense')
      AND (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to IS NULL OR e.created_at <= p_to)

    UNION ALL

    SELECT
      'leave_request'::text,
      r.id,
      COALESCE(t.name_en, t.name_ar, t.code),
      jsonb_build_object(
        'driver_id', r.driver_id,
        'leave_type', t.code,
        'start_date', r.start_date,
        'end_date', r.end_date,
        'days_requested', r.days_requested,
        'reason', r.reason
      ),
      '',
      r.requested_at
    FROM public.driver_leave_requests r
    JOIN public.leave_types t ON t.id = r.leave_type_id
    CROSS JOIN caller c
    WHERE c.tenant_id IS NOT NULL
      AND p_tenant_id = c.tenant_id
      AND public.user_has_permission('attendance', 'approve')
      AND r.tenant_id = c.tenant_id
      AND r.deleted_at IS NULL
      AND r.status = 'pending'
      AND (p_type IS NULL OR p_type = 'leave_request')
      AND (p_from IS NULL OR r.requested_at >= p_from)
      AND (p_to IS NULL OR r.requested_at <= p_to)

    UNION ALL

    SELECT
      'application'::text,
      a.id,
      a.application_number,
      jsonb_build_object(
        'full_name', COALESCE((SELECT string_agg(left(parts.part, 1) || '.', ' ' ORDER BY parts.position)
          FROM regexp_split_to_table(btrim(a.full_name), E'\\s+') WITH ORDINALITY AS parts(part, position)
          WHERE parts.part <> ''), '—'),
        'mobile_hashed', CASE WHEN a.mobile IS NOT NULL THEN 'present' ELSE NULL END,
        'city', a.city,
        'work_type', a.work_type,
        'driver_category', a.driver_category,
        'status', a.status
      ),
      '',
      a.submitted_at
    FROM public.driver_applications a
    CROSS JOIN caller c
    WHERE c.tenant_id IS NOT NULL
      AND p_tenant_id = c.tenant_id
      AND public.user_has_permission('hr', 'approve')
      AND a.tenant_id = c.tenant_id
      AND a.status IN ('submitted', 'under_review')
      AND (p_type IS NULL OR p_type = 'application')
      AND (p_from IS NULL OR a.submitted_at >= p_from)
      AND (p_to IS NULL OR a.submitted_at <= p_to)
  ) q
  ORDER BY q.requested_at ASC, q.item_type, q.item_id
$$;

-- Preserve the old signature for in-flight/older clients; privacy applies here too.
CREATE OR REPLACE FUNCTION public.fetch_pending_approvals(
  p_tenant_id uuid, p_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(item_type text,item_id uuid,subject text,subject_meta jsonb,requester text,requested_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.pending_approval_rows(p_tenant_id,p_type,p_from,p_to)
  ORDER BY requested_at,item_type,item_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100)
$$;

-- One snapshot for filtered totals and page rows. Search only the safe projection:
-- hidden applicant names/mobile/identity and the unrelated tenant roster never enter it.
CREATE OR REPLACE FUNCTION public.fetch_pending_approvals_page(
  p_tenant_id uuid, p_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_search text DEFAULT '', p_page integer DEFAULT 1, p_page_size integer DEFAULT 50
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH options AS (
    SELECT LEAST(GREATEST(COALESCE(p_page_size,50),1),100) AS size,
      GREATEST(COALESCE(p_page,1),1)::bigint AS requested_page,
      lower(left(btrim(COALESCE(p_search,'')),200)) AS term
  ), filtered AS MATERIALIZED (
    SELECT q.* FROM public.pending_approval_rows(p_tenant_id,p_type,p_from,p_to) q CROSS JOIN options o
    WHERE o.term = '' OR strpos(lower(concat_ws(' ',q.subject,q.requester,
      q.subject_meta->>'full_name',q.subject_meta->>'expense_type',q.subject_meta->>'category',
      q.subject_meta->>'leave_type',q.subject_meta->>'city',q.subject_meta->>'work_type',
      q.subject_meta->>'driver_category',q.subject_meta->>'status')),o.term)>0
  ), totals AS (
    SELECT count(*) AS total,
      count(*) FILTER(WHERE item_type='expense') AS expenses,
      count(*) FILTER(WHERE item_type='leave_request') AS leaves,
      count(*) FILTER(WHERE item_type='application') AS applications,
      count(*) FILTER(WHERE requested_at<=statement_timestamp()-interval '3 days') AS stale
    FROM filtered
  ), paging AS (
    SELECT o.size,t.*,GREATEST((t.total+o.size-1)/o.size,1) AS pages,
      LEAST(o.requested_page,GREATEST((t.total+o.size-1)/o.size,1)) AS page
    FROM totals t CROSS JOIN options o
  ), items AS (
    SELECT * FROM filtered ORDER BY requested_at,item_type,item_id
    LIMIT (SELECT size FROM paging) OFFSET (SELECT (page-1)*size FROM paging)
  )
  SELECT jsonb_build_object(
    'rows',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.requested_at,i.item_type,i.item_id) FROM items i),'[]'::jsonb),
    'page',p.page,'pageSize',p.size,'totalPages',p.pages,
    'kpis',jsonb_build_object('total',p.total,'expenses',p.expenses,'leaves',p.leaves,
      'applications',p.applications,'stale',p.stale)
  ) FROM paging p
$$;

REVOKE ALL ON FUNCTION public.pending_approval_rows(uuid,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fetch_pending_approvals(uuid,text,timestamptz,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fetch_pending_approvals(uuid,text,timestamptz,timestamptz,integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.fetch_pending_approvals_page(uuid,text,timestamptz,timestamptz,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fetch_pending_approvals_page(uuid,text,timestamptz,timestamptz,text,integer,integer) TO authenticated,service_role;
COMMENT ON FUNCTION public.fetch_pending_approvals_page(uuid,text,timestamptz,timestamptz,text,integer,integer) IS
  'Caller-bound per-module approval inbox: stable pages and exact filtered totals; applicant initials only, no inferred user consent association.';
NOTIFY pgrst,'reload schema';
