BEGIN;
CREATE SCHEMA IF NOT EXISTS application_private;
REVOKE ALL ON SCHEMA application_private FROM PUBLIC,anon,service_role;
GRANT USAGE ON SCHEMA application_private TO authenticated;
ALTER TABLE public.driver_applications ADD COLUMN workflow_version integer NOT NULL DEFAULT 1, ADD COLUMN documents_version integer NOT NULL DEFAULT 1,
 ADD COLUMN withdrawn_at timestamptz,ADD COLUMN withdrawn_by uuid REFERENCES auth.users(id),ADD COLUMN withdrawal_reason text,
 ADD COLUMN archived_at timestamptz,ADD COLUMN archived_by uuid REFERENCES auth.users(id),ADD COLUMN archive_reason text;
ALTER TABLE public.driver_applications DROP CONSTRAINT driver_applications_status_check;
ALTER TABLE public.driver_applications ADD CONSTRAINT driver_applications_status_check CHECK(status IN('submitted','under_review','approved','rejected','withdrawn')),
 ADD CONSTRAINT application_withdrawal_evidence CHECK((status='withdrawn' AND withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawal_reason IS NOT NULL AND length(btrim(withdrawal_reason)) BETWEEN 5 AND 500) OR(status<>'withdrawn' AND withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawal_reason IS NULL)),
 ADD CONSTRAINT application_archive_evidence CHECK((archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL) OR(archived_at IS NOT NULL AND archived_by IS NOT NULL AND archive_reason IS NOT NULL AND length(btrim(archive_reason)) BETWEEN 5 AND 500 AND status IN('approved','rejected','withdrawn')));
CREATE INDEX application_review_page ON public.driver_applications(tenant_id,created_at DESC,id DESC);
CREATE INDEX application_withdrawn_by_fk ON public.driver_applications(withdrawn_by) WHERE withdrawn_by IS NOT NULL;
CREATE INDEX application_archived_by_fk ON public.driver_applications(archived_by) WHERE archived_by IS NOT NULL;
REVOKE UPDATE,DELETE ON public.driver_applications FROM PUBLIC,anon,authenticated;
DO $acl$ DECLARE cols text;BEGIN SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid='public.driver_applications'::regclass AND attnum>0 AND NOT attisdropped;EXECUTE format('REVOKE UPDATE (%s) ON public.driver_applications FROM PUBLIC,anon,authenticated',cols);END;$acl$;
CREATE FUNCTION application_private.history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'APP_HISTORY_IMMUTABLE'; END IF;
 IF current_user='service_role' THEN RAISE EXCEPTION 'APP_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF OLD.status IN('approved','rejected','withdrawn') AND
  (to_jsonb(NEW)-ARRAY['updated_at','workflow_version','archived_at','archived_by','archive_reason']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['updated_at','workflow_version','archived_at','archived_by','archive_reason']) THEN RAISE EXCEPTION 'APP_HISTORY_IMMUTABLE'; END IF;
 IF (NEW.archived_at,NEW.archived_by,NEW.archive_reason) IS DISTINCT FROM (OLD.archived_at,OLD.archived_by,OLD.archive_reason)
  AND (auth.uid() IS NULL OR NOT public.user_has_permission('hr','approve')) THEN RAISE EXCEPTION 'APP_FORBIDDEN' USING ERRCODE='42501'; END IF;
 NEW.workflow_version:=OLD.workflow_version+CASE WHEN (to_jsonb(NEW)-'updated_at'-'workflow_version') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'workflow_version') THEN 1 ELSE 0 END;
 RETURN NEW;
END; $$;
CREATE TRIGGER application_history_guard BEFORE UPDATE OR DELETE ON public.driver_applications FOR EACH ROW EXECUTE FUNCTION application_private.history_guard();
CREATE FUNCTION application_private.document_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent_id uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.application_id ELSE NEW.application_id END;a public.driver_applications%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.application_id,NEW.tenant_id,NEW.id) IS DISTINCT FROM (OLD.application_id,OLD.tenant_id,OLD.id) THEN RAISE EXCEPTION 'APP_DOCUMENT_IDENTITY_IMMUTABLE'; END IF;
 SELECT * INTO a FROM public.driver_applications WHERE id=parent_id FOR UPDATE;
 IF NOT FOUND OR a.tenant_id IS DISTINCT FROM (CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END) THEN RAISE EXCEPTION 'APP_DOCUMENT_TENANT' USING ERRCODE='42501'; END IF;
 IF a.status NOT IN('submitted','under_review') OR a.archived_at IS NOT NULL THEN RAISE EXCEPTION 'APP_HISTORY_IMMUTABLE'; END IF;
 IF TG_OP<>'UPDATE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN UPDATE public.driver_applications SET documents_version=documents_version+1 WHERE id=parent_id; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER application_document_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON public.driver_application_documents FOR EACH ROW EXECUTE FUNCTION application_private.document_guard();
CREATE FUNCTION application_private.mutate(p_id uuid,p_expected_version integer,p_action text,p_reason text,p_surface text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();reviewer uuid;a public.driver_applications%ROWTYPE;after_row public.driver_applications%ROWTYPE;
BEGIN
 IF t IS NULL OR actor IS NULL OR NOT public.user_has_permission('hr','approve') THEN RAISE EXCEPTION 'APP_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_action IS NULL OR p_action NOT IN('under_review','approved','rejected','withdraw','archive','restore') OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500 OR p_surface IS NULL OR p_surface NOT IN('applications','approvals_inbox') THEN RAISE EXCEPTION 'APP_INPUT' USING ERRCODE='22023'; END IF;
 SELECT id INTO reviewer FROM public.users WHERE auth_user_id=actor AND tenant_id=t AND status='active' AND deleted_at IS NULL;
 IF reviewer IS NULL THEN RAISE EXCEPTION 'APP_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.driver_applications WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APP001: application not found'; END IF;
 IF a.workflow_version<>p_expected_version THEN RAISE EXCEPTION 'APP_STALE'; END IF;
 IF p_action IN('archive','restore') THEN
  IF a.status NOT IN('approved','rejected','withdrawn') OR (p_action='archive' AND a.archived_at IS NOT NULL) OR (p_action='restore' AND a.archived_at IS NULL) THEN RAISE EXCEPTION 'APP_INVALID_TRANSITION'; END IF;
  UPDATE public.driver_applications SET archived_at=CASE WHEN p_action='archive' THEN clock_timestamp() END,archived_by=CASE WHEN p_action='archive' THEN actor END,archive_reason=CASE WHEN p_action='archive' THEN btrim(p_reason) END WHERE id=p_id RETURNING * INTO after_row;
 ELSE
  IF a.archived_at IS NOT NULL OR a.status NOT IN('submitted','under_review') THEN RAISE EXCEPTION 'APP002: application already decided'; END IF;
  IF p_action='under_review' AND a.status<>'submitted' THEN RAISE EXCEPTION 'APP_INVALID_TRANSITION'; END IF;
  UPDATE public.driver_applications SET status=CASE WHEN p_action='withdraw' THEN 'withdrawn' ELSE p_action END,reviewed_by=reviewer,reviewed_at=clock_timestamp(),review_note=btrim(p_reason),
   withdrawn_at=CASE WHEN p_action='withdraw' THEN clock_timestamp() END,withdrawn_by=CASE WHEN p_action='withdraw' THEN actor END,withdrawal_reason=CASE WHEN p_action='withdraw' THEN btrim(p_reason) END WHERE id=p_id RETURNING * INTO after_row;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,actor,'hr','driver_application',p_id,CASE p_action WHEN 'archive' THEN 'application_archived' WHEN 'restore' THEN 'application_restored' WHEN 'withdraw' THEN 'application_withdrawn' ELSE 'application_reviewed' END,
 jsonb_build_object('status',a.status,'version',a.workflow_version,'archived',a.archived_at IS NOT NULL),jsonb_build_object('status',after_row.status,'version',after_row.workflow_version,'archived',after_row.archived_at IS NOT NULL,'reason',btrim(p_reason),'surface',p_surface));
 RETURN jsonb_build_object('id',after_row.id,'version',after_row.workflow_version,'status',after_row.status,'archived',after_row.archived_at IS NOT NULL);
END; $$;
CREATE FUNCTION public.mutate_application_review_atomic(p_id uuid,p_expected_version integer,p_action text,p_reason text,p_surface text DEFAULT 'applications') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT application_private.mutate(p_id,p_expected_version,p_action,p_reason,p_surface); $$;
REVOKE ALL ON FUNCTION application_private.mutate(uuid,integer,text,text,text),public.mutate_application_review_atomic(uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION application_private.mutate(uuid,integer,text,text,text),public.mutate_application_review_atomic(uuid,integer,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.decide_application_atomic(uuid,uuid,text,text,uuid),public.decide_leave_request_atomic(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION application_private.page(p_search text,p_status text,p_archived boolean,p_page integer,p_page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();n bigint;last_page integer;actual_page integer;summary jsonb;rows jsonb;
BEGIN
 IF t IS NULL OR auth.uid() IS NULL OR NOT public.user_has_permission('hr','read') THEN RAISE EXCEPTION 'APP_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_search IS NULL OR length(p_search)>200 OR p_status IS NULL OR p_status NOT IN('all','submitted','under_review','approved','rejected','withdrawn') OR p_archived IS NULL OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'APP_INPUT' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('total',count(*),'pending',count(*) FILTER(WHERE status IN('submitted','under_review')),'approved',count(*) FILTER(WHERE status='approved'),'rejected',count(*) FILTER(WHERE status='rejected'),'withdrawn',count(*) FILTER(WHERE status='withdrawn')) INTO summary FROM public.driver_applications WHERE tenant_id=t AND (archived_at IS NOT NULL)=p_archived;
 SELECT count(*) INTO n FROM public.driver_applications a WHERE a.tenant_id=t AND (a.archived_at IS NOT NULL)=p_archived AND (p_status='all' OR a.status=p_status) AND (btrim(p_search)='' OR position(lower(btrim(p_search)) IN lower(concat_ws(' ',a.application_number,a.full_name,a.mobile,a.city)))>0);
 last_page:=greatest(1,ceil(n::numeric/p_page_size)::integer);actual_page:=least(p_page,last_page);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb) INTO rows FROM(SELECT id,application_number,full_name,mobile,city,work_type,driver_category,status,platform_codes,submitted_at,created_at,workflow_version,archived_at FROM public.driver_applications a WHERE a.tenant_id=t AND (a.archived_at IS NOT NULL)=p_archived AND (p_status='all' OR a.status=p_status) AND (btrim(p_search)='' OR position(lower(btrim(p_search)) IN lower(concat_ws(' ',a.application_number,a.full_name,a.mobile,a.city)))>0) ORDER BY a.created_at DESC,a.id DESC LIMIT p_page_size OFFSET (actual_page-1)*p_page_size)q;
 RETURN jsonb_build_object('rows',rows,'summary',summary,'total',n,'page',actual_page,'pageSize',p_page_size,'totalPages',last_page);
END; $$;
CREATE FUNCTION public.fetch_applications_page(p_search text DEFAULT '',p_status text DEFAULT 'all',p_archived boolean DEFAULT false,p_page integer DEFAULT 1,p_page_size integer DEFAULT 25) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT application_private.page(p_search,p_status,p_archived,p_page,p_page_size); $$;
REVOKE ALL ON FUNCTION application_private.page(text,text,boolean,integer,integer),public.fetch_applications_page(text,text,boolean,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION application_private.page(text,text,boolean,integer,integer),public.fetch_applications_page(text,text,boolean,integer,integer) TO authenticated;
REVOKE ALL ON FUNCTION application_private.history_guard(),application_private.document_guard() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
