BEGIN;
CREATE SCHEMA IF NOT EXISTS expense_private;
REVOKE ALL ON SCHEMA expense_private FROM PUBLIC,anon;GRANT USAGE ON SCHEMA expense_private TO authenticated;
ALTER TABLE public.expenses ADD COLUMN correction_version integer NOT NULL DEFAULT 1,
 ADD COLUMN cancelled_at timestamptz,ADD COLUMN cancelled_by uuid REFERENCES auth.users(id),ADD COLUMN cancellation_reason text,
 ADD CONSTRAINT expense_cancellation_decision CHECK((cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
  OR(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND cancellation_reason=btrim(cancellation_reason) AND length(cancellation_reason) BETWEEN 5 AND 500 AND NOT is_approved AND rejected_at IS NULL));
CREATE INDEX expenses_cancelled_by_fk ON public.expenses(cancelled_by) WHERE cancelled_by IS NOT NULL;
CREATE TABLE public.expense_correction_receipts(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),request_id uuid NOT NULL,expense_id uuid NOT NULL REFERENCES public.expenses(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),operation text NOT NULL CHECK(operation IN('update','cancel')),request_payload jsonb NOT NULL,
 result_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,request_id)
);
CREATE INDEX expense_correction_expense_fk ON public.expense_correction_receipts(expense_id);
CREATE INDEX expense_correction_actor_fk ON public.expense_correction_receipts(actor_id);
ALTER TABLE public.expense_correction_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_correction_receipts FROM PUBLIC,anon,authenticated;
REVOKE UPDATE,DELETE ON public.expenses FROM authenticated;
CREATE FUNCTION expense_private.guard_history() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.is_approved OR OLD.rejected_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'EXP_HISTORY_IMMUTABLE'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.cancelled_at IS NOT NULL AND (to_jsonb(NEW)-'updated_at'-'correction_version') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'correction_version') THEN RAISE EXCEPTION 'EXP_CANCELLED: expense was cancelled'; END IF;
 IF (OLD.is_approved OR OLD.rejected_at IS NOT NULL) AND (to_jsonb(NEW)-'updated_at'-'correction_version') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'correction_version') THEN RAISE EXCEPTION 'EXP_HISTORY_IMMUTABLE'; END IF;
 NEW.correction_version:=OLD.correction_version+CASE WHEN (to_jsonb(NEW)-'updated_at'-'correction_version') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'correction_version') THEN 1 ELSE 0 END;
 RETURN NEW;
END; $$;
CREATE TRIGGER expense_final_history BEFORE UPDATE OR DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION expense_private.guard_history();

CREATE FUNCTION expense_private.correct(p_id uuid,p_expected_version integer,p_request_id uuid,p_operation text,p_details jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();e public.expenses%ROWTYPE;receipt public.expense_correction_receipts%ROWTYPE;
 payload jsonb;before_values jsonb;after_values jsonb;v_type text;v_category text;v_vendor text;v_description text;v_amount numeric;v_rate numeric;v_date date;
BEGIN
 IF t IS NULL OR actor IS NULL OR NOT public.user_has_permission('expenses','update') THEN RAISE EXCEPTION 'EXP_EDIT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_operation IS NULL OR p_operation NOT IN('update','cancel')
  OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'EXP_EDIT_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.expenses WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND OR e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'EXP001: expense not found'; END IF;
 IF e.created_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'EXP_EDIT_MAKER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_operation='update' THEN
  IF p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_details) k WHERE k NOT IN('expense_type','category','amount','expense_date','vendor','description','vat_rate'))
   OR jsonb_typeof(p_details->'expense_type') IS DISTINCT FROM 'string' OR jsonb_typeof(p_details->'expense_date') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_details->'amount') IS DISTINCT FROM 'number' OR jsonb_typeof(p_details->'vat_rate') IS DISTINCT FROM 'number'
   OR (p_details->>'expense_date') !~ '^\d{4}-\d{2}-\d{2}$' OR EXISTS(SELECT 1 FROM jsonb_each(p_details) x WHERE x.key IN('category','vendor','description') AND jsonb_typeof(x.value) NOT IN('string','null')) THEN RAISE EXCEPTION 'EXP_EDIT_INPUT' USING ERRCODE='22023'; END IF;
  v_type:=p_details->>'expense_type';v_date:=(p_details->>'expense_date')::date;v_amount:=(p_details->>'amount')::numeric;v_rate:=(p_details->>'vat_rate')::numeric;
  v_category:=nullif(btrim(p_details->>'category'),'');v_vendor:=nullif(btrim(p_details->>'vendor'),'');v_description:=nullif(btrim(p_details->>'description'),'');
  IF v_type NOT IN('fuel','advance','operational','platform_commission','maintenance','other') OR v_amount NOT BETWEEN 0.01 AND 99999999.99 OR v_amount<>round(v_amount,2)
   OR v_rate NOT BETWEEN 0 AND 100 OR v_rate<>round(v_rate,2) OR length(v_category)>200 OR length(v_vendor)>200 OR length(v_description)>2000 THEN RAISE EXCEPTION 'EXP_EDIT_INPUT' USING ERRCODE='22023'; END IF;
  payload:=jsonb_build_object('expense_type',v_type,'category',v_category,'amount',v_amount,'expense_date',v_date,'vendor',v_vendor,'description',v_description,'vat_rate',v_rate);
 ELSE
  IF p_details IS NOT NULL AND p_details<>'{}'::jsonb THEN RAISE EXCEPTION 'EXP_EDIT_INPUT' USING ERRCODE='22023'; END IF;payload:='{}';
 END IF;
 payload:=jsonb_build_object('id',p_id,'operation',p_operation,'expected_version',p_expected_version,'details',payload,'reason',btrim(p_reason));
 SELECT * INTO receipt FROM public.expense_correction_receipts WHERE tenant_id=t AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.expense_id IS DISTINCT FROM p_id OR receipt.actor_id IS DISTINCT FROM actor OR receipt.request_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'EXP_EDIT_RETRY_MISMATCH'; END IF;
  RETURN jsonb_build_object('id',e.id,'version',receipt.result_version,'replayed',true);
 END IF;
 IF e.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'EXP_CANCELLED: expense was cancelled'; END IF;
 IF e.is_approved OR e.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'EXP_EDIT_DECIDED'; END IF;
 IF e.correction_version<>p_expected_version THEN RAISE EXCEPTION 'EXP_EDIT_STALE'; END IF;
 IF e.currency<>'SAR' OR e.approved_by IS NOT NULL OR e.approved_at IS NOT NULL OR e.vat_amount<>0 OR e.coa_account_code IS NOT NULL OR e.is_deducted OR e.payroll_period_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.payables WHERE tenant_id=t AND source_entity_type='expense' AND source_entity_id=e.id)
  OR EXISTS(SELECT 1 FROM public.financial_events WHERE tenant_id=t AND source_type='expense' AND source_id=e.id)
  OR EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=t AND source_entity_type='expense' AND source_entity_id=e.id)
 THEN RAISE EXCEPTION 'EXP_EDIT_FINANCE_REVIEW'; END IF;
 before_values:=jsonb_build_object('expense_type',e.expense_type,'category',e.category,'amount',e.amount,'expense_date',e.expense_date,'vendor',e.vendor,'description',e.description,'vat_rate',e.vat_rate,'version',e.correction_version);
 IF p_operation='update' THEN
  UPDATE public.expenses SET expense_type=v_type,category=v_category,amount=v_amount,expense_date=v_date,vendor=v_vendor,description=v_description,vat_rate=v_rate,updated_by=actor WHERE id=e.id RETURNING * INTO e;
 ELSE
  UPDATE public.expenses SET cancelled_at=clock_timestamp(),cancelled_by=actor,cancellation_reason=btrim(p_reason),updated_by=actor WHERE id=e.id RETURNING * INTO e;
 END IF;
 after_values:=jsonb_build_object('expense_type',e.expense_type,'category',e.category,'amount',e.amount,'expense_date',e.expense_date,'vendor',e.vendor,'description',e.description,'vat_rate',e.vat_rate,'version',e.correction_version,'decision',CASE WHEN p_operation='cancel' THEN 'cancelled' ELSE 'pending' END,'reason',btrim(p_reason));
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,actor,'expenses','expenses',e.id,CASE WHEN p_operation='update' THEN 'expense_pending_updated' ELSE 'expense_cancelled' END,before_values,after_values);
 INSERT INTO public.expense_correction_receipts(tenant_id,request_id,expense_id,actor_id,operation,request_payload,result_version) VALUES(t,p_request_id,e.id,actor,p_operation,payload,e.correction_version);
 RETURN jsonb_build_object('id',e.id,'version',e.correction_version,'replayed',false);
END; $$;
CREATE FUNCTION public.correct_pending_expense_atomic(p_id uuid,p_expected_version integer,p_request_id uuid,p_operation text,p_details jsonb,p_reason text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT expense_private.correct(p_id,p_expected_version,p_request_id,p_operation,p_details,p_reason); $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA expense_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION expense_private.correct(uuid,integer,uuid,text,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.correct_pending_expense_atomic(uuid,integer,uuid,text,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.correct_pending_expense_atomic(uuid,integer,uuid,text,jsonb,text) TO authenticated;

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


CREATE FUNCTION expense_private.decide(p_id uuid,p_expected_version integer,p_decision text,p_vat_rate numeric,p_recoverability text,p_reason text,p_surface text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();e public.expenses%ROWTYPE;
BEGIN
 IF t IS NULL OR actor IS NULL OR NOT public.user_has_permission('expenses','approve') THEN RAISE EXCEPTION 'EXP_EDIT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<1 OR p_decision IS NULL OR p_decision NOT IN('approved','rejected') THEN RAISE EXCEPTION 'EXP_EDIT_INPUT' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.expenses WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXP001: expense not found'; END IF;
 IF e.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'EXP_CANCELLED: expense was cancelled'; END IF;
 IF e.is_approved THEN RAISE EXCEPTION 'EXP002: expense already approved'; END IF;
 IF e.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'EXP_REJECTED: expense already rejected'; END IF;
 IF e.correction_version<>p_expected_version THEN RAISE EXCEPTION 'EXP_EDIT_STALE'; END IF;
 IF p_decision='rejected' THEN RETURN public.reject_expense_atomic(t,p_id,p_reason,actor); END IF;
 RETURN public.approve_expense_with_context_atomic(t,p_id,p_vat_rate,p_recoverability,actor,p_reason,p_surface);
END; $$;
CREATE FUNCTION public.decide_expense_reviewed_atomic(p_id uuid,p_expected_version integer,p_decision text,p_vat_rate numeric DEFAULT NULL,p_recoverability text DEFAULT NULL,p_reason text DEFAULT NULL,p_surface text DEFAULT 'expenses') RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT expense_private.decide(p_id,p_expected_version,p_decision,p_vat_rate,p_recoverability,p_reason,p_surface); $$;
REVOKE ALL ON FUNCTION expense_private.decide(uuid,integer,text,numeric,text,text,text),public.decide_expense_reviewed_atomic(uuid,integer,text,numeric,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION expense_private.decide(uuid,integer,text,numeric,text,text,text),public.decide_expense_reviewed_atomic(uuid,integer,text,numeric,text,text,text) TO authenticated;

-- Runtime decisions require the authenticated reviewed-version boundary.
REVOKE ALL ON FUNCTION public.approve_expense_atomic(uuid,uuid,numeric,text,uuid),public.approve_expense_with_context_atomic(uuid,uuid,numeric,text,uuid,text,text),public.reject_expense_atomic(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
