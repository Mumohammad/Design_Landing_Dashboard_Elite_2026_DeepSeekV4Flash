BEGIN;
-- Forward-only: no existing attendance, financial, or salary rows are backfilled.
CREATE SCHEMA IF NOT EXISTS payroll_private;
REVOKE ALL ON SCHEMA payroll_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA payroll_private TO authenticated;
ALTER TABLE public.attendance_periods ADD COLUMN preparation_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.payroll_advances ADD COLUMN preparation_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.payroll_advances ADD COLUMN request_id uuid;
CREATE UNIQUE INDEX payroll_advance_request_unique ON public.payroll_advances(tenant_id,request_id) WHERE request_id IS NOT NULL;
CREATE TABLE public.payroll_preparation_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 driver_id uuid NOT NULL REFERENCES public.drivers(id), period_year integer NOT NULL, period_month integer NOT NULL CHECK(period_month BETWEEN 1 AND 12),
 version integer NOT NULL DEFAULT 1, attendance_reviewed boolean NOT NULL DEFAULT false, orders_reviewed boolean NOT NULL DEFAULT false,
 attendance_note text, orders_note text, reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz, locked_at timestamptz,
 UNIQUE(tenant_id,driver_id,period_year,period_month)
);
ALTER TABLE public.payroll_preparation_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_preparation_read ON public.payroll_preparation_reviews FOR SELECT TO authenticated
 USING(tenant_id = public.get_my_tenant_id() AND public.user_has_permission('payroll','read'));
-- New tables must not inherit Supabase default table-write/DDL grants.
-- RLS does not protect TRUNCATE; preparation writes go through reviewed RPCs.
REVOKE ALL ON public.payroll_preparation_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payroll_preparation_reviews TO authenticated;
-- The mutation API is the sole authenticated writer of derived and reviewed inputs.
REVOKE INSERT, UPDATE, DELETE ON public.payroll_preparation_reviews, public.attendance_periods,
 public.driver_attendance_summary, public.monthly_driver_orders, public.driver_payroll_rules, public.payroll_advances FROM authenticated;

CREATE FUNCTION payroll_private.actor(p_permission text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid;
BEGIN
 t := public.get_my_tenant_id();
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('payroll',p_permission) THEN
  RAISE EXCEPTION 'PAY_PREPARATION_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 RETURN t;
END; $$;

CREATE FUNCTION payroll_private.rule_complete(r jsonb, c text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE f text; fields text[];
BEGIN
 fields := ARRAY['working_days_target','target_orders','minimum_net_floor'];
 IF c='sponsored_type2' THEN fields := fields || ARRAY['package_amount','threshold_orders','car_rent_deduction'];
 ELSIF c IN ('sponsored_type1','freelancer') THEN fields := fields || ARRAY['base_salary','bonus_rate','deduction_rate'];
 ELSE RETURN false; END IF;
 IF c='freelancer' THEN fields := fields || ARRAY['bonus_cap','deduction_cap']; END IF;
 FOREACH f IN ARRAY fields LOOP
  IF r->>f IS NULL OR (r->>f)::numeric < 0 OR (r->>f)::numeric > 99999999.99
   OR (r->>f)::numeric != round((r->>f)::numeric,2) THEN RETURN false; END IF;
 END LOOP;
 RETURN r->>'category'=c AND (r->>'working_days_target')::numeric BETWEEN 1 AND 31
  AND (r->>'working_days_target')::numeric=trunc((r->>'working_days_target')::numeric)
  AND (r->>'target_orders')::numeric=trunc((r->>'target_orders')::numeric)
  AND (c!='sponsored_type2' OR (r->>'threshold_orders')::numeric=trunc((r->>'threshold_orders')::numeric));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END; $$;

CREATE FUNCTION payroll_private.assert_source_open(t uuid, d date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text || ':' || to_char(d,'YYYY-MM'),0));
 IF EXISTS(SELECT 1 FROM public.attendance_periods WHERE tenant_id=t AND period_year=extract(year FROM d)
  AND period_month=extract(month FROM d) AND deleted_at IS NULL AND status='locked') THEN
  RAISE EXCEPTION 'PAY_PREPARATION_LOCKED';
 END IF;
END; $$;
CREATE FUNCTION payroll_private.source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d date; t uuid; dr uuid; yy integer; mm integer;
BEGIN
 -- Check BOTH identities so a move cannot bypass an old locked period.
 IF TG_OP!='INSERT' THEN
  d := (to_jsonb(OLD)->>CASE WHEN TG_TABLE_NAME='driver_attendance' THEN 'attendance_date' ELSE 'entry_date' END)::date;
  PERFORM payroll_private.assert_source_open(OLD.tenant_id,d);
  IF OLD.is_locked THEN RAISE EXCEPTION 'PAY_SOURCE_LOCKED'; END IF;
 END IF;
 IF TG_OP!='DELETE' THEN
  d := (to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='driver_attendance' THEN 'attendance_date' ELSE 'entry_date' END)::date;
  PERFORM payroll_private.assert_source_open(NEW.tenant_id,d);
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER payroll_attendance_lock BEFORE INSERT OR UPDATE OR DELETE ON public.driver_attendance
 FOR EACH ROW EXECUTE FUNCTION payroll_private.source_guard();
CREATE TRIGGER payroll_orders_lock BEFORE INSERT OR UPDATE OR DELETE ON public.daily_order_entries
 FOR EACH ROW EXECUTE FUNCTION payroll_private.source_guard();
CREATE FUNCTION payroll_private.source_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; d date; t uuid; dr uuid; yy integer; mm integer; i integer;
BEGIN
 -- Invalidate both old and new driver/month after reassignment, archive, or delete.
 FOR i IN 1..2 LOOP
  IF (i=1 AND TG_OP='INSERT') OR (i=2 AND TG_OP='DELETE') THEN CONTINUE; END IF;
  row_data := CASE WHEN i=1 THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  d := (row_data->>CASE WHEN TG_TABLE_NAME='driver_attendance' THEN 'attendance_date' ELSE 'entry_date' END)::date;
  t := (row_data->>'tenant_id')::uuid; dr := (row_data->>'driver_id')::uuid;
  yy := extract(year FROM d); mm := extract(month FROM d);
  INSERT INTO public.payroll_preparation_reviews(tenant_id,driver_id,period_year,period_month)
   VALUES(t,dr,yy,mm) ON CONFLICT(tenant_id,driver_id,period_year,period_month) DO NOTHING;
  UPDATE public.payroll_preparation_reviews SET version=version+1,
   attendance_reviewed=CASE WHEN TG_TABLE_NAME='driver_attendance' THEN false ELSE attendance_reviewed END,
   orders_reviewed=CASE WHEN TG_TABLE_NAME='daily_order_entries' THEN false ELSE orders_reviewed END
   WHERE tenant_id=t AND driver_id=dr AND period_year=yy AND period_month=mm;
  UPDATE public.attendance_periods SET preparation_version=preparation_version+1
   WHERE tenant_id=t AND period_year=yy AND period_month=mm AND deleted_at IS NULL;
 END LOOP;
 RETURN NULL;
END; $$;
CREATE TRIGGER payroll_attendance_changed AFTER INSERT OR UPDATE OR DELETE ON public.driver_attendance
 FOR EACH ROW EXECUTE FUNCTION payroll_private.source_changed();
CREATE TRIGGER payroll_orders_changed AFTER INSERT OR UPDATE OR DELETE ON public.daily_order_entries
 FOR EACH ROW EXECUTE FUNCTION payroll_private.source_changed();

-- Reviewed period amounts are explicit owner inputs, never inferred from wages.
CREATE TABLE public.payroll_period_bases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),driver_id uuid NOT NULL REFERENCES public.drivers(id),
 period_year integer NOT NULL CHECK(period_year BETWEEN 2000 AND 2100),period_month integer NOT NULL CHECK(period_month BETWEEN 1 AND 12),
 version integer NOT NULL DEFAULT 1,mode text NOT NULL CHECK(mode IN('full_month_rule','reviewed_period')),
 rule_id uuid NOT NULL REFERENCES public.driver_payroll_rules(id),rule_snapshot jsonb NOT NULL,employment_snapshot jsonb NOT NULL,
 employed_from date NOT NULL,employed_to date NOT NULL,
 period_base_amount numeric(10,2),period_order_target integer,period_absence_deduction numeric(10,2),period_minimum_floor numeric(10,2),
 period_package_threshold integer,period_rent_deduction numeric(10,2),review_note text NOT NULL,approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL DEFAULT now(),locked_at timestamptz,
 UNIQUE(tenant_id,driver_id,period_year,period_month),CHECK(employed_from<=employed_to),
 CHECK(mode='full_month_rule' OR (period_base_amount>=0 AND period_base_amount IS NOT NULL AND period_order_target>=0 AND period_order_target IS NOT NULL
  AND period_absence_deduction>=0 AND period_absence_deduction IS NOT NULL AND period_minimum_floor>=0 AND period_minimum_floor IS NOT NULL)),
 CHECK(period_package_threshold IS NULL OR period_package_threshold>=0),CHECK(period_rent_deduction IS NULL OR period_rent_deduction>=0)
);
CREATE INDEX payroll_basis_driver_fk ON public.payroll_period_bases(driver_id);
CREATE INDEX payroll_basis_rule_fk ON public.payroll_period_bases(rule_id);
CREATE INDEX payroll_basis_approver_fk ON public.payroll_period_bases(approved_by);
ALTER TABLE public.payroll_period_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_basis_read ON public.payroll_period_bases FOR SELECT TO authenticated USING(tenant_id=public.get_my_tenant_id() AND public.user_has_permission('payroll','read'));
REVOKE ALL ON public.payroll_period_bases FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payroll_period_bases TO authenticated;
ALTER TABLE public.driver_payroll_periods ADD COLUMN period_basis_id uuid REFERENCES public.payroll_period_bases(id);
CREATE INDEX payroll_period_basis_fk ON public.driver_payroll_periods(period_basis_id) WHERE period_basis_id IS NOT NULL;

CREATE FUNCTION payroll_private.employment_snapshot(d public.drivers) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',d.id,'hire_date',d.hire_date,'termination_date',d.termination_date,'category',d.category,'status',d.status,'nationality_code',d.nationality_code);
$$;
CREATE FUNCTION payroll_private.employment_window(d public.drivers,start_d date,end_d date) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE issue text; included boolean; from_d date; to_d date;
BEGIN
 IF d.status='draft' THEN RETURN jsonb_build_object('participates',false,'issue',NULL); END IF;
 issue:=CASE WHEN d.hire_date IS NULL THEN 'PAY_HIRE_DATE_REQUIRED'
  WHEN d.termination_date<d.hire_date THEN 'PAY_EMPLOYMENT_DATES_INVALID'
  WHEN d.status IN('terminated','blacklisted') AND d.termination_date IS NULL THEN 'PAY_TERMINATION_DATE_REQUIRED'
  WHEN d.status IN('active','on_leave','suspended') AND d.termination_date IS NOT NULL THEN 'PAY_EMPLOYMENT_STATUS_DATES_MISMATCH' END;
 included:=issue IS NOT NULL OR (d.hire_date<=end_d AND (d.termination_date IS NULL OR d.termination_date>=start_d));
 from_d:=greatest(d.hire_date,start_d);to_d:=least(COALESCE(d.termination_date,end_d),end_d);
 RETURN jsonb_build_object('participates',included,'issue',issue,'from',from_d,'to',to_d,'requiresBasis',from_d>start_d OR to_d<end_d);
END; $$;
CREATE FUNCTION payroll_private.basis_locked_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.locked_at IS NOT NULL AND (TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN RAISE EXCEPTION 'PAY_BASIS_LOCKED'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER payroll_basis_locked BEFORE UPDATE OR DELETE ON public.payroll_period_bases FOR EACH ROW EXECUTE FUNCTION payroll_private.basis_locked_guard();
CREATE FUNCTION payroll_private.employment_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF payroll_private.employment_snapshot(NEW) IS DISTINCT FROM payroll_private.employment_snapshot(OLD) THEN
  UPDATE public.payroll_preparation_reviews r SET attendance_reviewed=false,orders_reviewed=false,version=version+1
   WHERE tenant_id=OLD.tenant_id AND driver_id=OLD.id AND locked_at IS NULL;
  UPDATE public.attendance_periods a SET preparation_version=preparation_version+1
   WHERE tenant_id=OLD.tenant_id AND status='open' AND deleted_at IS NULL;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER payroll_employment_changed AFTER UPDATE OF hire_date,termination_date,category,status,nationality_code ON public.drivers FOR EACH ROW EXECUTE FUNCTION payroll_private.employment_changed();

CREATE FUNCTION payroll_private.mutate(p_action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE win jsonb; basis public.payroll_period_bases%ROWTYPE; rule_start date;
 t uuid; actor uuid := auth.uid(); yy integer; mm integer; start_d date; end_d date; dr uuid;
 ap public.attendance_periods%ROWTYPE; rv public.payroll_preparation_reviews%ROWTYPE; rule public.driver_payroll_rules%ROWTYPE;
 adv public.payroll_advances%ROWTYPE; pay public.driver_payroll_periods%ROWTYPE; driver public.drivers%ROWTYPE;
 obj jsonb; day_row jsonb; before_row jsonb; entity uuid; expected integer; n integer; cnt integer; total numeric; revenue numeric; note text;
BEGIN
 t := payroll_private.actor(CASE WHEN p_action IN ('lock','basis_save') OR (p_action='advance_transition' AND p->>'to' IN ('approved','repaid')) THEN 'approve'
  WHEN p_action='open' OR (p_action IN ('rule_save','advance_save') AND p->>'id' IS NULL) THEN 'create' ELSE 'update' END);
 note := btrim(COALESCE(p->>'note',p->>'reason',''));
 IF p_action!='open' AND (length(note)<5 OR length(note)>1000) THEN RAISE EXCEPTION 'PAY_REVIEW_NOTE_REQUIRED'; END IF;
 IF p_action IN ('rule_save','rule_archive') THEN
  IF p_action='rule_save' THEN dr := (p->>'driverId')::uuid;
  ELSE SELECT driver_id INTO dr FROM public.driver_payroll_rules WHERE id=(p->>'id')::uuid AND tenant_id=t; END IF;
  SELECT * INTO driver FROM public.drivers WHERE id=dr AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY_DRIVER_NOT_FOUND'; END IF;
  IF p->>'id' IS NOT NULL THEN
   SELECT * INTO rule FROM public.driver_payroll_rules WHERE id=(p->>'id')::uuid AND tenant_id=t AND driver_id=dr AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND OR rule.version IS DISTINCT FROM (p->>'expectedVersion')::integer THEN RAISE EXCEPTION 'PAY_STALE_VERSION'; END IF;
   IF EXISTS(SELECT 1 FROM public.driver_payroll_periods WHERE payroll_rule_id=rule.id)
    OR EXISTS(SELECT 1 FROM public.payroll_preparation_reviews WHERE tenant_id=t AND driver_id=dr AND locked_at IS NOT NULL
      AND make_date(period_year,period_month,1)>=date_trunc('month',rule.effective_date)) THEN RAISE EXCEPTION 'PAY_RULE_HISTORY_IMMUTABLE'; END IF;
   before_row := to_jsonb(rule);
  END IF;
  IF p_action='rule_archive' THEN
   UPDATE public.driver_payroll_rules SET is_active=false,version=version+1,updated_by=actor WHERE id=rule.id RETURNING id INTO entity;
  ELSE
   obj := jsonb_build_object('category',p->>'category','working_days_target',p->'workingDaysTarget','target_orders',p->'targetOrders',
    'base_salary',p->'baseSalary','bonus_rate',p->'bonusRate','deduction_rate',p->'deductionRate','package_amount',p->'packageAmount',
    'threshold_orders',p->'thresholdOrders','car_rent_deduction',p->'carRentDeduction','bonus_cap',p->'bonusCap',
    'deduction_cap',p->'deductionCap','minimum_net_floor',p->'minimumNetFloor');
   IF NOT payroll_private.rule_complete(obj,driver.category::text) THEN RAISE EXCEPTION 'PAY_RULE_INCOMPLETE'; END IF;
   IF EXISTS(SELECT 1 FROM public.driver_payroll_rules WHERE tenant_id=t AND driver_id=dr AND is_active AND deleted_at IS NULL
    AND effective_date=(p->>'effectiveDate')::date AND id IS DISTINCT FROM rule.id) THEN RAISE EXCEPTION 'PAY_RULE_EFFECTIVE_DATE_EXISTS'; END IF;
   IF EXISTS(SELECT 1 FROM public.attendance_periods WHERE tenant_id=t AND status='locked' AND deleted_at IS NULL
    AND end_date >= (p->>'effectiveDate')::date) THEN RAISE EXCEPTION 'PAY_RULE_LOCKED_PERIOD'; END IF;
   IF rule.id IS NULL THEN
    INSERT INTO public.driver_payroll_rules(tenant_id,driver_id,category,effective_date,created_by)
    VALUES(t,dr,driver.category,(p->>'effectiveDate')::date,actor) RETURNING id INTO entity;
   ELSE entity := rule.id; END IF;
   UPDATE public.driver_payroll_rules SET
    base_salary=(obj->>'base_salary')::numeric,working_days_target=(obj->>'working_days_target')::integer,target_orders=(obj->>'target_orders')::integer,
    bonus_rate=(obj->>'bonus_rate')::numeric,deduction_rate=(obj->>'deduction_rate')::numeric,package_amount=(obj->>'package_amount')::numeric,
    threshold_orders=(obj->>'threshold_orders')::integer,car_rent_deduction=(obj->>'car_rent_deduction')::numeric,
    bonus_cap=(obj->>'bonus_cap')::numeric,deduction_cap=(obj->>'deduction_cap')::numeric,minimum_net_floor=(obj->>'minimum_net_floor')::numeric,
    effective_date=(p->>'effectiveDate')::date,custom_notes=note,version=CASE WHEN rule.id IS NULL THEN 1 ELSE version+1 END,updated_by=actor
    WHERE id=entity;
  END IF;
  UPDATE public.attendance_periods SET preparation_version=preparation_version+1 WHERE tenant_id=t AND status='open' AND deleted_at IS NULL
   AND end_date>=CASE WHEN p_action='rule_save' THEN (p->>'effectiveDate')::date ELSE rule.effective_date END;
 ELSIF p_action IN ('advance_save','advance_transition') THEN
  IF p_action='advance_save' THEN dr := (p->>'driverId')::uuid;
  ELSE SELECT driver_id INTO dr FROM public.payroll_advances WHERE id=(p->>'id')::uuid AND tenant_id=t; END IF;
  SELECT * INTO driver FROM public.drivers WHERE id=dr AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY_DRIVER_NOT_FOUND'; END IF;
  IF p->>'id' IS NOT NULL THEN
   SELECT * INTO adv FROM public.payroll_advances WHERE id=(p->>'id')::uuid AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND OR adv.preparation_version IS DISTINCT FROM (p->>'expectedVersion')::integer THEN RAISE EXCEPTION 'PAY_STALE_VERSION'; END IF;
   before_row := to_jsonb(adv);
  END IF;
  IF p_action='advance_save' THEN
   IF adv.id IS NOT NULL AND adv.status!='pending' THEN RAISE EXCEPTION 'PAY_ADVANCE_HISTORY_IMMUTABLE'; END IF;
   IF (p->>'amount')::numeric<=0 OR (p->>'amount')::numeric!=round((p->>'amount')::numeric,2)
    OR p->>'repaymentMonth' !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    OR p->>'repaymentMonth'<left(p->>'advanceDate',7) THEN RAISE EXCEPTION 'PAY_ADVANCE_INVALID'; END IF;
   IF adv.id IS NULL THEN
    IF p->>'requestId' IS NULL THEN RAISE EXCEPTION 'PAY_ADVANCE_REQUEST_ID_REQUIRED'; END IF;
    SELECT * INTO adv FROM public.payroll_advances WHERE tenant_id=t AND request_id=(p->>'requestId')::uuid FOR UPDATE;
    IF FOUND THEN
     IF adv.driver_id IS DISTINCT FROM dr OR adv.created_by IS DISTINCT FROM actor OR adv.amount IS DISTINCT FROM (p->>'amount')::numeric
      OR adv.advance_date IS DISTINCT FROM (p->>'advanceDate')::date OR adv.repayment_month IS DISTINCT FROM p->>'repaymentMonth'
      OR adv.reason IS DISTINCT FROM note THEN RAISE EXCEPTION 'PAY_ADVANCE_RETRY_MISMATCH'; END IF;
     RETURN jsonb_build_object('id',adv.id);
    END IF;
    INSERT INTO public.payroll_advances(tenant_id,driver_id,request_id,amount,advance_date,repayment_month,reason,created_by)
    VALUES(t,dr,(p->>'requestId')::uuid,(p->>'amount')::numeric,(p->>'advanceDate')::date,p->>'repaymentMonth',note,actor) RETURNING id INTO entity;
   ELSE
    UPDATE public.payroll_advances SET amount=(p->>'amount')::numeric,advance_date=(p->>'advanceDate')::date,
     repayment_month=p->>'repaymentMonth',reason=note,preparation_version=preparation_version+1,updated_by=actor WHERE id=adv.id RETURNING id INTO entity;
   END IF;
  ELSE
   IF NOT ((adv.status='pending' AND p->>'to' IN ('approved','cancelled')) OR (adv.status='approved' AND p->>'to' IN ('repaid','cancelled'))) THEN RAISE EXCEPTION 'PAY_ADVANCE_TRANSITION_INVALID'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':'||adv.repayment_month,0));
   IF p->>'to' IN ('approved','cancelled') AND (adv.status='approved' OR p->>'to'='approved') AND EXISTS(
    SELECT 1 FROM public.driver_payroll_periods WHERE tenant_id=t AND driver_id=dr AND period_year=left(adv.repayment_month,4)::integer
     AND period_month=right(adv.repayment_month,2)::integer AND deleted_at IS NULL AND status!='cancelled') THEN RAISE EXCEPTION 'PAY_ADVANCE_PAYROLL_EXISTS'; END IF;
   IF p->>'to'='repaid' THEN
    SELECT * INTO pay FROM public.driver_payroll_periods WHERE id=(p->>'payrollPeriodId')::uuid AND tenant_id=t AND driver_id=dr
     AND status='paid' AND deleted_at IS NULL AND period_year=left(adv.repayment_month,4)::integer AND period_month=right(adv.repayment_month,2)::integer FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAY_ADVANCE_PAID_PAYROLL_REQUIRED'; END IF;
    SELECT COALESCE(sum(amount),0) INTO total FROM public.payroll_advances WHERE tenant_id=t AND driver_id=dr AND repayment_month=adv.repayment_month
     AND deleted_at IS NULL AND (status='approved' OR (status='repaid' AND payroll_period_id=pay.id));
    IF total!=pay.advance_deduction THEN RAISE EXCEPTION 'PAY_ADVANCE_REPAYMENT_MISMATCH'; END IF;
   END IF;
   UPDATE public.payroll_advances SET status=p->>'to',approved_by=CASE WHEN p->>'to'='approved' THEN actor ELSE approved_by END,
    approved_at=CASE WHEN p->>'to'='approved' THEN now() ELSE approved_at END,repaid_at=CASE WHEN p->>'to'='repaid' THEN now() ELSE repaid_at END,
    payroll_period_id=CASE WHEN p->>'to'='repaid' THEN pay.id ELSE payroll_period_id END,
    notes=note,preparation_version=preparation_version+1,updated_by=actor WHERE id=adv.id RETURNING id INTO entity;
  END IF;
 ELSE
  yy := (p->>'year')::integer; mm := (p->>'month')::integer;
  IF yy IS NULL OR mm IS NULL OR yy NOT BETWEEN 2000 AND 2100 OR mm NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'PAY_PERIOD_INVALID'; END IF;
  start_d := make_date(yy,mm,1); end_d := (start_d+interval '1 month - 1 day')::date;
  PERFORM payroll_private.assert_source_open(t,start_d);
  SELECT * INTO ap FROM public.attendance_periods WHERE tenant_id=t AND period_year=yy AND period_month=mm AND deleted_at IS NULL FOR UPDATE;
  IF p_action='open' THEN
   IF ap.id IS NOT NULL THEN RAISE EXCEPTION 'PAY_PERIOD_ALREADY_EXISTS'; END IF;
   IF (p->>'workingDays')::integer NOT BETWEEN 1 AND extract(day FROM end_d) THEN RAISE EXCEPTION 'PAY_WORKING_DAYS_INVALID'; END IF;
   INSERT INTO public.attendance_periods(tenant_id,period_year,period_month,start_date,end_date,working_days_count,created_by)
    VALUES(t,yy,mm,start_d,end_d,(p->>'workingDays')::integer,actor) RETURNING id INTO entity;
  ELSE
   IF ap.id IS NULL THEN RAISE EXCEPTION 'PAY_OPEN_PERIOD_FIRST'; END IF;
   IF p_action='basis_save' THEN
    dr:=(p->>'driverId')::uuid;
    SELECT * INTO driver FROM public.drivers WHERE id=dr AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAY_DRIVER_NOT_FOUND'; END IF;
    win:=payroll_private.employment_window(driver,start_d,end_d);
    IF NOT (win->>'participates')::boolean THEN RAISE EXCEPTION 'PAY_DRIVER_NOT_FOUND'; END IF;
    IF win->>'issue' IS NOT NULL THEN RAISE EXCEPTION '%',win->>'issue'; END IF;
    IF NOT (win->>'requiresBasis')::boolean THEN RAISE EXCEPTION 'PAY_PERIOD_BASIS_NOT_REQUIRED'; END IF;
    IF (p->>'employedFrom')::date IS DISTINCT FROM (win->>'from')::date OR (p->>'employedTo')::date IS DISTINCT FROM (win->>'to')::date THEN RAISE EXCEPTION 'PAY_EMPLOYMENT_SNAPSHOT_CHANGED'; END IF;
    SELECT * INTO rule FROM public.driver_payroll_rules WHERE tenant_id=t AND driver_id=dr AND is_active AND deleted_at IS NULL
     AND effective_date<=(win->>'from')::date ORDER BY effective_date DESC,created_at DESC,id LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR NOT payroll_private.rule_complete(to_jsonb(rule),driver.category::text) THEN RAISE EXCEPTION 'PAY_RULE_INCOMPLETE'; END IF;
    IF rule.base_pay_type IS NOT NULL OR rule.extra_order_rate IS NOT NULL OR rule.under_target_rate IS NOT NULL OR NOT rule.apply_violations OR NOT rule.apply_penalties OR NOT rule.apply_vehicle_deductions OR NOT rule.apply_maintenance THEN RAISE EXCEPTION 'PAY_RULE_UNSUPPORTED'; END IF;
    IF rule.id IS DISTINCT FROM (p->>'ruleId')::uuid OR rule.version IS DISTINCT FROM (p->>'ruleVersion')::integer OR p->>'ratesAcknowledged' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'PAY_RULE_SNAPSHOT_CHANGED'; END IF;
    IF EXISTS(SELECT 1 FROM public.driver_payroll_rules WHERE tenant_id=t AND driver_id=dr AND is_active AND deleted_at IS NULL AND effective_date>(win->>'from')::date AND effective_date<=(win->>'to')::date) THEN RAISE EXCEPTION 'PAY_MIDMONTH_RULE_REQUIRES_SPLIT'; END IF;
    FOREACH note IN ARRAY ARRAY['periodBaseAmount','periodAbsenceDeduction','periodMinimumFloor'] LOOP
     IF p->>note IS NULL OR (p->>note)::numeric<0 OR (p->>note)::numeric>99999999.99 OR (p->>note)::numeric!=round((p->>note)::numeric,2) THEN RAISE EXCEPTION 'PAY_PERIOD_AMOUNTS_REQUIRED'; END IF;
    END LOOP;
    note:=btrim(p->>'note');
    IF p->>'periodOrderTarget' IS NULL OR (p->>'periodOrderTarget')::numeric NOT BETWEEN 0 AND 1000000 OR (p->>'periodOrderTarget')::numeric!=trunc((p->>'periodOrderTarget')::numeric) THEN RAISE EXCEPTION 'PAY_PERIOD_TARGET_REQUIRED'; END IF;
    IF driver.category='sponsored_type2' AND (p->>'periodPackageThreshold' IS NULL OR (p->>'periodPackageThreshold')::numeric NOT BETWEEN 0 AND 1000000
      OR (p->>'periodPackageThreshold')::numeric!=trunc((p->>'periodPackageThreshold')::numeric) OR p->>'periodRentDeduction' IS NULL
      OR (p->>'periodRentDeduction')::numeric<0 OR (p->>'periodRentDeduction')::numeric>99999999.99 OR (p->>'periodRentDeduction')::numeric!=round((p->>'periodRentDeduction')::numeric,2)) THEN RAISE EXCEPTION 'PAY_PERIOD_PACKAGE_VALUES_REQUIRED'; END IF;
    SELECT * INTO basis FROM public.payroll_period_bases WHERE tenant_id=t AND driver_id=dr AND period_year=yy AND period_month=mm FOR UPDATE;
    IF (basis.id IS NULL AND (p->>'expectedVersion')::integer IS DISTINCT FROM 0) OR (basis.id IS NOT NULL AND basis.version IS DISTINCT FROM (p->>'expectedVersion')::integer) THEN RAISE EXCEPTION 'PAY_STALE_VERSION'; END IF;
    before_row:=CASE WHEN basis.id IS NOT NULL THEN to_jsonb(basis) END;
    INSERT INTO public.payroll_period_bases(tenant_id,driver_id,period_year,period_month,mode,rule_id,rule_snapshot,employment_snapshot,employed_from,employed_to,
      period_base_amount,period_order_target,period_absence_deduction,period_minimum_floor,period_package_threshold,period_rent_deduction,review_note,approved_by)
    VALUES(t,dr,yy,mm,'reviewed_period',rule.id,to_jsonb(rule),payroll_private.employment_snapshot(driver),(win->>'from')::date,(win->>'to')::date,
      (p->>'periodBaseAmount')::numeric,(p->>'periodOrderTarget')::integer,(p->>'periodAbsenceDeduction')::numeric,(p->>'periodMinimumFloor')::numeric,
      CASE WHEN driver.category='sponsored_type2' THEN (p->>'periodPackageThreshold')::integer END,CASE WHEN driver.category='sponsored_type2' THEN (p->>'periodRentDeduction')::numeric END,note,actor)
    ON CONFLICT(tenant_id,driver_id,period_year,period_month) DO UPDATE SET version=public.payroll_period_bases.version+1,mode=excluded.mode,
      rule_id=excluded.rule_id,rule_snapshot=excluded.rule_snapshot,employment_snapshot=excluded.employment_snapshot,employed_from=excluded.employed_from,employed_to=excluded.employed_to,
      period_base_amount=excluded.period_base_amount,period_order_target=excluded.period_order_target,period_absence_deduction=excluded.period_absence_deduction,
      period_minimum_floor=excluded.period_minimum_floor,period_package_threshold=excluded.period_package_threshold,period_rent_deduction=excluded.period_rent_deduction,
      review_note=excluded.review_note,approved_by=excluded.approved_by,approved_at=clock_timestamp() RETURNING id INTO entity;
    UPDATE public.attendance_periods SET preparation_version=preparation_version+1 WHERE id=ap.id;
   ELSIF p_action IN ('attendance_save','orders_review') THEN
    dr := (p->>'driverId')::uuid;
    SELECT * INTO driver FROM public.drivers WHERE id=dr AND tenant_id=t AND deleted_at IS NULL AND (payroll_private.employment_window(drivers,start_d,end_d)->>'participates')::boolean FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAY_DRIVER_NOT_FOUND'; END IF;
    win:=payroll_private.employment_window(driver,start_d,end_d);
    IF win->>'issue' IS NOT NULL THEN RAISE EXCEPTION '%',win->>'issue'; END IF;
    rule_start:=(win->>'from')::date;
    INSERT INTO public.payroll_preparation_reviews(tenant_id,driver_id,period_year,period_month) VALUES(t,dr,yy,mm)
     ON CONFLICT(tenant_id,driver_id,period_year,period_month) DO NOTHING;
    SELECT * INTO rv FROM public.payroll_preparation_reviews WHERE tenant_id=t AND driver_id=dr AND period_year=yy AND period_month=mm FOR UPDATE;
    IF (p->>'expectedVersion')::integer IS NULL OR (rv.version!=(p->>'expectedVersion')::integer AND NOT (rv.version=1 AND (p->>'expectedVersion')::integer=0)) THEN RAISE EXCEPTION 'PAY_STALE_VERSION'; END IF;
    IF p_action='attendance_save' THEN
     IF jsonb_typeof(p->'days')!='array' OR jsonb_array_length(p->'days')!=((win->>'to')::date-(win->>'from')::date+1) THEN RAISE EXCEPTION 'PAY_ATTENDANCE_INCOMPLETE'; END IF;
     SELECT count(DISTINCT x->>'date') INTO cnt FROM jsonb_array_elements(p->'days') x WHERE (x->>'date')::date BETWEEN (win->>'from')::date AND (win->>'to')::date;
     IF cnt!=((win->>'to')::date-(win->>'from')::date+1) THEN RAISE EXCEPTION 'PAY_ATTENDANCE_INCOMPLETE'; END IF;
     FOR day_row IN SELECT value FROM jsonb_array_elements(p->'days') LOOP
      INSERT INTO public.driver_attendance(tenant_id,driver_id,attendance_date,status,entry_method,notes,created_by)
       VALUES(t,dr,(day_row->>'date')::date,(day_row->>'status')::public.attendance_status,'manual',note,actor)
       ON CONFLICT(tenant_id,attendance_date,driver_id) DO UPDATE SET status=excluded.status,notes=excluded.notes,updated_by=actor,deleted_at=NULL;
     END LOOP;
     UPDATE public.payroll_preparation_reviews SET attendance_reviewed=true,attendance_note=note,reviewed_by=actor,reviewed_at=now(),version=version+1 WHERE id=rv.id;
    ELSE
     SELECT COALESCE(sum(orders_delivered),0),COALESCE(sum(gross_revenue),0) INTO total,revenue FROM public.daily_order_entries
      WHERE tenant_id=t AND driver_id=dr AND entry_date BETWEEN start_d AND end_d AND deleted_at IS NULL;
     IF total IS DISTINCT FROM (p->>'delivered')::numeric OR revenue IS DISTINCT FROM (p->>'revenue')::numeric THEN RAISE EXCEPTION 'PAY_ORDER_TOTALS_CHANGED'; END IF;
     UPDATE public.payroll_preparation_reviews SET orders_reviewed=true,orders_note=note,reviewed_by=actor,reviewed_at=now(),version=version+1 WHERE id=rv.id;
     UPDATE public.attendance_periods SET preparation_version=preparation_version+1 WHERE id=ap.id;
    END IF;
    entity := rv.id;
   ELSIF p_action='lock' THEN
    IF ap.preparation_version IS DISTINCT FROM (p->>'expectedVersion')::integer THEN RAISE EXCEPTION 'PAY_STALE_VERSION'; END IF;
    IF EXISTS(SELECT 1 FROM public.driver_payroll_periods WHERE tenant_id=t AND period_year=yy AND period_month=mm AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PAY_EXISTING_PAYROLL_REQUIRES_REVIEW'; END IF;
    SELECT count(*) INTO cnt FROM public.drivers WHERE tenant_id=t AND deleted_at IS NULL AND (payroll_private.employment_window(drivers,start_d,end_d)->>'participates')::boolean;
    IF cnt=0 THEN RAISE EXCEPTION 'PAY_NO_ACTIVE_DRIVERS'; END IF;
    IF EXISTS(SELECT 1 FROM public.driver_attendance a JOIN public.drivers d ON d.id=a.driver_id AND d.tenant_id=a.tenant_id WHERE a.tenant_id=t AND a.deleted_at IS NULL AND a.attendance_date BETWEEN start_d AND end_d
      AND (NOT (payroll_private.employment_window(d,start_d,end_d)->>'participates')::boolean OR a.attendance_date NOT BETWEEN greatest(d.hire_date,start_d) AND least(COALESCE(d.termination_date,end_d),end_d)))
     OR EXISTS(SELECT 1 FROM public.daily_order_entries a JOIN public.drivers d ON d.id=a.driver_id AND d.tenant_id=a.tenant_id WHERE a.tenant_id=t AND a.deleted_at IS NULL AND a.entry_date BETWEEN start_d AND end_d
      AND (NOT (payroll_private.employment_window(d,start_d,end_d)->>'participates')::boolean OR a.entry_date NOT BETWEEN greatest(d.hire_date,start_d) AND least(COALESCE(d.termination_date,end_d),end_d)))
    THEN RAISE EXCEPTION 'PAY_SOURCE_OUTSIDE_EMPLOYMENT_REVIEW_REQUIRED'; END IF;
    FOR driver IN SELECT * FROM public.drivers WHERE tenant_id=t AND deleted_at IS NULL AND (payroll_private.employment_window(drivers,start_d,end_d)->>'participates')::boolean ORDER BY id FOR UPDATE LOOP
     win:=payroll_private.employment_window(driver,start_d,end_d);
     IF win->>'issue' IS NOT NULL THEN RAISE EXCEPTION '%',win->>'issue'; END IF;
     rule_start:=(win->>'from')::date;
     SELECT * INTO rv FROM public.payroll_preparation_reviews WHERE tenant_id=t AND driver_id=driver.id AND period_year=yy AND period_month=mm FOR UPDATE;
     IF rv.id IS NULL OR NOT rv.attendance_reviewed OR NOT rv.orders_reviewed THEN RAISE EXCEPTION 'PAY_DRIVER_INPUTS_UNREVIEWED'; END IF;
     SELECT * INTO rule FROM public.driver_payroll_rules WHERE tenant_id=t AND driver_id=driver.id AND is_active AND deleted_at IS NULL
      AND effective_date<=rule_start ORDER BY effective_date DESC,created_at DESC,id LIMIT 1 FOR UPDATE;
     IF rule.id IS NULL OR NOT payroll_private.rule_complete(to_jsonb(rule),driver.category::text) THEN RAISE EXCEPTION 'PAY_RULE_INCOMPLETE'; END IF;
     IF rule.base_pay_type IS NOT NULL OR rule.extra_order_rate IS NOT NULL OR rule.under_target_rate IS NOT NULL OR NOT rule.apply_violations OR NOT rule.apply_penalties OR NOT rule.apply_vehicle_deductions OR NOT rule.apply_maintenance THEN RAISE EXCEPTION 'PAY_RULE_UNSUPPORTED'; END IF;
     IF EXISTS(SELECT 1 FROM public.driver_payroll_rules WHERE tenant_id=t AND driver_id=driver.id AND is_active AND deleted_at IS NULL
       AND effective_date>rule_start AND effective_date<=(win->>'to')::date) THEN RAISE EXCEPTION 'PAY_MIDMONTH_RULE_REQUIRES_SPLIT'; END IF;
     SELECT count(*) INTO n FROM public.driver_attendance WHERE tenant_id=t AND driver_id=driver.id AND attendance_date BETWEEN start_d AND end_d AND deleted_at IS NULL;
     IF n!=((win->>'to')::date-(win->>'from')::date+1) THEN RAISE EXCEPTION 'PAY_ATTENDANCE_INCOMPLETE'; END IF;
     IF EXISTS(SELECT 1 FROM public.driver_attendance WHERE tenant_id=t AND driver_id=driver.id AND attendance_date BETWEEN start_d AND end_d AND deleted_at IS NULL AND attendance_date NOT BETWEEN (win->>'from')::date AND (win->>'to')::date) THEN RAISE EXCEPTION 'PAY_ATTENDANCE_OUTSIDE_EMPLOYMENT_REVIEW_REQUIRED'; END IF;
     IF EXISTS(SELECT 1 FROM public.driver_attendance_summary WHERE tenant_id=t AND driver_id=driver.id AND period_year=yy AND period_month=mm)
      OR EXISTS(SELECT 1 FROM public.monthly_driver_orders WHERE tenant_id=t AND driver_id=driver.id AND period_year=yy AND period_month=mm) THEN
       RAISE EXCEPTION 'PAY_EXISTING_SUMMARY_REQUIRES_REVIEW'; END IF;
     SELECT * INTO basis FROM public.payroll_period_bases WHERE tenant_id=t AND driver_id=driver.id AND period_year=yy AND period_month=mm FOR UPDATE;
     IF (win->>'requiresBasis')::boolean THEN
      IF basis.id IS NULL OR basis.mode<>'reviewed_period' OR basis.employment_snapshot IS DISTINCT FROM payroll_private.employment_snapshot(driver)
       OR basis.rule_snapshot IS DISTINCT FROM to_jsonb(rule) OR basis.employed_from IS DISTINCT FROM (win->>'from')::date OR basis.employed_to IS DISTINCT FROM (win->>'to')::date THEN RAISE EXCEPTION 'PAY_PERIOD_BASIS_REVIEW_REQUIRED'; END IF;
      UPDATE public.payroll_period_bases SET locked_at=clock_timestamp() WHERE id=basis.id;
     ELSE
      INSERT INTO public.payroll_period_bases(tenant_id,driver_id,period_year,period_month,mode,rule_id,rule_snapshot,employment_snapshot,employed_from,employed_to,review_note,approved_by,locked_at)
      VALUES(t,driver.id,yy,mm,'full_month_rule',rule.id,to_jsonb(rule),payroll_private.employment_snapshot(driver),start_d,end_d,note,actor,clock_timestamp())
      ON CONFLICT(tenant_id,driver_id,period_year,period_month) DO UPDATE SET mode=excluded.mode,version=public.payroll_period_bases.version+1,rule_id=excluded.rule_id,
       rule_snapshot=excluded.rule_snapshot,employment_snapshot=excluded.employment_snapshot,employed_from=excluded.employed_from,employed_to=excluded.employed_to,
       period_base_amount=NULL,period_order_target=NULL,period_absence_deduction=NULL,period_minimum_floor=NULL,period_package_threshold=NULL,period_rent_deduction=NULL,
       review_note=excluded.review_note,approved_by=excluded.approved_by,approved_at=clock_timestamp(),locked_at=excluded.locked_at;
     END IF;
     INSERT INTO public.driver_attendance_summary(tenant_id,driver_id,period_year,period_month,working_days_target,working_days_actual,
      days_present,days_late,days_half_day,days_absent_excused,days_absent_unexcused,days_on_leave,days_public_holiday,days_day_off,total_late_minutes,total_overtime_minutes,created_by)
     SELECT t,driver.id,yy,mm,rule.working_days_target,sum(working_day_value),count(*) FILTER(WHERE status='present'),count(*) FILTER(WHERE status='late'),
      count(*) FILTER(WHERE status='half_day'),count(*) FILTER(WHERE status='absent_excused'),count(*) FILTER(WHERE status='absent_unexcused'),
      count(*) FILTER(WHERE status='on_leave'),count(*) FILTER(WHERE status='public_holiday'),count(*) FILTER(WHERE status='day_off'),sum(late_minutes),sum(overtime_minutes),actor
      FROM public.driver_attendance WHERE tenant_id=t AND driver_id=driver.id AND attendance_date BETWEEN start_d AND end_d AND deleted_at IS NULL;
     -- One row per platform only. Never mix an all-platform rollup with platform totals.
     INSERT INTO public.monthly_driver_orders(tenant_id,driver_id,platform_id,period_year,period_month,total_delivered,total_failed,total_returned,total_revenue,total_distance_km,working_days,created_by)
     SELECT t,driver.id,platform_id,yy,mm,sum(orders_delivered),sum(orders_failed),sum(orders_returned),sum(gross_revenue),sum(COALESCE(total_distance_km,0)),count(DISTINCT entry_date),actor
      FROM public.daily_order_entries WHERE tenant_id=t AND driver_id=driver.id AND entry_date BETWEEN start_d AND end_d AND deleted_at IS NULL GROUP BY platform_id;
     -- Empty reviewed orders are explicitly zero, rather than a missing input.
     IF NOT FOUND THEN INSERT INTO public.monthly_driver_orders(tenant_id,driver_id,platform_id,period_year,period_month,total_delivered,created_by)
      VALUES(t,driver.id,NULL,yy,mm,0,actor); END IF;
    END LOOP;
    UPDATE public.driver_attendance SET is_locked=true,updated_by=actor WHERE tenant_id=t AND attendance_date BETWEEN start_d AND end_d AND deleted_at IS NULL;
    UPDATE public.daily_order_entries SET is_locked=true,updated_by=actor WHERE tenant_id=t AND entry_date BETWEEN start_d AND end_d AND deleted_at IS NULL;
    UPDATE public.payroll_preparation_reviews SET locked_at=now(),attendance_reviewed=true,orders_reviewed=true WHERE tenant_id=t AND period_year=yy AND period_month=mm;
    UPDATE public.attendance_periods SET status='locked',locked_by=actor,locked_at=now(),updated_by=actor,preparation_version=preparation_version+1 WHERE id=ap.id;
    entity := ap.id;
   ELSE RAISE EXCEPTION 'PAY_PREPARATION_ACTION_INVALID'; END IF;
  END IF;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
 VALUES(t,actor,'payroll','payroll_preparation',entity,'payroll_'||p_action,before_row,CASE WHEN p_action='basis_save' THEN (SELECT to_jsonb(x) FROM public.payroll_period_bases x WHERE id=entity) ELSE jsonb_build_object('note',note,'year',yy,'month',mm,'driver_id',dr) END);
 RETURN jsonb_build_object('id',entity);
END; $$;
CREATE FUNCTION public.payroll_preparation_mutate(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payroll_private.mutate(p_action,p_payload); $$;

CREATE FUNCTION payroll_private.read_period(p_year integer,p_month integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid; start_d date; end_d date;
BEGIN
 t := payroll_private.actor('read');
 IF p_year NOT BETWEEN 2000 AND 2100 OR p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'PAY_PERIOD_INVALID'; END IF;
 start_d := make_date(p_year,p_month,1); end_d := (start_d+interval '1 month - 1 day')::date;
 RETURN jsonb_build_object(
  'period',(SELECT to_jsonb(a) FROM public.attendance_periods a WHERE tenant_id=t AND period_year=p_year AND period_month=p_month AND deleted_at IS NULL),
  'drivers',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',d.id,'name',d.full_name_ar,'code',d.driver_code,'category',COALESCE(b.employment_snapshot->>'category',d.category::text),
    'employment',CASE WHEN b.locked_at IS NOT NULL THEN jsonb_build_object('participates',true,'from',b.employed_from,'to',b.employed_to,'requiresBasis',b.mode='reviewed_period','issue',NULL) ELSE payroll_private.employment_window(d,start_d,end_d) END)),'[]')
   FROM public.drivers d LEFT JOIN public.payroll_period_bases b ON b.tenant_id=t AND b.driver_id=d.id AND b.period_year=p_year AND b.period_month=p_month
   WHERE d.tenant_id=t AND (b.locked_at IS NOT NULL OR (d.deleted_at IS NULL AND (payroll_private.employment_window(d,start_d,end_d)->>'participates')::boolean))),
  'bases',(SELECT COALESCE(jsonb_agg(to_jsonb(b)||jsonb_build_object('is_current',b.employment_snapshot=payroll_private.employment_snapshot(d) AND b.rule_snapshot=to_jsonb(r))),'[]')
   FROM public.payroll_period_bases b JOIN public.drivers d ON d.id=b.driver_id JOIN public.driver_payroll_rules r ON r.id=b.rule_id WHERE b.tenant_id=t AND b.period_year=p_year AND b.period_month=p_month),
  'rules',(SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]') FROM public.driver_payroll_rules r WHERE tenant_id=t AND deleted_at IS NULL),
  'reviews',(SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]') FROM public.payroll_preparation_reviews r WHERE tenant_id=t AND period_year=p_year AND period_month=p_month),
  'attendance',(SELECT COALESCE(jsonb_agg(jsonb_build_object('driver_id',driver_id,'date',attendance_date,'status',status)),'[]') FROM public.driver_attendance WHERE tenant_id=t AND attendance_date BETWEEN start_d AND end_d AND deleted_at IS NULL),
  'orders',(SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT driver_id,sum(orders_delivered) delivered,sum(gross_revenue) revenue,count(*) entries FROM public.daily_order_entries WHERE tenant_id=t AND entry_date BETWEEN start_d AND end_d AND deleted_at IS NULL GROUP BY driver_id) x),
  'advances',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY created_at DESC),'[]') FROM public.payroll_advances a WHERE tenant_id=t AND deleted_at IS NULL AND repayment_month=to_char(start_d,'YYYY-MM')),
  'paidPayroll',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'driver_id',driver_id)),'[]') FROM public.driver_payroll_periods WHERE tenant_id=t AND period_year=p_year AND period_month=p_month AND status='paid' AND deleted_at IS NULL),
  'defaults',(SELECT COALESCE(jsonb_object_agg(key,value),'{}') FROM public.system_settings WHERE tenant_id=t AND deleted_at IS NULL AND key IN ('payroll.default_working_days','payroll.min_net_floor','payroll.saudi_minimum_wage'))
 );
END; $$;
CREATE FUNCTION public.payroll_preparation_read(p_year integer,p_month integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payroll_private.read_period(p_year,p_month); $$;
-- Derived rows are immutable once the preparation has been locked, even to a service-role caller.
CREATE FUNCTION payroll_private.derived_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP!='INSERT' THEN
  PERFORM payroll_private.assert_source_open(OLD.tenant_id,make_date(OLD.period_year,OLD.period_month,1));
 END IF;
 IF TG_OP!='DELETE' THEN
  PERFORM payroll_private.assert_source_open(NEW.tenant_id,make_date(NEW.period_year,NEW.period_month,1));
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER payroll_summary_locked BEFORE INSERT OR UPDATE OR DELETE ON public.driver_attendance_summary
 FOR EACH ROW EXECUTE FUNCTION payroll_private.derived_guard();
CREATE TRIGGER payroll_monthly_orders_locked BEFORE INSERT OR UPDATE OR DELETE ON public.monthly_driver_orders
 FOR EACH ROW EXECUTE FUNCTION payroll_private.derived_guard();
CREATE FUNCTION payroll_private.payroll_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE approved_total numeric; violation_total numeric;
BEGIN
 IF TG_OP='UPDATE' AND NEW.advance_deduction IS NOT DISTINCT FROM OLD.advance_deduction
  AND NEW.violations_deduction IS NOT DISTINCT FROM OLD.violations_deduction
  AND NEW.calculated_at IS NOT DISTINCT FROM OLD.calculated_at THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':'||to_char(make_date(NEW.period_year,NEW.period_month,1),'YYYY-MM'),0));
 SELECT COALESCE(sum(amount),0) INTO approved_total FROM public.payroll_advances WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id
  AND repayment_month=to_char(make_date(NEW.period_year,NEW.period_month,1),'YYYY-MM') AND status='approved' AND deleted_at IS NULL;
 IF approved_total IS DISTINCT FROM NEW.advance_deduction THEN RAISE EXCEPTION 'PAY_ADVANCE_SNAPSHOT_CHANGED'; END IF;
 SELECT COALESCE(sum(deduction_amount),0) INTO violation_total FROM public.violation_deduction_ledger WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id
  AND deduction_month=to_char(make_date(NEW.period_year,NEW.period_month,1),'YYYY-MM') AND status='pending' AND deleted_at IS NULL;
 IF violation_total IS DISTINCT FROM NEW.violations_deduction THEN RAISE EXCEPTION 'PAY_VIOLATION_SNAPSHOT_CHANGED'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payroll_advance_snapshot BEFORE INSERT OR UPDATE ON public.driver_payroll_periods
 FOR EACH ROW EXECUTE FUNCTION payroll_private.payroll_snapshot_guard();
CREATE FUNCTION payroll_private.locked_period_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.status='locked' AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at')) THEN
  RAISE EXCEPTION 'PAY_PREPARATION_LOCKED';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER payroll_period_lock_immutable BEFORE UPDATE OR DELETE ON public.attendance_periods
 FOR EACH ROW EXECUTE FUNCTION payroll_private.locked_period_guard();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA payroll_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payroll_private.mutate(text,jsonb),payroll_private.read_period(integer,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.payroll_preparation_mutate(text,jsonb),public.payroll_preparation_read(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_preparation_mutate(text,jsonb),public.payroll_preparation_read(integer,integer) TO authenticated;
CREATE FUNCTION payroll_private.periods_page(p_year integer,p_page integer,p_search text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid; rows jsonb; total bigint; stats jsonb;
BEGIN
 t := payroll_private.actor('read');
 IF p_year NOT BETWEEN 2000 AND 2100 OR p_page IS NULL OR p_page<0 OR p_page>100000 OR length(COALESCE(p_search,''))>200 THEN RAISE EXCEPTION 'PAY_PAGE_INVALID'; END IF;
 WITH filtered AS (
  SELECT pp.* FROM public.driver_payroll_periods pp JOIN public.drivers d ON d.id=pp.driver_id AND d.tenant_id=pp.tenant_id
  WHERE pp.tenant_id=t AND pp.period_year=p_year AND pp.deleted_at IS NULL
   AND (COALESCE(p_search,'')='' OR d.full_name_ar ILIKE '%'||p_search||'%' OR d.driver_code ILIKE '%'||p_search||'%')
 ) SELECT count(*),jsonb_build_object('net',COALESCE(sum(net_payroll) FILTER(WHERE status<>'cancelled'),0),'approved',count(*) FILTER(WHERE status IN ('approved','paid')),
  'delivered',COALESCE(sum(orders_achieved) FILTER(WHERE status<>'cancelled'),0)) INTO total,stats FROM filtered;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.period_month DESC,x.created_at DESC,x.id DESC),'[]') INTO rows FROM (
  SELECT pp.id,pp.driver_id,pp.period_year,pp.period_month,pp.status,pp.net_payroll,pp.base_amount,pp.orders_bonus,pp.total_deductions,pp.cod_deduction,
   pp.orders_achieved,pp.orders_prorated_target,pp.orders_variance,pp.below_minimum_wage,pp.minimum_floor_applied,pp.manual_override,pp.created_at,
   jsonb_build_object('full_name_ar',d.full_name_ar,'driver_code',d.driver_code) driver,
   (SELECT COALESCE(sum(total_delivered),0) FROM public.monthly_driver_orders o WHERE o.tenant_id=t AND o.driver_id=pp.driver_id AND o.period_year=pp.period_year AND o.period_month=pp.period_month AND o.deleted_at IS NULL) live_delivered,
   (SELECT jsonb_build_object('sessions',count(*),'variance',COALESCE(sum(cod_variance),0),'pending',count(*) FILTER(WHERE status='pending')) FROM public.driver_cod_sessions c
    WHERE c.tenant_id=t AND c.driver_id=pp.driver_id AND c.deleted_at IS NULL AND c.session_date>=make_date(pp.period_year,pp.period_month,1)
     AND c.session_date<(make_date(pp.period_year,pp.period_month,1)+interval '1 month')::date) live_cod
  FROM public.driver_payroll_periods pp JOIN public.drivers d ON d.id=pp.driver_id AND d.tenant_id=pp.tenant_id
  WHERE pp.tenant_id=t AND pp.period_year=p_year AND pp.deleted_at IS NULL
   AND (COALESCE(p_search,'')='' OR d.full_name_ar ILIKE '%'||p_search||'%' OR d.driver_code ILIKE '%'||p_search||'%')
  ORDER BY pp.period_month DESC,pp.created_at DESC,pp.id DESC LIMIT 50 OFFSET p_page*50
 ) x;
 RETURN jsonb_build_object('rows',rows,'total',total,'stats',stats);
END; $$;
CREATE FUNCTION public.payroll_periods_page(p_year integer,p_page integer,p_search text DEFAULT '') RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payroll_private.periods_page(p_year,p_page,p_search); $$;
REVOKE ALL ON FUNCTION payroll_private.periods_page(integer,integer,text),public.payroll_periods_page(integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION payroll_private.periods_page(integer,integer,text),public.payroll_periods_page(integer,integer,text) TO authenticated;

-- Status changes are caller-bound and audit, ledger application and cancellation
-- rollback commit in one transaction. The service client cannot approve payroll.
REVOKE INSERT,UPDATE,DELETE ON public.driver_payroll_periods FROM authenticated;
CREATE FUNCTION payroll_private.apply_approved_violation_deductions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ledger_total numeric; advance_total numeric; month_key text; applied_count integer; advance_count integer;
BEGIN
 month_key := to_char(make_date(NEW.period_year,NEW.period_month,1),'YYYY-MM');
 IF NEW.status='paid' AND OLD.status='approved' THEN
  IF auth.uid() IS NULL OR NEW.paid_by IS DISTINCT FROM auth.uid() OR NEW.tenant_id IS DISTINCT FROM public.get_my_tenant_id()
   OR NOT public.user_has_permission('payroll','approve') THEN RAISE EXCEPTION 'PAY_APPROVAL_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':'||month_key,0));
  SELECT COALESCE(sum(amount),0) INTO advance_total FROM public.payroll_advances WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id
   AND payroll_period_id=NEW.id AND status='approved' AND deleted_at IS NULL;
  IF advance_total IS DISTINCT FROM NEW.advance_deduction THEN RAISE EXCEPTION 'PAY_ADVANCE_RESERVATION_CHANGED'; END IF;
  SELECT COALESCE(sum(deduction_amount),0) INTO ledger_total FROM public.violation_deduction_ledger WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id
   AND payroll_period_id=NEW.id AND status='applied' AND deleted_at IS NULL;
  IF ledger_total IS DISTINCT FROM NEW.violations_deduction THEN RAISE EXCEPTION 'PAY_VIOLATION_RESERVATION_CHANGED'; END IF;
  UPDATE public.payroll_advances SET status='repaid',repaid_at=now(),preparation_version=preparation_version+1,updated_by=auth.uid()
   WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND payroll_period_id=NEW.id AND status='approved' AND deleted_at IS NULL;
  RETURN NEW;
 END IF;
 IF NEW.status!='approved' OR OLD.status='approved' THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR NEW.approved_by IS DISTINCT FROM auth.uid() OR NEW.tenant_id IS DISTINCT FROM public.get_my_tenant_id()
  OR NOT public.user_has_permission('payroll','approve') THEN RAISE EXCEPTION 'PAY_APPROVAL_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;
 month_key := to_char(make_date(NEW.period_year,NEW.period_month,1),'YYYY-MM');
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':'||month_key,0));
 PERFORM 1 FROM public.violation_deduction_ledger WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND deduction_month=month_key AND status='pending' AND deleted_at IS NULL FOR UPDATE;
 SELECT COALESCE(sum(deduction_amount),0) INTO ledger_total FROM public.violation_deduction_ledger WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND deduction_month=month_key AND status='pending' AND deleted_at IS NULL;
 PERFORM 1 FROM public.payroll_advances WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND repayment_month=month_key AND status='approved' AND deleted_at IS NULL FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO advance_total FROM public.payroll_advances WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND repayment_month=month_key AND status='approved' AND deleted_at IS NULL;
 IF EXISTS(SELECT 1 FROM public.payroll_advances WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND repayment_month=month_key AND status='approved' AND deleted_at IS NULL AND payroll_period_id IS NOT NULL) THEN RAISE EXCEPTION 'PAY_ADVANCE_ALREADY_RESERVED'; END IF;
 IF ledger_total IS DISTINCT FROM NEW.violations_deduction THEN RAISE EXCEPTION 'PAY_VIOLATION_SNAPSHOT_CHANGED'; END IF;
 IF advance_total IS DISTINCT FROM NEW.advance_deduction THEN RAISE EXCEPTION 'PAY_ADVANCE_SNAPSHOT_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM public.violation_deduction_ledger l LEFT JOIN public.violations v ON v.id=l.violation_id
  WHERE l.tenant_id=NEW.tenant_id AND l.driver_id=NEW.driver_id AND l.deduction_month=month_key AND l.status='pending' AND l.deleted_at IS NULL
   AND (v.id IS NULL OR v.tenant_id IS DISTINCT FROM NEW.tenant_id OR v.driver_id IS DISTINCT FROM NEW.driver_id
    OR v.deleted_at IS NOT NULL OR v.status!='resolved' OR v.deduction_amount IS DISTINCT FROM l.deduction_amount OR v.deduction_applied OR l.payroll_period_id IS NOT NULL))
  OR EXISTS(SELECT 1 FROM public.violation_deduction_ledger WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND deduction_month=month_key AND status='pending' AND deleted_at IS NULL GROUP BY violation_id HAVING count(*)>1)
 THEN RAISE EXCEPTION 'PAY_VIOLATION_LEDGER_INVALID'; END IF;
 UPDATE public.violations v SET deduction_applied=true,deduction_applied_at=now(),deduction_applied_by=auth.uid(),payroll_period_id=NEW.id,status='deduction_applied',updated_by=auth.uid()
  WHERE v.tenant_id=NEW.tenant_id AND v.driver_id=NEW.driver_id AND EXISTS(SELECT 1 FROM public.violation_deduction_ledger l WHERE l.violation_id=v.id AND l.tenant_id=NEW.tenant_id AND l.driver_id=NEW.driver_id AND l.deduction_month=month_key AND l.status='pending' AND l.deleted_at IS NULL);
 UPDATE public.violation_deduction_ledger SET status='applied',applied_at=now(),applied_by=auth.uid(),payroll_period_id=NEW.id,updated_by=auth.uid()
  WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND deduction_month=month_key AND status='pending' AND deleted_at IS NULL;
 GET DIAGNOSTICS applied_count=ROW_COUNT;
 UPDATE public.payroll_advances SET payroll_period_id=NEW.id,preparation_version=preparation_version+1,updated_by=auth.uid()
  WHERE tenant_id=NEW.tenant_id AND driver_id=NEW.driver_id AND repayment_month=month_key AND status='approved' AND deleted_at IS NULL;
 GET DIAGNOSTICS advance_count=ROW_COUNT;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
 VALUES(NEW.tenant_id,auth.uid(),'payroll','driver_payroll_period',NEW.id,'payroll_deductions_applied',jsonb_build_object('violations',applied_count,'amount',ledger_total,'advances_reserved',advance_count,'advance_amount',advance_total));
 RETURN NEW;
END; $$;
CREATE TRIGGER payroll_apply_violations_on_approval AFTER UPDATE ON public.driver_payroll_periods
 FOR EACH ROW EXECUTE FUNCTION payroll_private.apply_approved_violation_deductions();
CREATE FUNCTION payroll_private.transition_status(p_id uuid,p_to text,p_reason text,p_surface text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid; pay public.driver_payroll_periods%ROWTYPE; before_status text;
BEGIN
 t := payroll_private.actor(CASE WHEN p_to IN ('approved','paid') THEN 'approve' ELSE 'update' END);
 SELECT * INTO pay FROM public.driver_payroll_periods WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAY_PERIOD_NOT_FOUND'; END IF;
 before_status := pay.status::text;
 IF p_surface NOT IN ('payroll','approvals_inbox') OR p_surface IS NULL THEN RAISE EXCEPTION 'PAY_SURFACE_INVALID'; END IF;
 IF p_to=before_status THEN RAISE EXCEPTION 'PAY_ALREADY_STATUS'; END IF;
 IF pay.period_locked OR NOT ((before_status='draft' AND p_to IN ('calculated','cancelled')) OR (before_status='calculated' AND p_to IN ('in_review','cancelled'))
  OR (before_status='in_review' AND p_to IN ('approved','calculated','cancelled')) OR (before_status='approved' AND p_to IN ('paid','cancelled'))) THEN RAISE EXCEPTION 'PAY_TRANSITION_INVALID'; END IF;
 IF p_to='cancelled' AND (length(btrim(COALESCE(p_reason,'')))<5 OR length(p_reason)>500) THEN RAISE EXCEPTION 'PAY_CANCEL_REASON_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':'||to_char(make_date(pay.period_year,pay.period_month,1),'YYYY-MM'),0));
 UPDATE public.driver_payroll_periods SET status=p_to::public.payroll_status,updated_by=auth.uid(),
  approved_by=CASE WHEN p_to='approved' THEN auth.uid() ELSE approved_by END,approved_at=CASE WHEN p_to='approved' THEN now() ELSE approved_at END,
  paid_by=CASE WHEN p_to='paid' THEN auth.uid() ELSE paid_by END,paid_at=CASE WHEN p_to='paid' THEN now() ELSE paid_at END,
  cancelled_by=CASE WHEN p_to='cancelled' THEN auth.uid() ELSE cancelled_by END,cancelled_at=CASE WHEN p_to='cancelled' THEN now() ELSE cancelled_at END,
  cancel_reason=CASE WHEN p_to='cancelled' THEN btrim(p_reason) ELSE cancel_reason END WHERE id=pay.id;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
 VALUES(t,auth.uid(),'payroll','driver_payroll_period',pay.id,'payroll_status_changed',jsonb_build_object('status',before_status),jsonb_build_object('status',p_to,'reason',p_reason,'surface',p_surface));
 RETURN jsonb_build_object('id',pay.id,'period_year',pay.period_year,'period_month',pay.period_month,'net_payroll',pay.net_payroll);
END; $$;
CREATE FUNCTION public.transition_payroll_status_atomic(p_id uuid,p_to text,p_reason text DEFAULT NULL,p_surface text DEFAULT 'payroll') RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payroll_private.transition_status(p_id,p_to,p_reason,p_surface); $$;
REVOKE ALL ON FUNCTION payroll_private.apply_approved_violation_deductions(),payroll_private.transition_status(uuid,text,text,text),public.transition_payroll_status_atomic(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payroll_private.transition_status(uuid,text,text,text),public.transition_payroll_status_atomic(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_cancelled_payroll()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer; v_advance_count integer;
BEGIN
  IF NEW.status <> 'cancelled' OR OLD.status = 'cancelled' THEN RETURN NEW; END IF;
  UPDATE public.violations v SET deduction_applied = false, deduction_applied_at = NULL,
    deduction_applied_by = NULL, payroll_period_id = NULL, status = 'resolved'
  WHERE v.tenant_id = NEW.tenant_id AND v.driver_id = NEW.driver_id
    AND EXISTS (SELECT 1 FROM public.violation_deduction_ledger l
      WHERE l.violation_id = v.id AND l.tenant_id = NEW.tenant_id
        AND l.payroll_period_id = NEW.id AND l.status = 'applied');
  UPDATE public.violation_deduction_ledger SET status = 'pending', applied_at = NULL,
    applied_by = NULL, payroll_period_id = NULL, rollback_reason = NEW.cancel_reason,
    rolled_back_by = NEW.cancelled_by, rolled_back_at = now()
  WHERE tenant_id = NEW.tenant_id AND driver_id = NEW.driver_id
    AND payroll_period_id = NEW.id AND status = 'applied';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.payroll_advances SET status = 'approved', payroll_period_id = NULL, repaid_at = NULL, preparation_version = preparation_version + 1, updated_by = NEW.cancelled_by
  WHERE tenant_id = NEW.tenant_id AND driver_id = NEW.driver_id
    AND payroll_period_id = NEW.id AND status IN ('approved','repaid');
  GET DIAGNOSTICS v_advance_count = ROW_COUNT;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, old_values, new_values)
  VALUES (NEW.tenant_id, NEW.cancelled_by, 'payroll', 'driver_payroll_period', NEW.id, 'payroll_cancelled',
    jsonb_build_object('status', OLD.status),
    jsonb_build_object('reason', NEW.cancel_reason, 'rolledback_violations', v_count, 'rolledback_advances', v_advance_count));
  RETURN NEW;
END;
$$;

-- Keep every cancelled revision addressable by its original id.
ALTER TABLE public.driver_payroll_periods ADD COLUMN supersedes_id uuid REFERENCES public.driver_payroll_periods(id);
CREATE INDEX payroll_supersedes_fk ON public.driver_payroll_periods(supersedes_id) WHERE supersedes_id IS NOT NULL;
ALTER TABLE public.driver_payroll_periods DROP CONSTRAINT driver_payroll_periods_tenant_id_driver_id_period_year_peri_key;
CREATE UNIQUE INDEX payroll_one_live_driver_month ON public.driver_payroll_periods(tenant_id,driver_id,period_year,period_month)
 WHERE status<>'cancelled' AND deleted_at IS NULL;

-- Numeric arithmetic is authoritative; no fallback salaries, rates or targets.
CREATE FUNCTION payroll_private.formula(c text,r jsonb,o integer,w numeric,other_deductions numeric,absence numeric,sa boolean,advisory numeric) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE base numeric:=0; bonus numeric:=0; package_d numeric:=0; order_d numeric:=0; target integer; variance integer; total numeric; net numeric; floor_applied boolean;
BEGIN
 IF NOT payroll_private.rule_complete(r,c) OR o IS NULL OR o<0 OR w IS NULL OR w<0 OR w>31 OR other_deductions IS NULL OR other_deductions<0
  OR absence IS NULL OR absence<0 OR advisory IS NULL OR advisory<0 THEN RAISE EXCEPTION 'PAY_RULE_INCOMPLETE'; END IF;
 target:=ceil((r->>'target_orders')::numeric*w/(r->>'working_days_target')::numeric); variance:=o-target;
 IF c IN ('sponsored_type1','freelancer') THEN
  base:=round((r->>'base_salary')::numeric*w/(r->>'working_days_target')::numeric,2);
  bonus:=greatest(variance,0)*(r->>'bonus_rate')::numeric;
  order_d:=greatest(-variance,0)*(r->>'deduction_rate')::numeric;
  -- A zero cap retains the existing reviewed contract meaning: no cap.
  IF c='freelancer' THEN
   IF (r->>'bonus_cap')::numeric>0 THEN bonus:=least(bonus,(r->>'bonus_cap')::numeric); END IF;
   IF (r->>'deduction_cap')::numeric>0 THEN order_d:=least(order_d,(r->>'deduction_cap')::numeric); END IF;
  END IF;
 ELSE
  base:=(r->>'package_amount')::numeric;
  IF o<(r->>'threshold_orders')::integer THEN package_d:=(r->>'car_rent_deduction')::numeric; END IF;
 END IF;
 total:=round(package_d+order_d+other_deductions+absence,2); net:=round(base+bonus-total,2);
 floor_applied:=net<(r->>'minimum_net_floor')::numeric; net:=greatest(net,(r->>'minimum_net_floor')::numeric);
 RETURN jsonb_build_object('base_amount',base,'orders_bonus',bonus,'package_deduction',package_d,'orders_deduction',order_d,
  'orders_prorated_target',target,'orders_variance',variance,'total_deductions',total,'net_payroll',net,'minimum_floor_applied',floor_applied,
  'below_minimum_wage',COALESCE(sa,false) AND net<advisory);
END; $$;
REVOKE ALL ON FUNCTION payroll_private.formula(text,jsonb,integer,numeric,numeric,numeric,boolean,numeric) FROM PUBLIC,anon,authenticated;

-- A reviewed period basis is already adjusted for the employed interval.
-- Never multiply its base or order target by attendance a second time.
CREATE FUNCTION payroll_private.period_formula(c text,r jsonb,o integer,w numeric,other_deductions numeric,absence numeric,sa boolean,advisory numeric,b public.payroll_period_bases) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE base numeric;bonus numeric:=0;order_d numeric:=0;package_d numeric:=0;target integer;variance integer;total numeric;net numeric;floor_applied boolean;
BEGIN
 IF b.mode='full_month_rule' THEN RETURN payroll_private.formula(c,r,o,w,other_deductions,absence,sa,advisory); END IF;
 IF b.mode IS DISTINCT FROM 'reviewed_period' OR b.period_base_amount IS NULL OR b.period_order_target IS NULL OR b.period_absence_deduction IS NULL OR b.period_minimum_floor IS NULL
  OR NOT payroll_private.rule_complete(r,c) THEN RAISE EXCEPTION 'PAY_PERIOD_BASIS_REVIEW_REQUIRED'; END IF;
 base:=b.period_base_amount;target:=b.period_order_target;variance:=o-target;
 IF c='sponsored_type2' THEN
  IF b.period_package_threshold IS NULL OR b.period_rent_deduction IS NULL THEN RAISE EXCEPTION 'PAY_PERIOD_PACKAGE_VALUES_REQUIRED'; END IF;
  IF o<b.period_package_threshold THEN package_d:=b.period_rent_deduction; END IF;
 ELSE
  bonus:=greatest(variance,0)*(r->>'bonus_rate')::numeric;order_d:=greatest(-variance,0)*(r->>'deduction_rate')::numeric;
  IF c='freelancer' THEN
   IF (r->>'bonus_cap')::numeric>0 THEN bonus:=least(bonus,(r->>'bonus_cap')::numeric); END IF;
   IF (r->>'deduction_cap')::numeric>0 THEN order_d:=least(order_d,(r->>'deduction_cap')::numeric); END IF;
  END IF;
 END IF;
 total:=round(package_d+order_d+other_deductions+b.period_absence_deduction,2);net:=round(base+bonus-total,2);floor_applied:=net<b.period_minimum_floor;net:=greatest(net,b.period_minimum_floor);
 RETURN jsonb_build_object('base_amount',base,'orders_bonus',bonus,'package_deduction',package_d,'orders_deduction',order_d,
  'orders_prorated_target',target,'orders_variance',variance,'total_deductions',total,'net_payroll',net,'minimum_floor_applied',floor_applied,'below_minimum_wage',COALESCE(sa,false) AND net<advisory);
END; $$;
REVOKE ALL ON FUNCTION payroll_private.period_formula(text,jsonb,integer,numeric,numeric,numeric,boolean,numeric,public.payroll_period_bases) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION payroll_private.calculation_drivers(p_year integer,p_month integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid;
BEGIN
 t:=payroll_private.actor('create');
 IF p_year IS NULL OR p_month IS NULL OR p_year NOT BETWEEN 2000 AND 2100 OR p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'PAY_PERIOD_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.attendance_periods WHERE tenant_id=t AND period_year=p_year AND period_month=p_month AND status='locked' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PAY_INPUTS_UNREVIEWED'; END IF;
 RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',driver_id)),'[]') FROM public.payroll_period_bases WHERE tenant_id=t AND period_year=p_year AND period_month=p_month AND locked_at IS NOT NULL);
END; $$;
CREATE FUNCTION public.payroll_calculation_drivers(p_year integer,p_month integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payroll_private.calculation_drivers(p_year,p_month); $$;
REVOKE ALL ON FUNCTION payroll_private.calculation_drivers(integer,integer),public.payroll_calculation_drivers(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payroll_private.calculation_drivers(integer,integer),public.payroll_calculation_drivers(integer,integer) TO authenticated;

CREATE FUNCTION payroll_private.calculate(p_driver uuid,p_year integer,p_month integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid; d public.drivers%ROWTYPE; r public.driver_payroll_rules%ROWTYPE; a public.driver_attendance_summary%ROWTYPE; b public.payroll_period_bases%ROWTYPE;
 pay public.driver_payroll_periods%ROWTYPE; previous_id uuid; row_id uuid; start_d date; end_d date; month_key text; o integer;
 v numeric; adv numeric; cod numeric; absence numeric; advisory numeric; result jsonb; before_row jsonb; line_items jsonb;
BEGIN
 t:=payroll_private.actor('create');
 IF p_year IS NULL OR p_month IS NULL OR p_year NOT BETWEEN 2000 AND 2100 OR p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'PAY_PERIOD_INVALID'; END IF;
 start_d:=make_date(p_year,p_month,1); end_d:=(start_d+interval '1 month - 1 day')::date; month_key:=to_char(start_d,'YYYY-MM');
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':'||month_key,0));
 SELECT * INTO b FROM public.payroll_period_bases WHERE tenant_id=t AND driver_id=p_driver AND period_year=p_year AND period_month=p_month AND locked_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=p_driver AND tenant_id=t) THEN RAISE EXCEPTION 'PAY_DRIVER_NOT_FOUND'; END IF;
  RAISE EXCEPTION 'PAY_INPUTS_UNREVIEWED';
 END IF;
 SELECT * INTO d FROM public.drivers WHERE id=p_driver AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAY_DRIVER_NOT_FOUND'; END IF;
 d:=jsonb_populate_record(d,b.employment_snapshot);
 IF NOT EXISTS(SELECT 1 FROM public.attendance_periods WHERE tenant_id=t AND period_year=p_year AND period_month=p_month AND status='locked' AND deleted_at IS NULL)
  OR NOT EXISTS(SELECT 1 FROM public.payroll_preparation_reviews WHERE tenant_id=t AND driver_id=p_driver AND period_year=p_year AND period_month=p_month AND locked_at IS NOT NULL AND attendance_reviewed AND orders_reviewed)
 THEN RAISE EXCEPTION 'PAY_INPUTS_UNREVIEWED'; END IF;
 r:=jsonb_populate_record(NULL::public.driver_payroll_rules,b.rule_snapshot);
 IF NOT payroll_private.rule_complete(to_jsonb(r),d.category::text) THEN RAISE EXCEPTION 'PAY_RULE_INCOMPLETE'; END IF;
 IF r.base_pay_type IS NOT NULL OR r.extra_order_rate IS NOT NULL OR r.under_target_rate IS NOT NULL OR NOT r.apply_violations OR NOT r.apply_penalties
  OR NOT r.apply_vehicle_deductions OR NOT r.apply_maintenance THEN RAISE EXCEPTION 'PAY_RULE_UNSUPPORTED'; END IF;
 SELECT * INTO a FROM public.driver_attendance_summary WHERE tenant_id=t AND driver_id=p_driver AND period_year=p_year AND period_month=p_month AND deleted_at IS NULL;
 IF NOT FOUND OR a.working_days_actual IS NULL THEN RAISE EXCEPTION 'PAY_ATTENDANCE_INCOMPLETE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.monthly_driver_orders WHERE tenant_id=t AND driver_id=p_driver AND period_year=p_year AND period_month=p_month AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'PAY_ORDERS_UNPREPARED'; END IF;
 SELECT sum(total_delivered) INTO o FROM public.monthly_driver_orders WHERE tenant_id=t AND driver_id=p_driver AND period_year=p_year AND period_month=p_month AND deleted_at IS NULL;
 SELECT value::numeric INTO advisory FROM public.system_settings WHERE tenant_id=t AND key='payroll.saudi_minimum_wage' AND deleted_at IS NULL AND btrim(value)<>'';
 IF advisory IS NULL OR advisory<0 THEN RAISE EXCEPTION 'PAY_ADVISORY_SETTING_REQUIRED'; END IF;
 SELECT * INTO pay FROM public.driver_payroll_periods WHERE tenant_id=t AND driver_id=p_driver AND period_year=p_year AND period_month=p_month
  AND deleted_at IS NULL AND status<>'cancelled' FOR UPDATE;
 IF FOUND AND (pay.status NOT IN ('draft','calculated') OR pay.period_locked) THEN RAISE EXCEPTION 'PAY_CALCULATION_HISTORY_IMMUTABLE'; END IF;
 before_row:=CASE WHEN pay.id IS NOT NULL THEN to_jsonb(pay) END;
 SELECT id INTO previous_id FROM public.driver_payroll_periods WHERE tenant_id=t AND driver_id=p_driver AND period_year=p_year AND period_month=p_month
  AND status='cancelled' ORDER BY cancelled_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1;
 PERFORM 1 FROM public.payroll_advances WHERE tenant_id=t AND driver_id=p_driver AND repayment_month=month_key AND status='approved' AND deleted_at IS NULL FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO adv FROM public.payroll_advances WHERE tenant_id=t AND driver_id=p_driver AND repayment_month=month_key AND status='approved' AND deleted_at IS NULL;
 IF EXISTS(SELECT 1 FROM public.payroll_advances WHERE tenant_id=t AND driver_id=p_driver AND repayment_month=month_key AND status='approved' AND deleted_at IS NULL AND payroll_period_id IS NOT NULL)
 THEN RAISE EXCEPTION 'PAY_ADVANCE_ALREADY_RESERVED'; END IF;
 PERFORM 1 FROM public.violation_deduction_ledger WHERE tenant_id=t AND driver_id=p_driver AND deduction_month=month_key AND status='pending' AND deleted_at IS NULL FOR UPDATE;
 SELECT COALESCE(sum(deduction_amount),0) INTO v FROM public.violation_deduction_ledger WHERE tenant_id=t AND driver_id=p_driver AND deduction_month=month_key AND status='pending' AND deleted_at IS NULL;
 SELECT COALESCE(sum(cod_variance) FILTER(WHERE cod_variance>0),0) INTO cod FROM public.driver_cod_sessions WHERE tenant_id=t AND driver_id=p_driver
  AND session_date>=start_d AND session_date<=end_d AND deduction_created AND status='pending' AND deleted_at IS NULL;
 absence:=CASE WHEN b.mode='reviewed_period' THEN b.period_absence_deduction ELSE round(a.days_absent_unexcused*CASE WHEN d.category='sponsored_type2' THEN r.package_amount ELSE r.base_salary END/r.working_days_target,2) END;
 result:=payroll_private.period_formula(d.category::text,to_jsonb(r),o,a.working_days_actual,v+adv+cod,absence,d.nationality_code='SA',advisory,b);
 IF pay.id IS NULL THEN
  INSERT INTO public.driver_payroll_periods(tenant_id,driver_id,period_year,period_month,payroll_rule_id,working_days_target,working_days_actual,
   target_orders_monthly,orders_prorated_target,orders_achieved,orders_variance,base_amount,orders_bonus,total_earnings,orders_deduction,package_deduction,
   violations_deduction,advance_deduction,absence_deduction,cod_deduction,total_deductions,net_payroll,minimum_floor_applied,is_recovery,below_minimum_wage,status,calculated_at,calculated_by,created_by,updated_by,supersedes_id,period_basis_id)
  VALUES(t,p_driver,p_year,p_month,r.id,r.working_days_target,a.working_days_actual,r.target_orders,(result->>'orders_prorated_target')::integer,o,(result->>'orders_variance')::integer,
   (result->>'base_amount')::numeric,(result->>'orders_bonus')::numeric,(result->>'base_amount')::numeric+(result->>'orders_bonus')::numeric,(result->>'orders_deduction')::numeric,(result->>'package_deduction')::numeric,
   v,adv,absence,cod,(result->>'total_deductions')::numeric,(result->>'net_payroll')::numeric,(result->>'minimum_floor_applied')::boolean,(result->>'net_payroll')::numeric<0,(result->>'below_minimum_wage')::boolean,
   'calculated',clock_timestamp(),auth.uid(),auth.uid(),auth.uid(),previous_id,b.id) RETURNING id INTO row_id;
 ELSE
  UPDATE public.driver_payroll_periods SET payroll_rule_id=r.id,period_basis_id=b.id,working_days_target=r.working_days_target,working_days_actual=a.working_days_actual,target_orders_monthly=r.target_orders,
   orders_prorated_target=(result->>'orders_prorated_target')::integer,orders_achieved=o,orders_variance=(result->>'orders_variance')::integer,
   base_amount=(result->>'base_amount')::numeric,orders_bonus=(result->>'orders_bonus')::numeric,total_earnings=(result->>'base_amount')::numeric+(result->>'orders_bonus')::numeric,
   orders_deduction=(result->>'orders_deduction')::numeric,package_deduction=(result->>'package_deduction')::numeric,violations_deduction=v,advance_deduction=adv,
   absence_deduction=absence,cod_deduction=cod,total_deductions=(result->>'total_deductions')::numeric,net_payroll=(result->>'net_payroll')::numeric,minimum_floor_applied=(result->>'minimum_floor_applied')::boolean,
   is_recovery=(result->>'net_payroll')::numeric<0,below_minimum_wage=(result->>'below_minimum_wage')::boolean,status='calculated',calculated_at=clock_timestamp(),calculated_by=auth.uid(),updated_by=auth.uid()
   WHERE id=pay.id RETURNING id INTO row_id;
 END IF;
 SELECT COALESCE(jsonb_agg(x),'[]') INTO line_items FROM (
  SELECT jsonb_build_object('source','violation','amount',deduction_amount,'reason','Violation deduction','source_module','violations','source_reference',violation_id,'status','approved') x
   FROM public.violation_deduction_ledger WHERE tenant_id=t AND driver_id=p_driver AND deduction_month=month_key AND status='pending' AND deleted_at IS NULL
  UNION ALL SELECT jsonb_build_object('source','advance','amount',amount,'reason','Advance repayment','source_module','advances','source_reference',id,'status','approved')
   FROM public.payroll_advances WHERE tenant_id=t AND driver_id=p_driver AND repayment_month=month_key AND status='approved' AND deleted_at IS NULL
  UNION ALL SELECT jsonb_build_object('source','cod','amount',cod_variance,'reason','COD shortfall','source_module','cod','source_reference',id,'status','approved')
   FROM public.driver_cod_sessions WHERE tenant_id=t AND driver_id=p_driver AND session_date BETWEEN start_d AND end_d AND deduction_created AND status='pending' AND cod_variance>0 AND deleted_at IS NULL
 ) items;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
 VALUES(t,auth.uid(),'payroll','driver_payroll_period',row_id,'payroll_calculated',before_row,result||jsonb_build_object('rule_id',r.id,'period_basis_id',b.id,'supersedes_id',previous_id,'year',p_year,'month',p_month));
 RETURN result||jsonb_build_object('id',row_id,'deduction_lines',line_items,'calculation_steps',jsonb_build_array('Calculated atomically from locked reviewed sources'),
  'warnings',CASE WHEN (result->>'below_minimum_wage')::boolean THEN jsonb_build_array('BELOW_CONFIGURED_PAYROLL_ADVISORY') ELSE '[]'::jsonb END,
  'period',jsonb_build_object('driver_id',p_driver,'period_year',p_year,'period_month',p_month,'status','calculated'));
END; $$;
CREATE FUNCTION public.calculate_payroll_atomic(p_driver uuid,p_year integer,p_month integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payroll_private.calculate(p_driver,p_year,p_month); $$;
REVOKE ALL ON FUNCTION payroll_private.calculate(uuid,integer,integer),public.calculate_payroll_atomic(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payroll_private.calculate(uuid,integer,integer),public.calculate_payroll_atomic(uuid,integer,integer) TO authenticated;

COMMIT;
