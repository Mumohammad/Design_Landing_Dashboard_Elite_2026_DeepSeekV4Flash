BEGIN;
CREATE SCHEMA IF NOT EXISTS management_private;
REVOKE ALL ON SCHEMA management_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA management_private TO authenticated;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
-- Durable Auth identity: nullable for historical accepted invitations; pending tokens bind lazily.
ALTER TABLE public.invites ADD COLUMN IF NOT EXISTS provisioning_auth_user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS invites_provisioning_auth_user_id_key ON public.invites(provisioning_auth_user_id) WHERE provisioning_auth_user_id IS NOT NULL;
CREATE OR REPLACE FUNCTION management_private.bump_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.version:=OLD.version+1;NEW.updated_at:=clock_timestamp();RETURN NEW;END;$$;
REVOKE ALL ON FUNCTION management_private.bump_version() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zz_management_version ON public.users;
CREATE TRIGGER zz_management_version BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION management_private.bump_version();
DROP TRIGGER IF EXISTS zz_management_version ON public.roles;
CREATE TRIGGER zz_management_version BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION management_private.bump_version();

CREATE OR REPLACE FUNCTION management_private.user_mutation(p_action text,p_user_id uuid,p_expected_version bigint,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();a uuid:=auth.uid();actor public.users%ROWTYPE;u public.users%ROWTYPE; n public.users%ROWTYPE;old_row jsonb;new_row jsonb;stamp timestamptz:=clock_timestamp();rid uuid;reason text:=btrim(coalesce(p_input->>'reason',''));
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('users',CASE WHEN p_action='archive' THEN 'delete' ELSE 'update' END) IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: user management permission required';END IF;
 IF p_action IS NULL OR p_action NOT IN ('profile','status','role','archive','employee_code') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'USR001: invalid user operation';END IF;
 -- Serializes concurrent owner changes, role archival and employee-code edits.
 PERFORM 1 FROM public.tenants WHERE id=t AND deleted_at IS NULL FOR UPDATE;
 SELECT * INTO actor FROM public.users WHERE auth_user_id=a AND tenant_id=t AND status='active' AND deleted_at IS NULL;
 SELECT * INTO u FROM public.users WHERE id=p_user_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'USR002: user not found in this organization';END IF;
 IF p_expected_version IS NULL OR u.version<>p_expected_version THEN RAISE EXCEPTION 'USR003: record changed; reload before saving';END IF;
 IF p_action IN ('role','archive') AND actor.role IS DISTINCT FROM 'general_manager' THEN RAISE EXCEPTION 'USR004: only the general manager can change roles or archive users';END IF;
 IF u.auth_user_id=a AND p_action IN ('status','role','archive') THEN RAISE EXCEPTION 'USR005: you cannot change your own role, account status or archive your account';END IF;
 IF u.role='general_manager' AND actor.role IS DISTINCT FROM 'general_manager' THEN RAISE EXCEPTION 'USR006: only a general manager can manage another general manager';END IF;
 old_row:=jsonb_build_object('id',u.id,'full_name_ar',u.full_name_ar,'full_name_en',u.full_name_en,'preferred_name',u.preferred_name,'employee_code',u.employee_code,'role',u.role,'status',u.status,'version',u.version);
 IF p_action='profile' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('full_name_ar','full_name_en','preferred_name','phone','employee_code')) OR p_input='{}'::jsonb THEN RAISE EXCEPTION 'USR001: invalid profile fields';END IF;
  n:=jsonb_populate_record(u,p_input);
  n.full_name_ar:=nullif(btrim(n.full_name_ar),'');n.full_name_en:=nullif(btrim(n.full_name_en),'');n.preferred_name:=nullif(btrim(n.preferred_name),'');n.employee_code:=nullif(upper(btrim(n.employee_code)),'');n.phone:=nullif(btrim(n.phone),'');
  IF n.full_name_ar IS NULL AND n.full_name_en IS NULL OR length(coalesce(n.full_name_ar,''))>150 OR length(coalesce(n.full_name_en,''))>150 OR length(coalesce(n.preferred_name,''))>100 OR n.phone !~ '^\+?[0-9 ()-]{7,25}$' OR n.employee_code !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' THEN RAISE EXCEPTION 'USR007: enter valid profile details';END IF;
  IF n.employee_code IS NOT NULL AND n.employee_code IS DISTINCT FROM u.employee_code AND EXISTS(SELECT 1 FROM public.users WHERE tenant_id=t AND id<>u.id AND deleted_at IS NULL AND upper(employee_code)=n.employee_code) THEN RAISE EXCEPTION 'USR008: employee code is already assigned';END IF;
  UPDATE public.users SET full_name_ar=n.full_name_ar,full_name_en=n.full_name_en,preferred_name=n.preferred_name,phone=n.phone,employee_code=n.employee_code,updated_by=a WHERE id=u.id AND tenant_id=t;
 ELSIF p_action='employee_code' THEN
  IF p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'USR001: invalid employee code fields';END IF;
  IF nullif(btrim(u.employee_code),'') IS NOT NULL THEN RAISE EXCEPTION 'USR009: employee code is already assigned';END IF;
  UPDATE public.users SET employee_code=public.next_employee_code(t),updated_by=a WHERE id=u.id AND tenant_id=t;
 ELSIF p_action='status' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('status','reason')) OR length(reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'USR010: a reason is required';END IF;
  n.status:=(p_input->>'status')::public.user_status;
  IF n.status IS NULL OR u.status=n.status OR u.status='terminated' OR (u.status='active' AND n.status NOT IN ('inactive','locked','terminated')) OR (u.status='inactive' AND n.status NOT IN ('active','terminated')) OR (u.status='locked' AND n.status NOT IN ('active','inactive','terminated')) OR (u.status='pending_invite' AND n.status NOT IN ('active','inactive','terminated')) THEN RAISE EXCEPTION 'USR011: invalid account status transition';END IF;
  IF n.status='active' AND (u.locked_until>stamp OR (u.status='pending_invite' AND (u.accepted_invite_at IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=u.auth_user_id AND email_confirmed_at IS NOT NULL)))) THEN RAISE EXCEPTION 'USR012: resolve the active lock or complete invitation acceptance first';END IF;
  IF u.role='general_manager' AND n.status<>'active' AND NOT EXISTS(SELECT 1 FROM public.users WHERE tenant_id=t AND id<>u.id AND role='general_manager' AND status='active' AND deleted_at IS NULL AND (locked_until IS NULL OR locked_until<=stamp)) THEN RAISE EXCEPTION 'USR013: the last active general manager must remain available';END IF;
  UPDATE public.users SET status=n.status,updated_by=a WHERE id=u.id AND tenant_id=t;
 ELSIF p_action='role' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('role','reason')) OR length(reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'USR010: a reason is required';END IF;
  n.role:=(p_input->>'role')::public.user_role;
  IF n.role IS NULL OR n.role='general_manager' OR n.role=u.role THEN RAISE EXCEPTION 'USR014: select a different supported non-owner role';END IF;
  IF u.role='general_manager' AND NOT EXISTS(SELECT 1 FROM public.users WHERE tenant_id=t AND id<>u.id AND role='general_manager' AND status='active' AND deleted_at IS NULL AND (locked_until IS NULL OR locked_until<=stamp)) THEN RAISE EXCEPTION 'USR013: the last active general manager must remain available';END IF;
  SELECT id INTO rid FROM public.roles WHERE tenant_id=t AND name=n.role AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USR015: configure an active tenant role before assigning it';END IF;
  UPDATE public.user_role_assignments SET revoked_at=stamp,updated_by=a WHERE tenant_id=t AND user_id=u.id AND revoked_at IS NULL AND deleted_at IS NULL;
  UPDATE public.users SET role=n.role,updated_by=a WHERE id=u.id AND tenant_id=t;
  INSERT INTO public.user_role_assignments(tenant_id,user_id,role_id,assigned_by,created_by) VALUES(t,u.id,rid,a,a);
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k<>'reason') OR length(reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'USR010: a reason is required';END IF;
  IF u.status NOT IN ('inactive','terminated') THEN RAISE EXCEPTION 'USR016: deactivate the account before archiving it';END IF;
  IF u.role='general_manager' AND NOT EXISTS(SELECT 1 FROM public.users WHERE tenant_id=t AND id<>u.id AND role='general_manager' AND status='active' AND deleted_at IS NULL AND (locked_until IS NULL OR locked_until<=stamp)) THEN RAISE EXCEPTION 'USR013: the last active general manager must remain available';END IF;
  UPDATE public.users SET deleted_at=stamp,updated_by=a WHERE id=u.id AND tenant_id=t;
  UPDATE public.user_role_assignments SET revoked_at=stamp,updated_by=a WHERE tenant_id=t AND user_id=u.id AND revoked_at IS NULL AND deleted_at IS NULL;
  UPDATE public.tenant_memberships SET deleted_at=stamp,updated_by=a WHERE tenant_id=t AND user_id=u.id AND deleted_at IS NULL;
 END IF;
 SELECT jsonb_build_object('id',x.id,'full_name_ar',x.full_name_ar,'full_name_en',x.full_name_en,'preferred_name',x.preferred_name,'employee_code',x.employee_code,'role',x.role,'status',x.status,'version',x.version,'archived',x.deleted_at IS NOT NULL) INTO new_row FROM public.users x WHERE id=u.id AND tenant_id=t;
 -- Phone values are deliberately absent from audit payloads.
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'users','users',u.id,'user_'||p_action,old_row,new_row||jsonb_build_object('reason',nullif(reason,''),'phone_changed',p_action='profile' AND p_input ? 'phone'));
 RETURN jsonb_build_object('id',u.id,'version',new_row->'version');
END;$$;

CREATE OR REPLACE FUNCTION management_private.role_mutation(p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();a uuid:=auth.uid();actor public.users%ROWTYPE;r public.roles%ROWTYPE;n public.roles%ROWTYPE;rid uuid:=coalesce(p_id,gen_random_uuid());old_row jsonb;new_row jsonb;grants uuid[];reason text:=btrim(coalesce(p_input->>'reason',''));stamp timestamptz:=clock_timestamp();
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('roles','read') IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: role management permission required';END IF;
 PERFORM 1 FROM public.tenants WHERE id=t AND deleted_at IS NULL FOR UPDATE;
 SELECT * INTO actor FROM public.users WHERE auth_user_id=a AND tenant_id=t AND deleted_at IS NULL AND status='active';
 IF actor.role IS DISTINCT FROM 'general_manager' THEN RAISE EXCEPTION 'USR017: only the general manager can configure role permissions';END IF;
 IF p_action IS NULL OR p_action NOT IN ('save','archive','restore') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('name','name_ar','name_en','description','permission_ids','reason')) THEN RAISE EXCEPTION 'USR018: invalid role operation';END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO r FROM public.roles WHERE id=p_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USR019: role not found in this organization';END IF;
  IF p_expected_version IS NULL OR r.version<>p_expected_version THEN RAISE EXCEPTION 'USR003: record changed; reload before saving';END IF;
  IF r.name='general_manager' THEN RAISE EXCEPTION 'USR020: the general manager system role and its access are immutable';END IF;
  old_row:=to_jsonb(r)||jsonb_build_object('permission_ids',coalesce((SELECT jsonb_agg(permission_id ORDER BY permission_id) FROM public.role_permissions WHERE role_id=r.id),'[]'::jsonb));
 END IF;
 IF p_action='save' THEN
  IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'USR021: restore the archived role before editing';END IF;
  n:=jsonb_populate_record(NULL::public.roles,coalesce(old_row,jsonb_build_object('id',rid,'tenant_id',t,'created_at',stamp,'updated_at',stamp,'created_by',a,'is_system_role',false,'version',1))||(p_input-'permission_ids'-'reason'));
  IF n.name IS NULL OR n.name='general_manager' OR (p_id IS NOT NULL AND n.name IS DISTINCT FROM r.name) OR length(btrim(coalesce(n.name_ar,''))) NOT BETWEEN 1 AND 100 OR length(btrim(coalesce(n.name_en,''))) NOT BETWEEN 1 AND 100 OR length(coalesce(n.description,''))>1000 THEN RAISE EXCEPTION 'USR022: select a supported non-owner preset and enter both role labels';END IF;
  IF p_id IS NULL AND EXISTS(SELECT 1 FROM public.roles WHERE tenant_id=t AND name=n.name) THEN RAISE EXCEPTION 'USR023: this preset already exists; edit or restore its existing record';END IF;
  IF jsonb_typeof(p_input->'permission_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'permission_ids')>500 THEN RAISE EXCEPTION 'USR024: choose permissions from the existing catalog';END IF;
  SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO grants FROM jsonb_array_elements_text(p_input->'permission_ids');
  IF EXISTS(SELECT 1 FROM unnest(grants) p WHERE NOT EXISTS(SELECT 1 FROM public.permissions WHERE id=p)) THEN RAISE EXCEPTION 'USR024: choose permissions from the existing catalog';END IF;
  IF p_id IS NULL THEN INSERT INTO public.roles SELECT n.*;
  ELSE UPDATE public.roles SET name_ar=btrim(n.name_ar),name_en=btrim(n.name_en),description=nullif(btrim(n.description),''),updated_by=a WHERE id=rid AND tenant_id=t;END IF;
  -- Effective authorization continues to resolve the fixed users.role preset.
  DELETE FROM public.role_permissions WHERE role_id=rid;
  INSERT INTO public.role_permissions(role_id,permission_id,created_by) SELECT rid,p,a FROM unnest(grants) p;
 ELSIF p_action='archive' THEN
  IF p_id IS NULL OR r.deleted_at IS NOT NULL OR r.is_system_role THEN RAISE EXCEPTION 'USR025: system or already archived roles cannot be archived';END IF;
  IF length(reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'USR010: a reason is required';END IF;
  IF EXISTS(SELECT 1 FROM public.users WHERE tenant_id=t AND role=r.name AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.user_role_assignments WHERE tenant_id=t AND role_id=r.id AND deleted_at IS NULL AND revoked_at IS NULL) THEN RAISE EXCEPTION 'USR026: reassign all users before archiving this role';END IF;
  UPDATE public.roles SET deleted_at=stamp,updated_by=a WHERE id=rid AND tenant_id=t;
 ELSE
  IF p_id IS NULL OR r.deleted_at IS NULL OR r.is_system_role THEN RAISE EXCEPTION 'USR027: select an archived non-system preset to restore';END IF;
  IF EXISTS(SELECT 1 FROM public.roles WHERE tenant_id=t AND name=r.name AND deleted_at IS NULL AND id<>r.id) THEN RAISE EXCEPTION 'USR023: this preset already exists; edit or restore its existing record';END IF;
  UPDATE public.roles SET deleted_at=NULL,updated_by=a WHERE id=rid AND tenant_id=t;
 END IF;
 SELECT to_jsonb(x)||jsonb_build_object('permission_ids',coalesce((SELECT jsonb_agg(permission_id ORDER BY permission_id) FROM public.role_permissions WHERE role_id=rid),'[]'::jsonb)) INTO new_row FROM public.roles x WHERE id=rid AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'roles','roles',rid,'role_'||p_action,old_row,new_row||jsonb_build_object('reason',nullif(reason,'')));
 RETURN jsonb_build_object('id',rid,'version',new_row->'version');
END;$$;

CREATE OR REPLACE FUNCTION management_private.user_list(p_surface text,p_search text DEFAULT '',p_status text DEFAULT 'all',p_role text DEFAULT 'all',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();rows jsonb;total bigint;kpis jsonb;is_owner boolean;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR public.user_has_permission('users','read') IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: user read permission required';END IF;
 IF p_surface IS NULL OR p_surface NOT IN ('users','security') OR p_page IS NULL OR p_page<1 OR p_page>1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR length(coalesce(p_search,''))>200 THEN RAISE EXCEPTION 'USR028: invalid roster filters';END IF;
 SELECT role='general_manager' INTO is_owner FROM public.users WHERE auth_user_id=auth.uid() AND tenant_id=t AND status='active' AND deleted_at IS NULL;
 SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE status='active'),'pendingInvite',count(*) FILTER(WHERE status='pending_invite'),'lockedOrTerminated',count(*) FILTER(WHERE status IN ('locked','terminated')),'twoFactorEnabled',count(*) FILTER(WHERE two_factor_enabled),'mustChange',count(*) FILTER(WHERE must_change_password),'failedAttempts',count(*) FILTER(WHERE failed_login_attempts>0),'locked',count(*) FILTER(WHERE status='locked' OR locked_until>now()),'saudiSharePct',NULL) INTO kpis FROM public.users WHERE tenant_id=t AND deleted_at IS NULL;
 SELECT count(*) INTO total FROM public.users WHERE tenant_id=t AND deleted_at IS NULL AND (coalesce(p_status,'all')='all' OR status::text=p_status) AND (coalesce(p_role,'all')='all' OR role::text=p_role) AND (coalesce(p_search,'')='' OR strpos(lower(concat_ws(' ',full_name_ar,full_name_en,email,employee_code)),lower(p_search))>0);
 SELECT coalesce(jsonb_agg(row_data ORDER BY sort_created DESC,sort_id),'[]') INTO rows FROM (
  SELECT u.created_at sort_created,u.id sort_id,jsonb_build_object('id',u.id,'version',u.version,'employee_code',u.employee_code,'full_name_ar',u.full_name_ar,'full_name_en',u.full_name_en,'email',u.email,'phone',NULL,'role',u.role,'status',u.status,'two_factor_enabled',u.two_factor_enabled,'must_change_password',u.must_change_password,'invited_at',u.invited_at,'last_login_at',u.last_login_at,'created_at',u.created_at)||CASE WHEN p_surface='security' THEN jsonb_build_object('failed_login_attempts',u.failed_login_attempts) ELSE '{}'::jsonb END row_data
  FROM public.users u WHERE u.tenant_id=t AND u.deleted_at IS NULL AND (coalesce(p_status,'all')='all' OR u.status::text=p_status) AND (coalesce(p_role,'all')='all' OR u.role::text=p_role) AND (coalesce(p_search,'')='' OR strpos(lower(concat_ws(' ',u.full_name_ar,u.full_name_en,u.email,u.employee_code)),lower(p_search))>0) ORDER BY u.created_at DESC,u.id OFFSET (p_page-1)*p_page_size LIMIT p_page_size
 ) q;
 RETURN jsonb_build_object('users',rows,'total',total,'page',p_page,'pageSize',p_page_size,'kpis',kpis,'isOwner',coalesce(is_owner,false));
END;$$;
CREATE OR REPLACE FUNCTION management_private.role_list() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();rows jsonb;catalog jsonb;owner boolean;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR public.user_has_permission('roles','read') IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: role read permission required';END IF;
 SELECT role='general_manager' INTO owner FROM public.users WHERE auth_user_id=auth.uid() AND tenant_id=t AND status='active' AND deleted_at IS NULL;
 SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('permission_ids',coalesce((SELECT jsonb_agg(permission_id ORDER BY permission_id) FROM public.role_permissions WHERE role_id=r.id),'[]'::jsonb),'user_count',(SELECT count(*) FROM public.users WHERE tenant_id=t AND role=r.name AND deleted_at IS NULL)) ORDER BY r.name,r.deleted_at),'[]'::jsonb) INTO rows FROM public.roles r WHERE r.tenant_id=t;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'module',module,'action',action,'description',description) ORDER BY module,action),'[]'::jsonb) INTO catalog FROM public.permissions;
 RETURN jsonb_build_object('roles',rows,'permissions',catalog,'isOwner',coalesce(owner,false));
END;$$;
CREATE OR REPLACE FUNCTION public.mutate_managed_user(p_action text,p_user_id uuid,p_expected_version bigint,p_input jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT management_private.user_mutation(p_action,p_user_id,p_expected_version,p_input);$$;
CREATE OR REPLACE FUNCTION public.mutate_managed_role(p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT management_private.role_mutation(p_action,p_input,p_id,p_expected_version);$$;
CREATE OR REPLACE FUNCTION public.list_managed_users(p_surface text,p_search text DEFAULT '',p_status text DEFAULT 'all',p_role text DEFAULT 'all',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT management_private.user_list(p_surface,p_search,p_status,p_role,p_page,p_page_size);$$;
CREATE OR REPLACE FUNCTION public.list_managed_roles() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT management_private.role_list();$$;
REVOKE ALL ON FUNCTION management_private.user_mutation(text,uuid,bigint,jsonb),management_private.role_mutation(text,jsonb,uuid,bigint),management_private.user_list(text,text,text,text,integer,integer),management_private.role_list(),public.mutate_managed_user(text,uuid,bigint,jsonb),public.mutate_managed_role(text,jsonb,uuid,bigint),public.list_managed_users(text,text,text,text,integer,integer),public.list_managed_roles() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION management_private.user_mutation(text,uuid,bigint,jsonb),management_private.role_mutation(text,jsonb,uuid,bigint),management_private.user_list(text,text,text,text,integer,integer),management_private.role_list(),public.mutate_managed_user(text,uuid,bigint,jsonb),public.mutate_managed_role(text,jsonb,uuid,bigint),public.list_managed_users(text,text,text,text,integer,integer),public.list_managed_roles() TO authenticated;

CREATE OR REPLACE FUNCTION management_private.issue_invite(p_email text,p_role text,p_token_id uuid,p_token_hash text,p_expires_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();a uuid:=auth.uid();iid uuid;mail text:=lower(btrim(p_email));
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('users','manage') IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.users WHERE auth_user_id=a AND tenant_id=t AND role='general_manager' AND status='active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'USR029: only the general manager can issue team invitations';END IF;
 IF p_role IS NULL OR p_role='general_manager' OR NOT EXISTS(SELECT 1 FROM public.roles WHERE tenant_id=t AND name::text=p_role AND deleted_at IS NULL) THEN RAISE EXCEPTION 'USR030: select an active supported non-owner tenant role';END IF;
 IF length(mail) NOT BETWEEN 3 AND 254 OR mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR p_token_id IS NULL OR p_token_hash !~ '^[$]2[aby][$][0-9]{2}[$][./A-Za-z0-9]{53}$' OR p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR p_expires_at>clock_timestamp()+interval '8 days' THEN RAISE EXCEPTION 'USR031: invalid invitation details';END IF;
 PERFORM 1 FROM public.tenants WHERE id=t AND deleted_at IS NULL FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.invites WHERE tenant_id=t AND lower(email)=mail AND status='pending' AND deleted_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'USR032: an invitation is already pending for this email';END IF;
 INSERT INTO public.invites(tenant_id,email,role,token_id,token_hash,status,expires_at,invited_by,created_by) VALUES(t,mail,p_role::public.user_role,p_token_id,p_token_hash,'pending',p_expires_at,a,a) RETURNING id INTO iid;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,a,'users','invites',iid,'invite_created',jsonb_build_object('email',mail,'role',p_role));
 RETURN jsonb_build_object('id',iid);
END;$$;
CREATE OR REPLACE FUNCTION public.issue_managed_invite(p_email text,p_role text,p_token_id uuid,p_token_hash text,p_expires_at timestamptz) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT management_private.issue_invite(p_email,p_role,p_token_id,p_token_hash,p_expires_at);$$;
REVOKE ALL ON FUNCTION management_private.issue_invite(text,text,uuid,text,timestamptz),public.issue_managed_invite(text,text,uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION management_private.issue_invite(text,text,uuid,text,timestamptz),public.issue_managed_invite(text,text,uuid,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION management_private.reserve_invite_identity(p_invite_id uuid,p_candidate_auth_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $reserve$
DECLARE i public.invites%ROWTYPE;stamp timestamptz;
BEGIN
 IF coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'AUTH007: trusted invitation provisioning required';END IF;
 SELECT * INTO i FROM public.invites WHERE id=p_invite_id AND deleted_at IS NULL FOR UPDATE;
 stamp:=clock_timestamp();
 IF NOT FOUND OR i.role='general_manager' OR p_candidate_auth_user_id IS NULL THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 -- A concurrent token-verified request can arrive just after acceptance. It may
 -- recover the existing binding, but cannot invent one for a consumed token.
 IF i.status='accepted' AND i.provisioning_auth_user_id IS NOT NULL AND i.accepted_by=i.provisioning_auth_user_id THEN RETURN jsonb_build_object('auth_user_id',i.provisioning_auth_user_id);END IF;
 IF i.status<>'pending' OR i.expires_at<=stamp THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 PERFORM 1 FROM public.tenants WHERE id=i.tenant_id AND status='active' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 PERFORM 1 FROM public.roles WHERE tenant_id=i.tenant_id AND name=i.role AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 IF i.provisioning_auth_user_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_candidate_auth_user_id) THEN RAISE EXCEPTION 'USR036: provisioning identity is already in use';END IF;
  UPDATE public.invites SET provisioning_auth_user_id=p_candidate_auth_user_id WHERE id=i.id;
  i.provisioning_auth_user_id:=p_candidate_auth_user_id;
 END IF;
 RETURN jsonb_build_object('auth_user_id',i.provisioning_auth_user_id);
END;$reserve$;
CREATE OR REPLACE FUNCTION public.reserve_managed_invite_identity(p_invite_id uuid,p_candidate_auth_user_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $reserve$SELECT management_private.reserve_invite_identity(p_invite_id,p_candidate_auth_user_id);$reserve$;
REVOKE ALL ON FUNCTION management_private.reserve_invite_identity(uuid,uuid),public.reserve_managed_invite_identity(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA management_private TO service_role;
GRANT EXECUTE ON FUNCTION management_private.reserve_invite_identity(uuid,uuid),public.reserve_managed_invite_identity(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION management_private.accept_invite(p_invite_id uuid,p_auth_user_id uuid,p_full_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.invites%ROWTYPE;rid uuid;uid uuid;mail text;stamp timestamptz:=clock_timestamp();
BEGIN
 IF coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'AUTH007: trusted invitation provisioning required';END IF;
 IF length(btrim(coalesce(p_full_name,''))) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'USR033: enter a valid team member name';END IF;
 SELECT * INTO i FROM public.invites WHERE id=p_invite_id AND deleted_at IS NULL FOR UPDATE;
 stamp:=clock_timestamp();
 IF NOT FOUND OR i.role='general_manager' THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 -- A transport retry of this exact trusted provisioning call is idempotent.
 -- The public token flow still rejects consumed invitations before Auth creation.
 IF i.status='accepted' AND i.accepted_by=p_auth_user_id THEN
  SELECT u.id INTO uid FROM public.users u JOIN auth.users au ON au.id=u.auth_user_id
   WHERE u.auth_user_id=p_auth_user_id AND u.tenant_id=i.tenant_id AND u.deleted_at IS NULL
   AND lower(btrim(au.email))=lower(btrim(i.email)) AND au.email_confirmed_at IS NOT NULL
   AND (i.provisioning_auth_user_id IS NULL OR (i.provisioning_auth_user_id=p_auth_user_id AND au.raw_app_meta_data @> jsonb_build_object('_invite_provisioned',true,'_invite_id',i.id::text,'_invite_tenant_id',i.tenant_id::text)));
  IF FOUND THEN RETURN jsonb_build_object('id',uid);END IF;
 END IF;
 IF i.status<>'pending' OR i.expires_at<=stamp OR i.provisioning_auth_user_id IS DISTINCT FROM p_auth_user_id THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 PERFORM 1 FROM public.tenants WHERE id=i.tenant_id AND status='active' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 SELECT id INTO rid FROM public.roles WHERE tenant_id=i.tenant_id AND name=i.role AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 SELECT lower(btrim(email)) INTO mail FROM auth.users WHERE id=p_auth_user_id AND email_confirmed_at IS NOT NULL AND raw_app_meta_data @> jsonb_build_object('_invite_provisioned',true,'_invite_id',i.id::text,'_invite_tenant_id',i.tenant_id::text);
 IF mail IS NULL OR mail<>lower(btrim(i.email)) OR EXISTS(SELECT 1 FROM public.users WHERE auth_user_id=p_auth_user_id) THEN RAISE EXCEPTION 'USR034: invalid or expired invitation';END IF;
 INSERT INTO public.users(auth_user_id,tenant_id,email,role,full_name_ar,full_name_en,status,must_change_password,accepted_invite_at,created_by) VALUES(p_auth_user_id,i.tenant_id,lower(i.email),i.role,btrim(p_full_name),btrim(p_full_name),'active',false,stamp,p_auth_user_id) RETURNING id INTO uid;
 INSERT INTO public.tenant_memberships(tenant_id,user_id,created_by) VALUES(i.tenant_id,uid,p_auth_user_id);
 INSERT INTO public.user_role_assignments(tenant_id,user_id,role_id,assigned_by,created_by) VALUES(i.tenant_id,uid,rid,i.invited_by,p_auth_user_id);
 UPDATE public.invites SET status='accepted',accepted_at=stamp,accepted_by=p_auth_user_id,updated_by=p_auth_user_id WHERE id=i.id AND status='pending';
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(i.tenant_id,p_auth_user_id,'users','invites',i.id,'invite_accepted',jsonb_build_object('user_id',uid,'role',i.role));
 RETURN jsonb_build_object('id',uid);
END;$$;
CREATE OR REPLACE FUNCTION public.accept_managed_invite(p_invite_id uuid,p_auth_user_id uuid,p_full_name text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT management_private.accept_invite(p_invite_id,p_auth_user_id,p_full_name);$$;
REVOKE ALL ON FUNCTION management_private.accept_invite(uuid,uuid,text),public.accept_managed_invite(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA management_private TO service_role;
GRANT EXECUTE ON FUNCTION management_private.accept_invite(uuid,uuid,text),public.accept_managed_invite(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION management_private.revoke_invite(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();a uuid:=auth.uid();i public.invites%ROWTYPE;
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('users','manage') IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.users WHERE auth_user_id=a AND tenant_id=t AND role='general_manager' AND status='active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'USR029: only the general manager can issue team invitations';END IF;
 SELECT * INTO i FROM public.invites WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR i.status<>'pending' THEN RAISE EXCEPTION 'USR035: invitation is no longer pending';END IF;
 -- Match acceptance's lock order: invitation, then tenant.
 PERFORM 1 FROM public.tenants WHERE id=t AND deleted_at IS NULL FOR UPDATE;
 UPDATE public.invites SET status='revoked',updated_by=a WHERE id=i.id AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action) VALUES(t,a,'users','invites',i.id,'invite_revoked');
 RETURN jsonb_build_object('id',i.id);
END;$$;
CREATE OR REPLACE FUNCTION public.revoke_managed_invite(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT management_private.revoke_invite(p_id);$$;
REVOKE ALL ON FUNCTION management_private.revoke_invite(uuid),public.revoke_managed_invite(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION management_private.revoke_invite(uuid),public.revoke_managed_invite(uuid) TO authenticated;

REVOKE INSERT,UPDATE,DELETE ON public.users,public.roles,public.role_permissions,public.user_role_assignments FROM PUBLIC,anon,authenticated;
DO $management_acl$ DECLARE tab text;col record;BEGIN
 FOREACH tab IN ARRAY ARRAY['users','roles','role_permissions','user_role_assignments'] LOOP
  FOR col IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.'||tab) AND attnum>0 AND NOT attisdropped LOOP
   EXECUTE format('REVOKE INSERT(%I),UPDATE(%I) ON public.%I FROM PUBLIC,anon,authenticated',col.attname,col.attname,tab);
  END LOOP;
 END LOOP;
END $management_acl$;
COMMIT;

