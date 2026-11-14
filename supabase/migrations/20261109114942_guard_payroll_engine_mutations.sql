-- Financial writes use the caller, complete reviewed inputs and one transaction.
-- No historic business records are repaired or replaced by this migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
CREATE SCHEMA IF NOT EXISTS payroll_guard_private;
REVOKE ALL ON SCHEMA payroll_guard_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE payroll_guard_private.source_versions(tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),version bigint NOT NULL DEFAULT 0);
ALTER TABLE payroll_guard_private.source_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_guard_private.source_versions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION payroll_guard_private.bump_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll-source:'||t::text,0));
 INSERT INTO payroll_guard_private.source_versions(tenant_id,version) VALUES(t,1) ON CONFLICT(tenant_id) DO UPDATE SET version=payroll_guard_private.source_versions.version+1;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION payroll_guard_private.bump_source() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['payroll_engine_rule_sets','payroll_engine_items','payroll_engine_adjustments','payroll_engine_traffic_fines','drivers','driver_platform_accounts'] LOOP
  EXECUTE format('CREATE TRIGGER payroll_source_changed AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION payroll_guard_private.bump_source()',name);
 END LOOP;
END $$;
ALTER TABLE public.payroll_engine_runs ADD COLUMN calculated_source_version bigint,ADD COLUMN approved_source_version bigint;
CREATE TABLE payroll_guard_private.run_receipts(tenant_id uuid NOT NULL,actor_id uuid NOT NULL,request_key text NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(tenant_id,actor_id,request_key));
ALTER TABLE payroll_guard_private.run_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_guard_private.run_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE payroll_guard_private.calculation_attestations(tenant_id uuid NOT NULL,actor_id uuid NOT NULL,operation text NOT NULL,payload_hash text NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(tenant_id,actor_id,operation,payload_hash));
ALTER TABLE payroll_guard_private.calculation_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_guard_private.calculation_attestations FROM PUBLIC,anon,authenticated,service_role;
-- Only the authenticated server action can attest the workbook/calculator
-- output. A browser with payroll permissions cannot invent calculated results.
CREATE FUNCTION public.attest_platform_payroll(p_tenant uuid,p_actor uuid,p_operation text,p_payload jsonb,p_source_version bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation IS NULL OR p_operation NOT IN ('save','approve') THEN RAISE EXCEPTION 'PAYENG019: calculator server required'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>25000000 OR p_source_version IS NULL OR NOT EXISTS(SELECT 1 FROM public.users u JOIN public.tenants t ON t.id=u.tenant_id WHERE u.auth_user_id=p_actor AND u.tenant_id=p_tenant AND u.status='active' AND u.deleted_at IS NULL AND (u.locked_until IS NULL OR u.locked_until<=now()) AND t.status='active' AND t.deleted_at IS NULL) THEN RAISE EXCEPTION 'PAYENG019: calculator identity unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll-source:'||p_tenant::text,0));
 IF p_source_version IS DISTINCT FROM coalesce((SELECT version FROM payroll_guard_private.source_versions WHERE tenant_id=p_tenant),0) THEN RAISE EXCEPTION 'PAYENG011: payroll inputs changed; reload and recalculate'; END IF;
 INSERT INTO payroll_guard_private.calculation_attestations VALUES(p_tenant,p_actor,p_operation,encode(extensions.digest(p_payload::text,'sha256'),'hex'),now()+interval '10 minutes') ON CONFLICT(tenant_id,actor_id,operation,payload_hash) DO UPDATE SET expires_at=excluded.expires_at;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.attest_platform_payroll(uuid,uuid,text,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attest_platform_payroll(uuid,uuid,text,jsonb,bigint) TO service_role;

CREATE FUNCTION public.read_my_payroll_source_version() RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('payroll','read') THEN RAISE EXCEPTION 'PAYENG010: payroll permission required'; END IF;
 RETURN coalesce((SELECT version FROM payroll_guard_private.source_versions WHERE tenant_id=t),0);
END $$;
REVOKE ALL ON FUNCTION public.read_my_payroll_source_version() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_payroll_source_version() TO authenticated;

CREATE FUNCTION public.save_my_platform_payroll(p_run jsonb,p_results jsonb,p_exceptions jsonb,p_income jsonb,p_source_version bigint,p_run_id uuid DEFAULT NULL,p_expected_version integer DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();v_id uuid;existing public.payroll_engine_runs%ROWTYPE;v_request_key text;v_payload_hash text;receipt payroll_guard_private.run_receipts%ROWTYPE;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('payroll',CASE WHEN p_run_id IS NULL THEN 'create' ELSE 'update' END) THEN RAISE EXCEPTION 'PAYENG010: payroll permission required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll-source:'||t::text,0));
 IF p_run_id IS NULL AND (coalesce(p_run->>'file_path','') !~ ('^'||t::text||'/[0-9]{4}-(0[1-9]|1[0-2])/[0-9a-f-]{36}\.(xlsx|xls)$') OR coalesce(p_run->>'file_sha256','') !~ '^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'PAYENG017: tenant workbook evidence required'; END IF;
 IF nullif(p_run->>'platform_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.delivery_platforms WHERE id=(p_run->>'platform_id')::uuid AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PAYENG017: tenant platform required'; END IF;
 IF nullif(p_run->>'rule_set_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payroll_engine_rule_sets WHERE id=(p_run->>'rule_set_id')::uuid AND tenant_id=t AND status='active') THEN RAISE EXCEPTION 'PAYENG017: active tenant rule set required'; END IF;
 v_request_key:=CASE WHEN p_run_id IS NULL THEN 'upload:'||(p_run->>'file_path') ELSE 'recalculate:'||p_run_id::text||':'||coalesce(p_expected_version::text,'missing') END;
 v_payload_hash:=encode(extensions.digest(jsonb_build_object('run',p_run,'results',p_results,'exceptions',p_exceptions,'income',p_income,'source',p_source_version,'run_id',p_run_id,'expected_version',p_expected_version)::text,'sha256'),'hex');
 SELECT * INTO receipt FROM payroll_guard_private.run_receipts r WHERE r.tenant_id=t AND r.actor_id=actor AND r.request_key=v_request_key;
 IF FOUND THEN IF receipt.payload_hash<>v_payload_hash THEN RAISE EXCEPTION 'PAYENG018: workbook or recalculation request changed; reload'; END IF; RETURN (receipt.result->>'id')::uuid; END IF;
 IF p_run_id IS NULL AND EXISTS(SELECT 1 FROM public.payroll_engine_runs r WHERE r.tenant_id=t AND r.month_key=p_run->>'month_key' AND r.platform_name=coalesce(nullif(p_run->>'platform_name',''),'HungerStation') AND r.status='draft') THEN RAISE EXCEPTION 'PAYENG023: review or cancel the existing draft before importing a replacement'; END IF;
 IF p_source_version IS NULL OR p_source_version IS DISTINCT FROM coalesce((SELECT version FROM payroll_guard_private.source_versions WHERE tenant_id=t),0) THEN RAISE EXCEPTION 'PAYENG011: payroll inputs changed; reload and recalculate'; END IF;
 IF NOT EXISTS(SELECT 1 FROM payroll_guard_private.calculation_attestations a WHERE a.tenant_id=t AND a.actor_id=actor AND a.operation='save' AND a.payload_hash=v_payload_hash AND a.expires_at>now()) THEN RAISE EXCEPTION 'PAYENG019: calculator confirmation required'; END IF;
 IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' OR jsonb_array_length(p_results)=0 OR jsonb_array_length(p_results)>100000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_results) r GROUP BY r->>'rider_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'PAYENG012: complete unique rider results required'; END IF;
 IF p_run_id IS NOT NULL THEN
  SELECT * INTO existing FROM public.payroll_engine_runs WHERE payroll_engine_runs.id=p_run_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND OR existing.total_drivers<>jsonb_array_length(p_results) OR EXISTS(SELECT rider_id FROM public.payroll_engine_results WHERE run_id=p_run_id EXCEPT SELECT value->>'rider_id' FROM jsonb_array_elements(p_results)) THEN RAISE EXCEPTION 'PAYENG012: complete unique rider results required'; END IF;
 END IF;
 v_id:=public.payroll_engine_save_run(t,actor,p_run,p_results,p_exceptions,p_income,p_run_id,p_expected_version);
 UPDATE public.payroll_engine_runs SET calculated_source_version=p_source_version WHERE payroll_engine_runs.id=v_id AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,actor,'payroll','payroll_engine_runs',v_id,'platform_payroll_saved_atomic',jsonb_build_object('source_version',p_source_version,'riders',jsonb_array_length(p_results)));
 INSERT INTO payroll_guard_private.run_receipts VALUES(t,actor,v_request_key,v_payload_hash,jsonb_build_object('id',v_id));
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.save_my_platform_payroll(jsonb,jsonb,jsonb,jsonb,bigint,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_my_platform_payroll(jsonb,jsonb,jsonb,jsonb,bigint,uuid,integer) TO authenticated;

CREATE FUNCTION public.approve_my_platform_payroll(p_run_id uuid,p_expected_version integer,p_changes jsonb,p_source_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();run public.payroll_engine_runs%ROWTYPE;result jsonb;c jsonb;v_request_key text;v_payload_hash text;receipt payroll_guard_private.run_receipts%ROWTYPE;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('payroll','approve') THEN RAISE EXCEPTION 'PAYENG010: payroll permission required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll-source:'||t::text,0));
 SELECT * INTO run FROM public.payroll_engine_runs WHERE id=p_run_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYENG002: payroll run not found'; END IF;
 v_request_key:='approve:'||p_run_id::text||':'||coalesce(p_expected_version::text,'missing');
 v_payload_hash:=encode(extensions.digest(jsonb_build_object('changes',p_changes,'source',p_source_version,'run_id',p_run_id,'expected_version',p_expected_version,'results',(SELECT jsonb_agg(r.result ORDER BY r.rider_id COLLATE "C") FROM public.payroll_engine_results r WHERE r.run_id=p_run_id AND r.tenant_id=t))::text,'sha256'),'hex');
 SELECT * INTO receipt FROM payroll_guard_private.run_receipts r WHERE r.tenant_id=t AND r.actor_id=actor AND r.request_key=v_request_key;
 IF FOUND THEN IF receipt.payload_hash<>v_payload_hash OR run.status<>'approved' THEN RAISE EXCEPTION 'PAYENG018: approval request changed; reload'; END IF; RETURN receipt.result||jsonb_build_object('replayed',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM payroll_guard_private.calculation_attestations a WHERE a.tenant_id=t AND a.actor_id=actor AND a.operation='approve' AND a.payload_hash=v_payload_hash AND a.expires_at>now()) THEN RAISE EXCEPTION 'PAYENG019: calculator confirmation required'; END IF;
 IF p_source_version IS NULL OR p_source_version IS DISTINCT FROM run.calculated_source_version OR p_source_version IS DISTINCT FROM coalesce((SELECT version FROM payroll_guard_private.source_versions WHERE tenant_id=t),0) THEN RAISE EXCEPTION 'PAYENG011: payroll inputs changed; reload and recalculate'; END IF;
 IF run.total_drivers<>(SELECT count(*) FROM public.payroll_engine_results WHERE run_id=run.id AND tenant_id=t) THEN RAISE EXCEPTION 'PAYENG012: complete unique rider results required'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'PAYENG013: invalid installment changes'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_changes) AS change_row(value) GROUP BY change_row.value->>'table',change_row.value->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'PAYENG013: duplicate installment changes'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  IF c->>'table' NOT IN ('items','traffic','traffic_status','adjustment_status') OR c->>'table' IS NULL THEN RAISE EXCEPTION 'PAYENG013: invalid installment changes'; END IF;
  IF c->>'table' IN ('items','traffic') AND EXISTS(SELECT 1 FROM public.payroll_engine_runs r WHERE r.tenant_id=t AND r.status='approved' AND r.month_key=run.month_key AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.installment_changes) x WHERE x->>'id'=c->>'id' AND x->>'table'=c->>'table')) THEN RAISE EXCEPTION 'PAYENG014: this installment was already applied this month'; END IF;
  IF c->>'table'='items' AND NOT EXISTS(SELECT 1 FROM public.payroll_engine_items i WHERE i.id=(c->>'id')::uuid AND i.tenant_id=t AND i.kind='deduction' AND i.status='active' AND i.installment_enabled AND i.installment_status='active' AND NOT i.apply_to_all AND cardinality(i.target_rider_ids)=1 AND EXISTS(SELECT 1 FROM public.payroll_engine_results r WHERE r.run_id=run.id AND r.rider_id=ANY(i.target_rider_ids)) AND (c->>'installmentTotalPaid')::numeric=least(i.amount,i.installment_total_paid+i.installment_monthly_amount) AND c->>'installmentStatus'=CASE WHEN least(i.amount,i.installment_total_paid+i.installment_monthly_amount)>=i.amount THEN 'completed' ELSE 'active' END) THEN RAISE EXCEPTION 'PAYENG013: installment must match one participating rider and current balance'; END IF;
  IF c->>'table'='traffic' AND NOT EXISTS(SELECT 1 FROM public.payroll_engine_traffic_fines f WHERE f.id=(c->>'id')::uuid AND f.tenant_id=t AND f.status='approved' AND f.installment_enabled AND f.installment_status='active' AND EXISTS(SELECT 1 FROM public.payroll_engine_results r WHERE r.run_id=run.id AND r.rider_id=f.rider_id) AND (c->>'installmentTotalPaid')::numeric=least(f.amount,f.installment_total_paid+f.installment_monthly_amount)) THEN RAISE EXCEPTION 'PAYENG013: invalid rider installment'; END IF;
  IF c->>'table'='traffic_status' AND NOT EXISTS(SELECT 1 FROM public.payroll_engine_traffic_fines f WHERE f.id=(c->>'id')::uuid AND f.tenant_id=t AND f.status='approved' AND NOT f.installment_enabled AND EXISTS(SELECT 1 FROM public.payroll_engine_results r WHERE r.run_id=run.id AND r.rider_id=f.rider_id)) THEN RAISE EXCEPTION 'PAYENG013: invalid rider fine'; END IF;
  IF c->>'table'='adjustment_status' AND NOT EXISTS(SELECT 1 FROM public.payroll_engine_adjustments a WHERE a.id=(c->>'id')::uuid AND a.tenant_id=t AND a.status='active' AND EXISTS(SELECT 1 FROM public.payroll_engine_results r WHERE r.run_id=run.id AND r.rider_id=a.rider_id)) THEN RAISE EXCEPTION 'PAYENG013: invalid rider adjustment'; END IF;
 END LOOP;
 -- The legacy helper's month-wide gate skips unrelated riders. Its caller is
 -- protected above by a per-item monthly check; disable that coarse branch.
 result:=public.payroll_engine_approve_run(t,actor,run.id,p_expected_version,p_changes);
 UPDATE public.payroll_engine_runs SET approved_source_version=coalesce((SELECT version FROM payroll_guard_private.source_versions WHERE tenant_id=t),0) WHERE id=run.id;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,actor,'payroll','payroll_engine_runs',run.id,'platform_payroll_approved_atomic',result);
 INSERT INTO payroll_guard_private.run_receipts VALUES(t,actor,v_request_key,v_payload_hash,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.approve_my_platform_payroll(uuid,integer,jsonb,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approve_my_platform_payroll(uuid,integer,jsonb,bigint) TO authenticated;

CREATE FUNCTION public.read_my_platform_payroll_approval(p_run_id uuid,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();state text;receipt jsonb;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('payroll','approve') THEN RAISE EXCEPTION 'PAYENG010: payroll permission required'; END IF;
 SELECT status INTO state FROM public.payroll_engine_runs WHERE id=p_run_id AND tenant_id=t;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYENG002: payroll run not found'; END IF;
 IF state<>'approved' THEN RETURN NULL; END IF;
 SELECT r.result INTO receipt FROM payroll_guard_private.run_receipts r WHERE r.tenant_id=t AND r.actor_id=actor AND r.request_key='approve:'||p_run_id::text||':'||p_expected_version::text;
 IF receipt IS NULL THEN RETURN NULL; END IF;
 RETURN receipt||jsonb_build_object('run_id',p_run_id,'replayed',true);
END $$;
REVOKE ALL ON FUNCTION public.read_my_platform_payroll_approval(uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_my_platform_payroll_approval(uuid,integer) TO authenticated;

-- Keep the service-only legacy function signature for already-applied history,
-- replacing only its unsafe tenant/month-wide skip with per-item validation in
-- the new caller wrapper. No stored approval or installment is rewritten.
DO $$ DECLARE definition text;updated text;BEGIN
 definition:=replace(pg_get_functiondef('public.payroll_engine_approve_run(uuid,uuid,uuid,integer,jsonb)'::regprocedure),E'\r\n',E'\n');
 updated:=replace(definition,E'   ELSIF NOT v_first THEN\n    CONTINUE; -- installments advance once per month (first approved run), like upstream',E'   ELSIF false THEN\n    CONTINUE; -- caller wrapper enforces per-item monthly ownership');
 IF definition=updated THEN RAISE EXCEPTION 'PAYENG_SOURCE_CONTRACT_CHANGED'; END IF;
 EXECUTE updated;
END $$;

CREATE FUNCTION public.cancel_my_platform_payroll(p_run_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();run public.payroll_engine_runs%ROWTYPE;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('payroll','update') THEN RAISE EXCEPTION 'PAYENG010: payroll permission required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll-source:'||t::text,0));
 SELECT * INTO run FROM public.payroll_engine_runs WHERE id=p_run_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYENG002: payroll run not found'; END IF;
 IF run.status='cancelled' AND run.cancelled_by=actor AND run.cancel_reason=btrim(p_reason) THEN RETURN; END IF;
 IF run.journal_entry_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.journal_entries WHERE id=run.journal_entry_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PAYENG008: remove or reverse the payroll journal before cancelling'; END IF;
 IF run.status='approved' AND jsonb_array_length(run.installment_changes)>0 AND run.approved_source_version IS DISTINCT FROM coalesce((SELECT version FROM payroll_guard_private.source_versions WHERE tenant_id=t),0) THEN RAISE EXCEPTION 'PAYENG015: later payroll input changes require a reviewed reversal'; END IF;
 PERFORM public.payroll_engine_cancel_run(t,actor,p_run_id,p_reason);
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,actor,'payroll','payroll_engine_runs',p_run_id,'platform_payroll_cancelled_atomic',jsonb_build_object('reason',p_reason));
END $$;
REVOKE ALL ON FUNCTION public.cancel_my_platform_payroll(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_my_platform_payroll(uuid,text) TO authenticated;

CREATE FUNCTION public.create_my_platform_payroll_journal(p_run_id uuid,p_expense_account uuid,p_payable_account uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();run public.payroll_engine_runs%ROWTYPE;amount numeric;rows bigint;entry jsonb;description text;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('payroll','approve') OR NOT public.user_has_permission('accounting','create') THEN RAISE EXCEPTION 'PAYENG010: payroll and accounting permissions required'; END IF;
 SELECT * INTO run FROM public.payroll_engine_runs WHERE id=p_run_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND OR run.status<>'approved' THEN RAISE EXCEPTION 'PAYENG005: approve the payroll run first'; END IF;
 IF run.journal_entry_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.id=run.journal_entry_id AND j.tenant_id=t AND j.deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.journal_entry_lines WHERE journal_entry_id=run.journal_entry_id AND account_id=p_expense_account AND debit_amount>0) OR NOT EXISTS(SELECT 1 FROM public.journal_entry_lines WHERE journal_entry_id=run.journal_entry_id AND account_id=p_payable_account AND credit_amount>0) THEN RAISE EXCEPTION 'PAYENG016: existing journal needs review'; END IF;
  RETURN jsonb_build_object('id',run.journal_entry_id,'replayed',true);
 END IF;
 IF p_expense_account=p_payable_account OR NOT EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE id=p_expense_account AND tenant_id=t AND is_active AND deleted_at IS NULL AND account_type='expense') OR NOT EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE id=p_payable_account AND tenant_id=t AND is_active AND deleted_at IS NULL AND account_type='liability') THEN RAISE EXCEPTION 'PAYENG016: choose active expense and payable accounts'; END IF;
 SELECT count(*),sum(round(final_net_salary,2)) INTO rows,amount FROM public.payroll_engine_results WHERE run_id=run.id AND tenant_id=t;
 IF rows<>run.total_drivers OR rows=0 OR amount IS NULL OR amount<=0 OR amount>9999999999.99 THEN RAISE EXCEPTION 'PAYENG012: complete payable payroll results required'; END IF;
 description:='Rider payroll '||run.payroll_month||' — '||run.platform_name;
 entry:=public.save_journal_draft(jsonb_build_object('entry_date',((run.month_key||'-01')::date+interval '1 month - 1 day')::date,'description_ar','رواتب المناديب '||run.month_key||' — '||run.platform_name,'description_en',description,'lines',jsonb_build_array(jsonb_build_object('account_id',p_expense_account,'debit',amount,'credit',0,'description',description),jsonb_build_object('account_id',p_payable_account,'debit',0,'credit',amount,'description',description))));
 UPDATE public.journal_entries SET source_module='payroll',source_entity_type='payroll_engine_run',source_entity_id=run.id WHERE id=(entry->>'id')::uuid AND tenant_id=t;
 UPDATE public.payroll_engine_runs SET journal_entry_id=(entry->>'id')::uuid,updated_at=now() WHERE id=run.id;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,actor,'payroll','payroll_engine_runs',run.id,'platform_payroll_journal_atomic',jsonb_build_object('journal_id',entry->>'id','amount',amount));
 RETURN entry||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_my_platform_payroll_journal(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_my_platform_payroll_journal(uuid,uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.payroll_engine_save_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,integer) FROM service_role;
REVOKE ALL ON FUNCTION public.payroll_engine_approve_run(uuid,uuid,uuid,integer,jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.payroll_engine_cancel_run(uuid,uuid,uuid,text) FROM service_role;
NOTIFY pgrst,'reload schema';

CREATE TABLE payroll_guard_private.income_receipts(tenant_id uuid NOT NULL,actor_id uuid NOT NULL,request_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(tenant_id,actor_id,request_id));
ALTER TABLE payroll_guard_private.income_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payroll_guard_private.income_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.import_my_platform_income(p_request_id uuid,p_month text,p_company text,p_rows jsonb,p_overwrite boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();v public.payroll_income_records%ROWTYPE;r jsonb;field text;payload_hash text;receipt payroll_guard_private.income_receipts%ROWTYPE;result jsonb;existing uuid;imported integer:=0;updated integer:=0;custom_total numeric;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('payroll','create') OR (p_overwrite AND NOT public.user_has_permission('payroll','update')) THEN RAISE EXCEPTION 'PAYENG010: payroll import permission required'; END IF;
 IF p_request_id IS NULL OR p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' OR p_company IS NULL OR length(btrim(p_company)) NOT BETWEEN 1 AND 80 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000 OR p_overwrite IS NULL THEN RAISE EXCEPTION 'PAYENG020: invalid income import'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('income-import:'||t::text||':'||p_month||':'||p_company,0));
 payload_hash:=encode(extensions.digest(jsonb_build_object('month',p_month,'company',p_company,'rows',p_rows,'overwrite',p_overwrite)::text,'sha256'),'hex');
 SELECT * INTO receipt FROM payroll_guard_private.income_receipts WHERE tenant_id=t AND actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN IF receipt.payload_hash<>payload_hash THEN RAISE EXCEPTION 'PAYENG021: request identifies different income rows'; END IF; RETURN receipt.result||jsonb_build_object('replayed',true); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) AS input_row(value) GROUP BY input_row.value->>'rider_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'PAYENG020: duplicate income rider'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('driver_id','rider_id','driver_name','basic_payment','distance_payment','segment_payment','acceptance_penalty','contact_penalty','stacking_deduction','declined_penalty','late_penalty','no_show_penalty','no_show_special_penalty','daily_acceptance_penalty','missed_days_penalty','rider_balance','custom_fields','source_file')) OR coalesce(length(btrim(r->>'rider_id')),0) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'PAYENG020: invalid income row'; END IF;
  FOREACH field IN ARRAY ARRAY['basic_payment','distance_payment','segment_payment','acceptance_penalty','contact_penalty','stacking_deduction','declined_penalty','late_penalty','no_show_penalty','no_show_special_penalty','daily_acceptance_penalty','missed_days_penalty','rider_balance'] LOOP
   IF jsonb_typeof(r->field) IS DISTINCT FROM 'number' OR abs((r->>field)::numeric)>999999999 THEN RAISE EXCEPTION 'PAYENG020: invalid income amount'; END IF;
  END LOOP;
  v:=jsonb_populate_record(NULL::public.payroll_income_records,r);
  IF v.driver_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=v.driver_id AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PAYENG020: invalid income driver'; END IF;
  IF length(coalesce(v.driver_name,''))>160 OR length(coalesce(v.source_file,''))>200 OR (v.custom_fields IS NOT NULL AND jsonb_typeof(v.custom_fields)<>'array') OR jsonb_array_length(coalesce(v.custom_fields,'[]'))>50 THEN RAISE EXCEPTION 'PAYENG020: invalid income fields'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(v.custom_fields,'[]')) f WHERE coalesce(f->>'type','') NOT IN ('add','deduct') OR coalesce(length(f->>'name'),0) NOT BETWEEN 1 AND 120 OR jsonb_typeof(f->'amount') IS DISTINCT FROM 'number' OR abs((f->>'amount')::numeric)>999999999) THEN RAISE EXCEPTION 'PAYENG020: invalid custom income amount'; END IF;
  SELECT coalesce(sum(CASE WHEN f->>'type'='deduct' THEN -abs((f->>'amount')::numeric) ELSE abs((f->>'amount')::numeric) END),0) INTO custom_total FROM jsonb_array_elements(coalesce(v.custom_fields,'[]')) f;
  v.total_penalties:=abs(v.acceptance_penalty)+abs(v.contact_penalty)+abs(v.stacking_deduction)+abs(v.declined_penalty)+abs(v.late_penalty)+abs(v.no_show_penalty)+abs(v.no_show_special_penalty)+abs(v.daily_acceptance_penalty)+abs(v.missed_days_penalty)+abs(v.rider_balance);v.total_income:=v.basic_payment+v.distance_payment+v.segment_payment-v.total_penalties+custom_total;
  v.tenant_id:=t;v.month_key:=p_month;v.company_name:=p_company;v.created_by:=actor;v.updated_at:=now();v.driver_name:=coalesce(v.driver_name,'');
  SELECT id INTO existing FROM public.payroll_income_records WHERE tenant_id=t AND month_key=p_month AND company_name=p_company AND rider_id=v.rider_id FOR UPDATE;
  IF FOUND THEN
   IF NOT p_overwrite OR EXISTS(SELECT 1 FROM public.payroll_income_records WHERE id=existing AND run_id IS NOT NULL) THEN RAISE EXCEPTION 'PAYENG022: existing or payroll-managed income cannot be overwritten'; END IF;
   UPDATE public.payroll_income_records SET driver_id=v.driver_id,driver_name=v.driver_name,basic_payment=v.basic_payment,distance_payment=v.distance_payment,segment_payment=v.segment_payment,acceptance_penalty=v.acceptance_penalty,contact_penalty=v.contact_penalty,stacking_deduction=v.stacking_deduction,declined_penalty=v.declined_penalty,late_penalty=v.late_penalty,no_show_penalty=v.no_show_penalty,no_show_special_penalty=v.no_show_special_penalty,daily_acceptance_penalty=v.daily_acceptance_penalty,missed_days_penalty=v.missed_days_penalty,rider_balance=v.rider_balance,custom_fields=v.custom_fields,source_file=v.source_file,total_income=v.total_income,total_penalties=v.total_penalties,updated_at=v.updated_at WHERE id=existing AND tenant_id=t;updated:=updated+1;
  ELSE
   INSERT INTO public.payroll_income_records(tenant_id,month_key,company_name,driver_id,rider_id,driver_name,basic_payment,distance_payment,segment_payment,acceptance_penalty,contact_penalty,stacking_deduction,declined_penalty,late_penalty,no_show_penalty,no_show_special_penalty,daily_acceptance_penalty,missed_days_penalty,rider_balance,custom_fields,source_file,total_income,total_penalties,created_by,updated_at) VALUES(v.tenant_id,v.month_key,v.company_name,v.driver_id,v.rider_id,v.driver_name,v.basic_payment,v.distance_payment,v.segment_payment,v.acceptance_penalty,v.contact_penalty,v.stacking_deduction,v.declined_penalty,v.late_penalty,v.no_show_penalty,v.no_show_special_penalty,v.daily_acceptance_penalty,v.missed_days_penalty,v.rider_balance,v.custom_fields,v.source_file,v.total_income,v.total_penalties,v.created_by,v.updated_at);imported:=imported+1;
  END IF;
 END LOOP;
 result:=jsonb_build_object('imported',imported,'updated',updated);
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,action,new_values) VALUES(t,actor,'payroll','payroll_income_records','income_import_atomic',result||jsonb_build_object('month',p_month,'company',p_company,'request_id',p_request_id));
 INSERT INTO payroll_guard_private.income_receipts VALUES(t,actor,p_request_id,payload_hash,result);
 RETURN result||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.import_my_platform_income(uuid,text,text,jsonb,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.import_my_platform_income(uuid,text,text,jsonb,boolean) TO authenticated;

CREATE FUNCTION payroll_guard_private.protect_managed_income() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF current_user='service_role' AND OLD.run_id IS NOT NULL THEN RAISE EXCEPTION 'PAYENG022: payroll-managed income requires its payroll workflow'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION payroll_guard_private.protect_managed_income() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payroll_income_managed_write BEFORE UPDATE OR DELETE ON public.payroll_income_records FOR EACH ROW EXECUTE FUNCTION payroll_guard_private.protect_managed_income();
NOTIFY pgrst,'reload schema';
COMMIT;
