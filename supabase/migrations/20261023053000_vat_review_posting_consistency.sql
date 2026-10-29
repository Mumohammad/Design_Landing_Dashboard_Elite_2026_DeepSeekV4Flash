BEGIN;
-- A VAT claim and its general-ledger reclassification are one caller-owned decision.
-- Imported or ambiguous sources are held for finance review, never backfilled.
REVOKE INSERT,UPDATE,DELETE ON public.vat_input_ledger FROM PUBLIC,anon,authenticated;
DO $acl$ DECLARE cols text;BEGIN SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid='public.vat_input_ledger'::regclass AND attnum>0 AND NOT attisdropped;EXECUTE format('REVOKE INSERT (%s),UPDATE (%s) ON public.vat_input_ledger FROM PUBLIC,anon,authenticated',cols,cols);END;$acl$;
CREATE SCHEMA vat_review_private;
REVOKE ALL ON SCHEMA vat_review_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE vat_review_private.resolutions(
 input_id uuid PRIMARY KEY REFERENCES public.vat_input_ledger(id),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 expense_id uuid NOT NULL UNIQUE REFERENCES public.expenses(id),
 original_entry_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id),
 adjustment_entry_id uuid UNIQUE REFERENCES public.journal_entries(id),
 classification text NOT NULL CHECK(classification IN('recoverable','non_recoverable')),
 vat_amount numeric(12,2) NOT NULL CHECK(vat_amount>=0),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 resolved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE vat_review_private.resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vat_review_private.resolutions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION vat_review_private.immutable_resolution() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'VAT_REVIEW_IMMUTABLE: preserve the recorded VAT resolution' USING ERRCODE='55000';END $$;
CREATE TRIGGER immutable_resolution BEFORE UPDATE OR DELETE ON vat_review_private.resolutions FOR EACH ROW EXECUTE FUNCTION vat_review_private.immutable_resolution();

CREATE OR REPLACE FUNCTION public.resolve_my_vat_review(p_id uuid,p_recoverability text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $review$
DECLARE t uuid:=public.get_my_tenant_id();r public.vat_input_ledger%ROWTYPE;e public.expenses%ROWTYPE;
 v_source_id uuid;j public.journal_entries%ROWTYPE;ev public.financial_events%ROWTYPE;
 expense_account uuid;ap_account uuid;vat_account uuid;adjustment uuid;entry_ref text;period_status text;v_period_id uuid;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('accounting','approve') THEN RAISE EXCEPTION 'VAT review access denied' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR p_recoverability IS NULL OR p_recoverability NOT IN('recoverable','non_recoverable') THEN RAISE EXCEPTION 'Invalid VAT classification' USING ERRCODE='22023';END IF;
 SELECT source_entity_id INTO v_source_id FROM public.vat_input_ledger WHERE id=p_id AND tenant_id=t;
 IF NOT FOUND THEN RAISE EXCEPTION 'VAT005: review item not found';END IF;
 -- Expense first, then input: approval/dispatch use the same source-first order.
 SELECT * INTO e FROM public.expenses WHERE id=v_source_id AND tenant_id=t FOR UPDATE;
 SELECT * INTO r FROM public.vat_input_ledger WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VAT005: review item not found';END IF;
 IF r.vat_recoverability<>'pending_review' THEN RAISE EXCEPTION 'VAT004: classification is already final';END IF;
 IF r.source_entity_type IS DISTINCT FROM 'expense' OR r.source_entity_id IS DISTINCT FROM e.id OR e.id IS NULL
  OR NOT e.is_approved OR e.deleted_at IS NOT NULL OR e.cancelled_at IS NOT NULL OR e.rejected_at IS NOT NULL
  OR e.approved_by IS NULL OR e.approved_at IS NULL OR e.vat_recoverability IS DISTINCT FROM 'pending_review'
  OR e.currency IS DISTINCT FROM 'SAR' OR e.amount IS NULL OR e.amount<=0 OR e.vat_rate IS NULL OR e.vat_rate<0 OR e.vat_rate>100 OR e.vat_amount IS NULL
  OR (r.invoice_date,r.vat_base_amount,r.vat_rate,r.vat_amount,r.invoice_ref) IS DISTINCT FROM (e.expense_date,e.amount,e.vat_rate,e.vat_amount,e.expense_code)
  OR r.period_year<>extract(year FROM e.expense_date)::integer OR r.period_month<>extract(month FROM e.expense_date)::integer
  OR r.vat_amount<0 OR r.vat_amount<>round(e.amount*e.vat_rate/100,2)
  OR (SELECT count(*) FROM public.vat_input_ledger WHERE tenant_id=t AND source_entity_type='expense' AND source_entity_id=e.id)<>1
  OR EXISTS(SELECT 1 FROM vat_review_private.resolutions WHERE expense_id=e.id)
 THEN RAISE EXCEPTION 'VAT007: source posting requires finance review';END IF;
 IF (SELECT count(*) FROM public.financial_events WHERE tenant_id=t AND source_type='expense' AND source_id=e.id AND event_type='ExpenseApprovedEvent')<>1
  OR (SELECT count(*) FROM public.journal_entries WHERE tenant_id=t AND source_entity_type='expense' AND source_entity_id=e.id)<>1
 THEN RAISE EXCEPTION 'VAT007: source posting requires finance review';END IF;
 SELECT * INTO ev FROM public.financial_events WHERE tenant_id=t AND source_type='expense' AND source_id=e.id AND event_type='ExpenseApprovedEvent' FOR SHARE;
 SELECT * INTO j FROM public.journal_entries WHERE tenant_id=t AND source_entity_type='expense' AND source_entity_id=e.id FOR UPDATE;
 IF ev.processing_status<>'processed' OR ev.processed_at IS NULL OR ev.event_date IS DISTINCT FROM e.expense_date
  OR NOT ev.payload @> jsonb_build_object('expense_id',e.id,'expense_code',e.expense_code,'amount',e.amount,'vat_amount',e.vat_amount,'vat_rate',e.vat_rate,'vat_recoverability','pending_review','coa_account_code',e.coa_account_code)
  OR j.status<>'posted' OR j.deleted_at IS NOT NULL OR j.entry_type<>'expense' OR j.source_module IS DISTINCT FROM 'accounting'
  OR j.entry_date IS DISTINCT FROM e.expense_date OR j.reversed_entry_id IS NOT NULL OR j.reversal_of_entry_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=t AND reversal_of_entry_id=j.id)
  OR (SELECT count(*) FROM public.audit_log WHERE tenant_id=t AND entity_id=e.id AND action='expense_approved')<>1
  OR NOT EXISTS(SELECT 1 FROM public.audit_log WHERE tenant_id=t AND entity_id=e.id AND action='expense_approved' AND actor_id=e.approved_by
   AND new_values @> jsonb_build_object('expense_ref',e.expense_code,'amount',e.amount,'vat_amount',e.vat_amount,'vat_rate',e.vat_rate,'vat_recoverability','pending_review','coa_account_code',e.coa_account_code))
 THEN RAISE EXCEPTION 'VAT007: source posting requires finance review';END IF;
 SELECT id INTO expense_account FROM public.chart_of_accounts WHERE tenant_id=t AND account_code=e.coa_account_code AND account_type='expense' AND is_active AND deleted_at IS NULL FOR SHARE;
 SELECT id INTO ap_account FROM public.chart_of_accounts WHERE tenant_id=t AND account_code='2000' AND account_type='liability' AND is_active AND deleted_at IS NULL FOR SHARE;
 SELECT id INTO vat_account FROM public.chart_of_accounts WHERE tenant_id=t AND account_code='2600' AND account_type='asset' AND is_active AND deleted_at IS NULL FOR SHARE;
 IF expense_account IS NULL OR ap_account IS NULL OR (p_recoverability='recoverable' AND r.vat_amount>0 AND vat_account IS NULL)
  OR (SELECT count(*) FROM public.journal_entry_lines WHERE tenant_id=t AND journal_entry_id=j.id)<>2
  OR NOT EXISTS(SELECT 1 FROM public.journal_entry_lines WHERE tenant_id=t AND journal_entry_id=j.id AND account_id=expense_account AND debit_amount=e.amount+e.vat_amount AND credit_amount=0)
  OR NOT EXISTS(SELECT 1 FROM public.journal_entry_lines WHERE tenant_id=t AND journal_entry_id=j.id AND account_id=ap_account AND credit_amount=e.amount+e.vat_amount AND debit_amount=0)
  OR (SELECT count(*) FROM public.payables WHERE tenant_id=t AND source_entity_type='expense' AND source_entity_id=e.id)<>1
  OR NOT EXISTS(SELECT 1 FROM public.payables WHERE tenant_id=t AND source_entity_type='expense' AND source_entity_id=e.id AND deleted_at IS NULL AND status::text NOT IN('void','cancelled')
   AND amount=e.amount AND vat_amount=e.vat_amount AND total_amount=e.amount+e.vat_amount AND invoice_date=e.expense_date)
  OR EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=t AND source_entity_type='vat_input_review' AND source_entity_id=r.id)
 THEN RAISE EXCEPTION 'VAT007: source posting requires finance review';END IF;
 SELECT id,status::text INTO v_period_id,period_status FROM public.accounting_periods WHERE id=j.period_id AND tenant_id=t AND period_year=r.period_year AND period_month=r.period_month AND deleted_at IS NULL FOR UPDATE;
 IF v_period_id IS NULL OR period_status NOT IN('open','reopened') THEN RAISE EXCEPTION 'ACC001: source accounting period is closed';END IF;
 INSERT INTO public.vat_periods(tenant_id,period_year,period_month,status,created_by) VALUES(t,r.period_year,r.period_month,'open',auth.uid()) ON CONFLICT(tenant_id,period_year,period_month) DO NOTHING;
 SELECT status INTO period_status FROM public.vat_periods WHERE tenant_id=t AND period_year=r.period_year AND period_month=r.period_month AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR period_status NOT IN('open','reopened') THEN RAISE EXCEPTION 'VAT001: source VAT period is closed';END IF;
 IF p_recoverability='recoverable' AND r.vat_amount>0 THEN
  SELECT out_entry_id,out_entry_ref INTO adjustment,entry_ref FROM public.post_journal_entry(t,r.invoice_date,'إعادة تصنيف ضريبة المدخلات — '||r.invoice_ref,
   jsonb_build_array(jsonb_build_object('account_id',vat_account,'debit',r.vat_amount,'credit',0,'description','Recoverable input VAT'),jsonb_build_object('account_id',expense_account,'debit',0,'credit',r.vat_amount,'description','Reclassify previously expensed VAT')),
   'Input VAT reclassification',auth.uid(),'vat','vat_input_review',r.id);
 END IF;
 UPDATE public.vat_input_ledger SET vat_recoverability=p_recoverability WHERE id=r.id AND tenant_id=t;
 INSERT INTO vat_review_private.resolutions(input_id,tenant_id,expense_id,original_entry_id,adjustment_entry_id,classification,vat_amount,actor_id)
 VALUES(r.id,t,e.id,j.id,adjustment,p_recoverability,r.vat_amount,auth.uid());
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,auth.uid(),'accounting','vat_input_ledger',r.id,'vat_review_item_resolved',
 jsonb_build_object('invoice_ref',r.invoice_ref,'vat_amount',r.vat_amount,'from','pending_review','to',p_recoverability,'expense_id',e.id,'original_entry_id',j.id,'adjustment_entry_id',adjustment));
END $review$;
REVOKE ALL ON FUNCTION public.resolve_my_vat_review(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_my_vat_review(uuid,text) TO authenticated;

CREATE FUNCTION vat_review_private.protect_input() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM vat_review_private.resolutions WHERE input_id=OLD.id))
  OR (TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM vat_review_private.resolutions WHERE expense_id=NEW.source_entity_id AND NEW.source_entity_type='expense'))
 THEN RAISE EXCEPTION 'VAT_REVIEW_IMMUTABLE: preserve the recorded VAT resolution' USING ERRCODE='55000';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER aaa_protect_resolved_input BEFORE INSERT OR UPDATE OR DELETE ON public.vat_input_ledger FOR EACH ROW EXECUTE FUNCTION vat_review_private.protect_input();
CREATE FUNCTION vat_review_private.protect_journal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM vat_review_private.resolutions WHERE OLD.id IN(original_entry_id,adjustment_entry_id)))
  OR (TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM vat_review_private.resolutions WHERE NEW.reversal_of_entry_id IN(original_entry_id,adjustment_entry_id)))
 THEN RAISE EXCEPTION 'VAT_REVIEW_IMMUTABLE: preserve the recorded VAT resolution' USING ERRCODE='55000';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER aaa_protect_review_journal BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION vat_review_private.protect_journal();
CREATE FUNCTION vat_review_private.protect_lines() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM vat_review_private.resolutions WHERE OLD.journal_entry_id IN(original_entry_id,adjustment_entry_id)))
  OR (TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM vat_review_private.resolutions WHERE NEW.journal_entry_id IN(original_entry_id,adjustment_entry_id)))
 THEN RAISE EXCEPTION 'VAT_REVIEW_IMMUTABLE: preserve the recorded VAT resolution' USING ERRCODE='55000';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER aaa_protect_review_lines BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION vat_review_private.protect_lines();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vat_review_private FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
