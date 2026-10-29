-- Complete caller-bound invoice pages/options and replay-safe application draft saves.
-- No existing invoice or permission row is rewritten. Legacy draft RPC remains
-- authenticated for compatibility; the application uses the receipt-bearing RPC.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE SCHEMA invoice_workflow_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA invoice_workflow_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE invoice_workflow_private.draft_receipts(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),actor_id uuid NOT NULL,request_id uuid NOT NULL,
 payload_hash text NOT NULL,response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tenant_id,actor_id,request_id)
);
ALTER TABLE invoice_workflow_private.draft_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoice_workflow_private.draft_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION invoice_workflow_private.immutable_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'INV_RECEIPT_IMMUTABLE'; END $$;
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON invoice_workflow_private.draft_receipts FOR EACH ROW EXECUTE FUNCTION invoice_workflow_private.immutable_receipt();
REVOKE ALL ON FUNCTION invoice_workflow_private.immutable_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_my_invoice_draft(p_input jsonb,p_invoice_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();a uuid:=auth.uid();h text;r invoice_workflow_private.draft_receipts%ROWTYPE;response jsonb;
BEGIN
 IF t IS NULL OR a IS NULL OR NOT public.user_has_permission('invoices',CASE WHEN p_invoice_id IS NULL THEN 'create' ELSE 'update' END) THEN RAISE EXCEPTION 'AUTH007: invoice permission required';END IF;
 IF p_request_id IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'INV002: draft request identity and input required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-draft:'||t::text||':'||a::text||':'||p_request_id::text,0));
 h:=encode(extensions.digest(jsonb_build_object('input',p_input,'invoice_id',p_invoice_id,'expected_updated_at',to_char(p_expected_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'sha256'),'hex');
 SELECT * INTO r FROM invoice_workflow_private.draft_receipts WHERE tenant_id=t AND actor_id=a AND request_id=p_request_id;
 IF FOUND THEN
  IF r.payload_hash<>h THEN RAISE EXCEPTION 'INV015: draft request identifies different details; reload before a new request';END IF;
  RETURN r.response||jsonb_build_object('replayed',true);
 END IF;
 response:=public.save_invoice_draft(p_input,p_invoice_id,p_expected_updated_at);
 INSERT INTO invoice_workflow_private.draft_receipts(tenant_id,actor_id,request_id,payload_hash,response) VALUES(t,a,p_request_id,h,response);
 RETURN response||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.save_my_invoice_draft(jsonb,uuid,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_my_invoice_draft(jsonb,uuid,timestamptz,uuid) TO authenticated;
CREATE FUNCTION public.read_my_invoice_page(p_search text DEFAULT '',p_status text DEFAULT 'all',p_page integer DEFAULT 1,p_page_size integer DEFAULT 50,p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();n bigint;summary jsonb;rows jsonb;
BEGIN
 IF t IS NULL OR auth.uid() IS NULL OR NOT public.user_has_permission('invoices','read') OR (p_export AND NOT public.user_has_permission('invoices','export')) THEN RAISE EXCEPTION 'AUTH007: invoice read/export permission required';END IF;
 IF p_search IS NULL OR length(p_search)>200 OR p_status IS NULL OR p_status NOT IN('all','draft','issued','finalized','paid','partially_paid','overdue','cancelled','credited') OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_export IS NULL THEN RAISE EXCEPTION 'INV002: invalid invoice page request';END IF;
 SELECT jsonb_build_object('total',count(*),'drafts',count(*) FILTER(WHERE status='draft'),'finalized',count(*) FILTER(WHERE status='finalized'),'value_sar',round(coalesce(sum(total) FILTER(WHERE currency='SAR' AND status NOT IN('cancelled','credited')),0),2)::text) INTO summary FROM public.invoices WHERE tenant_id=t AND deleted_at IS NULL;
 SELECT count(*) INTO n FROM public.invoices i LEFT JOIN public.customers c ON c.id=i.customer_id AND c.tenant_id=t LEFT JOIN public.suppliers s ON s.id=i.supplier_id AND s.tenant_id=t
 WHERE i.tenant_id=t AND i.deleted_at IS NULL AND (p_status='all' OR i.status::text=p_status) AND (p_search='' OR strpos(lower(concat_ws(' ',i.invoice_number,i.status::text,c.name_ar,c.name_en,s.name_ar,s.name_en)),lower(p_search))>0);
 IF p_export AND n>10000 THEN RAISE EXCEPTION 'INV_EXPORT_LIMIT: narrow the invoice export search';END IF;
 SELECT coalesce(jsonb_agg(q.row ORDER BY q.issue_date DESC,q.id DESC),'[]'::jsonb) INTO rows FROM (
 SELECT i.id,i.issue_date,jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'invoice_type',i.invoice_type,'issue_date',i.issue_date,'due_date',i.due_date,'show_due_date',i.show_due_date,'status',i.status,'subtotal',i.subtotal,'discount',i.discount,'vat_amount',i.vat_amount,'total',i.total,'currency',i.currency,'updated_at',i.updated_at,'customer_id',i.customer_id,'supplier_id',i.supplier_id,'vat_rate',i.vat_rate,'notes',i.notes,'customer_name',c.name_ar,'customer_name_en',c.name_en,'supplier_name',s.name_ar,'supplier_name_en',s.name_en) row
 FROM public.invoices i LEFT JOIN public.customers c ON c.id=i.customer_id AND c.tenant_id=t LEFT JOIN public.suppliers s ON s.id=i.supplier_id AND s.tenant_id=t
 WHERE i.tenant_id=t AND i.deleted_at IS NULL AND (p_status='all' OR i.status::text=p_status) AND (p_search='' OR strpos(lower(concat_ws(' ',i.invoice_number,i.status::text,c.name_ar,c.name_en,s.name_ar,s.name_en)),lower(p_search))>0)
 ORDER BY i.issue_date DESC,i.id DESC LIMIT CASE WHEN p_export THEN 10000 ELSE p_page_size END OFFSET CASE WHEN p_export THEN 0 ELSE(p_page-1)*p_page_size END
 )q;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',CASE WHEN p_export THEN 1 ELSE p_page END,'page_size',p_page_size,'summary',summary);
END $$;
REVOKE ALL ON FUNCTION public.read_my_invoice_page(text,text,integer,integer,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_invoice_page(text,text,integer,integer,boolean) TO authenticated;
CREATE FUNCTION public.read_my_invoice_party_page(p_kind text,p_search text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();n bigint;rows jsonb;
BEGIN
 IF t IS NULL OR auth.uid() IS NULL OR NOT public.user_has_permission('invoices','read') OR NOT(public.user_has_permission('invoices','create') OR public.user_has_permission('invoices','update')) THEN RAISE EXCEPTION 'AUTH007: invoice editing permission required';END IF;
 IF p_kind IS NULL OR p_kind NOT IN('customers','suppliers') OR p_search IS NULL OR length(p_search)>200 OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INV002: invalid invoice party page';END IF;
 IF p_kind='customers' THEN
  SELECT count(*) INTO n FROM public.customers c WHERE tenant_id=t AND deleted_at IS NULL AND is_active AND(p_search='' OR strpos(lower(concat_ws(' ',customer_code,name_ar,name_en)),lower(p_search))>0);
  SELECT coalesce(jsonb_agg(q.row ORDER BY q.code,q.id),'[]'::jsonb) INTO rows FROM(SELECT id,customer_code code,jsonb_build_object('id',id,'code',customer_code,'name_ar',name_ar,'name_en',name_en) row FROM public.customers WHERE tenant_id=t AND deleted_at IS NULL AND is_active AND(p_search='' OR strpos(lower(concat_ws(' ',customer_code,name_ar,name_en)),lower(p_search))>0) ORDER BY customer_code,id LIMIT p_page_size OFFSET(p_page-1)*p_page_size)q;
 ELSE
  SELECT count(*) INTO n FROM public.suppliers s WHERE tenant_id=t AND deleted_at IS NULL AND is_active AND(p_search='' OR strpos(lower(concat_ws(' ',supplier_code,name_ar,name_en)),lower(p_search))>0);
  SELECT coalesce(jsonb_agg(q.row ORDER BY q.code,q.id),'[]'::jsonb) INTO rows FROM(SELECT id,supplier_code code,jsonb_build_object('id',id,'code',supplier_code,'name_ar',name_ar,'name_en',name_en) row FROM public.suppliers WHERE tenant_id=t AND deleted_at IS NULL AND is_active AND(p_search='' OR strpos(lower(concat_ws(' ',supplier_code,name_ar,name_en)),lower(p_search))>0) ORDER BY supplier_code,id LIMIT p_page_size OFFSET(p_page-1)*p_page_size)q;
 END IF;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',p_page,'page_size',p_page_size);
END $$;
REVOKE ALL ON FUNCTION public.read_my_invoice_party_page(text,text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_invoice_party_page(text,text,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
