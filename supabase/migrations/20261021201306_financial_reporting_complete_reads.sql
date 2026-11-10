BEGIN;
-- Reporting only: preserve reversed originals in their posting period and the separate dated reversal.
-- Historical ledger data and imported examples are never rewritten.
CREATE OR REPLACE VIEW public.profit_loss
WITH (security_invoker = true) AS
SELECT
  je.tenant_id,
  EXTRACT(YEAR FROM je.entry_date)::int  AS period_year,
  EXTRACT(MONTH FROM je.entry_date)::int AS period_month,
  ca.account_code,
  ca.name_ar,
  ca.name_en,
  ca.account_type,
  ca.normal_balance,
  SUM(jel.debit_amount)  AS total_debit,
  SUM(jel.credit_amount) AS total_credit,
  -- P&L presentation sign: revenue positive, expenses negative, so
  -- net_balance = credit − debit (income is credit-normal, expense debit-normal
  -- but is shown as a deduction). Net Profit = SUM(net_balance) works directly.
  SUM(jel.credit_amount) - SUM(jel.debit_amount) AS net_balance
FROM public.journal_entry_lines jel
JOIN public.journal_entries je   ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id
JOIN public.chart_of_accounts ca ON ca.id = jel.account_id AND ca.tenant_id = je.tenant_id
WHERE je.status IN ('posted','reversed') AND je.deleted_at IS NULL
  AND ca.account_type IN ('income', 'expense')
GROUP BY
  je.tenant_id,
  EXTRACT(YEAR FROM je.entry_date),
  EXTRACT(MONTH FROM je.entry_date),
  ca.account_code, ca.name_ar, ca.name_en, ca.account_type, ca.normal_balance;

-- ---------------------------------------------------------------------
-- 2. Balance Sheet — cumulative balances as of each period end
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.balance_sheet
WITH (security_invoker = true) AS
WITH periods AS (
  SELECT DISTINCT
    je.tenant_id,
    EXTRACT(YEAR FROM je.entry_date)::int  AS period_year,
    EXTRACT(MONTH FROM je.entry_date)::int AS period_month
  FROM public.journal_entries je
  WHERE je.status IN ('posted','reversed') AND je.deleted_at IS NULL
),
balances AS (
  SELECT
    p.tenant_id,
    p.period_year,
    p.period_month,
    ca.account_code,
    ca.name_ar,
    ca.name_en,
    ca.account_type,
    ca.normal_balance,
    SUM(jel.debit_amount)  AS total_debit,
    SUM(jel.credit_amount) AS total_credit
  FROM periods p
  JOIN public.journal_entries je
    ON je.tenant_id = p.tenant_id
   AND je.status IN ('posted','reversed') AND je.deleted_at IS NULL
   AND je.entry_date <= (make_date(p.period_year, p.period_month, 1) + interval '1 month - 1 day')
  JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id AND jel.tenant_id = je.tenant_id
  JOIN public.chart_of_accounts ca    ON ca.id = jel.account_id AND ca.tenant_id = je.tenant_id
  WHERE ca.account_type IN ('asset', 'liability', 'equity')
  GROUP BY
    p.tenant_id, p.period_year, p.period_month,
    ca.account_code, ca.name_ar, ca.name_en, ca.account_type, ca.normal_balance
)
SELECT
  tenant_id,
  period_year,
  period_month,
  account_code,
  name_ar,
  name_en,
  account_type,
  normal_balance,
  total_debit,
  total_credit,
  -- Statement sign follows the accounting equation, including contra accounts.
  -- A credit-normal contra asset reduces assets; a debit-normal contra equity
  -- reduces equity. Normal balance remains descriptive metadata.
  CASE WHEN account_type = 'asset'
       THEN total_debit - total_credit
       ELSE total_credit - total_debit END AS balance
FROM balances
UNION ALL
SELECT p.tenant_id,p.period_year,p.period_month,'__UNCLOSED_RESULT__',
 'نتيجة الأرباح والخسائر غير المقفلة','Unclosed profit / loss',
 'equity'::public.account_type,'credit'::public.account_normal_balance,
 greatest(-sum(jel.credit_amount-jel.debit_amount),0),
 greatest(sum(jel.credit_amount-jel.debit_amount),0),sum(jel.credit_amount-jel.debit_amount)
FROM periods p
JOIN public.journal_entries je ON je.tenant_id=p.tenant_id
 AND je.status IN ('posted','reversed') AND je.deleted_at IS NULL
 AND je.entry_date <= (make_date(p.period_year,p.period_month,1)+interval '1 month - 1 day')
JOIN public.journal_entry_lines jel ON jel.journal_entry_id=je.id AND jel.tenant_id=p.tenant_id
JOIN public.chart_of_accounts ca ON ca.id=jel.account_id AND ca.tenant_id=p.tenant_id
WHERE ca.account_type IN ('income','expense')
GROUP BY p.tenant_id,p.period_year,p.period_month
HAVING sum(jel.credit_amount-jel.debit_amount)<>0;

-- ---------------------------------------------------------------------
-- 3. Cash Flow — cash account (1000/1100) movement by entry_type
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cash_flow
WITH (security_invoker = true) AS
SELECT
  je.tenant_id,
  EXTRACT(YEAR FROM je.entry_date)::int  AS period_year,
  EXTRACT(MONTH FROM je.entry_date)::int AS period_month,
  je.entry_type,
  COUNT(DISTINCT je.id)                  AS entry_count,
  SUM(jel.debit_amount)                  AS cash_in,
  SUM(jel.credit_amount)                 AS cash_out,
  SUM(jel.debit_amount) - SUM(jel.credit_amount) AS net_cash_flow
FROM public.journal_entry_lines jel
JOIN public.journal_entries je   ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id
JOIN public.chart_of_accounts ca ON ca.id = jel.account_id AND ca.tenant_id = je.tenant_id
WHERE je.status IN ('posted','reversed') AND je.deleted_at IS NULL
  AND (ca.account_code IN ('1000','1100') OR EXISTS (
    SELECT 1 FROM public.bank_accounts b WHERE b.tenant_id=je.tenant_id AND b.coa_account_code=ca.account_code
  ))
GROUP BY
  je.tenant_id,
  EXTRACT(YEAR FROM je.entry_date),
  EXTRACT(MONTH FROM je.entry_date),
  je.entry_type;


-- One STABLE invoker RPC returns a complete consistent statement snapshot.
-- JSON aggregation is not truncated by PostgREST's top-level row limit.
CREATE OR REPLACE FUNCTION public.read_my_financial_report(p_kind text,p_year integer DEFAULT NULL,p_month integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); result jsonb;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('accounting','read') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Financial report access denied'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('periods','statements','vat','vat_review','vat_return') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid financial report request'; END IF;
 IF p_kind IN ('statements','vat_return') AND (p_year IS NULL OR p_month IS NULL OR p_year NOT BETWEEN 1 AND 9999 OR p_month NOT BETWEEN 1 AND 12) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid financial report period'; END IF;
 IF p_kind='periods' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.period_year DESC,r.period_month DESC),'[]'::jsonb) INTO result FROM (
    SELECT DISTINCT extract(year FROM entry_date)::integer period_year,extract(month FROM entry_date)::integer period_month
     FROM public.journal_entries WHERE tenant_id=t AND status IN ('posted','reversed') AND deleted_at IS NULL
   ) r;
 ELSIF p_kind='statements' THEN
   SELECT jsonb_build_object(
    'profit_loss',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('total_debit',r.total_debit::text,'total_credit',r.total_credit::text,'net_balance',r.net_balance::text) ORDER BY r.account_code),'[]'::jsonb) FROM public.profit_loss r WHERE tenant_id=t AND period_year=p_year AND period_month=p_month),
    'balance_sheet',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('total_debit',r.total_debit::text,'total_credit',r.total_credit::text,'balance',r.balance::text) ORDER BY r.account_type,r.account_code),'[]'::jsonb) FROM public.balance_sheet r WHERE tenant_id=t AND period_year=p_year AND period_month=p_month),
    'cash_flow',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('cash_in',r.cash_in::text,'cash_out',r.cash_out::text,'net_cash_flow',r.net_cash_flow::text) ORDER BY r.entry_type),'[]'::jsonb) FROM public.cash_flow r WHERE tenant_id=t AND period_year=p_year AND period_month=p_month)
   ) INTO result;
 ELSIF p_kind='vat_return' THEN
   SELECT to_jsonb(r)||jsonb_build_object('output_vat',r.output_vat::text,'recoverable_input_vat',r.recoverable_input_vat::text,'non_recoverable_vat',r.non_recoverable_vat::text,'pending_review_vat',r.pending_review_vat::text,'adjustments_output',r.adjustments_output::text,'adjustments_input',r.adjustments_input::text,'net_position',r.net_position::text) INTO result FROM public.vat_reconciliation r WHERE tenant_id=t AND period_year=p_year AND period_month=p_month;
 ELSIF p_kind='vat' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('output_vat',r.output_vat::text,'recoverable_input_vat',r.recoverable_input_vat::text,'non_recoverable_vat',r.non_recoverable_vat::text,'pending_review_vat',r.pending_review_vat::text,'adjustments_output',r.adjustments_output::text,'adjustments_input',r.adjustments_input::text,'net_position',r.net_position::text) ORDER BY r.period_year DESC,r.period_month DESC),'[]'::jsonb) INTO result
    FROM public.vat_reconciliation r WHERE tenant_id=t;
 ELSE
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'invoice_ref',r.invoice_ref,'invoice_date',r.invoice_date,
    'vat_base_amount',r.vat_base_amount::text,'vat_rate',r.vat_rate::text,'vat_amount',r.vat_amount::text,'supplier_id',r.supplier_id)
    ORDER BY r.invoice_date,r.id),'[]'::jsonb) INTO result FROM public.vat_input_ledger r
    WHERE tenant_id=t AND vat_recoverability='pending_review';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_my_financial_report(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_my_financial_report(text,integer,integer) TO authenticated;
-- A classification and its audit commit together. No historical row is reclassified.
CREATE OR REPLACE FUNCTION public.resolve_my_vat_review(p_id uuid,p_recoverability text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $vat$
DECLARE t uuid:=public.get_my_tenant_id(); r public.vat_input_ledger%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('accounting','approve') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='VAT review access denied'; END IF;
 IF p_recoverability IS NULL OR p_recoverability NOT IN ('recoverable','non_recoverable') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid VAT classification'; END IF;
 SELECT * INTO r FROM public.vat_input_ledger WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VAT005: review item not found'; END IF;
 IF r.vat_recoverability<>'pending_review' THEN RAISE EXCEPTION 'VAT004: classification is already final'; END IF;
 UPDATE public.vat_input_ledger SET vat_recoverability=p_recoverability WHERE id=r.id AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(t,auth.uid(),'accounting','vat_input_ledger',r.id,'vat_review_item_resolved',
   jsonb_build_object('invoice_ref',r.invoice_ref,'vat_amount',r.vat_amount,'from','pending_review','to',p_recoverability));
END $vat$;
REVOKE ALL ON FUNCTION public.resolve_my_vat_review(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_my_vat_review(uuid,text) TO authenticated;
REVOKE UPDATE ON public.vat_input_ledger FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.guard_service_vat_classification() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $vat$
BEGIN
 IF current_user='service_role' AND NEW.vat_recoverability IS DISTINCT FROM OLD.vat_recoverability THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='VAT review requires the guarded caller workflow'; END IF;
 RETURN NEW;
END $vat$;
REVOKE ALL ON FUNCTION public.guard_service_vat_classification() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS guarded_vat_classification ON public.vat_input_ledger;
CREATE TRIGGER guarded_vat_classification BEFORE UPDATE OF vat_recoverability ON public.vat_input_ledger
 FOR EACH ROW EXECUTE FUNCTION public.guard_service_vat_classification();

-- Every exported VAT return is a new immutable snapshot. A repeated period in
-- another tenant can never find or overwrite somebody else's document number.
CREATE OR REPLACE FUNCTION public.create_my_vat_return_document(p_year integer,p_month integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $vat_document$
DECLARE t uuid:=public.get_my_tenant_id(); snapshot jsonb; company jsonb; token text; number text; did uuid; stamp timestamptz:=clock_timestamp();
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('accounting','export')
   OR NOT public.user_has_permission('accounting','read') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='VAT report export access denied'; END IF;
 snapshot:=public.read_my_financial_report('vat_return',p_year,p_month);
 IF snapshot IS NULL THEN RAISE EXCEPTION 'VAT006: no VAT return data for this period'; END IF;
 SELECT jsonb_build_object('name_ar',name_ar,'name_en',name_en,'vat_number',vat_number)
  INTO company FROM public.tenants WHERE id=t AND deleted_at IS NULL;
 IF company IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Company profile unavailable'; END IF;
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 number:='VAT-RET-'||p_year||'-'||lpad(p_month::text,2,'0')||'-'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.generated_documents(tenant_id,doc_number,template_id,invoice_id,generated_data,verify_url,verify_token_hash,status,generated_by,generated_at,printed_at,created_by)
 VALUES(t,number,NULL,NULL,snapshot||jsonb_build_object('kind','vat_return','company',company),'/verify-document/'||token,
  encode(sha256(convert_to(token,'UTF8')),'hex'),'generated',auth.uid(),stamp,stamp,auth.uid()) RETURNING id INTO did;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(t,auth.uid(),'accounting','generated_documents',did,'vat_return_report_generated',jsonb_build_object('period_year',p_year,'period_month',p_month,'doc_number',number));
 RETURN jsonb_build_object('id',did,'doc_number',number,'verify_url','/verify-document/'||token,'data',snapshot,'company',company,'generated_at',stamp);
END $vat_document$;
REVOKE ALL ON FUNCTION public.create_my_vat_return_document(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_my_vat_return_document(integer,integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.protect_vat_return_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $vat_snapshot$
BEGIN
 IF OLD.generated_data->>'kind'='vat_return' AND (TG_OP='DELETE' OR
  NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.doc_number IS DISTINCT FROM OLD.doc_number
  OR NEW.generated_data IS DISTINCT FROM OLD.generated_data OR NEW.verify_url IS DISTINCT FROM OLD.verify_url
  OR NEW.verify_token_hash IS DISTINCT FROM OLD.verify_token_hash OR NEW.generated_by IS DISTINCT FROM OLD.generated_by
  OR NEW.generated_at IS DISTINCT FROM OLD.generated_at) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='VAT return snapshots are immutable; generate a new report';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $vat_snapshot$;
REVOKE ALL ON FUNCTION public.protect_vat_return_snapshot() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS immutable_vat_return_snapshot ON public.generated_documents;
CREATE TRIGGER immutable_vat_return_snapshot BEFORE UPDATE OR DELETE ON public.generated_documents
 FOR EACH ROW EXECUTE FUNCTION public.protect_vat_return_snapshot();

NOTIFY pgrst,'reload schema';

COMMIT;
