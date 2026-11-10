-- Platform authority is global and caller-bound; it never relies on target-tenant membership.
BEGIN;
CREATE SCHEMA IF NOT EXISTS platform_management_private;
REVOKE ALL ON SCHEMA platform_management_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS platform_management_private.creation_requests(
 request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK(mode IN('password','invite')),email text NOT NULL,full_name text,role public.user_role NOT NULL,
 auth_user_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,invite_id uuid REFERENCES public.invites(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_management_private.creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_management_private.creation_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION platform_management_private.actor() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid();
BEGIN
 IF a IS NULL OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated' OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RAISE EXCEPTION 'PUM_FORBIDDEN' USING ERRCODE='42501';END IF;
 -- Hold membership until commit so a concurrent revocation cannot race this operation.
 PERFORM 1 FROM public.platform_admins WHERE user_id=a FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_FORBIDDEN' USING ERRCODE='42501';END IF;
 RETURN a;
END;$$;
REVOKE ALL ON FUNCTION platform_management_private.actor() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.mutate_platform_user(p_action text,p_user_id uuid,p_expected_version bigint,p_input jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=platform_management_private.actor();t uuid;u public.users%ROWTYPE;v public.users%ROWTYPE;rid uuid;next_role public.user_role;next_status public.user_status;reset_email text;reason text:=btrim(coalesce(p_input->>'reason',''));stamp timestamptz:=clock_timestamp();
BEGIN
 IF p_action IS NULL OR p_action NOT IN('role','status','archive','reset_request') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR length(reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'PUM_INPUT' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k<>ALL(CASE p_action WHEN 'role' THEN ARRAY['role','reason'] WHEN 'status' THEN ARRAY['status','reason'] ELSE ARRAY['reason'] END)) THEN RAISE EXCEPTION 'PUM_INPUT' USING ERRCODE='22023';END IF;
 SELECT tenant_id INTO t FROM public.users WHERE id=p_user_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_NOT_FOUND' USING ERRCODE='P0002';END IF;
 -- Match the tenant management lock order, including role and last-owner changes.
 PERFORM 1 FROM public.tenants WHERE id=t AND status='active' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_TENANT_INACTIVE' USING ERRCODE='55000';END IF;
 SELECT * INTO u FROM public.users WHERE id=p_user_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_NOT_FOUND' USING ERRCODE='P0002';END IF;
 IF p_expected_version IS NULL OR u.version<>p_expected_version THEN RAISE EXCEPTION 'PUM_STALE' USING ERRCODE='40001';END IF;
 IF u.auth_user_id=a OR EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=u.auth_user_id) THEN RAISE EXCEPTION 'PUM_PROTECTED' USING ERRCODE='42501';END IF;
 IF p_action='role' THEN
  IF p_input->>'role' IS NULL OR NOT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.user_role'::regtype AND enumlabel=p_input->>'role') THEN RAISE EXCEPTION 'PUM_ROLE' USING ERRCODE='22023';END IF;
  next_role:=(p_input->>'role')::public.user_role;
  IF next_role='general_manager' OR next_role=u.role OR u.status='terminated' THEN RAISE EXCEPTION 'PUM_ROLE' USING ERRCODE='22023';END IF;
  IF u.role='general_manager' AND NOT EXISTS(SELECT 1 FROM public.users WHERE tenant_id=t AND id<>u.id AND role='general_manager' AND status='active' AND deleted_at IS NULL AND (locked_until IS NULL OR locked_until<=stamp)) THEN RAISE EXCEPTION 'PUM_LAST_OWNER' USING ERRCODE='55000';END IF;
  SELECT id INTO rid FROM public.roles WHERE tenant_id=t AND name=next_role AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PUM_ROLE' USING ERRCODE='22023';END IF;
  UPDATE public.user_role_assignments SET revoked_at=stamp,updated_by=a WHERE tenant_id=t AND user_id=u.id AND revoked_at IS NULL AND deleted_at IS NULL;
  UPDATE public.users SET role=next_role,updated_by=a WHERE id=u.id AND tenant_id=t RETURNING * INTO v;
  INSERT INTO public.user_role_assignments(tenant_id,user_id,role_id,assigned_by,created_by) VALUES(t,u.id,rid,a,a);
 ELSIF p_action='status' THEN
  IF p_input->>'status' IS NULL OR NOT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.user_status'::regtype AND enumlabel=p_input->>'status') THEN RAISE EXCEPTION 'PUM_STATUS' USING ERRCODE='22023';END IF;
  next_status:=(p_input->>'status')::public.user_status;
  IF next_status=u.status OR u.status='terminated' OR (u.status='active' AND next_status NOT IN('inactive','locked','terminated')) OR (u.status='inactive' AND next_status NOT IN('active','terminated')) OR (u.status='locked' AND next_status NOT IN('active','inactive','terminated')) OR (u.status='pending_invite' AND next_status NOT IN('inactive','terminated')) THEN RAISE EXCEPTION 'PUM_STATUS' USING ERRCODE='22023';END IF;
  IF next_status='active' AND (u.locked_until>stamp OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u.auth_user_id AND email_confirmed_at IS NOT NULL)) THEN RAISE EXCEPTION 'PUM_STATUS' USING ERRCODE='55000';END IF;
  IF next_status='active' THEN
   PERFORM 1 FROM public.roles WHERE tenant_id=t AND name=u.role AND deleted_at IS NULL FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PUM_ROLE' USING ERRCODE='22023';END IF;
  END IF;
  IF u.role='general_manager' AND next_status<>'active' AND NOT EXISTS(SELECT 1 FROM public.users WHERE tenant_id=t AND id<>u.id AND role='general_manager' AND status='active' AND deleted_at IS NULL AND (locked_until IS NULL OR locked_until<=stamp)) THEN RAISE EXCEPTION 'PUM_LAST_OWNER' USING ERRCODE='55000';END IF;
  UPDATE public.users SET status=next_status,updated_by=a WHERE id=u.id AND tenant_id=t RETURNING * INTO v;
 ELSIF p_action='archive' THEN
  IF u.status NOT IN('inactive','terminated') THEN RAISE EXCEPTION 'PUM_DEACTIVATE_FIRST' USING ERRCODE='55000';END IF;
  IF u.role='general_manager' AND NOT EXISTS(SELECT 1 FROM public.users WHERE tenant_id=t AND id<>u.id AND role='general_manager' AND status='active' AND deleted_at IS NULL AND (locked_until IS NULL OR locked_until<=stamp)) THEN RAISE EXCEPTION 'PUM_LAST_OWNER' USING ERRCODE='55000';END IF;
  UPDATE public.users SET deleted_at=stamp,updated_by=a WHERE id=u.id AND tenant_id=t RETURNING * INTO v;
  UPDATE public.user_role_assignments SET revoked_at=stamp,updated_by=a WHERE tenant_id=t AND user_id=u.id AND revoked_at IS NULL AND deleted_at IS NULL;
  UPDATE public.tenant_memberships SET deleted_at=stamp,updated_by=a WHERE tenant_id=t AND user_id=u.id AND deleted_at IS NULL;
 ELSE
  IF u.status<>'active' THEN RAISE EXCEPTION 'PUM_STATUS' USING ERRCODE='55000';END IF;
  SELECT lower(btrim(email)) INTO reset_email FROM auth.users WHERE id=u.auth_user_id AND email_confirmed_at IS NOT NULL AND email IS NOT NULL;
  IF NOT FOUND OR reset_email='' THEN RAISE EXCEPTION 'PUM_STATUS' USING ERRCODE='55000';END IF;
  v:=u;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
 VALUES(t,a,'platform_admin','users',u.id,'platform_user_'||p_action,jsonb_build_object('role',u.role,'status',u.status,'version',u.version,'archived',false),jsonb_build_object('role',v.role,'status',v.status,'version',v.version,'archived',v.deleted_at IS NOT NULL,'reason_recorded',true));
 RETURN jsonb_build_object('id',v.id,'version',v.version::text)||CASE WHEN p_action='reset_request' THEN jsonb_build_object('email',reset_email) ELSE '{}'::jsonb END;
END;$$;

CREATE OR REPLACE FUNCTION public.reserve_platform_user(p_request_id uuid,p_tenant_id uuid,p_email text,p_role text,p_full_name text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=platform_management_private.actor();r platform_management_private.creation_requests%ROWTYPE;mail text:=lower(btrim(p_email));name text:=nullif(btrim(p_full_name),'');
BEGIN
 IF p_request_id IS NULL OR p_tenant_id IS NULL OR mail IS NULL OR length(mail) NOT BETWEEN 3 AND 254 OR mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR length(coalesce(name,''))>150 OR p_role IS NULL OR p_role='general_manager' THEN RAISE EXCEPTION 'PUM_INPUT' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.tenants WHERE id=p_tenant_id AND status='active' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_TENANT_INACTIVE' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.roles role_row WHERE role_row.tenant_id=p_tenant_id AND role_row.name::text=p_role AND role_row.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_ROLE' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM platform_management_private.creation_requests WHERE request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.actor_id<>a OR r.tenant_id<>p_tenant_id OR r.email<>mail OR r.role::text<>p_role OR r.full_name IS DISTINCT FROM name OR r.mode<>'password' THEN RAISE EXCEPTION 'PUM_REQUEST_MISMATCH' USING ERRCODE='22023';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM auth.users WHERE lower(btrim(email))=mail) OR EXISTS(SELECT 1 FROM public.invites WHERE lower(btrim(email))=mail AND status='pending' AND deleted_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'PUM_EMAIL_EXISTS' USING ERRCODE='23505';END IF;
  INSERT INTO platform_management_private.creation_requests(request_id,actor_id,tenant_id,mode,email,full_name,role) VALUES(p_request_id,a,p_tenant_id,'password',mail,name,p_role::public.user_role) RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('auth_user_id',r.auth_user_id,'user_id',r.user_id);
END;$$;

CREATE OR REPLACE FUNCTION public.finalize_platform_user(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=platform_management_private.actor();r platform_management_private.creation_requests%ROWTYPE;t uuid;rid uuid;uid uuid;ver bigint;stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT tenant_id INTO t FROM platform_management_private.creation_requests WHERE request_id=p_request_id AND actor_id=a AND mode='password';
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_NOT_FOUND' USING ERRCODE='P0002';END IF;
 PERFORM 1 FROM public.tenants WHERE id=t AND status='active' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_TENANT_INACTIVE' USING ERRCODE='55000';END IF;
 SELECT * INTO r FROM platform_management_private.creation_requests WHERE request_id=p_request_id AND actor_id=a AND mode='password' FOR UPDATE;
 SELECT id INTO rid FROM public.roles WHERE tenant_id=t AND name=r.role AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR r.role='general_manager' THEN RAISE EXCEPTION 'PUM_ROLE' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM auth.users WHERE id=r.auth_user_id AND lower(btrim(email))=r.email AND email_confirmed_at IS NOT NULL AND coalesce(encrypted_password,'')<>''
 AND raw_app_meta_data @> jsonb_build_object('_invite_provisioned',true,'_platform_provision_request',r.request_id::text,'_platform_provision_tenant',t::text,'_platform_provision_actor',a::text) FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=r.auth_user_id) THEN RAISE EXCEPTION 'PUM_AUTH_BINDING' USING ERRCODE='42501';END IF;
 IF r.user_id IS NOT NULL THEN
  SELECT version INTO ver FROM public.users WHERE id=r.user_id AND tenant_id=t AND auth_user_id=r.auth_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PUM_AUTH_BINDING' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('id',r.user_id,'version',ver::text,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE auth_user_id=r.auth_user_id) THEN RAISE EXCEPTION 'PUM_AUTH_BINDING' USING ERRCODE='42501';END IF;
 INSERT INTO public.users(auth_user_id,tenant_id,email,full_name_en,role,status,must_change_password,invited_by,invited_at,accepted_invite_at,created_by)
 VALUES(r.auth_user_id,t,r.email,r.full_name,r.role,'active',true,a,stamp,stamp,a) RETURNING id,version INTO uid,ver;
 INSERT INTO public.tenant_memberships(tenant_id,user_id,is_primary,created_by) VALUES(t,uid,true,a);
 INSERT INTO public.user_role_assignments(tenant_id,user_id,role_id,assigned_by,created_by) VALUES(t,uid,rid,a,a);
 UPDATE platform_management_private.creation_requests SET user_id=uid WHERE request_id=r.request_id;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,a,'platform_admin','users',uid,'platform_user_created',jsonb_build_object('role',r.role,'status','active','version',ver,'must_change_password',true));
 RETURN jsonb_build_object('id',uid,'version',ver::text,'replayed',false);
END;$$;

CREATE OR REPLACE FUNCTION public.issue_platform_user_invite(p_request_id uuid,p_tenant_id uuid,p_email text,p_role text,p_full_name text,p_token_id uuid,p_token_hash text,p_expires_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=platform_management_private.actor();r platform_management_private.creation_requests%ROWTYPE;mail text:=lower(btrim(p_email));name text:=nullif(btrim(p_full_name),'');iid uuid;
BEGIN
 IF p_request_id IS NULL OR p_tenant_id IS NULL OR mail IS NULL OR length(mail) NOT BETWEEN 3 AND 254 OR mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR length(coalesce(name,''))>150 OR p_role IS NULL OR p_role='general_manager' OR p_token_id IS NULL OR p_token_hash !~ '^[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}$' OR p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR p_expires_at>clock_timestamp()+interval '8 days' THEN RAISE EXCEPTION 'PUM_INPUT' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.tenants WHERE id=p_tenant_id AND status='active' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_TENANT_INACTIVE' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.roles role_row WHERE role_row.tenant_id=p_tenant_id AND role_row.name::text=p_role AND role_row.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUM_ROLE' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM platform_management_private.creation_requests WHERE request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.actor_id<>a OR r.tenant_id<>p_tenant_id OR r.email<>mail OR r.role::text<>p_role OR r.full_name IS DISTINCT FROM name OR r.mode<>'invite' THEN RAISE EXCEPTION 'PUM_REQUEST_MISMATCH' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('id',r.invite_id,'replayed',true,'send_current_token',EXISTS(SELECT 1 FROM public.invites WHERE id=r.invite_id AND token_id=p_token_id AND token_hash=p_token_hash AND status='pending' AND deleted_at IS NULL AND expires_at>clock_timestamp()));
 END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE lower(btrim(email))=mail) OR EXISTS(SELECT 1 FROM public.invites WHERE lower(btrim(email))=mail AND status='pending' AND deleted_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'PUM_EMAIL_EXISTS' USING ERRCODE='23505';END IF;
 INSERT INTO public.invites(tenant_id,email,role,token_id,token_hash,status,expires_at,invited_by,created_by) VALUES(p_tenant_id,mail,p_role::public.user_role,p_token_id,p_token_hash,'pending',p_expires_at,a,a) RETURNING id INTO iid;
 INSERT INTO platform_management_private.creation_requests(request_id,actor_id,tenant_id,mode,email,full_name,role,invite_id) VALUES(p_request_id,a,p_tenant_id,'invite',mail,name,p_role::public.user_role,iid);
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(p_tenant_id,a,'platform_admin','invites',iid,'platform_invite_created',jsonb_build_object('role',p_role,'status','pending'));
 RETURN jsonb_build_object('id',iid,'replayed',false,'send_current_token',true);
END;$$;
REVOKE ALL ON FUNCTION public.mutate_platform_user(text,uuid,bigint,jsonb),public.reserve_platform_user(uuid,uuid,text,text,text),public.finalize_platform_user(uuid),public.issue_platform_user_invite(uuid,uuid,text,text,text,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mutate_platform_user(text,uuid,bigint,jsonb),public.reserve_platform_user(uuid,uuid,text,text,text),public.finalize_platform_user(uuid),public.issue_platform_user_invite(uuid,uuid,text,text,text,uuid,text,timestamptz) TO authenticated;
COMMIT;
