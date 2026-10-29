-- Customers/suppliers keep the structured Saudi National Address (added in
-- 20261028131000_zatca_national_address) through the atomic accounting-master
-- workflow: reads return the fields and a dedicated, permission-checked RPC
-- writes them right after the master create/update receipt.
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
  q:=format('SELECT id,%I AS code,name_ar,name_en,phone,email,tax_number,address,city,district,building_number,additional_number,postal_code,country_code,credit_limit::text,is_active,updated_at FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL AND strpos(lower(concat_ws('' '',%I,name_ar,name_en,phone,email,tax_number,address,city,district)),lower($2))>0',CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END,p_kind,CASE WHEN p_kind='customers' THEN 'customer_code' ELSE 'supplier_code' END);
  EXECUTE format('SELECT jsonb_build_object(''total'',count(*),''active'',count(*) FILTER(WHERE is_active),''tax_registered'',count(*) FILTER(WHERE tax_number IS NOT NULL AND tax_number<>''''),''avg_credit_limit'',round(coalesce(avg(credit_limit),0),2)::text) FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL',p_kind) INTO summary USING t;
 END IF;
 EXECUTE 'SELECT count(*) FROM ('||q||') r' INTO n USING t,term;
 IF p_export AND n>10000 THEN RAISE EXCEPTION 'MASTER_EXPORT_LIMIT: narrow the export search' USING ERRCODE='54000';END IF;
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY '||CASE WHEN p_kind='accounts' THEN 'account_code' ELSE 'code' END||',id),''[]''::jsonb) FROM (SELECT * FROM ('||q||') data ORDER BY '||CASE WHEN p_kind='accounts' THEN 'account_code' ELSE 'code' END||',id LIMIT $3 OFFSET $4)r' INTO rows USING t,term,CASE WHEN p_export THEN n ELSE p_page_size END,CASE WHEN p_export THEN 0 ELSE(p_page::bigint-1)*p_page_size END;
 IF p_export THEN action:=CASE p_kind WHEN 'accounts' THEN 'chart_of_accounts_exported' WHEN 'customers' THEN 'customer_list_exported' ELSE 'supplier_list_exported' END;INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,action,new_values) VALUES(t,auth.uid(),'accounting',CASE WHEN p_kind='accounts' THEN 'chart_of_accounts' ELSE p_kind END,action,jsonb_build_object('rows',n,'filtered',term<>''));END IF;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',p_page,'page_size',p_page_size,'summary',summary);
END$$;

CREATE OR REPLACE FUNCTION public.set_my_party_national_address(p_kind text, p_id uuid, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid; oldrow jsonb; newrow jsonb; v_city text; v_district text; v_building text; v_additional text; v_postal text; v_country text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('customers','suppliers') OR p_id IS NULL OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'MASTER_INVALID: invalid national address request' USING ERRCODE='22023';
  END IF;
  t := accounting_master_private.require_caller('update');
  v_city := nullif(btrim(coalesce(p_input->>'city','')),'');
  v_district := nullif(btrim(coalesce(p_input->>'district','')),'');
  v_building := nullif(btrim(coalesce(p_input->>'building_number','')),'');
  v_additional := nullif(btrim(coalesce(p_input->>'additional_number','')),'');
  v_postal := nullif(btrim(coalesce(p_input->>'postal_code','')),'');
  v_country := upper(coalesce(nullif(btrim(coalesce(p_input->>'country_code','')),''),'SA'));
  IF (v_city IS NOT NULL AND length(v_city) > 127) OR (v_district IS NOT NULL AND length(v_district) > 127)
     OR (v_building IS NOT NULL AND v_building !~ '^[0-9]{4}$') OR (v_additional IS NOT NULL AND v_additional !~ '^[0-9]{4}$')
     OR (v_postal IS NOT NULL AND v_postal !~ '^[0-9]{5}$') OR v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'MASTER_ADDRESS_INVALID: national address format is invalid' USING ERRCODE='22023';
  END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', p_kind) INTO oldrow USING t, p_id;
  IF oldrow IS NULL THEN RAISE EXCEPTION 'MASTER_NOT_FOUND: party not found'; END IF;
  EXECUTE format('UPDATE public.%I SET city=$3,district=$4,building_number=$5,additional_number=$6,postal_code=$7,country_code=$8,updated_by=$9 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(%I.*)', p_kind, p_kind)
    INTO newrow USING t, p_id, v_city, v_district, v_building, v_additional, v_postal, v_country, auth.uid();
  IF (oldrow->>'city') IS DISTINCT FROM v_city OR (oldrow->>'district') IS DISTINCT FROM v_district OR (oldrow->>'building_number') IS DISTINCT FROM v_building
     OR (oldrow->>'additional_number') IS DISTINCT FROM v_additional OR (oldrow->>'postal_code') IS DISTINCT FROM v_postal OR (oldrow->>'country_code') IS DISTINCT FROM v_country THEN
    INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
    VALUES (t, auth.uid(), 'accounting', p_kind, p_id, left(p_kind, length(p_kind)-1) || '_address_updated',
      jsonb_build_object('city',oldrow->'city','district',oldrow->'district','building_number',oldrow->'building_number','additional_number',oldrow->'additional_number','postal_code',oldrow->'postal_code','country_code',oldrow->'country_code'),
      jsonb_build_object('city',v_city,'district',v_district,'building_number',v_building,'additional_number',v_additional,'postal_code',v_postal,'country_code',v_country));
  END IF;
  RETURN jsonb_build_object('id', newrow->>'id', 'updated_at', newrow->>'updated_at');
END$$;

REVOKE ALL ON FUNCTION public.set_my_party_national_address(text,uuid,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_party_national_address(text,uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
