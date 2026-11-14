-- Forward-only branding reconciliation. Historical URLs and National Address stay intact.
BEGIN;
ALTER TABLE public.tenants ADD COLUMN logo_storage_path text;
REVOKE UPDATE(logo_storage_path) ON public.tenants FROM PUBLIC,anon,authenticated;
CREATE SCHEMA IF NOT EXISTS tenant_branding_private;
REVOKE ALL ON SCHEMA tenant_branding_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE tenant_branding_private.logo_receipts(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), actor_id uuid NOT NULL,
 request_id uuid NOT NULL, expected_version bigint NOT NULL, object_path text,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,actor_id,request_id)
);
ALTER TABLE tenant_branding_private.logo_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_branding_private.logo_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION tenant_branding_private.reject_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'SETTINGS_RECEIPT_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION tenant_branding_private.reject_receipt_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER logo_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON tenant_branding_private.logo_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION tenant_branding_private.reject_receipt_mutation();

CREATE OR REPLACE FUNCTION public.read_my_settings_bundle(p_surface text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); company jsonb; rows jsonb; manager boolean;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('settings','read') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SETTINGS_FORBIDDEN'; END IF;
 IF p_surface IS NULL OR p_surface NOT IN ('company','payroll') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
 manager:=public.user_has_permission('settings','manage');
 SELECT jsonb_build_object('id',id,'name_ar',name_ar,'name_en',name_en,'legal_name',legal_name,
  'cr_number',cr_number,'vat_number',vat_number,'address',address,'city',city,'region',region,'building_number',building_number,'additional_number',additional_number,'district',district,'postal_code',postal_code,'country',country,
  'phone',phone,'email',email,'logo_url',logo_url,'logo_storage_path',logo_storage_path,'timezone',timezone,'default_locale',default_locale,
  'configuration_version',configuration_version,'can_manage',manager)
 INTO company FROM public.tenants WHERE id=t AND deleted_at IS NULL;
 IF company IS NULL THEN RAISE EXCEPTION 'SETTINGS_UNAVAILABLE'; END IF;
 IF p_surface='company' THEN
  RETURN company||jsonb_build_object(
   'mol_reference',CASE WHEN manager THEN coalesce((SELECT value FROM public.system_settings WHERE tenant_id=t AND key='company.mol_reference' AND deleted_at IS NULL),'') ELSE '' END,
   'wps_iban',CASE WHEN manager THEN coalesce((SELECT value FROM public.system_settings WHERE tenant_id=t AND key='company.wps_iban' AND deleted_at IS NULL),'') ELSE '' END);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',key,'key',key,'value',coalesce(value,''),'is_public',coalesce(is_public,false)) ORDER BY key),'[]'::jsonb)
 INTO rows FROM (SELECT k.key,s.value,s.is_public FROM unnest(ARRAY['payroll.default_working_days','payroll.saudi_minimum_wage','payroll.min_net_floor'])k(key)
  LEFT JOIN public.system_settings s ON s.tenant_id=t AND s.key=k.key AND s.deleted_at IS NULL AND (manager OR s.is_public)) settings;
 RETURN jsonb_build_object('configuration_version',company->'configuration_version','can_manage',manager,'rows',rows);
END $$;

CREATE OR REPLACE FUNCTION public.save_my_settings(p_surface text,p_payload jsonb,p_expected_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); company public.tenants%ROWTYPE; k text; v jsonb; val text;
 allowed text[]; limits jsonb; normalized jsonb:='{}'::jsonb; audit_values jsonb; iban text; digits text:=''; ch text; n numeric;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('settings','manage') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SETTINGS_FORBIDDEN'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_surface IS NULL OR p_surface NOT IN ('company','wps','payroll') THEN
  RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
 SELECT * INTO company FROM public.tenants WHERE id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_UNAVAILABLE'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<>company.configuration_version THEN RAISE EXCEPTION 'SETTINGS_STALE'; END IF;
 IF p_surface='company' THEN
  allowed:=ARRAY['name_ar','name_en','legal_name','cr_number','vat_number','address','city','region','building_number','additional_number','district','postal_code','country','phone','email','timezone','default_locale'];
  limits:='{"name_ar":200,"name_en":200,"legal_name":250,"cr_number":10,"vat_number":15,"address":1000,"city":100,"region":100,"building_number":4,"additional_number":4,"district":127,"postal_code":5,"country":100,"phone":32,"email":320,"timezone":100,"default_locale":2}'::jsonb;
  FOR k,v IN SELECT key,value FROM jsonb_each(p_payload) LOOP
   IF NOT k=ANY(allowed) OR jsonb_typeof(v) NOT IN ('string','null') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   val:=nullif(btrim(p_payload->>k),'');
   IF length(val)>(limits->>k)::integer OR val ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   normalized:=normalized||jsonb_build_object(k,val);
  END LOOP;
  IF length(coalesce(normalized->>'name_ar',''))<1 OR length(coalesce(normalized->>'name_en',''))<1
   OR (normalized->>'cr_number' IS NOT NULL AND normalized->>'cr_number' !~ '^[0-9]{10}$')
   OR (normalized->>'vat_number' IS NOT NULL AND normalized->>'vat_number' !~ '^3[0-9]{13}3$')
   OR (normalized->>'building_number' IS NOT NULL AND normalized->>'building_number' !~ '^[0-9]{4}$')
   OR (normalized->>'additional_number' IS NOT NULL AND normalized->>'additional_number' !~ '^[0-9]{4}$')
   OR (normalized->>'postal_code' IS NOT NULL AND normalized->>'postal_code' !~ '^[0-9]{5}$')
   OR (normalized->>'email' IS NOT NULL AND normalized->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
   OR (normalized->>'default_locale' IS NOT NULL AND normalized->>'default_locale' NOT IN ('ar','en')) THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  IF (normalized?'country' AND coalesce(normalized->>'country','')='') OR (normalized?'timezone' AND coalesce(normalized->>'timezone','')='') OR (normalized?'default_locale' AND coalesce(normalized->>'default_locale','')='') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  IF normalized->>'timezone' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=normalized->>'timezone') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  UPDATE public.tenants SET
   name_ar=normalized->>'name_ar',name_en=normalized->>'name_en',
   legal_name=CASE WHEN normalized?'legal_name' THEN normalized->>'legal_name' ELSE legal_name END,
   cr_number=CASE WHEN normalized?'cr_number' THEN normalized->>'cr_number' ELSE cr_number END,
   vat_number=CASE WHEN normalized?'vat_number' THEN normalized->>'vat_number' ELSE vat_number END,
   address=CASE WHEN normalized?'address' THEN normalized->>'address' ELSE address END,
   city=CASE WHEN normalized?'city' THEN normalized->>'city' ELSE city END,
   region=CASE WHEN normalized?'region' THEN normalized->>'region' ELSE region END,
   building_number=CASE WHEN normalized?'building_number' THEN normalized->>'building_number' ELSE building_number END,
   additional_number=CASE WHEN normalized?'additional_number' THEN normalized->>'additional_number' ELSE additional_number END,
   district=CASE WHEN normalized?'district' THEN normalized->>'district' ELSE district END,
   postal_code=CASE WHEN normalized?'postal_code' THEN normalized->>'postal_code' ELSE postal_code END,
   country=CASE WHEN normalized?'country' THEN normalized->>'country' ELSE country END,
   phone=CASE WHEN normalized?'phone' THEN normalized->>'phone' ELSE phone END,
   email=CASE WHEN normalized?'email' THEN normalized->>'email' ELSE email END,
   timezone=CASE WHEN normalized?'timezone' THEN normalized->>'timezone' ELSE timezone END,
   default_locale=CASE WHEN normalized?'default_locale' THEN normalized->>'default_locale' ELSE default_locale END
  WHERE id=t;
  audit_values:=normalized-'logo_url';
 ELSE
  allowed:=CASE WHEN p_surface='wps' THEN ARRAY['company.mol_reference','company.wps_iban']
   ELSE ARRAY['payroll.default_working_days','payroll.saudi_minimum_wage','payroll.min_net_floor'] END;
  IF p_payload='{}'::jsonb THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  FOR k,v IN SELECT key,value FROM jsonb_each(p_payload) LOOP
   IF NOT k=ANY(allowed) OR jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   val:=btrim(p_payload->>k);
   IF p_surface='wps' THEN
    IF k='company.mol_reference' AND (val !~ '^[A-Za-z0-9][A-Za-z0-9 -]{0,49}$') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   ELSE
    IF val !~ '^[0-9]+([.][0-9]{1,2})?$' OR length(val)>14 THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
    n:=val::numeric;
    IF (k='payroll.default_working_days' AND (n<1 OR n>31 OR trunc(n)<>n)) OR n>999999999.99 THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
    val:=n::text;
   END IF;
   normalized:=normalized||jsonb_build_object(k,val);
  END LOOP;
  IF p_surface='wps' THEN
   IF NOT (normalized?'company.mol_reference' AND normalized?'company.wps_iban') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   iban:=upper(regexp_replace(normalized->>'company.wps_iban','[[:space:]]','','g'));
   IF iban !~ '^SA[0-9]{22}$' THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   FOR ch IN SELECT regexp_split_to_table(substr(iban,5)||left(iban,4),'') LOOP
    digits:=digits||CASE WHEN ch ~ '[A-Z]' THEN (ascii(ch)-55)::text ELSE ch END;
   END LOOP;
   IF mod(digits::numeric,97)<>1 THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   normalized:=normalized||jsonb_build_object('company.wps_iban',iban);
  END IF;
  FOR k,val IN SELECT key,value FROM jsonb_each_text(normalized) LOOP
   INSERT INTO public.system_settings(tenant_id,key,value,category,is_public,created_by,updated_by)
   VALUES(t,k,val,split_part(k,'.',1),false,auth.uid(),auth.uid())
   ON CONFLICT(tenant_id,key) WHERE deleted_at IS NULL DO UPDATE SET value=EXCLUDED.value,is_public=false,updated_by=auth.uid();
  END LOOP;
  UPDATE public.tenants SET configuration_version=configuration_version+1 WHERE id=t;
  audit_values:=CASE WHEN p_surface='wps' THEN normalized||jsonb_build_object('company.wps_iban','****'||right(iban,4)) ELSE normalized END;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(t,auth.uid(),'settings',CASE WHEN p_surface='company' THEN 'tenant' ELSE 'system_settings' END,t,'settings_'||p_surface||'_updated',audit_values);
 RETURN jsonb_build_object('configuration_version',(SELECT configuration_version FROM public.tenants WHERE id=t));
END $$;


-- This is the only normal application mutation of the managed logo reference.
CREATE FUNCTION public.save_my_company_logo(p_request_id uuid,p_expected_version bigint,p_object_path text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); actor uuid:=auth.uid(); company public.tenants%ROWTYPE;
 receipt tenant_branding_private.logo_receipts%ROWTYPE; object_metadata jsonb; result jsonb;
 operation text:=CASE WHEN p_object_path IS NULL THEN 'clear' ELSE 'attach' END;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('settings','manage') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SETTINGS_FORBIDDEN'; END IF;
 IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
 SELECT * INTO company FROM public.tenants WHERE id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_UNAVAILABLE'; END IF;
 -- Recheck dynamic access after waiting for the common profile/WPS/logo lock.
 IF company.status<>'active' OR public.get_my_tenant_id() IS DISTINCT FROM t OR NOT public.user_has_permission('settings','manage') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SETTINGS_FORBIDDEN'; END IF;
 SELECT * INTO receipt FROM tenant_branding_private.logo_receipts WHERE tenant_id=t AND actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.expected_version IS DISTINCT FROM p_expected_version OR receipt.object_path IS DISTINCT FROM p_object_path THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  -- Historical receipt replay precedes stale checking, never overwrites later edits.
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF p_expected_version<>company.configuration_version THEN RAISE EXCEPTION 'SETTINGS_STALE'; END IF;
 IF p_object_path IS NOT NULL THEN
  IF p_object_path !~ ('^'||t::text||'/logos/'||actor::text||'/'||p_request_id::text||'/logo-[0-9a-f]{16}[.]png$') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  SELECT metadata INTO object_metadata FROM storage.objects WHERE bucket_id='company-assets' AND name=p_object_path AND owner_id=actor::text FOR SHARE;
  IF NOT FOUND OR object_metadata->>'mimetype' IS DISTINCT FROM 'image/png'
   OR coalesce(object_metadata->>'size','') !~ '^[0-9]{1,7}$' THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  IF (object_metadata->>'size')::bigint NOT BETWEEN 1 AND 524288 THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
 END IF;
 UPDATE public.tenants SET logo_storage_path=p_object_path,logo_url=NULL WHERE id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
 VALUES(t,actor,'settings','tenant',t,'settings_logo_updated',jsonb_build_object('object_path',company.logo_storage_path),jsonb_build_object('operation',operation,'object_path',p_object_path));
 result:=jsonb_build_object('request_id',p_request_id,'operation',operation,'object_path',p_object_path,
  'configuration_version',(SELECT configuration_version FROM public.tenants WHERE id=t),'replayed',false);
 INSERT INTO tenant_branding_private.logo_receipts(tenant_id,actor_id,request_id,expected_version,object_path,result)
 VALUES(t,actor,p_request_id,p_expected_version,p_object_path,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_my_company_logo(uuid,bigint,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_my_company_logo(uuid,bigint,text) TO authenticated;
REVOKE ALL ON FUNCTION public.read_my_settings_bundle(text),public.save_my_settings(text,jsonb,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_settings_bundle(text),public.save_my_settings(text,jsonb,bigint) TO authenticated;

-- Alter the existing permissive policies: additional permissive policies cannot deny.
-- Logos are immutable, including staged orphans. Other company assets keep their workflow.
ALTER POLICY storage_company_assets_update ON storage.objects
 USING(bucket_id='company-assets' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('settings','manage') AND split_part(name,'/',2)<>'logos')
 WITH CHECK(bucket_id='company-assets' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('settings','manage') AND split_part(name,'/',2)<>'logos');
ALTER POLICY storage_company_assets_delete ON storage.objects
 USING(bucket_id='company-assets' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('settings','manage') AND split_part(name,'/',2)<>'logos');
-- Keep public SELECT and existing caller-bound INSERT. RPC independently checks
-- the exact tenant/actor/request namespace, owner_id, PNG type and positive size.
NOTIFY pgrst,'reload schema';
COMMIT;
