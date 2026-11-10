BEGIN;

-- All approval mutations serialize against the same parent lock used by draft
-- edits/deletes. A queued submission cannot resurrect a removed draft.
CREATE FUNCTION public.guard_journal_approval_parent()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_entry public.journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM public.journal_entries
    WHERE id=NEW.journal_entry_id AND tenant_id=NEW.tenant_id FOR UPDATE;
  IF NOT FOUND OR v_entry.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'JRN010: journal entry not found or does not belong to this tenant'; END IF;
  IF (NEW.status IN ('submitted','rejected') AND v_entry.status <> 'draft')
    OR (NEW.status='approved' AND v_entry.status <> 'posted') THEN
    RAISE EXCEPTION 'JRN013: approval state does not match journal state'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_journal_approval_parent() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_journal_approval_parent BEFORE INSERT OR UPDATE ON public.journal_approvals
  FOR EACH ROW EXECUTE FUNCTION public.guard_journal_approval_parent();

-- Recheck after the period row lock is acquired, including direct service writes.
CREATE FUNCTION public.guard_period_pending_drafts()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.status IN ('closing','closed') AND NEW.status IS DISTINCT FROM OLD.status
    AND EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=NEW.tenant_id
      AND period_id=NEW.id AND status='draft' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'ACC004: period has pending draft entries'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_period_pending_drafts() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_period_pending_drafts BEFORE UPDATE ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION public.guard_period_pending_drafts();

CREATE FUNCTION public.save_journal_draft(p_input jsonb,p_entry_id uuid DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id(); v_actor uuid := auth.uid();
  v_entry public.journal_entries%ROWTYPE;
  v_date date; v_period uuid; v_period_status public.accounting_period_status;
  v_line jsonb; v_account uuid; v_debit numeric; v_credit numeric;
  v_total_debit numeric := 0; v_total_credit numeric := 0;
BEGIN
  IF v_actor IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission('accounting',
    CASE WHEN p_entry_id IS NULL THEN 'create' ELSE 'update' END) THEN
    RAISE EXCEPTION 'AUTH007: accounting permission required'; END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR COALESCE(p_input->>'entry_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    OR length(btrim(COALESCE(p_input->>'description_ar',''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'JRN005: entry date and a description are required'; END IF;
  v_date := (p_input->>'entry_date')::date;
  IF p_entry_id IS NOT NULL THEN
    SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_entry_id
      AND tenant_id=v_tenant AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'JRN010: journal entry not found or does not belong to this tenant'; END IF;
    IF v_entry.status <> 'draft' OR v_entry.entry_type <> 'manual'
      OR EXISTS(SELECT 1 FROM public.journal_approvals WHERE journal_entry_id=p_entry_id AND status IN ('submitted','approved')) THEN
      RAISE EXCEPTION 'JRN013: only unsubmitted manual drafts can be changed'; END IF;
    IF p_expected_updated_at IS NULL OR v_entry.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'JRN014: journal changed; reload before saving'; END IF;
  END IF;
  IF jsonb_typeof(p_input->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'JRN006: journal lines required'; END IF;
  IF jsonb_array_length(p_input->'lines') NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'JRN006: journal needs between 2 and 200 lines'; END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_input->'lines') LOOP
    v_account := (v_line->>'account_id')::uuid;
    v_debit := COALESCE((v_line->>'debit')::numeric,0);
    v_credit := COALESCE((v_line->>'credit')::numeric,0);
    IF v_debit NOT BETWEEN 0 AND 9999999999.99 OR v_credit NOT BETWEEN 0 AND 9999999999.99
      OR v_debit <> round(v_debit,2) OR v_credit <> round(v_credit,2)
      OR (v_debit > 0) = (v_credit > 0) THEN
      RAISE EXCEPTION 'JRN007: each line needs one positive amount with at most two decimal places'; END IF;
    PERFORM 1 FROM public.chart_of_accounts WHERE id=v_account AND tenant_id=v_tenant
      AND deleted_at IS NULL AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'JRN008: active tenant account required'; END IF;
    v_total_debit := v_total_debit+v_debit; v_total_credit := v_total_credit+v_credit;
  END LOOP;
  IF v_total_debit > 9999999999.99 OR v_total_credit > 9999999999.99 THEN
    RAISE EXCEPTION 'JRN007: journal total exceeds supported amount'; END IF;
  v_period := public.get_or_create_period(v_tenant,v_date);
  SELECT status INTO v_period_status FROM public.accounting_periods
    WHERE id=v_period AND tenant_id=v_tenant AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR v_period_status NOT IN ('open','reopened') THEN
    RAISE EXCEPTION 'ACC001: the accounting period for this date is closed'; END IF;
  IF p_entry_id IS NULL THEN
    INSERT INTO public.journal_entries(tenant_id,entry_date,period_id,entry_type,status,
      description_ar,description_en,source_module,source_entity_type,created_by)
    VALUES(v_tenant,v_date,v_period,'manual','draft',btrim(p_input->>'description_ar'),
      NULLIF(btrim(p_input->>'description_en'),''),'accounting','manual_entry',v_actor)
    RETURNING * INTO v_entry;
  ELSE
    UPDATE public.journal_entries SET entry_date=v_date,period_id=v_period,
      description_ar=btrim(p_input->>'description_ar'),
      description_en=NULLIF(btrim(p_input->>'description_en'),''),updated_by=v_actor
    WHERE id=p_entry_id RETURNING * INTO v_entry;
    DELETE FROM public.journal_entry_lines WHERE journal_entry_id=p_entry_id AND tenant_id=v_tenant;
  END IF;
  INSERT INTO public.journal_entry_lines(tenant_id,journal_entry_id,account_id,description,debit_amount,credit_amount)
  SELECT v_tenant,v_entry.id,(l->>'account_id')::uuid,NULLIF(btrim(l->>'description'),''),
    COALESCE((l->>'debit')::numeric,0),COALESCE((l->>'credit')::numeric,0)
  FROM jsonb_array_elements(p_input->'lines') l;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
  VALUES(v_tenant,v_actor,'accounting','journal_entries',v_entry.id,
    CASE WHEN p_entry_id IS NULL THEN 'journal_draft_created' ELSE 'journal_draft_updated' END,
    jsonb_build_object('total_debit',v_total_debit,'total_credit',v_total_credit));
  RETURN jsonb_build_object('id',v_entry.id,'updated_at',v_entry.updated_at);
END; $$;

CREATE FUNCTION public.delete_journal_draft(p_entry_id uuid,p_expected_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tenant uuid := public.get_my_tenant_id(); v_entry public.journal_entries%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission('accounting','delete') THEN
    RAISE EXCEPTION 'AUTH007: accounting delete permission required'; END IF;
  SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_entry_id
    AND tenant_id=v_tenant AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JRN010: journal entry not found or does not belong to this tenant'; END IF;
  IF v_entry.status <> 'draft' OR v_entry.entry_type <> 'manual'
    OR EXISTS(SELECT 1 FROM public.journal_approvals WHERE journal_entry_id=p_entry_id AND status IN ('submitted','approved')) THEN
    RAISE EXCEPTION 'JRN013: only unsubmitted manual drafts can be changed'; END IF;
  IF p_expected_updated_at IS NULL OR v_entry.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'JRN014: journal changed; reload before deleting'; END IF;
  UPDATE public.journal_entries SET deleted_at=now(),updated_by=auth.uid() WHERE id=p_entry_id;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action)
  VALUES(v_tenant,auth.uid(),'accounting','journal_entries',p_entry_id,'journal_draft_deleted');
END; $$;
REVOKE ALL ON FUNCTION public.save_journal_draft(jsonb,uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.delete_journal_draft(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_journal_draft(jsonb,uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_journal_draft(uuid,timestamptz) TO authenticated;
COMMIT;
