BEGIN;
ALTER TABLE public.driver_leave_requests ADD COLUMN workflow_version integer NOT NULL DEFAULT 1,
 ADD COLUMN client_request_id uuid, ADD COLUMN cancelled_at timestamptz,ADD COLUMN cancelled_by uuid REFERENCES auth.users(id),ADD COLUMN cancellation_reason text;
CREATE UNIQUE INDEX driver_leave_client_request ON public.driver_leave_requests(tenant_id,client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX driver_leave_cancelled_by ON public.driver_leave_requests(cancelled_by) WHERE cancelled_by IS NOT NULL;
-- Retained legacy cancellations must remain reviewable/restorable through the
-- versioned workflow. Other archived rows stay hidden, and attendance.read
-- keeps the existing tenant/MFA authorization boundary intact.
ALTER POLICY leave_requests_sel ON public.driver_leave_requests USING (
 tenant_id=(SELECT public.get_my_tenant_id())
 AND (deleted_at IS NULL OR status='cancelled')
 AND (SELECT public.user_has_permission('attendance','read'))
);
REVOKE INSERT,UPDATE,DELETE ON public.driver_leave_requests FROM PUBLIC,anon,authenticated;
DO $acl$ DECLARE cols text;BEGIN SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid='public.driver_leave_requests'::regclass AND attnum>0 AND NOT attisdropped;EXECUTE format('REVOKE INSERT (%s),UPDATE (%s) ON public.driver_leave_requests FROM PUBLIC,anon,authenticated',cols,cols);END;$acl$;
CREATE FUNCTION driver_operations_private.leave_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LEAVE_HISTORY_IMMUTABLE';END IF;
 IF current_user='service_role' THEN RAISE EXCEPTION 'LEAVE_CALLER_REQUIRED' USING ERRCODE='42501';END IF;
 IF OLD.status IN('approved','rejected') AND (to_jsonb(NEW)-ARRAY['updated_at','workflow_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','workflow_version']) THEN RAISE EXCEPTION 'LEAVE_HISTORY_IMMUTABLE';END IF;
 IF (NEW.id,NEW.tenant_id,NEW.driver_id,NEW.client_request_id,NEW.created_by,NEW.requested_by) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.driver_id,OLD.client_request_id,OLD.created_by,OLD.requested_by) THEN RAISE EXCEPTION 'LEAVE_IDENTITY_IMMUTABLE';END IF;
 NEW.workflow_version:=OLD.workflow_version+1;RETURN NEW;
END;$$;
CREATE TRIGGER leave_history_guard BEFORE UPDATE OR DELETE ON public.driver_leave_requests FOR EACH ROW EXECUTE FUNCTION driver_operations_private.leave_history_guard();
REVOKE ALL ON FUNCTION driver_operations_private.leave_history_guard() FROM PUBLIC,anon,authenticated,service_role;
-- Leave balances are retained evidence, not counters maintained by this workflow.
-- Reconcile their recorded floors with requests while holding the same driver lock
-- as every caller mutation. Never release an opaque recorded reservation on edit.
CREATE FUNCTION driver_operations_private.leave_allowance_error(p_driver_id uuid,p_leave_type_id uuid,p_start_date date,p_days integer,p_exclude_id uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $allowance$
DECLARE d public.drivers%ROWTYPE;lt public.leave_types%ROWTYPE;policy_year integer:=extract(year FROM p_start_date)::integer;cap integer;approved_days bigint;pending_days bigint;recorded_used bigint:=0;recorded_pending bigint:=0;
BEGIN
 SELECT * INTO d FROM public.drivers WHERE id=p_driver_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR d.hire_date IS NULL THEN RETURN 'Driver employment dates require review';END IF;
 SELECT * INTO lt FROM public.leave_types WHERE id=p_leave_type_id AND tenant_id=d.tenant_id AND deleted_at IS NULL;
 IF NOT FOUND OR p_days IS NULL OR p_days<=0 OR policy_year IS NULL THEN RETURN 'Leave policy inputs require review';END IF;
 -- Preserve the repository's start-year allocation and configured policy limits.
 cap:=CASE WHEN lt.code='annual' THEN CASE WHEN policy_year-extract(year FROM d.hire_date)::integer>=5 THEN 30 ELSE 21 END WHEN lt.code='sick' THEN 120 WHEN lt.days_per_year>0 THEN lt.days_per_year ELSE NULL END;
 IF lt.code='annual' AND lt.days_per_year>0 THEN cap:=least(cap,lt.days_per_year);END IF;
 IF cap IS NULL THEN RETURN NULL;END IF;
 SELECT coalesce(sum(x.days_requested) FILTER(WHERE x.status='approved'),0),coalesce(sum(x.days_requested) FILTER(WHERE x.status='pending'),0) INTO approved_days,pending_days
 FROM public.driver_leave_requests x JOIN public.leave_types historical_type ON historical_type.id=x.leave_type_id AND historical_type.tenant_id=d.tenant_id
 WHERE x.tenant_id=d.tenant_id AND x.driver_id=d.id AND x.deleted_at IS NULL AND x.status IN('pending','approved') AND x.id IS DISTINCT FROM p_exclude_id AND historical_type.code=lt.code AND x.start_date>=make_date(policy_year,1,1) AND x.start_date<make_date(policy_year+1,1,1);
 IF lt.code='annual' THEN
  SELECT coalesce(sum(b.used_days),0),coalesce(sum(b.pending_days),0) INTO recorded_used,recorded_pending
  FROM public.driver_leave_balances b JOIN public.leave_types historical_type ON historical_type.id=b.leave_type_id AND historical_type.tenant_id=d.tenant_id
  WHERE b.tenant_id=d.tenant_id AND b.driver_id=d.id AND b.year=policy_year AND b.deleted_at IS NULL AND historical_type.code=lt.code;
 END IF;
 -- The current request is checked as one reservation, including final approval.
 -- This avoids charging an already pending request twice. Recorded floors remain
 -- intact; conflicting historical counters must be reconciled by HR, not guessed.
 IF greatest(recorded_used,approved_days)+greatest(recorded_pending,pending_days+p_days)>cap THEN RETURN 'Leave allowance or recorded balance requires HR review';END IF;
 RETURN NULL;
END;$allowance$;
REVOKE ALL ON FUNCTION driver_operations_private.leave_allowance_error(uuid,uuid,date,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.enforce_leave_policy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $policy$
DECLARE policy text;
BEGIN
 policy:=driver_operations_private.leave_allowance_error(NEW.driver_id,NEW.leave_type_id,NEW.start_date,NEW.days_requested::integer);
 IF policy IS NOT NULL THEN RAISE EXCEPTION 'LVE001: %',policy USING ERRCODE='check_violation';END IF;
 RETURN NEW;
END;$policy$;
REVOKE ALL ON FUNCTION public.enforce_leave_policy() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION driver_operations_private.leave_mutation(p_action text,p_input jsonb,p_id uuid,p_expected_version integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();old_row public.driver_leave_requests%ROWTYPE;r public.driver_leave_requests%ROWTYPE;d public.drivers%ROWTYPE;lt public.leave_types%ROWTYPE;driver uuid;start_day date;end_day date;days integer;action_reason text;policy text;nonce uuid;today date:=(now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
 IF actor IS NULL OR t IS NULL THEN RAISE EXCEPTION 'LEAVE_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN('create','edit','cancel','restore','approved','rejected') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'LEAVE_INPUT' USING ERRCODE='22023';END IF;
 IF NOT public.user_has_permission('attendance',CASE WHEN p_action='create' THEN 'create' WHEN p_action IN('approved','rejected') THEN 'approve' ELSE 'update' END) THEN RAISE EXCEPTION 'LEAVE_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN('driver_id','leave_type_id','start_date','end_date','reason','client_request_id','surface')) THEN RAISE EXCEPTION 'LEAVE_INPUT' USING ERRCODE='22023';END IF;
 action_reason:=btrim(coalesce(p_input->>'reason',''));
 IF length(action_reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'LEAVE_REASON_REQUIRED' USING ERRCODE='22023';END IF;
 IF p_action='create' THEN driver:=(p_input->>'driver_id')::uuid;nonce:=(p_input->>'client_request_id')::uuid;IF nonce IS NULL OR p_id IS NOT NULL OR p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'LEAVE_INPUT';END IF;
 ELSE SELECT driver_id INTO driver FROM public.driver_leave_requests WHERE id=p_id AND tenant_id=t;IF NOT FOUND THEN RAISE EXCEPTION 'LEAVE_NOT_FOUND';END IF;END IF;
 -- Consistent lock order with driver profile/fleet operations.
 SELECT * INTO d FROM public.drivers WHERE id=driver AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEAVE_NOT_FOUND';END IF;
 IF p_action<>'create' THEN
  SELECT * INTO old_row FROM public.driver_leave_requests WHERE id=p_id AND tenant_id=t AND driver_id=driver FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAVE_NOT_FOUND';END IF;
  IF p_expected_version IS NULL OR p_expected_version<>old_row.workflow_version THEN RAISE EXCEPTION 'LEAVE_STALE';END IF;
  IF (p_action='restore' AND (old_row.status<>'cancelled' OR old_row.reviewed_at IS NOT NULL)) OR (p_action<>'restore' AND (old_row.status<>'pending' OR old_row.deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'LEAVE_ALREADY_DECIDED';END IF;
  IF p_input?'driver_id' OR p_input?'client_request_id' THEN RAISE EXCEPTION 'LEAVE_IDENTITY_IMMUTABLE';END IF;
 END IF;
 IF p_action IN('create','edit','restore','approved') THEN
  IF d.status NOT IN('active','on_leave') THEN RAISE EXCEPTION 'LEAVE_DRIVER_INACTIVE';END IF;
  start_day:=CASE WHEN p_action IN('create','edit') THEN (p_input->>'start_date')::date ELSE old_row.start_date END;
  end_day:=CASE WHEN p_action IN('create','edit') THEN (p_input->>'end_date')::date ELSE old_row.end_date END;
  days:=end_day-start_day+1;
  IF start_day IS NULL OR end_day IS NULL OR days NOT BETWEEN 1 AND 366 OR (d.hire_date IS NOT NULL AND start_day<d.hire_date) OR (d.termination_date IS NOT NULL AND end_day>d.termination_date) THEN RAISE EXCEPTION 'LEAVE_DATES';END IF;
  SELECT * INTO lt FROM public.leave_types WHERE id=CASE WHEN p_action IN('create','edit') THEN (p_input->>'leave_type_id')::uuid ELSE old_row.leave_type_id END AND tenant_id=t AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAVE_TYPE_REQUIRED';END IF;
  IF p_action='create' THEN
   SELECT * INTO r FROM public.driver_leave_requests WHERE tenant_id=t AND client_request_id=nonce;
   IF FOUND THEN
    IF r.driver_id=driver AND r.created_by=actor AND r.leave_type_id=lt.id AND r.start_date=start_day AND r.end_date=end_day AND r.reason=action_reason THEN RETURN jsonb_build_object('id',r.id,'driver_id',driver,'version',r.workflow_version,'status',r.status);END IF;
    RAISE EXCEPTION 'LEAVE_REQUEST_REUSED';
   END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.driver_leave_requests x WHERE x.tenant_id=t AND x.driver_id=driver AND x.id IS DISTINCT FROM p_id AND x.deleted_at IS NULL AND x.status IN('pending','approved') AND daterange(x.start_date,x.end_date,'[]')&&daterange(start_day,end_day,'[]')) THEN RAISE EXCEPTION 'LEAVE_OVERLAP';END IF;
  policy:=driver_operations_private.leave_allowance_error(driver,lt.id,start_day,days,p_id);
  IF policy IS NOT NULL THEN RAISE EXCEPTION 'LEAVE_POLICY_REVIEW';END IF;
 END IF;
 IF p_action='create' THEN
  -- The insert trigger shares the locked allowance checker with this workflow.
  INSERT INTO public.driver_leave_requests(tenant_id,driver_id,leave_type_id,start_date,end_date,days_requested,reason,requested_by,created_by,updated_by,client_request_id) VALUES(t,driver,lt.id,start_day,end_day,days,action_reason,actor,actor,actor,nonce) RETURNING * INTO r;
 ELSIF p_action IN('edit','restore') THEN
  UPDATE public.driver_leave_requests SET leave_type_id=lt.id,start_date=start_day,end_date=end_day,days_requested=days,reason=CASE WHEN p_action='edit' THEN action_reason ELSE old_row.reason END,status='pending',deleted_at=NULL,cancelled_at=NULL,cancelled_by=NULL,cancellation_reason=NULL,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 ELSIF p_action='cancel' THEN
  UPDATE public.driver_leave_requests SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=actor,cancellation_reason=action_reason,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 ELSE
  IF p_input?'start_date' OR p_input?'end_date' OR p_input?'leave_type_id' THEN RAISE EXCEPTION 'LEAVE_INPUT';END IF;
  IF p_action='approved' AND old_row.days_requested<>days THEN RAISE EXCEPTION 'LEAVE_DATES';END IF;
  UPDATE public.driver_leave_requests SET status=p_action::public.leave_status,reviewed_by=actor,reviewed_at=clock_timestamp(),review_notes=action_reason,updated_by=actor WHERE id=p_id RETURNING * INTO r;
  -- Future or historical leave does not immediately change current operations.
  IF p_action='approved' AND today BETWEEN start_day AND end_day AND d.status='active' THEN
   UPDATE public.drivers SET status='on_leave',updated_by=actor WHERE id=driver AND tenant_id=t;
   INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,actor,'drivers','driver',driver,'status_changed',jsonb_build_object('status',d.status),jsonb_build_object('status','on_leave','leave_request_id',r.id));
  END IF;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,actor,'attendance','leave_request',r.id,'leave_'||p_action,CASE WHEN old_row.id IS NOT NULL THEN jsonb_build_object('status',old_row.status,'version',old_row.workflow_version,'start_date',old_row.start_date,'end_date',old_row.end_date,'days',old_row.days_requested) END,jsonb_build_object('status',r.status,'version',r.workflow_version,'driver_id',driver,'start_date',r.start_date,'end_date',r.end_date,'days',r.days_requested,'reason_recorded',true,'surface',coalesce(p_input->>'surface','driver_profile')));
 RETURN jsonb_build_object('id',r.id,'driver_id',driver,'version',r.workflow_version,'status',r.status);
END;$$;
CREATE FUNCTION public.mutate_driver_leave(p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT driver_operations_private.leave_mutation(p_action,p_input,p_id,p_expected_version);$$;
REVOKE ALL ON FUNCTION driver_operations_private.leave_mutation(text,jsonb,uuid,integer),public.mutate_driver_leave(text,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION driver_operations_private.leave_mutation(text,jsonb,uuid,integer),public.mutate_driver_leave(text,jsonb,uuid,integer) TO authenticated;
-- Shared inbox projects the exact reviewed version for both workflows.
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
        'expense_date', e.expense_date,
        'correction_version', e.correction_version
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
      AND e.is_approved = FALSE AND e.rejected_at IS NULL AND e.cancelled_at IS NULL
      AND (p_type IS NULL OR p_type = 'expense')
      AND (p_from IS NULL OR e.created_at >= p_from)
      AND (p_to IS NULL OR e.created_at <= p_to)

    UNION ALL

    SELECT
      'leave_request'::text,
      r.id,
      COALESCE(t.name_en, t.name_ar, t.code),
      jsonb_build_object(
        'workflow_version', r.workflow_version,
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
        'status', a.status,
        'workflow_version', a.workflow_version
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



COMMIT;
