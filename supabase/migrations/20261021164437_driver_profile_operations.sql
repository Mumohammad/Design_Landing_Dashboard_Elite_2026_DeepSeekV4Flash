BEGIN;
CREATE SCHEMA IF NOT EXISTS driver_operations_private;
REVOKE ALL ON SCHEMA driver_operations_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA driver_operations_private TO authenticated;
-- Caller-bound operations are the only authenticated write path. The definer
-- privilege is needed for the service-owned deduction ledger and atomic audit.
-- Every entry point resolves tenant + actor from the session and rechecks RBAC.
CREATE OR REPLACE FUNCTION driver_operations_private.save_driver_profile_operation(
  p_surface text, p_driver_id uuid, p_input jsonb, p_id uuid DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id(); v_actor uuid := auth.uid();
  v_table text; v_module text; v_before jsonb; v_after jsonb;
  v_id uuid := coalesce(p_id, gen_random_uuid()); v_status text; v_old_status text;
  v_date date; v_check_in timestamptz; v_check_out timestamptz;
  v_amount numeric; v_score numeric; v_key text; v_type uuid;
BEGIN
  v_table := CASE p_surface WHEN 'attendance' THEN 'driver_attendance' WHEN 'violations' THEN 'violations' WHEN 'training' THEN 'training_records' WHEN 'performance' THEN 'performance_reviews' END;
  v_module := CASE p_surface WHEN 'attendance' THEN 'attendance' WHEN 'violations' THEN 'violations' ELSE 'hr' END;
  IF v_table IS NULL THEN RAISE EXCEPTION 'OPS001: invalid operation surface'; END IF;
  IF v_actor IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission(v_module, CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END) THEN
    RAISE EXCEPTION 'AUTH007: operation permission required';
  END IF;
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'OPS002: invalid operation input'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = v_tenant AND deleted_at IS NULL) THEN RAISE EXCEPTION 'OPS003: active tenant driver required'; END IF;
  IF p_surface='violations' AND coalesce(p_input->>'deduction_month','') ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || (p_input->>'deduction_month'),0));
  END IF;
  IF p_id IS NOT NULL THEN
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND tenant_id=$2 AND driver_id=$3 AND deleted_at IS NULL FOR UPDATE', v_table)
      INTO v_before USING p_id, v_tenant, p_driver_id;
    IF v_before IS NULL THEN RAISE EXCEPTION 'OPS004: record not found in this driver profile'; END IF;
    IF p_expected_updated_at IS NULL OR (v_before->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'OPS005: record changed; reload before saving'; END IF;
  END IF;

  IF p_surface = 'attendance' THEN
    IF coalesce(p_input->>'attendance_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'OPS006: valid attendance date required'; END IF;
    v_date := (p_input->>'attendance_date')::date;
    v_status := p_input->>'status';
    IF v_status IS NULL OR v_status NOT IN ('present','late','half_day','absent_excused','absent_unexcused','on_leave','public_holiday','day_off') THEN RAISE EXCEPTION 'OPS007: invalid attendance status'; END IF;
    v_check_in := nullif(p_input->>'check_in_time','')::timestamptz;
    v_check_out := nullif(p_input->>'check_out_time','')::timestamptz;
    IF (v_check_in IS NOT NULL AND (v_check_in AT TIME ZONE 'Asia/Riyadh')::date <> v_date)
      OR (v_check_out IS NOT NULL AND (v_check_out AT TIME ZONE 'Asia/Riyadh')::date <> v_date)
      OR (v_check_in IS NOT NULL AND v_check_out IS NOT NULL AND v_check_out < v_check_in) THEN RAISE EXCEPTION 'OPS008: attendance times must be ordered on the Saudi attendance date'; END IF;
    FOREACH v_key IN ARRAY ARRAY['late_minutes','overtime_minutes'] LOOP
      IF coalesce((p_input->>v_key)::numeric,0) NOT BETWEEN 0 AND 32767 OR coalesce((p_input->>v_key)::numeric,0) <> trunc(coalesce((p_input->>v_key)::numeric,0)) THEN RAISE EXCEPTION 'OPS009: minutes must be nonnegative whole numbers'; END IF;
    END LOOP;
    IF p_id IS NULL THEN
      INSERT INTO public.driver_attendance AS t(id,tenant_id,driver_id,attendance_date,status,check_in_time,check_out_time,late_minutes,overtime_minutes,notes,entry_method,created_by,updated_by)
      VALUES(v_id,v_tenant,p_driver_id,v_date,v_status::public.attendance_status,v_check_in,v_check_out,coalesce((p_input->>'late_minutes')::smallint,0),coalesce((p_input->>'overtime_minutes')::smallint,0),nullif(btrim(p_input->>'notes'),''),'manual',v_actor,v_actor) RETURNING to_jsonb(t) INTO v_after;
    ELSE
      UPDATE public.driver_attendance AS t SET attendance_date=v_date,status=v_status::public.attendance_status,check_in_time=v_check_in,check_out_time=v_check_out,late_minutes=coalesce((p_input->>'late_minutes')::smallint,0),overtime_minutes=coalesce((p_input->>'overtime_minutes')::smallint,0),notes=nullif(btrim(p_input->>'notes'),''),updated_by=v_actor
      WHERE id=v_id AND tenant_id=v_tenant AND driver_id=p_driver_id RETURNING to_jsonb(t) INTO v_after;
    END IF;
  ELSIF p_surface = 'training' THEN
    IF coalesce(btrim(p_input->>'course_name'),'') = '' OR coalesce(p_input->>'training_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'OPS010: course name and training date required'; END IF;
    v_date := (p_input->>'training_date')::date;
    IF nullif(p_input->>'expiry_date','')::date < v_date THEN RAISE EXCEPTION 'OPS011: expiry must follow training date'; END IF;
    v_score := (p_input->>'score')::numeric;
    IF v_score IS NOT NULL AND (v_score < 0 OR v_score > 100) THEN RAISE EXCEPTION 'OPS012: scores must be between 0 and 100'; END IF;
    IF nullif(p_input->>'certificate_url','') IS NOT NULL AND (p_input->>'certificate_url') !~ '^https?://' THEN RAISE EXCEPTION 'OPS013: certificate URL must use HTTP or HTTPS'; END IF;
    IF p_id IS NULL THEN
      INSERT INTO public.training_records AS t(id,tenant_id,driver_id,course_name,training_date,expiry_date,provider,certificate_url,score,is_passed,created_by,updated_by)
      VALUES(v_id,v_tenant,p_driver_id,btrim(p_input->>'course_name'),v_date,nullif(p_input->>'expiry_date','')::date,nullif(btrim(p_input->>'provider'),''),nullif(p_input->>'certificate_url',''),v_score,coalesce((p_input->>'is_passed')::boolean,false),v_actor,v_actor) RETURNING to_jsonb(t) INTO v_after;
    ELSE
      UPDATE public.training_records AS t SET course_name=btrim(p_input->>'course_name'),training_date=v_date,expiry_date=nullif(p_input->>'expiry_date','')::date,provider=nullif(btrim(p_input->>'provider'),''),certificate_url=nullif(p_input->>'certificate_url',''),score=v_score,is_passed=coalesce((p_input->>'is_passed')::boolean,false),updated_by=v_actor WHERE id=v_id AND tenant_id=v_tenant AND driver_id=p_driver_id RETURNING to_jsonb(t) INTO v_after;
    END IF;
  ELSIF p_surface = 'performance' THEN
    IF coalesce(btrim(p_input->>'review_period'),'') = '' OR coalesce(p_input->>'review_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'OPS014: review period and date required'; END IF;
    v_status := coalesce(p_input->>'status','pending'); v_old_status := v_before->>'status';
    IF v_status NOT IN ('pending','in_progress','completed','cancelled') THEN RAISE EXCEPTION 'OPS015: invalid review status'; END IF;
    IF (p_id IS NULL AND v_status <> 'pending') OR (p_id IS NOT NULL AND (v_old_status IN ('completed','cancelled') OR (v_status <> v_old_status AND NOT ((v_old_status='pending' AND v_status IN ('in_progress','cancelled')) OR (v_old_status='in_progress' AND v_status IN ('completed','cancelled')))))) THEN RAISE EXCEPTION 'OPS016: invalid review transition or finalized review'; END IF;
    IF v_status='completed' AND NOT public.user_has_permission('hr','approve') THEN RAISE EXCEPTION 'AUTH007: HR approval permission required'; END IF;
    FOREACH v_key IN ARRAY ARRAY['attendance_score','violations_score','platform_kpi_score','overall_score'] LOOP
      v_score := (p_input->>v_key)::numeric;
      IF (v_status='completed' AND v_score IS NULL) OR (v_score IS NOT NULL AND (v_score < 0 OR v_score > 100)) THEN RAISE EXCEPTION 'OPS012: scores must be between 0 and 100'; END IF;
    END LOOP;
    IF p_id IS NULL THEN
      INSERT INTO public.performance_reviews AS t(id,tenant_id,driver_id,review_period,review_date,reviewer_id,attendance_score,violations_score,platform_kpi_score,overall_score,strengths,improvements,goals,status,created_by,updated_by)
      VALUES(v_id,v_tenant,p_driver_id,btrim(p_input->>'review_period'),(p_input->>'review_date')::date,v_actor,(p_input->>'attendance_score')::numeric,(p_input->>'violations_score')::numeric,(p_input->>'platform_kpi_score')::numeric,(p_input->>'overall_score')::numeric,nullif(btrim(p_input->>'strengths'),''),nullif(btrim(p_input->>'improvements'),''),nullif(btrim(p_input->>'goals'),''),v_status::public.review_status,v_actor,v_actor) RETURNING to_jsonb(t) INTO v_after;
    ELSE
      UPDATE public.performance_reviews AS t SET review_period=btrim(p_input->>'review_period'),review_date=(p_input->>'review_date')::date,reviewer_id=v_actor,attendance_score=(p_input->>'attendance_score')::numeric,violations_score=(p_input->>'violations_score')::numeric,platform_kpi_score=(p_input->>'platform_kpi_score')::numeric,overall_score=(p_input->>'overall_score')::numeric,strengths=nullif(btrim(p_input->>'strengths'),''),improvements=nullif(btrim(p_input->>'improvements'),''),goals=nullif(btrim(p_input->>'goals'),''),status=v_status::public.review_status,updated_by=v_actor WHERE id=v_id AND tenant_id=v_tenant AND driver_id=p_driver_id RETURNING to_jsonb(t) INTO v_after;
    END IF;
  ELSE
    IF coalesce(p_input->>'incident_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(btrim(p_input->>'incident_description'),'')='' THEN RAISE EXCEPTION 'OPS017: incident date and description required'; END IF;
    v_amount := coalesce((p_input->>'deduction_amount')::numeric,0);
    IF v_amount < 0 OR v_amount > 99999999.99 OR v_amount <> round(v_amount,2) THEN RAISE EXCEPTION 'OPS018: deduction must be nonnegative with at most two decimal places'; END IF;
    v_type := nullif(p_input->>'violation_type_id','')::uuid;
    IF v_type IS NULL AND p_id IS NOT NULL THEN v_type := (v_before->>'violation_type_id')::uuid; END IF;
    IF v_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.violation_types WHERE id=v_type AND tenant_id=v_tenant AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'OPS019: active tenant violation type required'; END IF;
    v_status := coalesce(p_input->>'status','open'); v_old_status := v_before->>'status';
    IF v_status NOT IN ('open','under_review','acknowledged','disputed','resolved','waived','escalated','closed') THEN RAISE EXCEPTION 'OPS020: invalid violation status'; END IF;
    IF p_id IS NOT NULL AND ((v_before->>'deduction_applied')::boolean OR v_old_status IN ('waived','closed','deduction_applied') OR EXISTS (SELECT 1 FROM public.violation_deduction_ledger WHERE violation_id=v_id AND tenant_id=v_tenant)) THEN RAISE EXCEPTION 'OPS021: reviewed deduction history is immutable; use the payroll reversal workflow'; END IF;
    IF (p_id IS NULL AND v_status <> 'open') OR (p_id IS NOT NULL AND v_status <> v_old_status AND NOT (
      (v_old_status='open' AND v_status IN ('under_review','acknowledged','disputed','escalated','waived')) OR
      (v_old_status='under_review' AND v_status IN ('acknowledged','disputed','resolved','escalated','waived')) OR
      (v_old_status='acknowledged' AND v_status IN ('under_review','disputed','resolved','waived')) OR
      (v_old_status='disputed' AND v_status IN ('under_review','escalated','waived')) OR
      (v_old_status='escalated' AND v_status IN ('under_review','resolved','waived')) OR
      (v_old_status='resolved' AND v_status='closed' AND v_amount=0)
    )) THEN RAISE EXCEPTION 'OPS022: invalid violation transition'; END IF;
    IF p_id IS NOT NULL AND v_status IS DISTINCT FROM v_old_status AND NOT public.user_has_permission('violations','approve') THEN RAISE EXCEPTION 'AUTH007: violation approval permission required'; END IF;
    IF v_status IN ('resolved','waived','closed') AND coalesce(btrim(p_input->>'review_notes'),'')='' THEN RAISE EXCEPTION 'OPS023: review notes are required for a decision'; END IF;
    IF v_status='resolved' AND v_amount>0 THEN
      IF coalesce(p_input->>'deduction_month','') !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'OPS024: deduction month must use YYYY-MM'; END IF;
      -- Serialize against preparation and refuse already approved/paid periods.
      PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || (p_input->>'deduction_month'),0));
      IF EXISTS (SELECT 1 FROM public.driver_payroll_periods WHERE tenant_id=v_tenant AND driver_id=p_driver_id AND period_year=split_part(p_input->>'deduction_month','-',1)::int AND period_month=split_part(p_input->>'deduction_month','-',2)::int AND deleted_at IS NULL AND (period_locked OR status NOT IN ('draft','cancelled'))) THEN RAISE EXCEPTION 'OPS025: deduction month payroll has already been prepared; choose an open month'; END IF;
    END IF;
    IF p_id IS NULL THEN
      INSERT INTO public.violations AS t(id,tenant_id,driver_id,violation_type_id,incident_date,incident_location,incident_description,deduction_amount,status,source,reported_by,created_by,updated_by)
      VALUES(v_id,v_tenant,p_driver_id,v_type,(p_input->>'incident_date')::date,nullif(btrim(p_input->>'incident_location'),''),btrim(p_input->>'incident_description'),v_amount,'open','manual',v_actor,v_actor,v_actor) RETURNING to_jsonb(t) INTO v_after;
    ELSE
      UPDATE public.violations AS t SET violation_type_id=v_type,incident_date=(p_input->>'incident_date')::date,incident_location=nullif(btrim(p_input->>'incident_location'),''),incident_description=btrim(p_input->>'incident_description'),deduction_amount=v_amount,status=v_status::public.violation_status,review_notes=nullif(btrim(p_input->>'review_notes'),''),reviewed_by=CASE WHEN v_status<>v_old_status THEN v_actor ELSE reviewed_by END,reviewed_at=CASE WHEN v_status<>v_old_status THEN now() ELSE reviewed_at END,waiver_reason=CASE WHEN v_status='waived' THEN btrim(p_input->>'review_notes') ELSE waiver_reason END,waived_by=CASE WHEN v_status='waived' THEN v_actor ELSE waived_by END,waived_at=CASE WHEN v_status='waived' THEN now() ELSE waived_at END,updated_by=v_actor WHERE id=v_id AND tenant_id=v_tenant AND driver_id=p_driver_id RETURNING to_jsonb(t) INTO v_after;
    END IF;
    IF v_status='resolved' AND v_amount>0 THEN
      INSERT INTO public.violation_deduction_ledger(tenant_id,violation_id,driver_id,deduction_amount,deduction_month,status,created_by,updated_by)
      VALUES(v_tenant,v_id,p_driver_id,v_amount,p_input->>'deduction_month','pending',v_actor,v_actor);
    END IF;
  END IF;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values)
  VALUES(v_tenant,v_actor,v_module,v_table,v_id,CASE WHEN p_id IS NULL THEN 'driver_operation_created' ELSE 'driver_operation_updated' END,CASE WHEN p_id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('surface',p_surface,'status',v_before->'status','updated_at',v_before->'updated_at')) END,jsonb_strip_nulls(jsonb_build_object('surface',p_surface,'status',v_after->'status','updated_at',v_after->'updated_at')));
  RETURN jsonb_build_object('id',v_id,'updated_at',v_after->>'updated_at');
END;
$$;
REVOKE ALL ON FUNCTION driver_operations_private.save_driver_profile_operation(text,uuid,jsonb,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION driver_operations_private.save_driver_profile_operation(text,uuid,jsonb,uuid,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION driver_operations_private.archive_driver_profile_operation(p_surface text,p_driver_id uuid,p_id uuid,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid:=public.get_my_tenant_id(); v_actor uuid:=auth.uid(); v_table text; v_module text; v_before jsonb; v_after jsonb;
BEGIN
  v_table:=CASE p_surface WHEN 'attendance' THEN 'driver_attendance' WHEN 'violations' THEN 'violations' WHEN 'training' THEN 'training_records' WHEN 'performance' THEN 'performance_reviews' END;
  v_module:=CASE p_surface WHEN 'attendance' THEN 'attendance' WHEN 'violations' THEN 'violations' ELSE 'hr' END;
  IF v_table IS NULL THEN RAISE EXCEPTION 'OPS001: invalid operation surface'; END IF;
  IF v_actor IS NULL OR v_tenant IS NULL OR NOT public.user_has_permission(v_module,'delete') THEN RAISE EXCEPTION 'AUTH007: operation permission required'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND tenant_id=$2 AND driver_id=$3 AND deleted_at IS NULL FOR UPDATE',v_table) INTO v_before USING p_id,v_tenant,p_driver_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'OPS004: record not found in this driver profile'; END IF;
  IF p_expected_updated_at IS NULL OR (v_before->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'OPS005: record changed; reload before saving'; END IF;
  IF p_surface='performance' AND v_before->>'status'='completed' THEN RAISE EXCEPTION 'OPS026: completed reviews are retained as history'; END IF;
  IF p_surface='violations' AND (v_before->>'status' NOT IN ('open','waived','closed') OR (v_before->>'deduction_applied')::boolean OR EXISTS(SELECT 1 FROM public.violation_deduction_ledger WHERE violation_id=p_id AND tenant_id=v_tenant)) THEN RAISE EXCEPTION 'OPS021: reviewed deduction history is immutable; use the payroll reversal workflow'; END IF;
  EXECUTE format('UPDATE public.%I t SET deleted_at=now(),updated_by=$1 WHERE id=$2 AND tenant_id=$3 AND driver_id=$4 RETURNING to_jsonb(t)',v_table) INTO v_after USING v_actor,p_id,v_tenant,p_driver_id;
  INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(v_tenant,v_actor,v_module,v_table,p_id,'driver_operation_archived',jsonb_strip_nulls(jsonb_build_object('surface',p_surface,'status',v_before->'status','updated_at',v_before->'updated_at')),jsonb_build_object('surface',p_surface,'status',v_after->'status','archived',true,'updated_at',v_after->'updated_at'));
  RETURN jsonb_build_object('id',p_id);
END;
$$;
REVOKE ALL ON FUNCTION driver_operations_private.archive_driver_profile_operation(text,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION driver_operations_private.archive_driver_profile_operation(text,uuid,uuid,timestamptz) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.driver_attendance,public.training_records,public.performance_reviews,public.violations FROM authenticated,anon;

CREATE OR REPLACE FUNCTION public.save_driver_profile_operation(p_surface text,p_driver_id uuid,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT driver_operations_private.save_driver_profile_operation(p_surface,p_driver_id,p_input,p_id,p_expected_updated_at); $$;
CREATE OR REPLACE FUNCTION public.archive_driver_profile_operation(p_surface text,p_driver_id uuid,p_id uuid,p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT driver_operations_private.archive_driver_profile_operation(p_surface,p_driver_id,p_id,p_expected_updated_at); $$;
REVOKE ALL ON FUNCTION public.save_driver_profile_operation(text,uuid,jsonb,uuid,timestamptz),public.archive_driver_profile_operation(text,uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_driver_profile_operation(text,uuid,jsonb,uuid,timestamptz),public.archive_driver_profile_operation(text,uuid,uuid,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION public.read_driver_violation_summary(p_driver_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();result jsonb;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT public.user_has_permission('violations','read') THEN RAISE EXCEPTION 'AUTH007: violation read permission required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=p_driver_id AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'OPS003: active tenant driver required'; END IF;
 SELECT jsonb_build_object('count',count(*),'deductions',coalesce(sum(deduction_amount),0)::text) INTO result FROM public.violations WHERE tenant_id=t AND driver_id=p_driver_id AND deleted_at IS NULL;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.read_driver_violation_summary(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_driver_violation_summary(uuid) TO authenticated;

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION driver_operations_private.bump_profile_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.profile_version:=OLD.profile_version+1;RETURN NEW;END; $$;
DROP TRIGGER IF EXISTS driver_profile_version ON public.drivers;
CREATE TRIGGER driver_profile_version BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION driver_operations_private.bump_profile_version();
REVOKE ALL ON FUNCTION driver_operations_private.bump_profile_version() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION driver_operations_private.mutate_driver(p_action text,p_input jsonb,p_id uuid,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();old_row public.drivers;n public.drivers;after_row jsonb;fields text;values_sql text;update_sql text;k text;amount numeric;new_id uuid:=coalesce(p_id,gen_random_uuid());reason text:=btrim(coalesce(p_input->>'reason',''));target public.driver_status;ref uuid;iban_value text;iban_digits text;iban_remainder integer;digit text;
 allowed constant text[]:=ARRAY['driver_code','full_name_ar','full_name_en','preferred_name','nationality','nationality_code','date_of_birth','place_of_birth','gender','marital_status','iqama_number','iqama_issue_date','iqama_expiry_date','profession_on_iqama','passport_number','passport_expiry_date','license_number','license_type','license_issue_date','license_expiry_date','primary_mobile','secondary_mobile','personal_email','work_email','current_city','current_region','national_address','category','employment_type','contract_type','job_title','department','cost_center','hire_date','onboarding_date','probation_start','probation_end','contract_start','contract_end','termination_date','termination_reason','rehire_eligible','supervisor_id','hr_owner_id','ops_owner_id','basic_salary','housing_allowance','transport_allowance','other_allowances','gosi_wage_basis','payroll_group','bank_name','iban','payment_method','primary_platform_id','driver_type','city_zone','service_area','shift_type','operational_state','tags','internal_notes','priority'];
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('create','update','status','archive') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DRIVER_INVALID_OPERATION'; END IF;
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers',CASE p_action WHEN 'create' THEN 'create' WHEN 'archive' THEN 'delete' ELSE 'update' END) THEN RAISE EXCEPTION 'AUTH007: driver permission required'; END IF;
 IF p_action<>'create' THEN
  SELECT * INTO old_row FROM public.drivers WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'DRIVER_NOT_FOUND'; END IF;
  IF p_expected_version IS NULL OR old_row.profile_version<>p_expected_version THEN RAISE EXCEPTION 'DRIVER_STALE_VERSION: reload the driver before saving'; END IF;
 ELSIF p_id IS NOT NULL OR p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'DRIVER_INVALID_OPERATION'; END IF;
 IF p_action IN ('create','update') THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) key WHERE NOT key=ANY(allowed) AND NOT(p_action='create' AND key='status')) THEN RAISE EXCEPTION 'DRIVER_FIELD_REQUIRES_DEDICATED_WORKFLOW'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_input) WHERE jsonb_typeof(value)='string' AND length(value#>>'{}')>10000) THEN RAISE EXCEPTION 'DRIVER_TEXT_TOO_LONG';END IF;
  -- No caller may change audit/compliance/vehicle/rule derived columns.
  SELECT * INTO n FROM jsonb_populate_record(CASE WHEN p_action='create' THEN NULL::public.drivers ELSE old_row END,p_input);
  IF coalesce(length(btrim(n.full_name_ar)),0)<1 OR coalesce(n.primary_mobile,'') !~ '^(05[0-9]{8}|\+9665[0-9]{8})$' OR n.category IS NULL THEN RAISE EXCEPTION 'DRIVER_IDENTITY_REQUIRED'; END IF;
  IF p_input?'iban' AND n.iban IS NOT NULL THEN
   iban_value:=upper(regexp_replace(n.iban,'\s','','g'));
   IF iban_value !~ '^SA[0-9]{22}$' THEN RAISE EXCEPTION 'DRIVER_INVALID_IBAN';END IF;
   iban_digits:=substr(iban_value,5)||'2810'||substr(iban_value,3,2);iban_remainder:=0;
   FOREACH digit IN ARRAY regexp_split_to_array(iban_digits,'') LOOP iban_remainder:=mod(iban_remainder*10+digit::integer,97);END LOOP;
   IF iban_remainder<>1 THEN RAISE EXCEPTION 'DRIVER_INVALID_IBAN';END IF;
   p_input:=p_input||jsonb_build_object('iban',iban_value);
  END IF;
  IF n.contract_start IS NOT NULL AND n.contract_end IS NOT NULL AND n.contract_end<=n.contract_start THEN RAISE EXCEPTION 'DRIVER_CONTRACT_DATES_INVALID'; END IF;
  IF n.termination_date IS NOT NULL AND (n.hire_date IS NULL OR n.termination_date<n.hire_date) THEN RAISE EXCEPTION 'DRIVER_EMPLOYMENT_DATES_INVALID'; END IF;
  IF (p_action='create' OR p_input?'hire_date' OR p_input?'termination_date') AND coalesce(n.status,'draft') IN ('active','on_leave','suspended') AND n.termination_date IS NOT NULL THEN RAISE EXCEPTION 'DRIVER_TERMINATION_REQUIRES_STATUS_WORKFLOW'; END IF;
  IF (p_action='create' OR p_input?'hire_date' OR p_input?'termination_date') AND n.status IN ('terminated','blacklisted') AND (n.hire_date IS NULL OR n.termination_date IS NULL) THEN RAISE EXCEPTION 'DRIVER_TERMINATION_DATE_REQUIRED'; END IF;
  FOREACH k IN ARRAY ARRAY['basic_salary','housing_allowance','transport_allowance','gosi_wage_basis'] LOOP
   amount:=(to_jsonb(n)->>k)::numeric;
   IF amount IS NOT NULL AND (amount<0 OR amount<>round(amount,2) OR (k='basic_salary' AND amount NOT BETWEEN 500 AND 50000)) THEN RAISE EXCEPTION 'DRIVER_INVALID_COMPENSATION'; END IF;
  END LOOP;
  IF n.primary_platform_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.delivery_platforms WHERE id=n.primary_platform_id AND tenant_id=t AND deleted_at IS NULL AND (is_active OR n.primary_platform_id=old_row.primary_platform_id)) THEN RAISE EXCEPTION 'DRIVER_TENANT_PLATFORM_REQUIRED'; END IF;
  FOREACH k IN ARRAY ARRAY['supervisor_id','hr_owner_id','ops_owner_id'] LOOP
   ref:=(to_jsonb(n)->>k)::uuid;
   IF ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=ref AND tenant_id=t AND status='active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'DRIVER_ACTIVE_TENANT_STAFF_REQUIRED'; END IF;
  END LOOP;
  IF p_action='create' THEN
   IF nullif(btrim(p_input->>'driver_code'),'') IS NULL THEN p_input:=p_input||jsonb_build_object('driver_code','DRV-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))); END IF;
   SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('(jsonb_populate_record(NULL::public.drivers,$1)).%I',key),',' ORDER BY key) INTO fields,values_sql FROM jsonb_object_keys(p_input) key;
   EXECUTE format('INSERT INTO public.drivers AS d(id,tenant_id,created_by,updated_by,%s) SELECT $2,$3,$4,$4,%s RETURNING to_jsonb(d)',fields,values_sql) INTO after_row USING p_input,new_id,t,actor;
  ELSE
   SELECT string_agg(format('%I=(jsonb_populate_record(NULL::public.drivers,$1)).%I',key,key),',' ORDER BY key) INTO update_sql FROM jsonb_object_keys(p_input) key;
   IF update_sql IS NULL THEN RETURN jsonb_build_object('id',old_row.id,'profile_version',old_row.profile_version,'updated_at',old_row.updated_at); END IF;
   EXECUTE format('UPDATE public.drivers AS d SET %s,updated_by=$2 WHERE id=$3 AND tenant_id=$4 RETURNING to_jsonb(d)',update_sql) INTO after_row USING p_input,actor,p_id,t;
  END IF;
 ELSIF p_action='status' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) key WHERE key NOT IN ('status','reason','note','termination_date')) THEN RAISE EXCEPTION 'DRIVER_INVALID_OPERATION'; END IF;
  target:=(p_input->>'status')::public.driver_status;
  IF target IS NULL OR old_row.status IN ('terminated','blacklisted') OR target=old_row.status OR NOT ((target='suspended' AND old_row.status IN ('active','on_leave')) OR (target='active' AND old_row.status IN ('draft','on_leave','suspended')) OR (target='on_leave' AND old_row.status='active') OR target IN ('terminated','blacklisted')) THEN RAISE EXCEPTION 'DRIVER_INVALID_STATUS_TRANSITION'; END IF;
  IF target IN ('suspended','terminated','blacklisted') AND length(reason)<5 THEN RAISE EXCEPTION 'DRIVER_STATUS_REASON_REQUIRED'; END IF;
  IF length(reason)>500 OR length(coalesce(p_input->>'note',''))>1000 THEN RAISE EXCEPTION 'DRIVER_INVALID_OPERATION'; END IF;
  IF target IN ('terminated','blacklisted') AND (nullif(p_input->>'termination_date','') IS NULL OR old_row.hire_date IS NULL OR (p_input->>'termination_date')::date<old_row.hire_date OR (p_input->>'termination_date')::date>(now() AT TIME ZONE 'Asia/Riyadh')::date) THEN RAISE EXCEPTION 'DRIVER_EXPLICIT_TERMINATION_DATE_REQUIRED'; END IF;
  IF target IN ('terminated','blacklisted') AND (old_row.current_vehicle_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE tenant_id=t AND driver_id=p_id AND is_current AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'DRIVER_RETURN_VEHICLE_FIRST'; END IF;
  UPDATE public.drivers AS d SET status=target,termination_date=CASE WHEN target IN ('terminated','blacklisted') THEN (p_input->>'termination_date')::date ELSE termination_date END,termination_reason=CASE WHEN target IN ('terminated','blacklisted') THEN reason ELSE termination_reason END,updated_by=actor WHERE id=p_id AND tenant_id=t RETURNING to_jsonb(d) INTO after_row;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) key WHERE key<>'reason') OR length(reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'DRIVER_ARCHIVE_REASON_REQUIRED'; END IF;
  IF old_row.current_vehicle_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE tenant_id=t AND driver_id=p_id AND is_current AND deleted_at IS NULL) THEN RAISE EXCEPTION 'DRIVER_RETURN_VEHICLE_FIRST'; END IF;
  IF old_row.cod_outstanding_amount<>0 OR EXISTS(SELECT 1 FROM public.driver_payroll_periods WHERE tenant_id=t AND driver_id=p_id AND deleted_at IS NULL AND status NOT IN ('paid','cancelled')) OR EXISTS(SELECT 1 FROM public.driver_cod_sessions WHERE tenant_id=t AND driver_id=p_id AND deleted_at IS NULL AND status='pending') THEN RAISE EXCEPTION 'DRIVER_RESOLVE_OPEN_BALANCES_FIRST'; END IF;
  UPDATE public.drivers AS d SET deleted_at=clock_timestamp(),archived_reason=reason,updated_by=actor WHERE id=p_id AND tenant_id=t RETURNING to_jsonb(d) INTO after_row;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,actor,'drivers','driver',new_id,CASE p_action WHEN 'create' THEN 'created' WHEN 'update' THEN 'updated' WHEN 'status' THEN 'status_changed' ELSE 'archived' END,CASE WHEN old_row.id IS NOT NULL THEN jsonb_build_object('status',old_row.status,'category',old_row.category,'profile_version',old_row.profile_version,'archived',old_row.deleted_at IS NOT NULL) END,
 jsonb_build_object('status',after_row->'status','category',after_row->'category','profile_version',after_row->'profile_version','archived',after_row->>'deleted_at' IS NOT NULL,
 'identity_changed',p_input ?| ARRAY['full_name_ar','full_name_en','preferred_name','nationality','nationality_code','date_of_birth','place_of_birth','gender','marital_status','iqama_number','iqama_issue_date','iqama_expiry_date','profession_on_iqama','passport_number','passport_expiry_date','license_number','license_type','license_issue_date','license_expiry_date'],
 'contact_changed',p_input ?| ARRAY['primary_mobile','secondary_mobile','personal_email','work_email','current_city','current_region','national_address'],
 'bank_details_changed',p_input ?| ARRAY['bank_name','iban','payment_method'],
 'compensation_changed',p_input ?| ARRAY['basic_salary','housing_allowance','transport_allowance','other_allowances','gosi_wage_basis','payroll_group'],
 'assignment_changed',p_input ?| ARRAY['supervisor_id','hr_owner_id','ops_owner_id','primary_platform_id'],
 'reason_recorded',reason<>''));
 -- AFTER triggers may also update derived compliance; return the final optimistic version.
 SELECT jsonb_build_object('id',id,'profile_version',profile_version,'updated_at',updated_at) INTO after_row FROM public.drivers WHERE id=new_id AND tenant_id=t;
 RETURN after_row;
END; $$;
REVOKE ALL ON FUNCTION driver_operations_private.mutate_driver(text,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION driver_operations_private.mutate_driver(text,jsonb,uuid,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.mutate_driver_profile(p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT driver_operations_private.mutate_driver(p_action,p_input,p_id,p_expected_version); $$;
REVOKE ALL ON FUNCTION public.mutate_driver_profile(text,jsonb,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_driver_profile(text,jsonb,uuid,integer) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.drivers FROM PUBLIC,anon,authenticated;
DO $acl$ DECLARE cols text;BEGIN SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid='public.drivers'::regclass AND attnum>0 AND NOT attisdropped;EXECUTE format('REVOKE INSERT (%s),UPDATE (%s) ON public.drivers FROM PUBLIC,anon,authenticated',cols,cols);END;$acl$;
REVOKE ALL ON FUNCTION public.set_driver_status(uuid,public.driver_status,text,uuid) FROM PUBLIC,anon,authenticated;
COMMIT;
