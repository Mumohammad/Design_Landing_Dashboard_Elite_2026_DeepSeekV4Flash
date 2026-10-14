BEGIN;

-- References serialize with bank edits/deactivation. Existing historical rows
-- can still be reconciled/voided without reassigning their bank account.
CREATE FUNCTION public.guard_active_bank_reference()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.bank_account_id IS NOT DISTINCT FROM OLD.bank_account_id
    AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN RETURN NEW; END IF;
  IF NEW.bank_account_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.bank_accounts WHERE id=NEW.bank_account_id
    AND tenant_id=NEW.tenant_id AND deleted_at IS NULL AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BNK005: active tenant bank account required'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_active_bank_reference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_payment_active_bank BEFORE INSERT OR UPDATE OF bank_account_id,tenant_id ON public.finance_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_active_bank_reference();
CREATE TRIGGER trg_transaction_active_bank BEFORE INSERT OR UPDATE OF bank_account_id,tenant_id ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_active_bank_reference();
CREATE TRIGGER trg_reconciliation_active_bank BEFORE INSERT OR UPDATE OF bank_account_id,tenant_id ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.guard_active_bank_reference();

CREATE FUNCTION public.save_bank_account(p_input jsonb,p_bank_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id(); v_bank public.bank_accounts%ROWTYPE;
  v_iban text := upper(regexp_replace(COALESCE(p_input->>'iban',''),'[[:space:]]','','g'));
  v_currency text := upper(COALESCE(p_input->>'currency','SAR'));
  v_opening numeric := COALESCE((p_input->>'opening_balance')::numeric,0);
  v_coa text := btrim(COALESCE(p_input->>'coa_account_code','1100'));
  v_digits text := ''; v_char text; v_used boolean;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission('accounting',
    CASE WHEN p_bank_id IS NULL THEN 'create' ELSE 'update' END) THEN
    RAISE EXCEPTION 'AUTH007: accounting permission required'; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR length(btrim(COALESCE(p_input->>'bank_name',''))) NOT BETWEEN 1 AND 200
    OR length(btrim(COALESCE(p_input->>'account_name',''))) NOT BETWEEN 1 AND 200
    OR length(COALESCE(p_input->>'account_number',''))>64
    OR v_currency !~ '^[A-Z]{3}$' OR v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'
    OR (left(v_iban,2)='SA' AND v_iban !~ '^SA[0-9]{22}$')
    OR v_opening NOT BETWEEN -9999999999.99 AND 9999999999.99 OR v_opening<>round(v_opening,2) THEN
    RAISE EXCEPTION 'BNK001: invalid bank account details'; END IF;
  FOR v_char IN SELECT regexp_split_to_table(substr(v_iban,5)||left(v_iban,4),'') LOOP
    v_digits := v_digits || CASE WHEN v_char ~ '[A-Z]' THEN (ascii(v_char)-55)::text ELSE v_char END;
  END LOOP;
  IF mod(v_digits::numeric,97)<>1 THEN RAISE EXCEPTION 'BNK001: invalid bank account details'; END IF;
  IF p_bank_id IS NOT NULL THEN
    SELECT * INTO v_bank FROM public.bank_accounts WHERE id=p_bank_id AND tenant_id=v_tenant AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PMT006: bank account not found'; END IF;
    IF p_expected_updated_at IS NULL OR v_bank.updated_at<>p_expected_updated_at THEN
      RAISE EXCEPTION 'BNK002: bank account changed; reload first'; END IF;
    SELECT EXISTS(SELECT 1 FROM public.finance_payments WHERE bank_account_id=p_bank_id)
      OR EXISTS(SELECT 1 FROM public.bank_transactions WHERE bank_account_id=p_bank_id)
      OR EXISTS(SELECT 1 FROM public.bank_reconciliations WHERE bank_account_id=p_bank_id) INTO v_used;
    IF v_used AND (v_bank.iban IS DISTINCT FROM v_iban OR v_bank.currency IS DISTINCT FROM v_currency
      OR v_bank.opening_balance IS DISTINCT FROM v_opening OR v_bank.coa_account_code IS DISTINCT FROM v_coa
      OR v_bank.account_number IS DISTINCT FROM NULLIF(btrim(p_input->>'account_number'),'')) THEN
      RAISE EXCEPTION 'BNK003: bank account has financial history; only names and active status may change'; END IF;
  END IF;
  PERFORM 1 FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND account_code=v_coa
    AND account_type='asset' AND is_active AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BNK005: active tenant asset account required'; END IF;
  -- Protect uniqueness without rewriting or rejecting pre-existing duplicates.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text||v_iban,0));
  IF EXISTS(SELECT 1 FROM public.bank_accounts WHERE tenant_id=v_tenant AND deleted_at IS NULL
    AND upper(regexp_replace(iban,'[[:space:]]','','g'))=v_iban AND id IS DISTINCT FROM p_bank_id) THEN
    RAISE EXCEPTION 'BNK004: bank account IBAN already exists'; END IF;
  IF p_bank_id IS NULL THEN
    INSERT INTO public.bank_accounts(tenant_id,bank_name,account_name,iban,account_number,currency,opening_balance,coa_account_code,created_by)
    VALUES(v_tenant,btrim(p_input->>'bank_name'),btrim(p_input->>'account_name'),v_iban,
      NULLIF(btrim(p_input->>'account_number'),''),v_currency,v_opening,v_coa,auth.uid()) RETURNING * INTO v_bank;
  ELSE
    UPDATE public.bank_accounts SET bank_name=btrim(p_input->>'bank_name'),account_name=btrim(p_input->>'account_name'),
      iban=v_iban,account_number=NULLIF(btrim(p_input->>'account_number'),''),currency=v_currency,
      opening_balance=v_opening,coa_account_code=v_coa,updated_by=auth.uid() WHERE id=p_bank_id RETURNING * INTO v_bank;
  END IF;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES(v_tenant,auth.uid(),'accounting','bank_accounts',v_bank.id,
    CASE WHEN p_bank_id IS NULL THEN 'bank_account_created' ELSE 'bank_account_updated' END,
    jsonb_build_object('bank_name',v_bank.bank_name,'iban_last4',right(v_iban,4),'currency',v_currency));
  RETURN jsonb_build_object('id',v_bank.id,'updated_at',v_bank.updated_at);
END; $$;

CREATE FUNCTION public.change_bank_account_state(p_bank_id uuid,p_expected_updated_at timestamptz,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tenant uuid := public.get_my_tenant_id(); v_bank public.bank_accounts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission('accounting',
    CASE WHEN p_action='delete' THEN 'delete' ELSE 'update' END) THEN
    RAISE EXCEPTION 'AUTH007: accounting permission required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('activate','deactivate','delete') THEN RAISE EXCEPTION 'BNK001: invalid bank account action'; END IF;
  SELECT * INTO v_bank FROM public.bank_accounts WHERE id=p_bank_id AND tenant_id=v_tenant AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PMT006: bank account not found'; END IF;
  IF p_expected_updated_at IS NULL OR v_bank.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'BNK002: bank account changed; reload first'; END IF;
  IF p_action='delete' AND (EXISTS(SELECT 1 FROM public.finance_payments WHERE bank_account_id=p_bank_id)
    OR EXISTS(SELECT 1 FROM public.bank_transactions WHERE bank_account_id=p_bank_id)
    OR EXISTS(SELECT 1 FROM public.bank_reconciliations WHERE bank_account_id=p_bank_id)) THEN
    RAISE EXCEPTION 'BNK003: bank account has financial history; deactivate it instead'; END IF;
  UPDATE public.bank_accounts SET is_active=(p_action='activate'),
    deleted_at=CASE WHEN p_action='delete' THEN now() ELSE NULL END,updated_by=auth.uid() WHERE id=p_bank_id;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action)
  VALUES(v_tenant,auth.uid(),'accounting','bank_accounts',p_bank_id,'bank_account_'||
    CASE p_action WHEN 'activate' THEN 'activated' WHEN 'deactivate' THEN 'deactivated' ELSE 'deleted' END);
END; $$;
REVOKE ALL ON FUNCTION public.save_bank_account(jsonb,uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.change_bank_account_state(uuid,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_bank_account(jsonb,uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_bank_account_state(uuid,timestamptz,text) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.bank_accounts FROM anon,authenticated;
COMMIT;
