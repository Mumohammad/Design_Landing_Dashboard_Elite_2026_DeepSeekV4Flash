BEGIN;
CREATE SCHEMA IF NOT EXISTS operations_private;
REVOKE ALL ON SCHEMA operations_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA operations_private TO authenticated;
CREATE OR REPLACE FUNCTION operations_private.actor(p_action text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid := public.get_my_tenant_id();
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('platforms',p_action) THEN RAISE EXCEPTION 'AUTH007: platform operation permission required'; END IF;
 RETURN t;
END; $$;
CREATE OR REPLACE FUNCTION operations_private.save_order(p_input jsonb,p_id uuid,p_expected timestamptz,p_archive boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid; old_row public.daily_order_entries; new_row public.daily_order_entries; d date; dr uuid; pl uuid; k text; n numeric; lock_key text;
BEGIN
 t:=operations_private.actor(CASE WHEN p_archive THEN 'delete' WHEN p_id IS NULL THEN 'create' ELSE 'update' END);
 IF p_id IS NOT NULL THEN
  SELECT * INTO old_row FROM public.daily_order_entries WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 END IF;
 IF NOT p_archive THEN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR coalesce(p_input->>'entry_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'ORDER_INVALID_DATE'; END IF;
  d:=(p_input->>'entry_date')::date; dr:=(p_input->>'driver_id')::uuid; pl:=(p_input->>'platform_id')::uuid;
 ELSE d:=old_row.entry_date; END IF;
 -- Deterministic month lock order also covers corrections that change month.
 FOR lock_key IN SELECT DISTINCT key FROM unnest(ARRAY[to_char(d,'YYYY-MM'),to_char(old_row.entry_date,'YYYY-MM')]) key WHERE key IS NOT NULL ORDER BY key LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':'||lock_key,0));
 END LOOP;
 IF p_id IS NOT NULL THEN
  SELECT * INTO old_row FROM public.daily_order_entries WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF p_expected IS NULL OR old_row.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'ORDER_STALE_VERSION'; END IF;
  IF old_row.is_locked THEN RAISE EXCEPTION 'PAY_PREPARATION_LOCKED'; END IF;
 END IF;
 IF NOT p_archive THEN
  IF coalesce((p_input->>'is_locked')::boolean,false) THEN RAISE EXCEPTION 'ORDER_LOCK_REQUIRES_PREPARATION'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=dr AND tenant_id=t AND deleted_at IS NULL AND (status IN ('active','on_leave') OR dr=old_row.driver_id)) THEN RAISE EXCEPTION 'ORDER_TENANT_DRIVER_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.delivery_platforms WHERE id=pl AND tenant_id=t AND deleted_at IS NULL AND (is_active OR pl=old_row.platform_id)) THEN RAISE EXCEPTION 'ORDER_ACTIVE_TENANT_PLATFORM_REQUIRED'; END IF;
  FOREACH k IN ARRAY ARRAY['orders_delivered','orders_failed','orders_returned','orders_cancelled','multi_order_batches'] LOOP
   n:=coalesce((p_input->>k)::numeric,0);
   IF n<0 OR n<>trunc(n) OR n>(CASE WHEN k='multi_order_batches' THEN 32767 ELSE 2147483647 END) THEN RAISE EXCEPTION 'ORDER_INVALID_COUNT'; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['gross_revenue','platform_reported_revenue','total_distance_km','avg_order_distance_km'] LOOP
   n:=(p_input->>k)::numeric;
   IF n IS NOT NULL AND (n<0 OR n<>round(n,2) OR n>(CASE WHEN k='avg_order_distance_km' THEN 9999.99 WHEN k='total_distance_km' THEN 999999.99 ELSE 99999999.99 END)) THEN RAISE EXCEPTION 'ORDER_INVALID_AMOUNT'; END IF;
  END LOOP;
  IF length(coalesce(p_input->>'notes',''))>2000 OR length(coalesce(p_input->>'shift_label',''))>80 THEN RAISE EXCEPTION 'ORDER_TEXT_TOO_LONG'; END IF;
  IF p_id IS NULL THEN
   INSERT INTO public.daily_order_entries(tenant_id,driver_id,platform_id,entry_date,shift_label,entry_source,created_by,updated_by)
    VALUES(t,dr,pl,d,nullif(btrim(p_input->>'shift_label'),''),coalesce(p_input->>'entry_source','manual'),auth.uid(),auth.uid()) RETURNING * INTO new_row;
  ELSE new_row:=old_row; END IF;
  UPDATE public.daily_order_entries SET driver_id=dr,platform_id=pl,entry_date=d,shift_label=nullif(btrim(p_input->>'shift_label'),''),
   orders_delivered=coalesce((p_input->>'orders_delivered')::integer,0),orders_failed=coalesce((p_input->>'orders_failed')::integer,0),orders_returned=coalesce((p_input->>'orders_returned')::integer,0),orders_cancelled=coalesce((p_input->>'orders_cancelled')::integer,0),multi_order_batches=coalesce((p_input->>'multi_order_batches')::smallint,0),
   gross_revenue=coalesce((p_input->>'gross_revenue')::numeric,0),platform_reported_revenue=(p_input->>'platform_reported_revenue')::numeric,total_distance_km=(p_input->>'total_distance_km')::numeric,avg_order_distance_km=(p_input->>'avg_order_distance_km')::numeric,notes=nullif(btrim(p_input->>'notes'),''),updated_by=auth.uid(),updated_at=clock_timestamp()
   WHERE id=new_row.id AND tenant_id=t RETURNING * INTO new_row;
 ELSE
  UPDATE public.daily_order_entries SET deleted_at=clock_timestamp(),updated_by=auth.uid(),updated_at=clock_timestamp() WHERE id=p_id AND tenant_id=t RETURNING * INTO new_row;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,action,entity_type,entity_id,old_values,new_values)
 VALUES(t,auth.uid(),'platforms',CASE WHEN p_archive THEN 'order_entry_archived' WHEN p_id IS NULL THEN 'order_entry_created' ELSE 'order_entry_updated' END,'daily_order_entries',new_row.id,CASE WHEN old_row.id IS NOT NULL THEN to_jsonb(old_row) END,to_jsonb(new_row));
 RETURN jsonb_build_object('id',new_row.id,'updated_at',new_row.updated_at);
END; $$;
CREATE OR REPLACE FUNCTION public.save_order_entry(p_input jsonb,p_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.save_order(p_input,p_id,p_expected_updated_at,false); $$;
CREATE OR REPLACE FUNCTION public.archive_order_entry(p_id uuid,p_expected_updated_at timestamptz) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.save_order('{}',p_id,p_expected_updated_at,true); $$;
CREATE OR REPLACE FUNCTION operations_private.list_orders(p_month text,p_search text,p_page integer,p_size integer,p_export boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid; start_d date; end_d date; count_rows bigint; stats jsonb; rows jsonb; q text:=left(btrim(coalesce(p_search,'')),200);
BEGIN
 t:=operations_private.actor(CASE WHEN p_export THEN 'export' ELSE 'read' END);
 IF p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' OR p_month IS NULL OR p_page<1 OR p_page IS NULL OR p_size NOT BETWEEN 1 AND 1000 OR p_size IS NULL THEN RAISE EXCEPTION 'ORDER_INVALID_PAGE'; END IF;
 start_d:=(p_month||'-01')::date; end_d:=(start_d+interval '1 month')::date;
 SELECT count(*),jsonb_build_object('delivered',coalesce(sum(e.orders_delivered),0),'failed',coalesce(sum(e.orders_failed),0),'revenue',coalesce(sum(e.gross_revenue),0)) INTO count_rows,stats
 FROM public.daily_order_entries e JOIN public.drivers d ON d.id=e.driver_id AND d.tenant_id=t JOIN public.delivery_platforms p ON p.id=e.platform_id AND p.tenant_id=t
 WHERE e.tenant_id=t AND e.deleted_at IS NULL AND e.entry_date>=start_d AND e.entry_date<end_d
 AND (q='' OR strpos(lower(concat_ws(' ',d.full_name_ar,d.full_name_en,d.driver_code,p.name_ar,p.name_en)),lower(q))>0);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date DESC,x.id),'[]') INTO rows FROM(
  SELECT e.*,jsonb_build_object('full_name_ar',d.full_name_ar,'full_name_en',d.full_name_en,'driver_code',d.driver_code) driver,
   jsonb_build_object('name_ar',p.name_ar,'name_en',p.name_en) platform
  FROM public.daily_order_entries e JOIN public.drivers d ON d.id=e.driver_id AND d.tenant_id=t JOIN public.delivery_platforms p ON p.id=e.platform_id AND p.tenant_id=t
  WHERE e.tenant_id=t AND e.deleted_at IS NULL AND e.entry_date>=start_d AND e.entry_date<end_d
   AND (q='' OR strpos(lower(concat_ws(' ',d.full_name_ar,d.full_name_en,d.driver_code,p.name_ar,p.name_en)),lower(q))>0)
  ORDER BY e.entry_date DESC,e.id LIMIT p_size OFFSET ((p_page::bigint-1)*p_size)
 ) x;
 RETURN jsonb_build_object('rows',rows,'total',count_rows,'summary',stats);
END; $$;
CREATE OR REPLACE FUNCTION public.list_order_entries(p_month text,p_search text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 50,p_export boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.list_orders(p_month,p_search,p_page,p_page_size,p_export); $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA operations_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION operations_private.save_order(jsonb,uuid,timestamptz,boolean),operations_private.list_orders(text,text,integer,integer,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.save_order_entry(jsonb,uuid,timestamptz),public.archive_order_entry(uuid,timestamptz),public.list_order_entries(text,text,integer,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_order_entry(jsonb,uuid,timestamptz),public.archive_order_entry(uuid,timestamptz),public.list_order_entries(text,text,integer,integer,boolean) TO authenticated;
-- Writes now require atomic audit + tenant references + preparation guard. Import callers use the same RPC.
REVOKE INSERT,UPDATE,DELETE ON public.daily_order_entries FROM PUBLIC,anon,authenticated;


CREATE OR REPLACE FUNCTION operations_private.platform_mutation(p_action text,p_input jsonb,p_id uuid,p_expected timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid; old_row public.delivery_platforms; new_row public.delivery_platforms; v_rate numeric; v_sort integer;
BEGIN
 t:=operations_private.actor(CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END);
 IF p_action NOT IN ('save','deactivate') THEN RAISE EXCEPTION 'PLATFORM_INVALID_ACTION'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO old_row FROM public.delivery_platforms WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'PLATFORM_NOT_FOUND'; END IF;
  IF p_expected IS NULL OR old_row.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'PLATFORM_STALE_VERSION'; END IF;
 END IF;
 IF p_action='deactivate' THEN
  IF p_id IS NULL THEN RAISE EXCEPTION 'PLATFORM_NOT_FOUND'; END IF;
  UPDATE public.delivery_platforms SET is_active=false,updated_by=auth.uid() WHERE id=p_id RETURNING * INTO new_row;
 ELSE
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR coalesce(p_input->>'code','') !~ '^[a-zA-Z0-9_-]{2,40}$' OR length(btrim(coalesce(p_input->>'name_ar','')))<2 OR length(p_input->>'name_ar')>120 OR length(coalesce(p_input->>'name_en',''))>120 THEN RAISE EXCEPTION 'PLATFORM_INVALID_NAME'; END IF;
  IF old_row.id IS NOT NULL AND old_row.code IS DISTINCT FROM p_input->>'code' THEN RAISE EXCEPTION 'PLATFORM_CODE_IMMUTABLE'; END IF;
  IF p_input->>'rate_type' IS NULL OR p_input->>'rate_type' NOT IN ('flat','distance_based','tiered','custom') THEN RAISE EXCEPTION 'PLATFORM_INVALID_RATE'; END IF;
  v_rate:=(p_input->>'rate_per_order')::numeric;v_sort:=coalesce((p_input->>'sort_order')::integer,100);
  IF (v_rate IS NOT NULL AND (v_rate<0 OR v_rate>9999.99 OR v_rate<>round(v_rate,2))) OR v_sort NOT BETWEEN 0 AND 9999 OR (nullif(p_input->>'brand_color','') IS NOT NULL AND p_input->>'brand_color' !~ '^#[0-9a-fA-F]{6}$') OR (nullif(p_input->>'api_base_url','') IS NOT NULL AND p_input->>'api_base_url' !~ '^https://[^/@]+') THEN RAISE EXCEPTION 'PLATFORM_INVALID_SETTINGS'; END IF;
  IF p_id IS NULL THEN INSERT INTO public.delivery_platforms(tenant_id,code,name_ar,created_by) VALUES(t,p_input->>'code',btrim(p_input->>'name_ar'),auth.uid()) RETURNING * INTO new_row; ELSE new_row:=old_row; END IF;
  UPDATE public.delivery_platforms SET name_ar=btrim(p_input->>'name_ar'),name_en=nullif(btrim(p_input->>'name_en'),''),brand_color=nullif(p_input->>'brand_color',''),rate_type=p_input->>'rate_type',rate_per_order=v_rate,api_base_url=nullif(p_input->>'api_base_url',''),sort_order=v_sort,is_active=coalesce((p_input->>'is_active')::boolean,true),updated_by=auth.uid() WHERE id=new_row.id RETURNING * INTO new_row;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,action,entity_type,entity_id,old_values,new_values) VALUES(t,auth.uid(),'platforms',CASE WHEN p_action='deactivate' THEN 'platform_deactivated' WHEN p_id IS NULL THEN 'platform_created' ELSE 'platform_updated' END,'delivery_platform',new_row.id,CASE WHEN old_row.id IS NOT NULL THEN to_jsonb(old_row)-'api_credentials' END,to_jsonb(new_row)-'api_credentials');
 RETURN jsonb_build_object('id',new_row.id,'updated_at',new_row.updated_at);
END; $$;
CREATE OR REPLACE FUNCTION public.save_delivery_platform(p_input jsonb,p_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,p_deactivate boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.platform_mutation(CASE WHEN p_deactivate THEN 'deactivate' ELSE 'save' END,p_input,p_id,p_expected_updated_at); $$;
CREATE OR REPLACE FUNCTION operations_private.platform_list(p_search text,p_page integer,p_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=operations_private.actor('read');q text:=left(btrim(coalesce(p_search,'')),200);total bigint;rows jsonb;stats jsonb;today date:=(now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
 IF p_page IS NULL OR p_page<1 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'PLATFORM_INVALID_PAGE'; END IF;
 SELECT count(*) INTO total FROM public.delivery_platforms WHERE tenant_id=t AND deleted_at IS NULL AND (q='' OR strpos(lower(concat_ws(' ',code,name_ar,name_en)),lower(q))>0);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sort_order,x.id),'[]') INTO rows FROM(SELECT id,code,name_ar,name_en,brand_color,is_active,rate_type,rate_per_order,api_base_url,sort_order,updated_at FROM public.delivery_platforms WHERE tenant_id=t AND deleted_at IS NULL AND (q='' OR strpos(lower(concat_ws(' ',code,name_ar,name_en)),lower(q))>0) ORDER BY sort_order,id LIMIT p_size OFFSET ((p_page::bigint-1)*p_size))x;
 SELECT jsonb_build_object('active',(SELECT count(*) FROM public.delivery_platforms WHERE tenant_id=t AND deleted_at IS NULL AND is_active),'todayOrders',(SELECT coalesce(sum(orders_delivered),0) FROM public.daily_order_entries WHERE tenant_id=t AND deleted_at IS NULL AND entry_date=today),'monthRevenue',(SELECT coalesce(sum(gross_revenue),0) FROM public.daily_order_entries WHERE tenant_id=t AND deleted_at IS NULL AND entry_date BETWEEN date_trunc('month',today)::date AND today),'outstanding',(SELECT coalesce(sum(outstanding_amount),0) FROM public.platform_payments WHERE tenant_id=t AND deleted_at IS NULL AND payment_status IN ('pending','partial','overdue'))) INTO stats;
 RETURN jsonb_build_object('rows',rows,'total',total,'summary',stats);
END; $$;
CREATE OR REPLACE FUNCTION public.list_delivery_platforms(p_search text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 50) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.platform_list(p_search,p_page,p_page_size); $$;
CREATE OR REPLACE FUNCTION operations_private.platform_detail(p_id uuid,p_tab text,p_month text,p_page integer,p_size integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=operations_private.actor('read');master jsonb;rows jsonb;total bigint;stats jsonb;start_d date;end_d date;today date:=(now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
 IF p_page IS NULL OR p_page<1 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 1000 OR p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'PLATFORM_INVALID_PAGE'; END IF;
 start_d:=(p_month||'-01')::date;end_d:=(start_d+interval '1 month')::date;
 SELECT jsonb_build_object('id',id,'name_ar',name_ar,'name_en',name_en,'code',code,'is_active',is_active,'updated_at',updated_at) INTO master FROM public.delivery_platforms WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL;
 IF master IS NULL THEN RAISE EXCEPTION 'PLATFORM_NOT_FOUND'; END IF;
 IF p_tab='daily' THEN
  SELECT count(DISTINCT entry_date) INTO total FROM public.daily_order_entries WHERE tenant_id=t AND platform_id=p_id AND deleted_at IS NULL AND entry_date>=start_d AND entry_date<end_d;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date DESC),'[]') INTO rows FROM(SELECT entry_date,sum(orders_delivered) orders_delivered,sum(orders_failed) orders_failed,sum(orders_returned) orders_returned,sum(orders_cancelled) orders_cancelled,sum(gross_revenue) gross_revenue FROM public.daily_order_entries WHERE tenant_id=t AND platform_id=p_id AND deleted_at IS NULL AND entry_date>=start_d AND entry_date<end_d GROUP BY entry_date ORDER BY entry_date DESC LIMIT p_size OFFSET ((p_page::bigint-1)*p_size))x;
 ELSIF p_tab='monthly' THEN
  SELECT count(*) INTO total FROM(SELECT period_year,period_month FROM public.monthly_driver_orders WHERE tenant_id=t AND platform_id=p_id AND deleted_at IS NULL GROUP BY period_year,period_month)x;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.period_year DESC,x.period_month DESC),'[]') INTO rows FROM(SELECT period_year,period_month,sum(total_delivered) total_delivered,sum(total_revenue) total_revenue FROM public.monthly_driver_orders WHERE tenant_id=t AND platform_id=p_id AND deleted_at IS NULL GROUP BY period_year,period_month ORDER BY period_year DESC,period_month DESC LIMIT p_size OFFSET ((p_page::bigint-1)*p_size))x;
 ELSIF p_tab='payments' THEN
  SELECT count(*) INTO total FROM public.platform_payments WHERE tenant_id=t AND platform_id=p_id AND deleted_at IS NULL;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.period_year DESC,x.period_month DESC,x.id),'[]') INTO rows FROM(SELECT id,period_year,period_month,expected_amount,received_amount,outstanding_amount,payment_status,payment_date,payment_ref,notes,updated_at FROM public.platform_payments WHERE tenant_id=t AND platform_id=p_id AND deleted_at IS NULL ORDER BY period_year DESC,period_month DESC,id LIMIT p_size OFFSET ((p_page::bigint-1)*p_size))x;
 ELSIF p_tab='drivers' THEN
  SELECT count(*) INTO total FROM public.drivers WHERE tenant_id=t AND primary_platform_id=p_id AND deleted_at IS NULL AND status IN ('active','on_leave');
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.full_name_ar,x.id),'[]') INTO rows FROM(SELECT id,full_name_ar,full_name_en,driver_code FROM public.drivers WHERE tenant_id=t AND primary_platform_id=p_id AND deleted_at IS NULL AND status IN ('active','on_leave') ORDER BY full_name_ar,id LIMIT p_size OFFSET ((p_page::bigint-1)*p_size))x;
 ELSE RAISE EXCEPTION 'PLATFORM_INVALID_TAB'; END IF;
 SELECT jsonb_build_object('todayOrders',coalesce(sum(orders_delivered),0),'todayRevenue',coalesce(sum(gross_revenue),0),'outstanding',(SELECT coalesce(sum(outstanding_amount),0) FROM public.platform_payments WHERE tenant_id=t AND platform_id=p_id AND deleted_at IS NULL)) INTO stats FROM public.daily_order_entries WHERE tenant_id=t AND platform_id=p_id AND deleted_at IS NULL AND entry_date=today;
 RETURN jsonb_build_object('platform',master,'rows',rows,'total',total,'summary',stats);
END; $$;
CREATE OR REPLACE FUNCTION public.get_delivery_platform_detail(p_id uuid,p_tab text DEFAULT 'daily',p_month text DEFAULT to_char(now(),'YYYY-MM'),p_page integer DEFAULT 1,p_page_size integer DEFAULT 50) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.platform_detail(p_id,p_tab,p_month,p_page,p_page_size); $$;
REVOKE ALL ON FUNCTION operations_private.platform_mutation(text,jsonb,uuid,timestamptz),operations_private.platform_list(text,integer,integer),operations_private.platform_detail(uuid,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION operations_private.platform_mutation(text,jsonb,uuid,timestamptz),operations_private.platform_list(text,integer,integer),operations_private.platform_detail(uuid,text,text,integer,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.save_delivery_platform(jsonb,uuid,timestamptz,boolean),public.list_delivery_platforms(text,integer,integer),public.get_delivery_platform_detail(uuid,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_delivery_platform(jsonb,uuid,timestamptz,boolean),public.list_delivery_platforms(text,integer,integer),public.get_delivery_platform_detail(uuid,text,text,integer,integer) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.delivery_platforms FROM PUBLIC,anon,authenticated;


CREATE OR REPLACE FUNCTION operations_private.payment_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=operations_private.actor('update');pl uuid:=(p->>'platform_id')::uuid;yy integer:=(p->>'period_year')::integer;mm integer:=(p->>'period_month')::integer;old_row public.platform_payments;new_row public.platform_payments;expected numeric;received numeric;state text;
BEGIN
 IF yy IS NULL OR yy NOT BETWEEN 2000 AND 2200 OR mm IS NULL OR mm NOT BETWEEN 1 AND 12 OR NOT EXISTS(SELECT 1 FROM public.delivery_platforms WHERE id=pl AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PLATFORM_PAYMENT_INVALID_PERIOD'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':platform-payment:'||pl::text||':'||yy::text||'-'||mm::text,0));
 SELECT * INTO old_row FROM public.platform_payments WHERE tenant_id=t AND platform_id=pl AND period_year=yy AND period_month=mm AND deleted_at IS NULL FOR UPDATE;
 IF old_row.id IS NOT NULL AND ((p->>'expected_updated_at')::timestamptz IS NULL OR old_row.updated_at IS DISTINCT FROM (p->>'expected_updated_at')::timestamptz) THEN RAISE EXCEPTION 'PLATFORM_PAYMENT_EXISTS_OR_CHANGED: open the existing period before correcting it'; END IF;
 IF old_row.id IS NULL AND p->>'expected_updated_at' IS NOT NULL THEN RAISE EXCEPTION 'PLATFORM_PAYMENT_NOT_FOUND'; END IF;
 expected:=(p->>'expected_amount')::numeric;received:=(p->>'received_amount')::numeric;
 IF expected IS NULL OR received IS NULL OR expected<0 OR received<0 OR expected>9999999999.99 OR received>expected OR expected<>round(expected,2) OR received<>round(received,2) THEN RAISE EXCEPTION 'PLATFORM_PAYMENT_INVALID_AMOUNT'; END IF;
 IF received>0 AND nullif(p->>'payment_date','') IS NULL THEN RAISE EXCEPTION 'PLATFORM_PAYMENT_DATE_REQUIRED'; END IF;
 IF length(coalesce(p->>'payment_ref',''))>120 OR length(coalesce(p->>'notes',''))>1000 THEN RAISE EXCEPTION 'PLATFORM_PAYMENT_INVALID_TEXT'; END IF;
 state:=CASE WHEN p->>'payment_status' IN ('overdue','disputed') THEN p->>'payment_status' WHEN expected>0 AND received>=expected THEN 'paid' WHEN received>0 THEN 'partial' ELSE 'pending' END;
 IF old_row.id IS NULL THEN INSERT INTO public.platform_payments(tenant_id,platform_id,period_year,period_month,created_by) VALUES(t,pl,yy,mm,auth.uid()) RETURNING * INTO new_row; ELSE new_row:=old_row; END IF;
 UPDATE public.platform_payments SET expected_amount=expected,received_amount=received,outstanding_amount=expected-received,payment_status=state::public.payment_status,payment_date=nullif(p->>'payment_date','')::date,payment_ref=nullif(btrim(p->>'payment_ref'),''),notes=nullif(btrim(p->>'notes'),''),updated_by=auth.uid() WHERE id=new_row.id RETURNING * INTO new_row;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,action,entity_type,entity_id,old_values,new_values) VALUES(t,auth.uid(),'platforms','platform_payment_recorded','platform_payments',new_row.id,CASE WHEN old_row.id IS NOT NULL THEN to_jsonb(old_row) END,to_jsonb(new_row));
 RETURN jsonb_build_object('id',new_row.id,'updated_at',new_row.updated_at);
END; $$;
CREATE OR REPLACE FUNCTION public.save_platform_payment(p_input jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.payment_save(p_input); $$;
CREATE OR REPLACE FUNCTION operations_private.platform_export(p_id uuid,p_month text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=operations_private.actor('export');result jsonb;start_d date;end_d date;
BEGIN
 IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.delivery_platforms WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PLATFORM_NOT_FOUND'; END IF;
 IF p_month IS NOT NULL THEN IF p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'PLATFORM_INVALID_PAGE'; END IF;start_d:=(p_month||'-01')::date;end_d:=(start_d+interval '1 month')::date; END IF;
 SELECT jsonb_build_object('platforms',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY sort_order,id),'[]') FROM(SELECT id,code,name_ar,name_en,is_active,rate_type,rate_per_order,sort_order FROM public.delivery_platforms WHERE tenant_id=t AND deleted_at IS NULL AND (p_id IS NULL OR id=p_id))x),'payments',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY period_year DESC,period_month DESC,id),'[]') FROM(SELECT a.id,a.period_year,a.period_month,a.expected_amount,a.received_amount,a.outstanding_amount,a.payment_status,a.payment_date,jsonb_build_object('name_ar',p.name_ar,'name_en',p.name_en) platform FROM public.platform_payments a JOIN public.delivery_platforms p ON p.id=a.platform_id AND p.tenant_id=t WHERE a.tenant_id=t AND a.deleted_at IS NULL AND (p_id IS NULL OR a.platform_id=p_id))x),'entries',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY entry_date DESC,id),'[]') FROM(SELECT e.id,e.entry_date,e.shift_label,e.orders_delivered,e.orders_failed,e.orders_returned,e.orders_cancelled,e.gross_revenue,jsonb_build_object('full_name_ar',d.full_name_ar,'full_name_en',d.full_name_en) driver FROM public.daily_order_entries e JOIN public.drivers d ON d.id=e.driver_id AND d.tenant_id=t WHERE e.tenant_id=t AND e.deleted_at IS NULL AND p_id IS NOT NULL AND e.platform_id=p_id AND (start_d IS NULL OR (e.entry_date>=start_d AND e.entry_date<end_d)))x)) INTO result;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.export_delivery_platform_data(p_id uuid DEFAULT NULL,p_month text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.platform_export(p_id,p_month); $$;
REVOKE ALL ON FUNCTION operations_private.payment_save(jsonb),operations_private.platform_export(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION operations_private.payment_save(jsonb),operations_private.platform_export(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_platform_payment(jsonb),public.export_delivery_platform_data(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_platform_payment(jsonb),public.export_delivery_platform_data(uuid,text) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.platform_payments FROM PUBLIC,anon,authenticated;
DO $acl$
DECLARE tbl text;cols text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['daily_order_entries','delivery_platforms','platform_payments'] LOOP
  SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid=('public.'||tbl)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%s),UPDATE (%s) ON public.%I FROM PUBLIC,anon,authenticated',cols,cols,tbl);
 END LOOP;
END;
$acl$;
CREATE OR REPLACE FUNCTION operations_private.export_orders(p_month text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=operations_private.actor('export');start_d date;end_d date;rows jsonb;
BEGIN
 IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'ORDER_INVALID_PAGE'; END IF;
 start_d:=(p_month||'-01')::date;end_d:=(start_d+interval '1 month')::date;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date DESC,x.id),'[]') INTO rows FROM(SELECT e.id,e.entry_date,e.shift_label,e.orders_delivered,e.orders_failed,e.orders_returned,e.orders_cancelled,e.total_distance_km,e.gross_revenue,e.platform_reported_revenue,e.revenue_variance,e.is_locked,jsonb_build_object('full_name_ar',d.full_name_ar,'full_name_en',d.full_name_en) driver,jsonb_build_object('name_ar',p.name_ar,'name_en',p.name_en) platform FROM public.daily_order_entries e JOIN public.drivers d ON d.id=e.driver_id AND d.tenant_id=t JOIN public.delivery_platforms p ON p.id=e.platform_id AND p.tenant_id=t WHERE e.tenant_id=t AND e.deleted_at IS NULL AND e.entry_date>=start_d AND e.entry_date<end_d)x;
 RETURN rows;
END; $$;
CREATE OR REPLACE FUNCTION public.export_order_entries(p_month text) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT operations_private.export_orders(p_month); $$;
REVOKE ALL ON FUNCTION operations_private.export_orders(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION operations_private.export_orders(text) TO authenticated;
REVOKE ALL ON FUNCTION public.export_order_entries(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.export_order_entries(text) TO authenticated;
COMMIT;
