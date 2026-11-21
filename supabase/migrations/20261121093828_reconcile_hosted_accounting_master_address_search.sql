-- Reconcile the hosted reader with the canonical national-address search.
-- Existing authorization, audit, paging, and export limits remain in the reader.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $reviewed_reader$
DECLARE
  reader pg_proc%ROWTYPE;
BEGIN
  SELECT p.* INTO reader
  FROM pg_proc AS p
  WHERE p.oid = to_regprocedure('public.read_my_accounting_master_page(text,text,integer,integer,boolean)');

  IF NOT FOUND
    OR reader.proowner <> 'postgres'::regrole
    OR NOT reader.prosecdef
    OR reader.provolatile <> 'v'
    OR reader.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR NOT has_function_privilege('authenticated', reader.oid, 'EXECUTE')
    OR has_function_privilege('anon', reader.oid, 'EXECUTE')
    OR has_function_privilege('service_role', reader.oid, 'EXECUTE')
    OR EXISTS (
      SELECT FROM aclexplode(reader.proacl) AS permission
      WHERE permission.grantee NOT IN ('postgres'::regrole, 'authenticated'::regrole)
    )
    OR md5(replace(reader.prosrc, chr(13) || chr(10), chr(10))) NOT IN (
      '90c5d219b801ef0b635a0043a8f97252', -- hosted reader before this fix
      '3f1d4af723bb15f2f0dc97fee0b73297'  -- canonical reader on fresh replay
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'MASTER_ADDRESS_SEARCH_REVIEW_REQUIRED: unexpected reader definition or permissions';
  END IF;
END
$reviewed_reader$;

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

NOTIFY pgrst, 'reload schema';
COMMIT;
