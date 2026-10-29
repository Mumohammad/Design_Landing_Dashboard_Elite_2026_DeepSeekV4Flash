-- Expose the e-invoicing (ZATCA) status on the paged invoice list so the
-- invoices table can show the Daftra-style e-invoice badge and the
-- "Send to ZATCA" action without a second read.
BEGIN;
CREATE OR REPLACE FUNCTION public.read_my_invoice_page(p_search text DEFAULT '',p_status text DEFAULT 'all',p_page integer DEFAULT 1,p_page_size integer DEFAULT 50,p_export boolean DEFAULT false)
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
 SELECT i.id,i.issue_date,jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'invoice_type',i.invoice_type,'issue_date',i.issue_date,'due_date',i.due_date,'show_due_date',i.show_due_date,'status',i.status,'subtotal',i.subtotal,'discount',i.discount,'vat_amount',i.vat_amount,'total',i.total,'currency',i.currency,'updated_at',i.updated_at,'customer_id',i.customer_id,'supplier_id',i.supplier_id,'vat_rate',i.vat_rate,'notes',i.notes,'zatca_status',i.zatca_status,'customer_name',c.name_ar,'customer_name_en',c.name_en,'supplier_name',s.name_ar,'supplier_name_en',s.name_en) row
 FROM public.invoices i LEFT JOIN public.customers c ON c.id=i.customer_id AND c.tenant_id=t LEFT JOIN public.suppliers s ON s.id=i.supplier_id AND s.tenant_id=t
 WHERE i.tenant_id=t AND i.deleted_at IS NULL AND (p_status='all' OR i.status::text=p_status) AND (p_search='' OR strpos(lower(concat_ws(' ',i.invoice_number,i.status::text,c.name_ar,c.name_en,s.name_ar,s.name_en)),lower(p_search))>0)
 ORDER BY i.issue_date DESC,i.id DESC LIMIT CASE WHEN p_export THEN 10000 ELSE p_page_size END OFFSET CASE WHEN p_export THEN 0 ELSE(p_page-1)*p_page_size END
 )q;
 RETURN jsonb_build_object('rows',rows,'total',n,'page',CASE WHEN p_export THEN 1 ELSE p_page END,'page_size',p_page_size,'summary',summary);
END $$;
REVOKE ALL ON FUNCTION public.read_my_invoice_page(text,text,integer,integer,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_invoice_page(text,text,integer,integer,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
