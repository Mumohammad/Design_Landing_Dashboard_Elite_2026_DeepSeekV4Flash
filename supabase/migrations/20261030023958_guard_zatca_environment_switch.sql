-- Guard the tenant preference without opening the production gateway.
-- This CLI timestamp precedes the upstream 20261030090000 migration on a fresh
-- ordered replay. Create its compatible table now so guards survive the later
-- CREATE TABLE IF NOT EXISTS and service-role grants. Existing values stay intact.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.zatca_tenant_environment (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
 production_enabled boolean NOT NULL DEFAULT false,
 changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 changed_at timestamptz NOT NULL DEFAULT now(),
 acknowledgement text CHECK(acknowledgement IS NULL OR length(acknowledgement)<=500)
);
CREATE INDEX IF NOT EXISTS zatca_tenant_environment_changed_by ON public.zatca_tenant_environment(changed_by);
ALTER TABLE public.zatca_tenant_environment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_tenant_environment FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.zatca_tenant_environment TO service_role;
CREATE SCHEMA IF NOT EXISTS zatca_switch_private;
REVOKE ALL ON SCHEMA zatca_switch_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE zatca_switch_private.receipts(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),actor_id uuid NOT NULL,request_id uuid NOT NULL,
 expected_version bigint NOT NULL,enabled boolean NOT NULL,acknowledgement text,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,request_id)
);
ALTER TABLE zatca_switch_private.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON zatca_switch_private.receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION zatca_switch_private.immutable_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'ZATCA_SWITCH_RECEIPT_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION zatca_switch_private.immutable_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zatca_switch_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON zatca_switch_private.receipts
 FOR EACH STATEMENT EXECUTE FUNCTION zatca_switch_private.immutable_receipt();
CREATE FUNCTION public.guard_zatca_environment_service_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 IF current_user='service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ZATCA_SWITCH_CALLER_REQUIRED'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.guard_zatca_environment_service_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zatca_environment_caller_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.zatca_tenant_environment
 FOR EACH STATEMENT EXECUTE FUNCTION public.guard_zatca_environment_service_write();

CREATE FUNCTION public.read_my_zatca_environment() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();version bigint;enabled boolean;changed timestamptz;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('accounting','read') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ZATCA_SWITCH_FORBIDDEN'; END IF;
 SELECT configuration_version INTO version FROM public.tenants WHERE id=t AND deleted_at IS NULL AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'ZATCA_SWITCH_UNAVAILABLE'; END IF;
 SELECT production_enabled,changed_at INTO enabled,changed FROM public.zatca_tenant_environment WHERE tenant_id=t;
 RETURN jsonb_build_object('production_enabled',coalesce(enabled,false),'changed_at',changed,
  'configuration_version',version,'can_manage',public.user_has_permission('accounting','approve'));
END $$;
REVOKE ALL ON FUNCTION public.read_my_zatca_environment() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_zatca_environment() TO authenticated;

CREATE FUNCTION public.save_my_zatca_environment(p_request_id uuid,p_expected_version bigint,p_enabled boolean,p_acknowledgement text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();company record;receipt zatca_switch_private.receipts%ROWTYPE;
 previous_enabled boolean;result jsonb;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('accounting','approve') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ZATCA_SWITCH_FORBIDDEN'; END IF;
 IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_expected_version>9007199254740990 OR p_enabled IS NULL
  OR (p_acknowledgement IS NOT NULL AND length(p_acknowledgement)>500) THEN RAISE EXCEPTION 'ZATCA_SWITCH_INVALID'; END IF;
 SELECT configuration_version,status INTO company FROM public.tenants WHERE id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ZATCA_SWITCH_UNAVAILABLE'; END IF;
 IF company.status<>'active' OR public.get_my_tenant_id() IS DISTINCT FROM t OR NOT public.user_has_permission('accounting','approve') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ZATCA_SWITCH_FORBIDDEN'; END IF;
 SELECT * INTO receipt FROM zatca_switch_private.receipts WHERE tenant_id=t AND actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.expected_version IS DISTINCT FROM p_expected_version OR receipt.enabled IS DISTINCT FROM p_enabled
   OR receipt.acknowledgement IS DISTINCT FROM p_acknowledgement THEN RAISE EXCEPTION 'ZATCA_SWITCH_INVALID'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 -- No database toggle or deployment flag substitutes for independent acceptance.
 IF p_enabled THEN RAISE EXCEPTION 'ZATCA_PRODUCTION_BLOCKED'; END IF;
 IF p_acknowledgement IS NOT NULL THEN RAISE EXCEPTION 'ZATCA_SWITCH_INVALID'; END IF;
 IF p_expected_version<>company.configuration_version THEN RAISE EXCEPTION 'ZATCA_SWITCH_STALE'; END IF;
 SELECT production_enabled INTO previous_enabled FROM public.zatca_tenant_environment WHERE tenant_id=t;
 INSERT INTO public.zatca_tenant_environment(tenant_id,production_enabled,changed_by,changed_at,acknowledgement)
 VALUES(t,false,actor,now(),NULL)
 ON CONFLICT(tenant_id) DO UPDATE SET production_enabled=false,changed_by=actor,changed_at=now(),acknowledgement=NULL;
 UPDATE public.tenants SET configuration_version=configuration_version+1 WHERE id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
 VALUES(t,actor,'accounting','zatca_tenant_environment',t,'zatca_production_disabled',
  jsonb_build_object('production_enabled',coalesce(previous_enabled,false)),jsonb_build_object('production_enabled',false));
 result:=jsonb_build_object('request_id',p_request_id,'production_enabled',false,
  'configuration_version',(SELECT configuration_version FROM public.tenants WHERE id=t),'replayed',false);
 INSERT INTO zatca_switch_private.receipts(tenant_id,actor_id,request_id,expected_version,enabled,acknowledgement,result)
 VALUES(t,actor,p_request_id,p_expected_version,false,NULL,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_my_zatca_environment(uuid,bigint,boolean,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_my_zatca_environment(uuid,bigint,boolean,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
