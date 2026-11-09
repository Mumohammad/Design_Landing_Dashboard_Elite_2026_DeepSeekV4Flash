-- Created by Supabase CLI as 20261102011432_atomic_external_fine_conversion.sql.
-- Renamed while unapplied to follow the repository's future-dated prerequisites.
-- Creating a payroll-deductible violation and linking its imported fine must
-- commit together. A lost response replays the same linked violation.
BEGIN;
ALTER FUNCTION public.resolve_external_fine(uuid,text,uuid,uuid,text) SET SCHEMA driver_operations_private;
REVOKE ALL ON FUNCTION driver_operations_private.resolve_external_fine(uuid,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.resolve_external_fine(p_id uuid,p_action text,p_driver_id uuid DEFAULT NULL,p_violation_id uuid DEFAULT NULL,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('assign','ignore','duplicate','reopen') OR p_violation_id IS NOT NULL THEN
  RAISE EXCEPTION 'FIN014: use the atomic fine conversion workflow';
 END IF;
 RETURN driver_operations_private.resolve_external_fine(p_id,p_action,p_driver_id,NULL,p_note);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_external_fine(uuid,text,uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_external_fine(uuid,text,uuid,uuid,text) TO authenticated;

CREATE FUNCTION driver_operations_private.convert_external_fine(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 t uuid:=public.get_my_tenant_id(); actor uuid:=auth.uid(); fine public.external_fine_imports;
 created jsonb; violation_id uuid; description text;
BEGIN
 IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('violations','create')
    OR NOT public.user_has_permission('violations','update') THEN
  RAISE EXCEPTION 'AUTH007: violations create and update permission required';
 END IF;
 SELECT * INTO fine FROM public.external_fine_imports WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF fine.id IS NULL THEN RAISE EXCEPTION 'FIN010: fine not found'; END IF;
 IF fine.status='violation_created' THEN
  IF fine.violation_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.violations v WHERE v.id=fine.violation_id
     AND v.tenant_id=t AND v.driver_id=fine.matched_driver_id AND v.external_fine_id=fine.id AND v.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'FIN015: linked violation requires review';
  END IF;
  RETURN jsonb_build_object('violation_id',fine.violation_id,'replayed',true);
 END IF;
 IF fine.status<>'matched' OR fine.matched_driver_id IS NULL THEN RAISE EXCEPTION 'FIN012: assign a driver before conversion'; END IF;
 IF fine.fine_amount IS NULL OR NOT(fine.fine_amount>=0 AND fine.fine_amount<=1000000) THEN
  RAISE EXCEPTION 'FIN005: a valid fine amount is required';
 END IF;
 description:=concat_ws(' · ','Traffic fine '||fine.external_ref,
   CASE WHEN fine.violation_type_code IS NOT NULL THEN 'type '||fine.violation_type_code END,
   CASE WHEN fine.vehicle_plate IS NOT NULL THEN 'plate '||fine.vehicle_plate END);
 created:=driver_operations_private.save_driver_profile_operation('violations',fine.matched_driver_id,
   jsonb_build_object('violation_type_id',NULL,'incident_date',coalesce(fine.violation_date,(now() AT TIME ZONE 'Asia/Riyadh')::date),
    'incident_location',fine.violation_location,'incident_description',description,'deduction_amount',fine.fine_amount,'status','open'),NULL,NULL);
 violation_id:=(created->>'id')::uuid;
 IF violation_id IS NULL THEN RAISE EXCEPTION 'FIN015: violation creation could not be confirmed'; END IF;
 PERFORM driver_operations_private.resolve_external_fine(fine.id,'link_violation',NULL,violation_id,NULL);
 RETURN jsonb_build_object('violation_id',violation_id,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION driver_operations_private.convert_external_fine(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION driver_operations_private.convert_external_fine(uuid) TO authenticated;
CREATE FUNCTION public.convert_my_external_fine(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT driver_operations_private.convert_external_fine(p_id); $$;
REVOKE ALL ON FUNCTION public.convert_my_external_fine(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.convert_my_external_fine(uuid) TO authenticated;
COMMIT;
