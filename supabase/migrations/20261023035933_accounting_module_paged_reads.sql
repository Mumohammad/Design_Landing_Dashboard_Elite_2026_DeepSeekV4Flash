BEGIN;
-- Equivalent scalar subqueries are evaluated once per scan instead of per record.
-- ALTER POLICY changes only USING; existing roles, command and policy mode remain intact.
ALTER POLICY sel_bank_accounts_tenant ON public.bank_accounts USING (tenant_id=(SELECT public.get_my_tenant_id()) AND deleted_at IS NULL AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_customers_tenant ON public.customers USING (tenant_id=(SELECT public.get_my_tenant_id()) AND deleted_at IS NULL AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_suppliers_tenant ON public.suppliers USING (tenant_id=(SELECT public.get_my_tenant_id()) AND deleted_at IS NULL AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_finance_payments_tenant ON public.finance_payments USING (tenant_id=(SELECT public.get_my_tenant_id()) AND deleted_at IS NULL AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_allocations_tenant ON public.payment_allocations USING (tenant_id=(SELECT public.get_my_tenant_id()) AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_payables_tenant ON public.payables USING (tenant_id=(SELECT public.get_my_tenant_id()) AND deleted_at IS NULL AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_vat_input_tenant ON public.vat_input_ledger USING (tenant_id=(SELECT public.get_my_tenant_id()) AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_vat_output_tenant ON public.vat_output_ledger USING (tenant_id=(SELECT public.get_my_tenant_id()) AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY vata_sel_tenant ON public.vat_adjustments USING (tenant_id=(SELECT public.get_my_tenant_id()) AND deleted_at IS NULL AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY vatp_sel_tenant ON public.vat_periods USING (tenant_id=(SELECT public.get_my_tenant_id()) AND deleted_at IS NULL AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_accounting_periods_tenant ON public.accounting_periods USING (tenant_id=(SELECT public.get_my_tenant_id()) AND deleted_at IS NULL AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_financial_events_tenant ON public.financial_events USING (tenant_id=(SELECT public.get_my_tenant_id()) AND (SELECT public.user_has_permission('accounting','read')));
ALTER POLICY sel_zatca_transmissions_tenant ON public.zatca_transmissions USING (tenant_id=(SELECT public.get_my_tenant_id()) AND (SELECT public.user_has_permission('accounting','read')));
-- Read-only pages use the caller's RLS and permission/MFA contract. No tenant argument.
CREATE OR REPLACE FUNCTION public.read_my_accounting_page(p_kind text,p_search text DEFAULT '',p_page integer DEFAULT 1,p_page_size integer DEFAULT 25,p_party uuid DEFAULT NULL,p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $accounting$
DECLARE t uuid:=public.get_my_tenant_id(); q text; result jsonb; summary jsonb; total bigint;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR public.user_has_permission('accounting','read') IS NOT TRUE OR (p_export AND public.user_has_permission('accounting','export') IS NOT TRUE) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Accounting read access denied'; END IF;
 IF p_kind IS NULL OR p_page IS NULL OR p_page<1 OR p_page>1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_search IS NULL OR length(p_search)>200 OR p_export IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid accounting page request'; END IF;
 CASE p_kind
 WHEN 'payments' THEN q:=$q$SELECT p.id,p.payment_ref,p.direction,p.payment_date,p.amount::text,p.method,p.reference,p.status,
  CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('name_ar',c.name_ar,'name_en',c.name_en) END customers,
  CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('name_ar',s.name_ar,'name_en',s.name_en) END suppliers,
  CASE WHEN b.id IS NOT NULL THEN jsonb_build_object('bank_name',b.bank_name) END bank_accounts,
  coalesce(alloc.items,'[]'::jsonb) payment_allocations,
  greatest(p.amount-coalesce(alloc.total,0),0)::text unallocated_amount,
  p.payment_date::text||' '||p.created_at::text||' '||p.id::text sort_key
  FROM public.finance_payments p LEFT JOIN (SELECT finance_payment_id,jsonb_agg(jsonb_build_object('id',id)) items,sum(allocated_amount) total FROM public.payment_allocations WHERE tenant_id=$1 GROUP BY finance_payment_id) alloc ON alloc.finance_payment_id=p.id LEFT JOIN public.customers c ON c.id=p.customer_id AND c.tenant_id=$1
  LEFT JOIN public.suppliers s ON s.id=p.supplier_id AND s.tenant_id=$1 LEFT JOIN public.bank_accounts b ON b.id=p.bank_account_id AND b.tenant_id=$1
  WHERE p.tenant_id=$1 AND p.deleted_at IS NULL AND strpos(lower(concat_ws(' ',p.payment_ref,p.reference,c.name_ar,c.name_en,s.name_ar,s.name_en)),lower($2))>0$q$;
 WHEN 'open_ar','open_ap','receivables','payables' THEN
  q:=format($q$SELECT r.id,r.invoice_ref,r.invoice_date,r.due_date,r.amount::text,r.vat_amount::text,r.total_amount::text,r.paid_amount::text,
  (CASE WHEN %1$L IN ('open_ar','open_ap') THEN greatest(r.total_amount-r.paid_amount-coalesce(reserved.total,0),0) ELSE r.total_amount-r.paid_amount END)::text outstanding,
  r.status,r.%3$I,coalesce(c.name_ar,c.name_en,'') party_name,c.name_ar party_name_ar,c.name_en party_name_en,
  r.due_date::text||' '||r.id::text sort_key FROM public.%4$I r LEFT JOIN public.%5$I c ON c.id=r.%3$I AND c.tenant_id=$1
  LEFT JOIN (SELECT a.%2$I target_id,sum(a.allocated_amount) total FROM public.payment_allocations a JOIN public.finance_payments p ON p.id=a.finance_payment_id AND p.tenant_id=$1 AND p.status='pending' AND p.deleted_at IS NULL WHERE a.tenant_id=$1 GROUP BY a.%2$I) reserved ON reserved.target_id=r.id
  WHERE r.tenant_id=$1 AND r.deleted_at IS NULL AND (%1$L NOT IN ('open_ar','open_ap') OR (r.status IN ('open','partially_paid','overdue') AND r.total_amount-r.paid_amount-coalesce(reserved.total,0)>0))
  AND ($3 IS NULL OR r.%3$I=$3) AND strpos(lower(concat_ws(' ',r.invoice_ref,c.name_ar,c.name_en)),lower($2))>0$q$,
  p_kind,CASE WHEN p_kind IN ('open_ar','receivables') THEN 'receivable_id' ELSE 'payable_id' END,
  CASE WHEN p_kind IN ('open_ar','receivables') THEN 'customer_id' ELSE 'supplier_id' END,
  CASE WHEN p_kind IN ('open_ar','receivables') THEN 'receivables' ELSE 'payables' END,
  CASE WHEN p_kind IN ('open_ar','receivables') THEN 'customers' ELSE 'suppliers' END);
 WHEN 'customers','suppliers' THEN q:=format($q$SELECT id,name_ar,name_en,coalesce(name_en,name_ar,'')||' '||id::text sort_key FROM public.%I WHERE tenant_id=$1 AND deleted_at IS NULL AND is_active AND strpos(lower(concat_ws(' ',name_ar,name_en)),lower($2))>0$q$,p_kind);
 WHEN 'accounts','asset_accounts' THEN q:=format($q$SELECT id,account_code,name_ar,name_en,account_type,normal_balance,account_code||' '||id::text sort_key FROM public.chart_of_accounts WHERE tenant_id=$1 AND deleted_at IS NULL AND is_active %s AND strpos(lower(concat_ws(' ',account_code,name_ar,name_en)),lower($2))>0$q$,CASE WHEN p_kind='asset_accounts' THEN 'AND account_type=''asset''' ELSE '' END);
 WHEN 'trial' THEN q:=$q$SELECT ca.account_code,ca.name_ar,ca.name_en,ca.account_type,ca.normal_balance,sum(l.debit_amount)::text total_debit,sum(l.credit_amount)::text total_credit,(sum(l.debit_amount)-sum(l.credit_amount))::text net_balance,ca.account_code sort_key
  FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id AND j.tenant_id=$1
  JOIN public.chart_of_accounts ca ON ca.id=l.account_id AND ca.tenant_id=$1
  WHERE l.tenant_id=$1 AND j.status IN ('posted','reversed') AND j.deleted_at IS NULL AND strpos(lower(concat_ws(' ',ca.account_code,ca.name_ar,ca.name_en)),lower($2))>0
  GROUP BY ca.account_code,ca.name_ar,ca.name_en,ca.account_type,ca.normal_balance$q$;
 WHEN 'vat_output','vat_input','vat_review' THEN q:=format($q$SELECT id,period_year,period_month,invoice_ref,invoice_date,vat_base_amount::text,vat_rate::text,vat_amount::text,%s invoice_date::text||' '||id::text sort_key
  FROM public.%I WHERE tenant_id=$1 %s AND strpos(lower(invoice_ref),lower($2))>0$q$,
  CASE WHEN p_kind='vat_output' THEN '' ELSE 'vat_recoverability,supplier_id,' END,
  CASE WHEN p_kind='vat_output' THEN 'vat_output_ledger' ELSE 'vat_input_ledger' END,
  CASE WHEN p_kind='vat_review' THEN 'AND vat_recoverability=''pending_review''' ELSE '' END);
 WHEN 'vat_adjustments' THEN q:=$q$SELECT id,period_year,period_month,adjustment_type,direction,base_amount::text,vat_amount::text,reason,status,lpad(period_year::text,4,'0')||lpad(period_month::text,2,'0')||' '||id::text sort_key FROM public.vat_adjustments WHERE tenant_id=$1 AND deleted_at IS NULL AND strpos(lower(concat_ws(' ',reason,adjustment_type,period_year,period_month)),lower($2))>0$q$;
 WHEN 'vat_periods' THEN q:=$q$SELECT id,period_year,period_month,status,lpad(period_year::text,4,'0')||lpad(period_month::text,2,'0') sort_key FROM public.vat_periods WHERE tenant_id=$1 AND deleted_at IS NULL AND strpos(period_year::text||'-'||lpad(period_month::text,2,'0'),$2)>0$q$;
 WHEN 'vat_recon','vat_months' THEN q:=$q$SELECT period_id,period_year,period_month,period_status,output_vat::text,recoverable_input_vat::text,non_recoverable_vat::text,pending_review_vat::text,adjustments_output::text,adjustments_input::text,pending_review_rows,net_position::text,lpad(period_year::text,4,'0')||lpad(period_month::text,2,'0') sort_key FROM public.vat_reconciliation WHERE tenant_id=$1 AND strpos(period_year::text||'-'||lpad(period_month::text,2,'0'),$2)>0$q$;
 WHEN 'periods' THEN q:=$q$SELECT id,period_year,period_month,status,opened_at,closed_at,reopen_reason,lpad(period_year::text,4,'0')||lpad(period_month::text,2,'0') sort_key FROM public.accounting_periods WHERE tenant_id=$1 AND deleted_at IS NULL AND strpos(lower(concat_ws(' ',period_year,period_month,status,reopen_reason)),lower($2))>0$q$;
 WHEN 'events' THEN q:=$q$SELECT id,idempotency_key,source_type,event_type,processing_status,event_date,created_at,processed_at,error_message,created_at::text||' '||id::text sort_key FROM public.financial_events WHERE tenant_id=$1 AND strpos(lower(concat_ws(' ',idempotency_key,source_type,event_type,processing_status)),lower($2))>0$q$;
 WHEN 'zatca' THEN q:=$q$SELECT id,doc_ref,doc_type,status,zatca_uuid,error_message,transmitted_at,created_at,response->>'sandbox' is_mock,created_at::text||' '||id::text sort_key FROM public.zatca_transmissions WHERE tenant_id=$1 AND strpos(lower(concat_ws(' ',doc_ref,doc_type,status,zatca_uuid)),lower($2))>0$q$;
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid accounting page request';
 END CASE;
 EXECUTE 'SELECT count(*) FROM ('||q||') r' INTO total USING t,btrim(p_search),p_party;
 IF p_export AND total>100000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Narrow the accounting export search'; END IF;
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r)-''sort_key'' ORDER BY sort_key '||CASE WHEN p_kind IN ('open_ar','open_ap','receivables','payables','accounts','asset_accounts','customers','suppliers','trial','vat_review') THEN 'ASC' ELSE 'DESC' END||'),''[]''::jsonb) FROM (SELECT * FROM ('||q||') source ORDER BY sort_key '||CASE WHEN p_kind IN ('open_ar','open_ap','receivables','payables','accounts','asset_accounts','customers','suppliers','trial','vat_review') THEN 'ASC' ELSE 'DESC' END||' LIMIT $4 OFFSET $5) r'
 INTO result USING t,btrim(p_search),p_party,CASE WHEN p_export THEN total ELSE p_page_size END,CASE WHEN p_export THEN 0 ELSE (p_page::bigint-1)*p_page_size END;
 IF p_kind='payments' THEN
  SELECT jsonb_build_object('payment_count',count(*),'inflow',coalesce(sum(p.amount) FILTER(WHERE p.direction='in' AND p.status<>'void'),0)::text,
   'outflow',coalesce(sum(p.amount) FILTER(WHERE p.direction='out' AND p.status<>'void'),0)::text,
   'unallocated',coalesce(sum(greatest(p.amount-coalesce(alloc.total,0),0)) FILTER(WHERE p.status<>'void'),0)::text,
   'outstanding_ar',(SELECT coalesce(sum(r.total_amount-r.paid_amount),0)::text FROM public.receivables r WHERE r.tenant_id=t AND r.deleted_at IS NULL AND r.status IN('open','partially_paid','overdue')),
   'outstanding_ap',(SELECT coalesce(sum(r.total_amount-r.paid_amount),0)::text FROM public.payables r WHERE r.tenant_id=t AND r.deleted_at IS NULL AND r.status IN('open','partially_paid','overdue')))
  INTO summary FROM public.finance_payments p LEFT JOIN (SELECT finance_payment_id,sum(allocated_amount) total FROM public.payment_allocations WHERE tenant_id=t GROUP BY finance_payment_id) alloc ON alloc.finance_payment_id=p.id WHERE p.tenant_id=t AND p.deleted_at IS NULL;
 END IF;
 RETURN jsonb_build_object('rows',result,'total',total,'page',p_page,'page_size',p_page_size,'summary',summary);
END $accounting$;
REVOKE ALL ON FUNCTION public.read_my_accounting_page(text,text,integer,integer,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_my_accounting_page(text,text,integer,integer,uuid,boolean) TO authenticated;
COMMIT;
