-- Forward-only reconciliation of National Address with the guarded settings and master workflows.
-- No business row updates, new grants, or changes to historical migrations.
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
  'cr_number',cr_number,'vat_number',vat_number,'address',address,'city',city,'region',region,'building_number',building_number,'additional_number',additional_number,'district',district,'postal_code',postal_code,'country',country,
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
  limits:='{"name_ar":200,"name_en":200,"legal_name":250,"cr_number":10,"vat_number":15,"address":1000,"city":100,"region":100,"building_number":4,"additional_number":4,"district":127,"postal_code":5,"country":100,"phone":32,"email":320,"logo_url":1024,"timezone":100,"default_locale":2}'::jsonb;
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

CREATE OR REPLACE FUNCTION accounting_master_private.normalize_input(p_kind text,p_action text,p_input jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb:='{}';k text;v jsonb;s text;n numeric;prefix text:=CASE WHEN p_kind='customers' THEN 'CUS' ELSE 'SUP' END;
BEGIN
 IF p_kind NOT IN('customers','suppliers','accounts') OR p_action NOT IN('create','update','set_active','archive') OR p_input IS NULL
 OR jsonb_typeof(p_input)<>'object' OR octet_length(convert_to(p_input::text,'UTF8'))>16384 THEN RAISE EXCEPTION 'MASTER_INVALID: invalid master details' USING ERRCODE='22023';END IF;
 IF p_action='archive' THEN IF p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'MASTER_INVALID: archive has no editable fields' USING ERRCODE='22023';END IF;RETURN p_input;END IF;
 IF p_action='set_active' THEN IF p_input- 'is_active'<>'{}'::jsonb OR jsonb_typeof(p_input->'is_active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'MASTER_INVALID: active state required' USING ERRCODE='22023';END IF;RETURN p_input;END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_input) LOOP
  IF (p_kind='accounts' AND k NOT IN('account_code','name_ar','name_en','account_type','normal_balance','parent_id','is_contra','is_active','description'))
  OR(p_kind<>'accounts' AND k NOT IN('code','name_ar','name_en','phone','email','tax_number','address','city','district','building_number','additional_number','postal_code','country_code','credit_limit','is_active')) THEN RAISE EXCEPTION 'MASTER_INVALID: unsupported master field' USING ERRCODE='22023';END IF;
  IF k IN('is_contra','is_active') THEN
   IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'MASTER_INVALID: invalid boolean field' USING ERRCODE='22023';END IF;r:=r||jsonb_build_object(k,v);
  ELSIF k='credit_limit' THEN
   IF v='null'::jsonb THEN r:=r||jsonb_build_object(k,NULL);CONTINUE;END IF;
   IF jsonb_typeof(v) NOT IN('number','string') OR (v#>>'{}') !~ '^\d{1,10}(\.\d+)?$' THEN RAISE EXCEPTION '%',prefix||'004: credit limit must be finite nonnegative exact cents';END IF;
   n:=(v#>>'{}')::numeric;IF n<>round(n,2) THEN RAISE EXCEPTION '%',prefix||'004: credit limit must be finite nonnegative exact cents';END IF;IF n>=10000000000 THEN RAISE EXCEPTION '%',prefix||'004: credit limit exceeds supported amount';END IF;
   r:=r||jsonb_build_object(k,round(n,2));
  ELSIF k='parent_id' THEN
   IF v='null'::jsonb OR v#>>'{}'='' THEN r:=r||jsonb_build_object(k,NULL);ELSE
    IF jsonb_typeof(v)<>'string' OR(v#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'COA002: invalid parent account';END IF;
    r:=r||jsonb_build_object(k,(v#>>'{}')::uuid);END IF;
  ELSE
   IF jsonb_typeof(v) NOT IN('string','null') THEN RAISE EXCEPTION 'MASTER_INVALID: text field required' USING ERRCODE='22023';END IF;
   s:=NULLIF(btrim(v#>>'{}',E' \t\r\n'),'');
   IF k IN('name_ar','name_en') AND(length(s)>200 OR((k='name_ar' OR p_kind='accounts') AND s IS NULL)) THEN
    IF p_kind='accounts' THEN RAISE EXCEPTION 'COA001: Arabic and English names are required and limited to 200 characters';ELSE RAISE EXCEPTION '%',prefix||'005: Arabic name is required and names are limited to 200 characters';END IF;
   END IF;
   IF(k='description' AND length(s)>1000) OR(k='phone' AND length(s)>50) OR(k='email' AND length(s)>254) OR(k='address' AND length(s)>2000) THEN RAISE EXCEPTION 'MASTER_INVALID: text field exceeds its limit' USING ERRCODE='22023';END IF;
   IF k IN('city','district','building_number','additional_number','postal_code','country_code') AND s ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'MASTER_INVALID: invalid address text' USING ERRCODE='22023';END IF;
   IF(k='city' AND length(s)>100) OR(k='district' AND length(s)>127)
    OR(k IN('building_number','additional_number') AND s IS NOT NULL AND s !~ '^[0-9]{4}$')
    OR(k='postal_code' AND s IS NOT NULL AND s !~ '^[0-9]{5}$') THEN RAISE EXCEPTION 'MASTER_INVALID: invalid national address' USING ERRCODE='22023';END IF;
   IF k='country_code' THEN s:=coalesce(upper(s),'SA');IF s !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'MASTER_INVALID: invalid country code' USING ERRCODE='22023';END IF;END IF;
   IF k='account_code' AND(s IS NULL OR s!~'^\d{3,6}$') THEN RAISE EXCEPTION 'COA001: account code must be 3-6 digits';END IF;
   IF k='code' THEN IF s IS NULL THEN CONTINUE;END IF;s:=upper(s);IF s!~'^[A-Z0-9][A-Z0-9-]{2,11}$' THEN RAISE EXCEPTION '%',prefix||'003: code must be 3-12 characters';END IF;END IF;
   IF k='tax_number' AND s IS NOT NULL AND s!~'^\d{15}$' THEN RAISE EXCEPTION '%',prefix||'002: tax number must be exactly 15 digits';END IF;
   IF k='account_type' AND(s IS NULL OR s NOT IN('asset','liability','equity','income','expense')) THEN RAISE EXCEPTION 'COA003: invalid account type';END IF;
   IF k='normal_balance' AND(s IS NULL OR s NOT IN('debit','credit')) THEN RAISE EXCEPTION 'COA003: invalid normal balance';END IF;
   r:=r||jsonb_build_object(k,s);
  END IF;
 END LOOP;
 IF p_action='create' AND((p_kind='accounts' AND NOT(r?'account_code' AND r?'name_ar' AND r?'name_en' AND r?'account_type' AND r?'normal_balance')) OR(p_kind<>'accounts' AND NOT r?'name_ar')) THEN RAISE EXCEPTION 'MASTER_INVALID: required master fields missing' USING ERRCODE='22023';END IF;
 IF p_action='create' THEN
  IF p_kind='accounts' THEN r:=jsonb_build_object('parent_id',NULL,'is_contra',false,'is_active',true,'description',NULL)||r;
  ELSE r:=jsonb_build_object('name_en',NULL,'phone',NULL,'email',NULL,'tax_number',NULL,'address',NULL,'credit_limit',NULL,'is_active',true)||r;END IF;
 END IF;
 RETURN r;
END$$;

CREATE OR REPLACE FUNCTION public.read_my_accounting_master_page(p_kind text,p_search text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25,p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=accounting_master_private.require_caller('read');q text;rows jsonb;n bigint;summary jsonb;term text;action text;
BEGIN
 IF p_kind NOT IN('customers','suppliers','accounts') OR p_kind IS NULL OR p_search IS NULL OR length(p_search)>200 OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_export IS NULL THEN RAISE EXCEPTION 'MASTER_INVALID: invalid page request' USING ERRCODE='22023';END IF;
 IF p_export THEN PERFORM accounting_master_private.require_caller('export');END IF;
 PERFORM accounting_master_private.lock_catalog(t);term:=btrim(p_search);
 IF p_kind='accounts' THEN
  q:='SELECT * FROM accounting_master_private.account_rows($1) WHERE strpos(lower(concat_ws('' '',account_code,name_ar,name_en,description)),lower($2))>0';
  SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE is_active),'assets',count(*) FILTER(WHERE account_type='asset'),'income_expense',count(*) FILTER(WHERE account_type IN('income','expense'))) INTO summary FROM public.chart_of_accounts WHERE tenant_id=t AND deleted_at IS NULL;
 ELSE
  q:=format('SELECT id,%I AS code,name_ar,name_en,phone,email,tax_number,address,city,district,building_number,additional_number,postal_code,country_code,credit_limit::text,is_active,updated_at FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL AND strpos(lower(concat_ws('' '',%I,name_ar,name_en,phone,email,tax_number,address,city,district,building_number,additional_number,postal_code,country_code)),lower($2))>0',CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END,p_kind,CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END);
  EXECUTE format('SELECT jsonb_build_object(''total'',count(*),''active'',count(*) FILTER(WHERE is_active),''tax_registered'',count(*) FILTER(WHERE tax_number IS NOT NULL AND tax_number<>''''),''avg_credit_limit'',round(coalesce(avg(credit_limit),0),2)::text) FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL',p_kind) INTO summary USING t;
 END IF;
 EXECUTE 'SELECT count(*) FROM ('||q||') r' INTO n USING t,term;
 IF p_export AND n>10000 THEN RAISE EXCEPTION 'MASTER_EXPORT_LIMIT: narrow the export search' USING ERRCODE='54000';END IF;
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY '||CASE WHEN p_kind='accounts' THEN 'account_code' ELSE 'code' END||',id),''[]''::jsonb) FROM (SELECT * FROM ('||q||') data ORDER BY '||CASE WHEN p_kind='accounts' THEN 'account_code' ELSE 'code' END||',id LIMIT $3 OFFSET $4)r' INTO rows USING t,term,CASE WHEN p_export THEN n ELSE p_page_size END,CASE WHEN p_export THEN 0 ELSE(p_page::bigint-1)*p_page_size END;
 IF p_export THEN action:=CASE p_kind WHEN 'accounts' THEN 'chart_of_accounts_exported' WHEN 'customers' THEN 'customer_list_exported' ELSE 'supplier_list_exported' END;INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,action,new_values) VALUES(t,auth.uid(),'accounting',CASE WHEN p_kind='accounts' THEN 'chart_of_accounts' ELSE p_kind END,action,jsonb_build_object('rows',n,'filtered',term<>''));END IF;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',p_page,'page_size',p_page_size,'summary',summary);
END$$;

CREATE OR REPLACE FUNCTION public.mutate_my_accounting_master(p_kind text,p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid;norm jsonb;payload jsonb;response jsonb;oldrow jsonb;newrow jsonb;acct public.chart_of_accounts%ROWTYPE;code_col text;code text;seq bigint;op text;action text;stamp timestamptz;duplicate boolean;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('customers','suppliers','accounts') OR p_action IS NULL OR p_action NOT IN('create','update','set_active','archive') THEN RAISE EXCEPTION 'MASTER_INVALID: unsupported master operation' USING ERRCODE='22023';END IF;
 t:=accounting_master_private.require_caller(CASE WHEN p_action='create' THEN 'create' ELSE 'update' END);
 norm:=accounting_master_private.normalize_input(p_kind,p_action,p_input);
 IF(p_action='create' AND(p_id IS NOT NULL OR p_expected_updated_at IS NOT NULL)) OR(p_action<>'create' AND(p_id IS NULL OR p_expected_updated_at IS NULL)) THEN RAISE EXCEPTION 'MASTER_INVALID: reviewed identity and timestamp required' USING ERRCODE='22023';END IF;
 op:=p_kind||':'||p_action;payload:=jsonb_build_object('input',norm,'id',p_id,'expected_updated_at',CASE WHEN p_expected_updated_at IS NULL THEN NULL ELSE to_char(p_expected_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END);
 response:=accounting_master_private.receipt_get(t,p_request_id,op,payload);IF response IS NOT NULL THEN RETURN response;END IF;
 IF p_kind='accounts' THEN
  IF p_action<>'create' THEN
   SELECT * INTO acct FROM public.chart_of_accounts WHERE tenant_id=t AND id=p_id AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'MASTER_NOT_FOUND: account not found';END IF;
   IF acct.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'MASTER_STALE: record changed; reload before saving';END IF;oldrow:=to_jsonb(acct);
  END IF;
  IF p_action='create' THEN
   IF EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=t AND account_code=norm->>'account_code' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'MASTER_DUPLICATE: account code already exists';END IF;
   INSERT INTO public.chart_of_accounts(tenant_id,account_code,name_ar,name_en,account_type,normal_balance,parent_id,is_contra,is_active,description,created_by,updated_by)
   VALUES(t,norm->>'account_code',norm->>'name_ar',norm->>'name_en',(norm->>'account_type')::public.account_type,(norm->>'normal_balance')::public.account_normal_balance,(norm->>'parent_id')::uuid,coalesce((norm->>'is_contra')::boolean,false),coalesce((norm->>'is_active')::boolean,true),norm->>'description',auth.uid(),auth.uid()) RETURNING * INTO acct;
  ELSIF p_action='update' THEN
   IF EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=t AND account_code=coalesce(norm->>'account_code',acct.account_code) AND deleted_at IS NULL AND id<>p_id) THEN RAISE EXCEPTION 'MASTER_DUPLICATE: account code already exists';END IF;
   UPDATE public.chart_of_accounts SET account_code=coalesce(norm->>'account_code',acct.account_code),name_ar=coalesce(norm->>'name_ar',acct.name_ar),name_en=coalesce(norm->>'name_en',acct.name_en),account_type=coalesce((norm->>'account_type')::public.account_type,acct.account_type),normal_balance=coalesce((norm->>'normal_balance')::public.account_normal_balance,acct.normal_balance),parent_id=CASE WHEN norm?'parent_id' THEN(norm->>'parent_id')::uuid ELSE acct.parent_id END,is_contra=coalesce((norm->>'is_contra')::boolean,acct.is_contra),is_active=coalesce((norm->>'is_active')::boolean,acct.is_active),description=CASE WHEN norm?'description' THEN norm->>'description' ELSE acct.description END,updated_by=auth.uid() WHERE id=p_id AND tenant_id=t RETURNING * INTO acct;
  ELSIF p_action='set_active' THEN UPDATE public.chart_of_accounts SET is_active=(norm->>'is_active')::boolean,updated_by=auth.uid() WHERE id=p_id AND tenant_id=t RETURNING * INTO acct;
  ELSE
   IF NOT accounting_master_private.can_archive(t,acct.id,acct.account_code) THEN RAISE EXCEPTION 'COA005: canonical or referenced account must be retained';END IF;
   UPDATE public.chart_of_accounts SET deleted_at=clock_timestamp(),is_active=false,updated_by=auth.uid() WHERE id=p_id AND tenant_id=t RETURNING * INTO acct;
  END IF;
  newrow:=to_jsonb(acct);code:=acct.account_code;
 ELSE
  code_col:=CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END;
  IF p_action<>'create' THEN
   EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',p_kind) INTO oldrow USING t,p_id;
   IF oldrow IS NULL THEN RAISE EXCEPTION 'MASTER_NOT_FOUND: party not found';END IF;
   IF(oldrow->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'MASTER_STALE: record changed; reload before saving';END IF;
  END IF;
  IF p_action='create' THEN
   code:=norm->>'code';IF code IS NULL THEN seq:=nextval('public.finance_doc_ref_seq');code:=lpad(seq::text,greatest(6,length(seq::text)),'0');END IF;
   IF length(code)>12 THEN RAISE EXCEPTION 'MASTER_INVALID: party code sequence exhausted';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE tenant_id=$1 AND upper(%I)=$2 AND deleted_at IS NULL)',p_kind,code_col) INTO duplicate USING t,code;
   IF duplicate THEN RAISE EXCEPTION 'MASTER_DUPLICATE: party code already exists';END IF;
   EXECUTE format('INSERT INTO public.%I(tenant_id,%I,name_ar,name_en,phone,email,tax_number,address,credit_limit,is_active,created_by,updated_by,city,district,building_number,additional_number,postal_code,country_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16,$17) RETURNING to_jsonb(%I.*)',p_kind,code_col,p_kind)
   INTO newrow USING t,code,norm->>'name_ar',norm->>'name_en',norm->>'phone',norm->>'email',norm->>'tax_number',norm->>'address',(norm->>'credit_limit')::numeric,coalesce((norm->>'is_active')::boolean,true),auth.uid(),norm->>'city',norm->>'district',norm->>'building_number',norm->>'additional_number',norm->>'postal_code',coalesce(norm->>'country_code','SA');
  ELSIF p_action='update' THEN
   code:=coalesce(norm->>'code',oldrow->>code_col);
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE tenant_id=$1 AND upper(%I)=upper($2) AND deleted_at IS NULL AND id<>$3)',p_kind,code_col) INTO duplicate USING t,code,p_id;
   IF duplicate THEN RAISE EXCEPTION 'MASTER_DUPLICATE: party code already exists';END IF;
   EXECUTE format('UPDATE public.%I SET %I=$3,name_ar=$4,name_en=$5,phone=$6,email=$7,tax_number=$8,address=$9,credit_limit=$10,is_active=$11,updated_by=$12,city=$13,district=$14,building_number=$15,additional_number=$16,postal_code=$17,country_code=$18 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(%I.*)',p_kind,code_col,p_kind)
   INTO newrow USING t,p_id,code,coalesce(norm->>'name_ar',oldrow->>'name_ar'),CASE WHEN norm?'name_en' THEN norm->>'name_en' ELSE oldrow->>'name_en' END,CASE WHEN norm?'phone' THEN norm->>'phone' ELSE oldrow->>'phone' END,CASE WHEN norm?'email' THEN norm->>'email' ELSE oldrow->>'email' END,CASE WHEN norm?'tax_number' THEN norm->>'tax_number' ELSE oldrow->>'tax_number' END,CASE WHEN norm?'address' THEN norm->>'address' ELSE oldrow->>'address' END,CASE WHEN norm?'credit_limit' THEN(norm->>'credit_limit')::numeric ELSE(oldrow->>'credit_limit')::numeric END,coalesce((norm->>'is_active')::boolean,(oldrow->>'is_active')::boolean),auth.uid(),CASE WHEN norm?'city' THEN norm->>'city' ELSE oldrow->>'city' END,CASE WHEN norm?'district' THEN norm->>'district' ELSE oldrow->>'district' END,CASE WHEN norm?'building_number' THEN norm->>'building_number' ELSE oldrow->>'building_number' END,CASE WHEN norm?'additional_number' THEN norm->>'additional_number' ELSE oldrow->>'additional_number' END,CASE WHEN norm?'postal_code' THEN norm->>'postal_code' ELSE oldrow->>'postal_code' END,CASE WHEN norm?'country_code' THEN norm->>'country_code' ELSE oldrow->>'country_code' END;
  ELSIF p_action='set_active' THEN
   EXECUTE format('UPDATE public.%I SET is_active=$3,updated_by=$4 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(%I.*)',p_kind,p_kind) INTO newrow USING t,p_id,(norm->>'is_active')::boolean,auth.uid();
  ELSE
   IF accounting_master_private.party_referenced(p_kind,t,p_id) THEN RAISE EXCEPTION 'MASTER_REFERENCED: party has financial history; deactivate it instead';END IF;
   EXECUTE format('UPDATE public.%I SET deleted_at=clock_timestamp(),is_active=false,updated_by=$3 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(%I.*)',p_kind,p_kind) INTO newrow USING t,p_id,auth.uid();
  END IF;code:=newrow->>code_col;
 END IF;
 action:=CASE WHEN p_kind='accounts' THEN 'account' ELSE left(p_kind,length(p_kind)-1) END||'_'||CASE p_action WHEN 'create' THEN 'created' WHEN 'update' THEN 'updated' WHEN 'archive' THEN 'deleted' ELSE CASE WHEN(newrow->>'is_active')::boolean THEN 'activated' ELSE 'deactivated' END END;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
 VALUES(t,auth.uid(),'accounting',CASE WHEN p_kind='accounts' THEN 'chart_of_accounts' ELSE p_kind END,(newrow->>'id')::uuid,action,
 CASE WHEN oldrow IS NULL THEN NULL ELSE jsonb_build_object('code',CASE WHEN p_kind='accounts' THEN oldrow->>'account_code' ELSE oldrow->>code_col END,'is_active',oldrow->'is_active','updated_at',oldrow->'updated_at') END,
 jsonb_build_object('code',code,'is_active',newrow->'is_active','archived',newrow->>'deleted_at' IS NOT NULL,'updated_at',newrow->'updated_at','request_id',p_request_id));
 response:=jsonb_build_object('id',newrow->'id','updated_at',newrow->'updated_at','code',code,'is_active',newrow->'is_active','archived',newrow->>'deleted_at' IS NOT NULL);
 PERFORM accounting_master_private.receipt_put(t,p_request_id,op,payload,response);RETURN response;
END$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
