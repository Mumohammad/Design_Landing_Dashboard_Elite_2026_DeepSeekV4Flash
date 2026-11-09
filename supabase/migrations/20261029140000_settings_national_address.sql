-- Company settings: carry the Saudi National Address (building number,
-- additional number, district, postal code) through the atomic settings
-- RPCs. ZATCA Phase 2 requires these on the seller party (BR-KSA-09), and the
-- invoice print uses them. Same contract as 20261022224925, extended only.
BEGIN;
CREATE OR REPLACE FUNCTION public.read_my_settings_bundle(p_surface text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); company jsonb; rows jsonb; manager boolean;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('settings','read') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SETTINGS_FORBIDDEN'; END IF;
 IF p_surface IS NULL OR p_surface NOT IN ('company','payroll') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
 manager:=public.user_has_permission('settings','manage');
 SELECT jsonb_build_object('id',id,'name_ar',name_ar,'name_en',name_en,'legal_name',legal_name,
  'cr_number',cr_number,'vat_number',vat_number,'address',address,'city',city,'region',region,'country',country,
  'building_number',building_number,'additional_number',additional_number,'district',district,'postal_code',postal_code,
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
  allowed:=ARRAY['name_ar','name_en','legal_name','cr_number','vat_number','address','city','region','building_number','additional_number','district','postal_code','country','phone','email','logo_url','timezone','default_locale'];
  limits:='{"name_ar":200,"name_en":200,"legal_name":250,"cr_number":10,"vat_number":15,"address":1000,"city":100,"region":100,"building_number":4,"additional_number":4,"district":100,"postal_code":5,"country":100,"phone":32,"email":320,"logo_url":1024,"timezone":100,"default_locale":2}'::jsonb;
  FOR k,v IN SELECT key,value FROM jsonb_each(p_payload) LOOP
   IF NOT k=ANY(allowed) OR jsonb_typeof(v) NOT IN ('string','null') THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   val:=nullif(btrim(p_payload->>k),'');
   IF length(val)>(limits->>k)::integer OR val ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'SETTINGS_INVALID'; END IF;
   normalized:=normalized||jsonb_build_object(k,val);
  END LOOP;
  IF length(coalesce(normalized->>'name_ar',''))<1 OR length(coalesce(normalized->>'name_en',''))<1
   OR (normalized->>'cr_number' IS NOT NULL AND normalized->>'cr_number' !~ '^[0-9]{10}$')
   OR (normalized->>'building_number' IS NOT NULL AND normalized->>'building_number' !~ '^[0-9]{4}$')
   OR (normalized->>'additional_number' IS NOT NULL AND normalized->>'additional_number' !~ '^[0-9]{4}$')
   OR (normalized->>'postal_code' IS NOT NULL AND normalized->>'postal_code' !~ '^[0-9]{5}$')
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
   building_number=CASE WHEN normalized?'building_number' THEN normalized->>'building_number' ELSE building_number END,
   additional_number=CASE WHEN normalized?'additional_number' THEN normalized->>'additional_number' ELSE additional_number END,
   district=CASE WHEN normalized?'district' THEN normalized->>'district' ELSE district END,
   postal_code=CASE WHEN normalized?'postal_code' THEN normalized->>'postal_code' ELSE postal_code END,
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
NOTIFY pgrst,'reload schema';
COMMIT;
