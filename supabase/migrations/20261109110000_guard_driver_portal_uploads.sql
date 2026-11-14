-- Created with Supabase CLI as 20261102011216_guard_driver_portal_uploads.sql.
-- Renamed while unapplied: follows the repository's existing Nov 8/9 prerequisites.
-- Portal capabilities reserve quota before issuance.
BEGIN;
CREATE SCHEMA IF NOT EXISTS driver_portal_private;
REVOKE ALL ON SCHEMA driver_portal_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA driver_portal_private TO service_role;

-- Refuse historical duplicates rather than silently discarding reviewed records.
CREATE UNIQUE INDEX uq_driver_portal_submission_path ON public.driver_portal_submissions(file_path);
CREATE TABLE driver_portal_private.upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  link_id uuid NOT NULL REFERENCES public.driver_portal_links(id),
  file_path text NOT NULL UNIQUE,
  doc_type text NOT NULL,
  expected_size integer NOT NULL CHECK(expected_size BETWEEN 1 AND 10485760),
  mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')),
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','issued','completed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
  issued_at timestamptz,
  completed_at timestamptz,
  submission_id uuid UNIQUE REFERENCES public.driver_portal_submissions(id),
  CHECK((status='completed')=(submission_id IS NOT NULL)),
  CHECK(status='reserved' OR issued_at IS NOT NULL)
);
ALTER TABLE driver_portal_private.upload_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON driver_portal_private.upload_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON driver_portal_private.upload_reservations TO service_role;
CREATE INDEX idx_portal_reservation_driver ON driver_portal_private.upload_reservations(driver_id,created_at);

-- All portal operations use tenant -> driver -> link -> reservation lock order.
-- SHARE protects tenant activation/deletion while allowing unrelated drivers.
CREATE FUNCTION driver_portal_private.lock_driver(p_tenant uuid,p_driver uuid,p_require_active boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.tenants WHERE id=p_tenant AND status='active' AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DPU001: portal scope unavailable'; END IF;
 PERFORM 1 FROM public.drivers WHERE id=p_driver AND tenant_id=p_tenant
   AND (NOT p_require_active OR (deleted_at IS NULL AND status IN ('active','on_leave'))) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DPU001: portal scope unavailable'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION driver_portal_private.lock_driver(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION driver_portal_private.lock_driver(uuid,uuid,boolean) TO service_role;

CREATE FUNCTION driver_portal_private.lock_link(p_token_hash text)
RETURNS public.driver_portal_links LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE initial public.driver_portal_links; current_link public.driver_portal_links;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'DPU001: portal scope unavailable'; END IF;
 SELECT * INTO initial FROM public.driver_portal_links WHERE token_hash=p_token_hash;
 IF initial.id IS NULL THEN RAISE EXCEPTION 'DPU001: portal scope unavailable'; END IF;
 PERFORM driver_portal_private.lock_driver(initial.tenant_id,initial.driver_id);
 SELECT * INTO current_link FROM public.driver_portal_links WHERE id=initial.id FOR UPDATE;
 IF current_link.id IS NULL OR current_link.token_hash<>p_token_hash OR current_link.tenant_id<>initial.tenant_id
   OR current_link.driver_id<>initial.driver_id OR current_link.revoked_at IS NOT NULL OR current_link.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'DPU001: portal scope unavailable'; END IF;
 RETURN current_link;
END;
$$;
REVOKE ALL ON FUNCTION driver_portal_private.lock_link(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION driver_portal_private.lock_link(text) TO service_role;

CREATE FUNCTION public.reserve_driver_portal_upload(p_token_hash text,p_doc_type text,p_size integer,p_mime text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE l public.driver_portal_links; r driver_portal_private.upload_reservations; extension text; pending bigint; issued bigint; legacy bigint; stamp timestamptz;
BEGIN
 l:=driver_portal_private.lock_link(p_token_hash);
 IF p_doc_type IS NULL OR NOT (p_doc_type=ANY(ARRAY['national_id','iqama','passport','work_permit','driving_license','home_delivery_permit','ajeer_permit','driver_card','training_certificate','health_certificate','medical_insurance','medical_certificate','food_handling_certificate','vehicle_license','vehicle_insurance','vehicle_lease_agreement','vehicle_handover_report','vehicle_return_report','accident_report','employment_contract','bank_letter','police_clearance','authorization_letter','other']))
   OR p_size IS NULL OR p_size<1 OR p_size>10485760 THEN RAISE EXCEPTION 'DPU004: invalid upload'; END IF;
 extension:=CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' WHEN 'image/heic' THEN 'heic' WHEN 'image/heif' THEN 'heif' WHEN 'application/pdf' THEN 'pdf' END;
 IF extension IS NULL THEN RAISE EXCEPTION 'DPU004: invalid upload'; END IF;
 stamp:=clock_timestamp();
 SELECT count(*) INTO pending FROM public.driver_portal_submissions WHERE tenant_id=l.tenant_id AND driver_id=l.driver_id AND status='pending';
 SELECT pending+count(*) INTO pending FROM driver_portal_private.upload_reservations WHERE tenant_id=l.tenant_id AND driver_id=l.driver_id AND status IN ('reserved','issued') AND expires_at>stamp;
 IF pending>=10 THEN RAISE EXCEPTION 'DPU002: review quota reached'; END IF;
 SELECT count(*) INTO issued FROM driver_portal_private.upload_reservations WHERE tenant_id=l.tenant_id AND driver_id=l.driver_id AND created_at>stamp-interval '24 hours';
 SELECT count(*) INTO legacy FROM public.driver_portal_submissions s WHERE s.tenant_id=l.tenant_id AND s.driver_id=l.driver_id AND s.created_at>stamp-interval '24 hours'
   AND NOT EXISTS(SELECT 1 FROM driver_portal_private.upload_reservations x WHERE x.file_path=s.file_path);
 IF issued+legacy>=20 THEN RAISE EXCEPTION 'DPU003: daily quota reached'; END IF;
 r.id:=gen_random_uuid();
 INSERT INTO driver_portal_private.upload_reservations(id,tenant_id,driver_id,link_id,file_path,doc_type,expected_size,mime_type)
 VALUES(r.id,l.tenant_id,l.driver_id,l.id,l.tenant_id::text||'/'||l.driver_id::text||'/'||p_doc_type||'-'||r.id::text||'.'||extension,p_doc_type,p_size,p_mime) RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id,'path',r.file_path);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_driver_portal_upload(text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_driver_portal_upload(text,text,integer,text) TO service_role;

-- Only return the signed token AFTER activation succeeds. An uncertain signing
-- or activation result still consumes the rolling daily attempt quota.
CREATE FUNCTION public.activate_driver_portal_upload(p_token_hash text,p_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE l public.driver_portal_links; r driver_portal_private.upload_reservations;
BEGIN
 l:=driver_portal_private.lock_link(p_token_hash);
 SELECT * INTO r FROM driver_portal_private.upload_reservations WHERE file_path=p_path AND link_id=l.id AND tenant_id=l.tenant_id AND driver_id=l.driver_id FOR UPDATE;
 IF r.id IS NULL OR r.status NOT IN ('reserved','issued') OR r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'DPU004: reservation unavailable'; END IF;
 IF r.status='reserved' THEN
  UPDATE driver_portal_private.upload_reservations SET status='issued',issued_at=clock_timestamp(),expires_at=clock_timestamp()+interval '2 hours 5 minutes' WHERE id=r.id RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('id',r.id,'path',r.file_path);
END;
$$;
REVOKE ALL ON FUNCTION public.activate_driver_portal_upload(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_driver_portal_upload(text,text) TO service_role;

CREATE FUNCTION public.complete_driver_portal_upload(p_token_hash text,p_path text,p_doc_type text,p_doc_number text DEFAULT NULL,p_expiry_date date DEFAULT NULL,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE l public.driver_portal_links; r driver_portal_private.upload_reservations; s public.driver_portal_submissions; obj storage.objects; bytes numeric; mime text;
BEGIN
 l:=driver_portal_private.lock_link(p_token_hash);
 SELECT * INTO r FROM driver_portal_private.upload_reservations WHERE file_path=p_path AND link_id=l.id AND tenant_id=l.tenant_id AND driver_id=l.driver_id FOR UPDATE;
 IF r.id IS NULL OR r.doc_type IS DISTINCT FROM p_doc_type OR length(p_doc_number)>100 OR length(p_note)>500 THEN RAISE EXCEPTION 'DPU004: reservation unavailable'; END IF;
 IF r.status='completed' THEN
  SELECT * INTO s FROM public.driver_portal_submissions WHERE id=r.submission_id AND file_path=r.file_path;
  IF s.id IS NULL OR s.tenant_id<>l.tenant_id OR s.driver_id<>l.driver_id OR s.link_id<>l.id OR s.doc_type<>p_doc_type
    OR s.doc_number IS DISTINCT FROM nullif(btrim(p_doc_number),'') OR s.expiry_date IS DISTINCT FROM p_expiry_date OR s.driver_note IS DISTINCT FROM nullif(btrim(p_note),'')
  THEN RAISE EXCEPTION 'DPU006: completed upload differs'; END IF;
  RETURN jsonb_build_object('id',s.id,'replayed',true);
 END IF;
 IF r.status<>'issued' OR r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'DPU004: reservation unavailable'; END IF;
 -- The reserved slot becomes exactly one pending submission under the driver
 -- lock. There is no second quota increment or check/insert race at finish.
 SELECT * INTO obj FROM storage.objects WHERE bucket_id='driver-portal-uploads' AND name=r.file_path FOR SHARE;
 IF obj.id IS NULL OR jsonb_typeof(obj.metadata->'size') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'DPU005: uploaded object unavailable'; END IF;
 bytes:=(obj.metadata->>'size')::numeric; mime:=obj.metadata->>'mimetype';
 IF bytes IS DISTINCT FROM r.expected_size::numeric OR bytes<1 OR bytes>10485760 OR mime IS DISTINCT FROM r.mime_type THEN RAISE EXCEPTION 'DPU005: uploaded object differs'; END IF;
 INSERT INTO public.driver_portal_submissions(tenant_id,driver_id,link_id,doc_type,doc_number,expiry_date,file_path,mime_type,file_size,driver_note)
 VALUES(l.tenant_id,l.driver_id,l.id,r.doc_type,nullif(btrim(p_doc_number),''),p_expiry_date,r.file_path,mime,bytes::integer,nullif(btrim(p_note),'')) RETURNING * INTO s;
 UPDATE driver_portal_private.upload_reservations SET status='completed',submission_id=s.id,completed_at=clock_timestamp() WHERE id=r.id;
 UPDATE public.driver_portal_links SET last_used_at=clock_timestamp(),use_count=use_count+1 WHERE id=l.id;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(l.tenant_id,NULL,'drivers','driver_portal_submission',s.id,'portal_submission_created',jsonb_build_object('driver_id',l.driver_id,'doc_type',r.doc_type));
 RETURN jsonb_build_object('id',s.id,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_driver_portal_upload(text,text,text,text,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_driver_portal_upload(text,text,text,text,date,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_driver_portal_link(p_driver_id uuid,p_token_hash text,p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); actor uuid:=auth.uid(); n public.driver_portal_links;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers','update') THEN RAISE EXCEPTION 'AUTH007: driver permission required'; END IF;
 -- Preserve the existing caller authorization, add a serialized current scope.
 IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=p_driver_id AND tenant_id=t AND deleted_at IS NULL AND status IN ('active','on_leave')) THEN RAISE EXCEPTION 'DPA001: active tenant driver required'; END IF;
 PERFORM driver_portal_private.lock_driver(t,p_driver_id);
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'DPL001: invalid token'; END IF;
 IF p_days IS NULL OR p_days<1 OR p_days>90 THEN RAISE EXCEPTION 'DPL002: link validity must be 1-90 days'; END IF;
 UPDATE public.driver_portal_links SET revoked_at=clock_timestamp() WHERE driver_id=p_driver_id AND tenant_id=t AND revoked_at IS NULL;
 INSERT INTO public.driver_portal_links(tenant_id,driver_id,token_hash,expires_at,created_by)
 VALUES(t,p_driver_id,p_token_hash,clock_timestamp()+make_interval(days=>p_days),actor) RETURNING * INTO n;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(t,actor,'drivers','driver_portal_link',n.id,'portal_link_issued',jsonb_build_object('driver_id',p_driver_id,'expires_at',n.expires_at));
 RETURN jsonb_build_object('id',n.id,'expires_at',n.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_driver_portal_link(uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_driver_portal_link(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_driver_portal_links(p_driver_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); actor uuid:=auth.uid(); c integer;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers','update') THEN RAISE EXCEPTION 'AUTH007: driver permission required'; END IF;
 PERFORM driver_portal_private.lock_driver(t,p_driver_id,false);
 UPDATE public.driver_portal_links SET revoked_at=clock_timestamp() WHERE driver_id=p_driver_id AND tenant_id=t AND revoked_at IS NULL;
 GET DIAGNOSTICS c=ROW_COUNT;
 IF c>0 THEN INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(t,actor,'drivers','driver_portal_link',p_driver_id,'portal_link_revoked',jsonb_build_object('count',c)); END IF;
 RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_driver_portal_links(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_driver_portal_links(uuid) TO authenticated;
COMMIT;
