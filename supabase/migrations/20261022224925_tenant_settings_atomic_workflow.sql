BEGIN;
-- Metadata only; existing business settings and company values are unchanged.
ALTER TABLE public.tenants ADD COLUMN configuration_version bigint NOT NULL DEFAULT 1;
CREATE FUNCTION public.bump_tenant_configuration_version() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN NEW.configuration_version:=OLD.configuration_version+1; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.bump_tenant_configuration_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tenant_configuration_version BEFORE UPDATE ON public.tenants
 FOR EACH ROW EXECUTE FUNCTION public.bump_tenant_configuration_version();

CREATE FUNCTION public.read_my_settings_bundle(p_surface text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); company jsonb; rows jsonb; manager boolean;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('settings','read') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SETTINGS_FORBIDDEN'; END IF;
 IF p_surface IS NULL OR p_surface NOT IN ('company','payroll') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
 manager:=public.user_has_permission('settings','manage');
 SELECT jsonb_build_object('id',id,'name_ar',name_ar,'name_en',name_en,'legal_name',legal_name,
  'cr_number',cr_number,'vat_number',vat_number,'address',address,'city',city,'region',region,'country',country,
  'phone',phone,'email',email,'logo_url',logo_url,'timezone',timezone,'default_locale',default_locale,
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
REVOKE ALL ON FUNCTION public.read_my_settings_bundle(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_my_settings_bundle(text) TO authenticated;

CREATE FUNCTION public.save_my_settings(p_surface text,p_payload jsonb,p_expected_version bigint) RETURNS jsonb
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
  allowed:=ARRAY['name_ar','name_en','legal_name','cr_number','vat_number','address','city','region','country','phone','email','logo_url','timezone','default_locale'];
  limits:='{"name_ar":200,"name_en":200,"legal_name":250,"cr_number":10,"vat_number":15,"address":1000,"city":100,"region":100,"country":100,"phone":32,"email":320,"logo_url":1024,"timezone":100,"default_locale":2}'::jsonb;
  FOR k,v IN SELECT key,value FROM jsonb_each(p_payload) LOOP
   IF NOT k=ANY(allowed) OR jsonb_typeof(v) NOT IN ('string','null') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   val:=nullif(btrim(p_payload->>k),'');
   IF length(val)>(limits->>k)::integer OR val ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   normalized:=normalized||jsonb_build_object(k,val);
  END LOOP;
  IF length(coalesce(normalized->>'name_ar',''))<1 OR length(coalesce(normalized->>'name_en',''))<1
   OR (normalized->>'cr_number' IS NOT NULL AND normalized->>'cr_number' !~ '^[0-9]{10}$')
   OR (normalized->>'vat_number' IS NOT NULL AND normalized->>'vat_number' !~ '^3[0-9]{13}3$')
   OR (normalized->>'email' IS NOT NULL AND normalized->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
   OR (normalized->>'default_locale' IS NOT NULL AND normalized->>'default_locale' NOT IN ('ar','en')) THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  IF (normalized?'country' AND coalesce(normalized->>'country','')='') OR (normalized?'timezone' AND coalesce(normalized->>'timezone','')='') OR (normalized?'default_locale' AND coalesce(normalized->>'default_locale','')='') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  IF normalized->>'timezone' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=normalized->>'timezone') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  IF normalized->>'logo_url' IS NOT NULL AND normalized->>'logo_url' IS DISTINCT FROM company.logo_url
   AND normalized->>'logo_url' !~ ('^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/company-assets/'||t::text||'/[A-Za-z0-9_./-]+$') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
  UPDATE public.tenants SET
   name_ar=normalized->>'name_ar',name_en=normalized->>'name_en',
   legal_name=CASE WHEN normalized?'legal_name' THEN normalized->>'legal_name' ELSE legal_name END,
   cr_number=CASE WHEN normalized?'cr_number' THEN normalized->>'cr_number' ELSE cr_number END,
   vat_number=CASE WHEN normalized?'vat_number' THEN normalized->>'vat_number' ELSE vat_number END,
   address=CASE WHEN normalized?'address' THEN normalized->>'address' ELSE address END,
   city=CASE WHEN normalized?'city' THEN normalized->>'city' ELSE city END,
   region=CASE WHEN normalized?'region' THEN normalized->>'region' ELSE region END,
   country=CASE WHEN normalized?'country' THEN normalized->>'country' ELSE country END,
   phone=CASE WHEN normalized?'phone' THEN normalized->>'phone' ELSE phone END,
   email=CASE WHEN normalized?'email' THEN normalized->>'email' ELSE email END,
   logo_url=CASE WHEN normalized?'logo_url' THEN normalized->>'logo_url' ELSE logo_url END,
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
REVOKE ALL ON FUNCTION public.save_my_settings(text,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_my_settings(text,jsonb,bigint) TO authenticated;
-- Configured values remain readable under the existing RLS contract.
REVOKE INSERT,UPDATE,DELETE ON public.system_settings FROM PUBLIC,anon,authenticated;
REVOKE UPDATE ON public.tenants FROM PUBLIC,anon,authenticated;
DO $$ DECLARE c record; BEGIN FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.tenants'::regclass AND attnum>0 AND NOT attisdropped LOOP
 EXECUTE format('REVOKE UPDATE (%I) ON public.tenants FROM PUBLIC,anon,authenticated',c.attname); END LOOP; END $$;

-- Prevent stale service-role settings writers from bypassing the reviewed caller workflow.
CREATE FUNCTION public.guard_direct_service_settings_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 IF current_user='service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SETTINGS_CALLER_REQUIRED'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.guard_direct_service_settings_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER caller_bound_settings_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.system_settings
 FOR EACH STATEMENT EXECUTE FUNCTION public.guard_direct_service_settings_write();
DO $$ DECLARE c record; BEGIN FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.system_settings'::regclass AND attnum>0 AND NOT attisdropped LOOP
 EXECUTE format('REVOKE INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON public.system_settings FROM PUBLIC,anon,authenticated',c.attname); END LOOP; END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
