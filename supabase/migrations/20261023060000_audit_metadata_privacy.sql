BEGIN;
-- Historical rows remain immutable. The projection has a closed, flat schema;
-- an actor's consent never authorizes another person's embedded information.
-- Pure helper: caller-supplied JSON only, no table lookup or tenant parameter.
CREATE OR REPLACE FUNCTION public.audit_metadata_minimal(p_module text,p_entity_type text,p_values jsonb,p_financial_read boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $minimal$
DECLARE result jsonb:='{}'::jsonb;k text;v jsonb;txt text;financial_module boolean:=p_module IN ('payroll','accounting','invoices','expenses','payments','vat');has_money boolean:=false;
BEGIN
 IF p_values IS NULL THEN RETURN NULL;END IF;
 IF jsonb_typeof(p_values)<>'object' OR p_module IS NULL OR p_module NOT IN ('drivers','attendance','hr','leave','violations','vehicles','maintenance','orders','platforms','payroll','accounting','invoices','expenses','payments','vat','users','roles','settings','security','reports','applications','templates','webhooks','audit_log') THEN RETURN result;END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(p_values) LOOP
  txt:=v #>> '{}';
  IF k ~ '(amount|salary|payroll|deduction|bonus|gross|net_pay|adjustment|allowance|earnings|variance)' THEN has_money:=true;END IF;
  IF p_module='drivers' AND coalesce(p_entity_type,'driver') IN ('driver','drivers') AND k NOT IN ('status','previous_status','old_status','new_status','category','employment_type','contract_type','operation','profile_version','version','archived','profile_changed','identity_changed','contact_changed','bank_details_changed','payroll_terms_changed','compensation_changed','assignment_changed','employment_changed','documents_changed','photo_changed','fields_changed','reason_recorded') THEN CONTINUE;END IF;
  IF financial_module AND p_financial_read IS NOT TRUE AND k NOT IN ('status','previous_status','old_status','new_status','period_year','period_month','year','month','period','version','profile_version','has_adjustment') THEN CONTINUE;END IF;
  IF k IN ('status','previous_status','old_status','new_status') AND jsonb_typeof(v)='string' AND txt IN ('draft','active','inactive','pending','pending_invite','accepted','expired','revoked','locked','terminated','on_leave','suspended','blacklisted','open','closed','submitted','approved','rejected','cancelled','calculated','paid','partially_paid','overdue','written_off','posted','reversed','allocated','partially_allocated','void','finalized','voided','available','assigned','in_maintenance','out_of_service','scheduled','in_progress','completed','verified','unverified','under_review','escalated','resolved','waived','present','absent','late','excused','recoverable','non_recoverable','pending_review','not_transmitted','reported','cleared','failed','processed','skipped_duplicate','closing','reopened') THEN result:=result||jsonb_build_object(k,txt);
  ELSIF k='category' AND p_module='drivers' AND txt IN ('sponsored_type1','sponsored_type2','freelancer') THEN result:=result||jsonb_build_object(k,txt);
  ELSIF k='employment_type' AND p_module='drivers' AND txt IN ('full_time','part_time','contract','temporary') THEN result:=result||jsonb_build_object(k,txt);
  ELSIF k='contract_type' AND p_module='drivers' AND txt IN ('unlimited','limited','task_based') THEN result:=result||jsonb_build_object(k,txt);
  ELSIF k='surface' AND txt IN ('attendance','violations','training','performance','leave','vehicles','documents','handover','maintenance','employee_payroll','driver_payroll') THEN result:=result||jsonb_build_object(k,txt);
  ELSIF k='operation' AND txt IN ('create','update','status','archive','restore','delete','assign','unassign','start','complete','cancel','verify','finalize','approve','reject','calculate','post','reverse','close','reopen') THEN result:=result||jsonb_build_object(k,txt);
  ELSIF k IN ('archived','profile_changed','identity_changed','contact_changed','bank_details_changed','payroll_terms_changed','compensation_changed','assignment_changed','reason_recorded','employment_changed','documents_changed','photo_changed','fields_changed','phone_changed','has_adjustment','is_active','is_finalized','period_locked') AND jsonb_typeof(v)='boolean' THEN result:=result||jsonb_build_object(k,v);
  ELSIF k IN ('version','profile_version','previous_version','expected_version','period_year','period_month','year','month','rows','count','total_count','violations','advances_reserved','rolledback_violations','rolledback_advances','documents_count','allocations_count') AND jsonb_typeof(v) IN ('number','string') AND txt ~ '^[0-9]{1,15}$' THEN
   IF k IN ('period_month','month') AND txt::numeric NOT BETWEEN 1 AND 12 OR k IN ('period_year','year') AND txt::numeric NOT BETWEEN 1 AND 9999 THEN CONTINUE;END IF;
   result:=result||jsonb_build_object(k,txt::numeric);
  ELSIF p_module IN ('attendance','hr','leave','violations','vehicles','maintenance','orders','platforms','payroll','accounting','invoices','expenses','payments','vat') AND k IN ('days','total_days','days_present','days_absent','days_leave','hours','duration_hours','overtime_hours','late_minutes','odometer','odometer_km','mileage') AND jsonb_typeof(v) IN ('number','string') AND txt ~ '^[0-9]{1,8}([.][0-9]{1,2})?$' THEN result:=result||jsonb_build_object(k,txt::numeric);
  ELSIF p_module IN ('attendance','hr','leave','violations','vehicles','maintenance','orders','platforms','payroll','accounting','invoices','expenses','payments','vat') AND k IN ('attendance_date','work_date','start_date','end_date','leave_date','training_date','review_date','incident_date','entry_date','payment_date','invoice_date','due_date','event_date','period_start','period_end','termination_date') AND jsonb_typeof(v)='string' AND txt ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN result:=result||jsonb_build_object(k,txt);
  ELSIF k IN ('created_at','updated_at','completed_at','finalized_at','verified_at','opened_at','closed_at','posted_at') AND jsonb_typeof(v)='string' AND txt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN result:=result||jsonb_build_object(k,txt);
  ELSIF k='period' AND jsonb_typeof(v)='string' AND txt ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN result:=result||jsonb_build_object(k,txt);
  ELSIF financial_module AND p_financial_read IS TRUE AND k IN ('amount','total_amount','net_amount','vat_amount','paid_amount','balance','total_debit','total_credit','net_balance','total_earnings','total_deductions','gross_payroll','net_payroll','gross_pay','net_pay','deductions','advance_amount','adjustment_amount','output_vat','recoverable_input_vat','non_recoverable_vat','pending_review_vat','adjustments_output','adjustments_input','net_position','variance','cod_variance') AND jsonb_typeof(v) IN ('number','string') AND txt ~ '^-?[0-9]{1,40}([.][0-9]{1,2})?$' THEN result:=result||jsonb_build_object(k,txt);
  END IF;
 END LOOP;
 IF p_values ? 'deleted_at' AND p_values->'deleted_at'<>'null'::jsonb THEN result:=result||jsonb_build_object('archived',true);END IF;
 IF financial_module AND has_money THEN result:=result||jsonb_build_object('has_adjustment',true);END IF;
 RETURN result;
END;$minimal$;
REVOKE ALL ON FUNCTION public.audit_metadata_minimal(text,text,jsonb,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.audit_metadata_minimal(text,text,jsonb,boolean) TO authenticated;

-- Owner access to historical columns is constrained by explicit caller gates.
-- SECURITY BARRIER keeps untrusted predicates behind tenant/permission checks.
CREATE OR REPLACE VIEW public.audit_log_safe WITH (security_barrier=true) AS
WITH caller AS (
 SELECT (SELECT auth.uid()) actor,(SELECT auth.role()) jwt_role,(SELECT public.get_my_tenant_id()) tenant_id,
  (SELECT public.user_has_permission('audit_log','read')) audit_read,
  (SELECT public.user_has_permission('payroll','read')) payroll_read,
  (SELECT public.user_has_permission('accounting','read')) accounting_read
)
SELECT a.id,a.tenant_id,a.actor_id,a.module,a.action,a.entity_type,a.entity_id,a.created_at,
 NULL::inet ip_address,NULL::text reason,
 public.audit_metadata_minimal(a.module,a.entity_type,a.old_values,CASE WHEN a.module='payroll' THEN c.payroll_read WHEN a.module IN ('accounting','invoices','expenses','payments','vat') THEN c.accounting_read ELSE false END) old_values,
 public.audit_metadata_minimal(a.module,a.entity_type,a.new_values,CASE WHEN a.module='payroll' THEN c.payroll_read WHEN a.module IN ('accounting','invoices','expenses','payments','vat') THEN c.accounting_read ELSE false END) new_values
FROM public.audit_log a CROSS JOIN caller c
WHERE c.actor IS NOT NULL AND c.jwt_role='authenticated' AND c.tenant_id IS NOT NULL AND c.audit_read IS TRUE AND a.tenant_id=c.tenant_id
 AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=c.tenant_id AND t.status='active'::public.tenant_status AND t.deleted_at IS NULL);
REVOKE ALL ON public.audit_log_safe FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.audit_log_safe TO authenticated;

CREATE OR REPLACE FUNCTION public.fetch_audit_trail_page(
 p_tenant_id uuid,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_actor_user_id uuid DEFAULT NULL,
 p_action text DEFAULT NULL,p_module text DEFAULT NULL,p_entity_type text DEFAULT NULL,p_entity_id uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid,created_at timestamptz,module text,action text,entity_type text,entity_id uuid,actor_id uuid,ip_address inet,reason text,old_values jsonb,new_values jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $audit$
 SELECT a.id,a.created_at,a.module,a.action,a.entity_type,a.entity_id,a.actor_id,a.ip_address,a.reason,a.old_values,a.new_values
 FROM public.audit_log_safe a
 WHERE a.tenant_id=p_tenant_id
 AND (p_from IS NULL OR a.created_at>=p_from) AND (p_to IS NULL OR a.created_at<=p_to)
 AND (p_actor_user_id IS NULL OR a.actor_id=p_actor_user_id OR a.actor_id=(SELECT u.auth_user_id FROM public.users u WHERE u.id=p_actor_user_id AND u.tenant_id=a.tenant_id LIMIT 1))
 AND (p_action IS NULL OR a.action=p_action) AND (p_module IS NULL OR a.module=p_module)
 AND (p_entity_type IS NULL OR a.entity_type=p_entity_type) AND (p_entity_id IS NULL OR a.entity_id=p_entity_id)
 ORDER BY a.created_at DESC,a.id LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100)
$audit$;
REVOKE ALL ON FUNCTION public.fetch_audit_trail_page(uuid,timestamptz,timestamptz,uuid,text,text,text,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fetch_audit_trail_page(uuid,timestamptz,timestamptz,uuid,text,text,text,uuid,integer) TO authenticated;

-- Remove historical per-column grants as well as table SELECT. Trusted service
-- writes and the stored append-only history remain unchanged.
REVOKE SELECT ON public.audit_log FROM PUBLIC,anon,authenticated;
DO $columns$ DECLARE col record;BEGIN
 FOR col IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid='public.audit_log'::regclass AND attnum>0 AND NOT attisdropped LOOP
  EXECUTE format('REVOKE SELECT(%I) ON public.audit_log FROM PUBLIC,anon,authenticated',col.attname);
 END LOOP;
END;$columns$;
GRANT SELECT(id,tenant_id,actor_id,module,action,entity_type,entity_id,created_at) ON public.audit_log TO authenticated;
COMMIT;
