BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated;
-- All fleet writers serialize on the parent vehicle before child/history rows.
-- Actor/tenant/MFA/RBAC are caller-bound; audit and every side effect commit together.
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.vehicle_maintenance_events ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.vehicle_documents ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.vehicle_handover_forms ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.vehicle_assignments ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION public.fleet_bump_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.version:=OLD.version+1; NEW.updated_at:=clock_timestamp(); RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.fleet_bump_version() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zz_fleet_version ON public.vehicles;
CREATE TRIGGER zz_fleet_version BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.fleet_bump_version();
DROP TRIGGER IF EXISTS zz_fleet_version ON public.vehicle_maintenance_events;
CREATE TRIGGER zz_fleet_version BEFORE UPDATE ON public.vehicle_maintenance_events FOR EACH ROW EXECUTE FUNCTION public.fleet_bump_version();
DROP TRIGGER IF EXISTS zz_fleet_version ON public.vehicle_documents;
CREATE TRIGGER zz_fleet_version BEFORE UPDATE ON public.vehicle_documents FOR EACH ROW EXECUTE FUNCTION public.fleet_bump_version();
DROP TRIGGER IF EXISTS zz_fleet_version ON public.vehicle_handover_forms;
CREATE TRIGGER zz_fleet_version BEFORE UPDATE ON public.vehicle_handover_forms FOR EACH ROW EXECUTE FUNCTION public.fleet_bump_version();
DROP TRIGGER IF EXISTS zz_fleet_version ON public.vehicle_assignments;
CREATE TRIGGER zz_fleet_version BEFORE UPDATE ON public.vehicle_assignments FOR EACH ROW EXECUTE FUNCTION public.fleet_bump_version();

CREATE OR REPLACE FUNCTION private.mutate_maintenance_event(p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<fleet_maintenance>>
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); v public.vehicles%ROWTYPE;
 e public.vehicle_maintenance_events%ROWTYPE; n public.vehicle_maintenance_events%ROWTYPE;
 vid uuid; eid uuid:=coalesce(p_id,gen_random_uuid()); before_row jsonb; after_row jsonb; reading integer; stamp timestamptz:=clock_timestamp();
BEGIN
 IF p_action NOT IN ('create','update','start','complete','cancel','archive') OR p_action IS NULL THEN RAISE EXCEPTION 'FLT001: invalid maintenance operation'; END IF;
 IF a IS NULL OR t IS NULL OR public.user_has_permission('maintenance',CASE WHEN p_action='create' THEN 'create' WHEN p_action='archive' THEN 'delete' ELSE 'update' END) IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: maintenance permission and verified session required'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('vehicle_id','maintenance_type','reported_by_driver_id','fault_description','provider','cost','parts_replaced','odometer_at_service','date_in','date_out','next_service_km','next_service_date','notes','reason')) THEN RAISE EXCEPTION 'FLT002: invalid maintenance fields'; END IF;
 IF p_action='create' THEN
  IF p_id IS NOT NULL THEN RAISE EXCEPTION 'FLT002: new events cannot replace an existing event'; END IF;
  vid:=(p_input->>'vehicle_id')::uuid;
 ELSE
  SELECT vehicle_id INTO vid FROM public.vehicle_maintenance_events WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL;
 END IF;
 SELECT * INTO v FROM public.vehicles WHERE id=vid AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLT003: active tenant vehicle not found'; END IF;
 IF v.status='retired' THEN RAISE EXCEPTION 'FLT004: retired vehicles cannot receive operational changes'; END IF;
 IF (p_action='create' AND (p_input ? 'date_out' OR p_input ? 'reason')) OR (p_action='update' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('maintenance_type','fault_description','provider','cost','parts_replaced','next_service_km','next_service_date','notes'))) OR (p_action='complete' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('cost','date_out','odometer_at_service','parts_replaced','notes'))) THEN RAISE EXCEPTION 'FLT002: invalid fields for transition'; END IF;
 IF p_action IN ('start','cancel','archive') AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k<>'reason') THEN RAISE EXCEPTION 'FLT002: invalid fields for transition'; END IF;
 IF p_action<>'create' THEN
  SELECT * INTO e FROM public.vehicle_maintenance_events WHERE id=p_id AND tenant_id=t AND vehicle_id=vid AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLT003: maintenance event not found'; END IF;
  IF p_expected_version IS NULL OR e.version<>p_expected_version THEN RAISE EXCEPTION 'FLT005: record changed; reload before saving'; END IF;
  IF (p_input ? 'vehicle_id' AND (p_input->>'vehicle_id')::uuid IS DISTINCT FROM vid) THEN RAISE EXCEPTION 'FLT006: a maintenance event cannot move to another vehicle'; END IF;
  IF (p_action IN ('update','start') AND e.status<>'open') OR (p_action IN ('complete','cancel') AND e.status NOT IN ('open','in_progress')) OR (p_action='archive' AND e.status NOT IN ('open','cancelled')) THEN RAISE EXCEPTION 'FLT007: finalized or started maintenance history cannot be changed by this operation'; END IF;
  before_row:=to_jsonb(e);
 END IF;
 IF p_action IN ('create','update') THEN
  n:=jsonb_populate_record(NULL::public.vehicle_maintenance_events,coalesce(before_row,jsonb_build_object('id',eid,'tenant_id',t,'vehicle_id',vid,'status','open','reported_at',stamp,'date_in',stamp,'created_at',stamp,'updated_at',stamp,'created_by',a,'updated_by',a,'version',1)) || (p_input-'reason'-'date_out'));
  IF n.maintenance_type IS NULL OR n.maintenance_type NOT IN ('preventive','emergency','periodic','repair') OR length(btrim(coalesce(n.fault_description,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'FLT008: maintenance type and fault description are required'; END IF;
  IF n.reported_by_driver_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=n.reported_by_driver_id AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'FLT009: reported driver must belong to this tenant'; END IF;
  IF n.cost IS NOT NULL AND (n.cost<0 OR n.cost>99999999.99) OR n.next_service_km IS NOT NULL AND n.next_service_km NOT BETWEEN 0 AND 5000000 THEN RAISE EXCEPTION 'FLT010: maintenance cost or next service reading is invalid'; END IF;
  IF length(coalesce(n.provider,''))>200 OR length(coalesce(n.parts_replaced,''))>1000 OR length(coalesce(n.notes,''))>2000 THEN RAISE EXCEPTION 'FLT010: maintenance details are too long'; END IF;
  IF n.date_in IS NULL OR n.date_in>stamp+interval '5 minutes' THEN RAISE EXCEPTION 'FLT011: entry date cannot be in the future'; END IF;
  IF p_action='create' THEN
   reading:=coalesce(n.odometer_at_service,v.odometer_current); n.odometer_at_service:=reading;
   INSERT INTO public.vehicle_maintenance_events SELECT n.*;
  ELSE
   UPDATE public.vehicle_maintenance_events SET maintenance_type=n.maintenance_type,fault_description=btrim(n.fault_description),provider=nullif(btrim(n.provider),''),cost=n.cost,parts_replaced=nullif(btrim(n.parts_replaced),''),next_service_km=n.next_service_km,next_service_date=n.next_service_date,notes=nullif(btrim(n.notes),''),updated_by=a WHERE id=eid AND tenant_id=t;
  END IF;
 ELSIF p_action='start' THEN
  UPDATE public.vehicle_maintenance_events SET status='in_progress',date_in=coalesce(date_in,stamp),updated_by=a WHERE id=eid AND tenant_id=t;
  IF v.status IN ('available','assigned') THEN UPDATE public.vehicles SET status='in_maintenance',updated_by=a WHERE id=vid AND tenant_id=t; END IF;
 ELSIF p_action='complete' THEN
  IF p_input->>'cost' IS NULL OR (p_input->>'cost')::numeric<0 OR (p_input->>'cost')::numeric>99999999.99 THEN RAISE EXCEPTION 'FLT010: a nonnegative actual cost is required'; END IF;
  IF coalesce(nullif(p_input->>'date_out','')::timestamptz,stamp)<e.date_in OR nullif(p_input->>'date_out','')::timestamptz>stamp+interval '5 minutes' THEN RAISE EXCEPTION 'FLT011: completion date must follow entry and cannot be in the future'; END IF;
  reading:=nullif(p_input->>'odometer_at_service','')::integer;
  UPDATE public.vehicle_maintenance_events SET status='completed',cost=(p_input->>'cost')::numeric,date_out=coalesce(nullif(p_input->>'date_out','')::timestamptz,stamp),odometer_at_service=coalesce(reading,odometer_at_service),parts_replaced=coalesce(nullif(btrim(p_input->>'parts_replaced'),''),parts_replaced),notes=coalesce(nullif(btrim(p_input->>'notes'),''),notes),updated_by=a WHERE id=eid AND tenant_id=t;
 ELSIF p_action IN ('cancel','archive') THEN
  IF length(btrim(coalesce(p_input->>'reason',''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FLT012: a reason is required'; END IF;
  UPDATE public.vehicle_maintenance_events SET status=CASE WHEN p_action='cancel' THEN 'cancelled' ELSE status END,notes=concat_ws(E'\n',nullif(notes,''),CASE WHEN p_action='cancel' THEN 'Cancelled: ' ELSE 'Archived: ' END || btrim(p_input->>'reason')),deleted_at=CASE WHEN p_action='archive' THEN stamp ELSE deleted_at END,updated_by=a WHERE id=eid AND tenant_id=t;
 END IF;
 IF reading IS NOT NULL THEN
  IF reading NOT BETWEEN 0 AND 5000000 OR reading<v.odometer_current OR EXISTS(SELECT 1 FROM public.vehicle_odometer_logs l WHERE l.vehicle_id=vid AND l.tenant_id=t AND l.deleted_at IS NULL AND l.reading>fleet_maintenance.reading) THEN RAISE EXCEPTION 'VEH003: odometer reading cannot move backwards'; END IF;
  INSERT INTO public.vehicle_odometer_logs(tenant_id,vehicle_id,reading,recorded_at,recorded_by,source,notes) VALUES(t,vid,reading,stamp,a,'manual','Maintenance '||p_action);
  UPDATE public.vehicles SET odometer_current=reading,odometer_last_service=CASE WHEN p_action='complete' THEN reading ELSE odometer_last_service END,updated_by=a WHERE id=vid AND tenant_id=t;
 END IF;
 IF p_action IN ('complete','cancel','archive') AND v.status='in_maintenance' AND NOT EXISTS(SELECT 1 FROM public.vehicle_maintenance_events WHERE vehicle_id=vid AND tenant_id=t AND deleted_at IS NULL AND status IN ('open','in_progress')) THEN
  UPDATE public.vehicles SET status=CASE WHEN EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE vehicle_id=vid AND tenant_id=t AND is_current AND deleted_at IS NULL) THEN 'assigned'::public.vehicle_status ELSE 'available'::public.vehicle_status END,updated_by=a WHERE id=vid AND tenant_id=t AND status='in_maintenance';
 END IF;
 SELECT to_jsonb(x) INTO after_row FROM public.vehicle_maintenance_events x WHERE id=eid AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'maintenance','vehicle_maintenance_events',eid,'maintenance_'||p_action,before_row,after_row);
 RETURN jsonb_build_object('id',eid,'version',after_row->'version','updated_at',after_row->>'updated_at','vehicle_id',vid);
END; $$;
REVOKE ALL ON FUNCTION private.mutate_maintenance_event(text,jsonb,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.mutate_maintenance_event(text,jsonb,uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION private.record_fleet_odometer(p_vehicle_id uuid,p_reading integer,p_recorded_at timestamptz DEFAULT NULL,p_source text DEFAULT 'manual',p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); v public.vehicles%ROWTYPE; lid uuid; stamp timestamptz:=clock_timestamp();
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('maintenance','create') IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: maintenance permission and verified session required'; END IF;
 SELECT * INTO v FROM public.vehicles WHERE id=p_vehicle_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR v.status='retired' THEN RAISE EXCEPTION 'FLT003: active operational vehicle required'; END IF;
 IF p_reading IS NULL OR p_reading NOT BETWEEN 0 AND 5000000 OR p_reading<v.odometer_current OR EXISTS(SELECT 1 FROM public.vehicle_odometer_logs WHERE vehicle_id=p_vehicle_id AND tenant_id=t AND deleted_at IS NULL AND reading>p_reading) THEN RAISE EXCEPTION 'VEH003: odometer reading cannot move backwards'; END IF;
 IF p_source IS NULL OR p_source NOT IN ('manual','gps','obd','import') OR coalesce(p_recorded_at,stamp)>stamp+interval '5 minutes' OR length(coalesce(p_notes,''))>500 THEN RAISE EXCEPTION 'FLT010: invalid odometer details'; END IF;
 INSERT INTO public.vehicle_odometer_logs(tenant_id,vehicle_id,reading,recorded_at,recorded_by,source,notes) VALUES(t,p_vehicle_id,p_reading,coalesce(p_recorded_at,stamp),a,p_source,nullif(btrim(p_notes),'')) RETURNING id INTO lid;
 UPDATE public.vehicles SET odometer_current=p_reading,updated_by=a WHERE id=p_vehicle_id AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values) VALUES(t,a,'maintenance','vehicle_odometer_logs',lid,'odometer_recorded',jsonb_build_object('vehicle_id',p_vehicle_id,'reading',p_reading));
 RETURN jsonb_build_object('id',lid);
END; $$;
REVOKE ALL ON FUNCTION private.record_fleet_odometer(uuid,integer,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.record_fleet_odometer(uuid,integer,timestamptz,text,text) TO authenticated;

-- Vehicle writes cannot set assignment pointers or fabricate maintenance status.
CREATE OR REPLACE FUNCTION private.save_fleet_vehicle(p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL,p_archive_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); v public.vehicles%ROWTYPE; n public.vehicles%ROWTYPE; vid uuid:=coalesce(p_id,gen_random_uuid()); old_row jsonb; new_row jsonb; stamp timestamptz:=clock_timestamp();
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('vehicles',CASE WHEN p_archive_reason IS NOT NULL THEN 'delete' WHEN p_id IS NULL THEN 'create' ELSE 'update' END) IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: vehicle permission and verified session required'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('vehicle_code','plate_number','plate_type','make','model','year','color','chassis_number','engine_number','vin','status','condition_status','fuel_type','odometer_current','odometer_last_service','odometer_unit','purchase_date','warranty_expiry','insurance_expiry','insurance_provider','insurance_policy_number','inspection_expiry','registration_expiry','operating_card_expiry','primary_platform_id','transmission','seats','cargo_capacity','notes','tags')) THEN RAISE EXCEPTION 'FLT002: invalid vehicle fields'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO v FROM public.vehicles WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLT003: active tenant vehicle not found'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<>v.version THEN RAISE EXCEPTION 'FLT005: record changed; reload before saving'; END IF;
  old_row:=to_jsonb(v);
 END IF;
 IF p_archive_reason IS NOT NULL THEN
  IF length(btrim(p_archive_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FLT012: a reason is required'; END IF;
  IF v.current_driver_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE vehicle_id=vid AND tenant_id=t AND is_current AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.vehicle_maintenance_events WHERE vehicle_id=vid AND tenant_id=t AND deleted_at IS NULL AND status IN ('open','in_progress')) THEN RAISE EXCEPTION 'FLT013: end active assignments and maintenance before archiving'; END IF;
  UPDATE public.vehicles SET deleted_at=stamp,status='retired',updated_by=a WHERE id=vid AND tenant_id=t;
 ELSE
  n:=jsonb_populate_record(NULL::public.vehicles,coalesce(old_row,jsonb_build_object('id',vid,'tenant_id',t,'status','available','condition_status','good','odometer_current',0,'odometer_unit','km','created_at',stamp,'updated_at',stamp,'created_by',a,'version',1)) || p_input);
  IF length(btrim(coalesce(n.plate_number,''))) NOT BETWEEN 4 AND 16 OR n.plate_number !~ '^([A-Z]{1,3}[ ]?[0-9]{3,4}|[ء-ي]{1,3}[ ]?[0-9]{3,4}|[0-9]{4,7})$' OR length(btrim(coalesce(n.make,''))) NOT BETWEEN 1 AND 100 OR length(btrim(coalesce(n.model,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FLT014: valid plate, make and model required'; END IF;
  IF n.odometer_current NOT BETWEEN 0 AND 5000000 OR (p_id IS NOT NULL AND n.odometer_current<v.odometer_current) OR n.odometer_last_service>n.odometer_current OR n.seats NOT BETWEEN 1 AND 100 OR n.cargo_capacity<0 OR length(coalesce(n.notes,''))>2000 THEN RAISE EXCEPTION 'FLT010: invalid vehicle values'; END IF;
  IF n.primary_platform_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.delivery_platforms WHERE id=n.primary_platform_id AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'FLT009: platform must belong to this tenant'; END IF;
  IF (p_id IS NULL AND n.status NOT IN ('available','off_road','retired')) OR (p_id IS NOT NULL AND n.status IS DISTINCT FROM v.status AND (n.status NOT IN ('available','off_road','retired') OR v.current_driver_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE tenant_id=t AND vehicle_id=vid AND is_current AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.vehicle_maintenance_events WHERE tenant_id=t AND vehicle_id=vid AND deleted_at IS NULL AND status IN ('open','in_progress')))) THEN RAISE EXCEPTION 'FLT015: status is managed by active assignments and maintenance'; END IF;
  n.vehicle_code:=coalesce(nullif(btrim(n.vehicle_code),''),'VEH-'||upper(substr(replace(vid::text,'-',''),1,10))); n.plate_number:=btrim(n.plate_number); n.make:=btrim(n.make); n.model:=btrim(n.model);
  IF p_id IS NULL THEN INSERT INTO public.vehicles SELECT n.*;
  ELSE UPDATE public.vehicles SET vehicle_code=n.vehicle_code,plate_number=n.plate_number,plate_type=n.plate_type,make=n.make,model=n.model,year=n.year,color=n.color,chassis_number=n.chassis_number,engine_number=n.engine_number,vin=n.vin,status=n.status,condition_status=n.condition_status,fuel_type=n.fuel_type,odometer_current=n.odometer_current,odometer_last_service=n.odometer_last_service,odometer_unit=n.odometer_unit,purchase_date=n.purchase_date,warranty_expiry=n.warranty_expiry,insurance_expiry=n.insurance_expiry,insurance_provider=n.insurance_provider,insurance_policy_number=n.insurance_policy_number,inspection_expiry=n.inspection_expiry,registration_expiry=n.registration_expiry,operating_card_expiry=n.operating_card_expiry,primary_platform_id=n.primary_platform_id,transmission=n.transmission,seats=n.seats,cargo_capacity=n.cargo_capacity,notes=n.notes,tags=n.tags,updated_by=a WHERE id=vid AND tenant_id=t; END IF;
  IF p_id IS NULL OR n.odometer_current>v.odometer_current THEN INSERT INTO public.vehicle_odometer_logs(tenant_id,vehicle_id,reading,recorded_by,notes) VALUES(t,vid,n.odometer_current,a,'Vehicle record observation'); END IF;
 END IF;
 SELECT to_jsonb(x) INTO new_row FROM public.vehicles x WHERE id=vid AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'vehicles','vehicles',vid,CASE WHEN p_archive_reason IS NOT NULL THEN 'vehicle_archived' WHEN p_id IS NULL THEN 'vehicle_created' ELSE 'vehicle_updated' END,old_row,new_row||jsonb_build_object('archive_reason',p_archive_reason));
 RETURN jsonb_build_object('id',vid,'version',new_row->'version');
END; $$;

-- Parent lock order: vehicle, driver, assignment. Ending a driver assignment
-- never overrides an active maintenance hold or a deliberate off-road state.
CREATE OR REPLACE FUNCTION private.mutate_fleet_assignment(p_action text,p_vehicle_id uuid,p_driver_id uuid,p_input jsonb DEFAULT '{}',p_expected_version bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); v public.vehicles%ROWTYPE; d public.drivers%ROWTYPE; x public.vehicle_assignments%ROWTYPE; xid uuid:=gen_random_uuid(); reading integer; old_row jsonb; new_row jsonb; stamp timestamptz:=clock_timestamp();
BEGIN
 IF a IS NULL OR t IS NULL OR p_action IS NULL OR p_action NOT IN ('assign','unassign') OR public.user_has_permission('assignments',CASE WHEN p_action='assign' THEN 'create' ELSE 'update' END) IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: assignment permission and verified session required'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('assignment_reason','handover_odometer','return_odometer','notes')) THEN RAISE EXCEPTION 'FLT002: invalid assignment fields'; END IF;
 SELECT * INTO v FROM public.vehicles WHERE id=p_vehicle_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLT003: active tenant vehicle not found'; END IF;
 SELECT * INTO d FROM public.drivers WHERE id=p_driver_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLT009: driver must belong to this tenant'; END IF;
 IF length(coalesce(p_input->>'assignment_reason',''))>500 OR length(coalesce(p_input->>'notes',''))>500 THEN RAISE EXCEPTION 'FLT010: assignment details are too long'; END IF;
 IF p_action='assign' THEN
  IF v.status<>'available' OR v.current_driver_id IS NOT NULL OR d.status NOT IN ('active','on_leave') OR d.current_vehicle_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE tenant_id=t AND deleted_at IS NULL AND is_current AND (vehicle_id=p_vehicle_id OR driver_id=p_driver_id)) OR EXISTS(SELECT 1 FROM public.vehicle_maintenance_events WHERE tenant_id=t AND vehicle_id=p_vehicle_id AND deleted_at IS NULL AND status IN ('open','in_progress')) THEN RAISE EXCEPTION 'FLT016: driver or vehicle is no longer available'; END IF;
  reading:=coalesce(nullif(p_input->>'handover_odometer','')::integer,v.odometer_current);
  INSERT INTO public.vehicle_assignments(id,tenant_id,vehicle_id,driver_id,assignment_reason,handover_odometer,created_by) VALUES(xid,t,p_vehicle_id,p_driver_id,nullif(btrim(p_input->>'assignment_reason'),''),reading,a);
  UPDATE public.vehicles SET status='assigned',current_driver_id=p_driver_id,updated_by=a WHERE id=p_vehicle_id AND tenant_id=t;
  UPDATE public.drivers SET current_vehicle_id=p_vehicle_id,updated_by=a WHERE id=p_driver_id AND tenant_id=t;
 ELSE
  SELECT * INTO x FROM public.vehicle_assignments WHERE tenant_id=t AND vehicle_id=p_vehicle_id AND driver_id=p_driver_id AND is_current AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLT017: current assignment not found'; END IF;
  IF p_expected_version IS NULL OR x.version<>p_expected_version THEN RAISE EXCEPTION 'FLT005: record changed; reload before saving'; END IF;
  xid:=x.id; old_row:=to_jsonb(x); reading:=coalesce(nullif(p_input->>'return_odometer','')::integer,v.odometer_current);
  UPDATE public.vehicle_assignments SET is_current=false,unassigned_at=stamp,return_odometer=reading,notes=nullif(btrim(p_input->>'notes'),''),updated_by=a WHERE id=x.id AND tenant_id=t;
  UPDATE public.drivers SET current_vehicle_id=NULL,updated_by=a WHERE id=p_driver_id AND tenant_id=t AND current_vehicle_id=p_vehicle_id;
  UPDATE public.vehicles SET current_driver_id=NULL,status=CASE WHEN EXISTS(SELECT 1 FROM public.vehicle_maintenance_events WHERE tenant_id=t AND vehicle_id=p_vehicle_id AND deleted_at IS NULL AND status IN ('open','in_progress')) THEN 'in_maintenance'::public.vehicle_status WHEN status='assigned' THEN 'available'::public.vehicle_status ELSE status END,updated_by=a WHERE id=p_vehicle_id AND tenant_id=t AND current_driver_id=p_driver_id;
 END IF;
 IF reading NOT BETWEEN 0 AND 5000000 OR reading<v.odometer_current THEN RAISE EXCEPTION 'VEH003: odometer reading cannot move backwards'; END IF;
 INSERT INTO public.vehicle_odometer_logs(tenant_id,vehicle_id,reading,recorded_at,recorded_by,notes) VALUES(t,p_vehicle_id,reading,stamp,a,'Assignment '||p_action);
 UPDATE public.vehicles SET odometer_current=reading,updated_by=a WHERE id=p_vehicle_id AND tenant_id=t;
 SELECT to_jsonb(z) INTO new_row FROM public.vehicle_assignments z WHERE id=xid AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'vehicles','vehicle_assignments',xid,'vehicle_'||p_action,old_row,new_row);
 RETURN jsonb_build_object('id',xid,'version',new_row->'version');
END; $$;

CREATE OR REPLACE FUNCTION private.mutate_fleet_document(p_action text,p_vehicle_id uuid,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); v public.vehicles%ROWTYPE; d public.vehicle_documents%ROWTYPE; n public.vehicle_documents%ROWTYPE; did uuid:=coalesce(p_id,gen_random_uuid()); old_row jsonb; new_row jsonb; o storage.objects%ROWTYPE; stamp timestamptz:=clock_timestamp();
BEGIN
 IF a IS NULL OR t IS NULL OR p_action IS NULL OR p_action NOT IN ('save','verify','archive') OR public.user_has_permission('vehicles',CASE WHEN p_action='archive' THEN 'delete' WHEN p_id IS NULL THEN 'create' ELSE 'update' END) IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: vehicle permission and verified session required'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('doc_type','doc_number','issue_date','expiry_date','issuing_authority','file_url','notes','reason')) THEN RAISE EXCEPTION 'FLT002: invalid document fields'; END IF;
 SELECT * INTO v FROM public.vehicles WHERE id=p_vehicle_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLT003: active tenant vehicle not found'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO d FROM public.vehicle_documents WHERE id=p_id AND tenant_id=t AND vehicle_id=p_vehicle_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLT018: vehicle document not found'; END IF;
  IF p_expected_version IS NULL OR d.version<>p_expected_version THEN RAISE EXCEPTION 'FLT005: record changed; reload before saving'; END IF;
  old_row:=to_jsonb(d);
 END IF;
 IF p_action='save' THEN
  IF d.is_verified THEN RAISE EXCEPTION 'FLT019: verified documents are immutable; upload a replacement'; END IF;
  n:=jsonb_populate_record(NULL::public.vehicle_documents,coalesce(old_row,jsonb_build_object('id',did,'tenant_id',t,'vehicle_id',p_vehicle_id,'created_at',stamp,'updated_at',stamp,'created_by',a,'version',1,'is_active',true,'is_verified',false))||p_input-'reason');
  IF n.doc_type IS NULL OR n.file_url IS NULL OR n.issue_date>n.expiry_date OR length(coalesce(n.doc_number,''))>100 OR length(coalesce(n.issuing_authority,''))>200 OR length(coalesce(n.notes,''))>2000 THEN RAISE EXCEPTION 'FLT010: invalid document details'; END IF;
  IF p_id IS NULL OR n.file_url IS DISTINCT FROM d.file_url THEN
   IF n.file_url NOT LIKE t::text||'/'||p_vehicle_id::text||'/%' OR n.file_url ~ '(^|/)..(/|$)' THEN RAISE EXCEPTION 'FLT020: document file must belong to this vehicle'; END IF;
   SELECT * INTO o FROM storage.objects WHERE bucket_id='vehicle-documents' AND name=n.file_url AND owner_id=a::text FOR SHARE;
   IF NOT FOUND OR coalesce((o.metadata->>'size')::bigint,0) NOT BETWEEN 1 AND 20971520 OR o.metadata->>'mimetype' NOT IN ('application/pdf','image/jpeg','image/png') OR EXISTS(SELECT 1 FROM public.vehicle_documents WHERE file_url=n.file_url AND id<>did) THEN RAISE EXCEPTION 'FLT021: a new owned document upload is required'; END IF;
   n.file_size_bytes:=(o.metadata->>'size')::bigint; n.mime_type:=o.metadata->>'mimetype';
  END IF;
  IF p_id IS NOT NULL AND n.doc_type IS DISTINCT FROM d.doc_type THEN RAISE EXCEPTION 'FLT027: document type cannot change; upload a replacement'; END IF;
  IF p_id IS NULL THEN
   UPDATE public.vehicle_documents SET is_active=false,updated_by=a WHERE tenant_id=t AND vehicle_id=p_vehicle_id AND doc_type=n.doc_type AND is_active AND deleted_at IS NULL;
   INSERT INTO public.vehicle_documents SELECT n.*;
  ELSE UPDATE public.vehicle_documents SET doc_type=n.doc_type,doc_number=n.doc_number,issue_date=n.issue_date,expiry_date=n.expiry_date,issuing_authority=n.issuing_authority,file_url=n.file_url,file_size_bytes=n.file_size_bytes,mime_type=n.mime_type,notes=n.notes,updated_by=a WHERE id=did AND tenant_id=t; END IF;
 ELSIF p_action='verify' THEN
  IF p_id IS NULL OR NOT d.is_active THEN RAISE EXCEPTION 'FLT018: active vehicle document required'; END IF;
  IF public.user_has_permission('vehicles','approve') IS NOT TRUE AND NOT EXISTS(SELECT 1 FROM public.users WHERE auth_user_id=a AND tenant_id=t AND role IN ('general_manager','admin') AND status='active') THEN RAISE EXCEPTION 'AUTH007: document verification permission required'; END IF;
  UPDATE public.vehicle_documents SET is_verified=true,verified_by=a,verified_at=stamp,updated_by=a WHERE id=did AND tenant_id=t;
 ELSE
  IF p_id IS NULL OR length(btrim(coalesce(p_input->>'reason',''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FLT012: a reason is required'; END IF;
  UPDATE public.vehicle_documents SET is_active=false,deleted_at=stamp,updated_by=a WHERE id=did AND tenant_id=t;
 END IF;
 SELECT to_jsonb(x) INTO new_row FROM public.vehicle_documents x WHERE id=did AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'vehicles','vehicle_documents',did,'vehicle_document_'||p_action,old_row,new_row||jsonb_build_object('reason',p_input->>'reason'));
 RETURN jsonb_build_object('id',did,'version',new_row->'version');
END; $$;

-- A handover is a physical observation tied to a genuine assignment. It is
-- finalized by both acknowledgements; finalized history is never overwritten.
ALTER TABLE public.vehicle_handover_forms ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.vehicle_handover_forms DROP CONSTRAINT IF EXISTS vehicle_handover_forms_tenant_id_assignment_id_form_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS fleet_handover_active_type ON public.vehicle_handover_forms(tenant_id,assignment_id,form_type) WHERE deleted_at IS NULL;
ALTER TABLE public.vehicle_handover_forms ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
ALTER TABLE public.vehicle_handover_forms ADD COLUMN IF NOT EXISTS finalized_by uuid REFERENCES auth.users(id);
CREATE OR REPLACE FUNCTION private.save_fleet_handover(p_assignment_id uuid,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); vid uuid; v public.vehicles%ROWTYPE; x public.vehicle_assignments%ROWTYPE; h public.vehicle_handover_forms%ROWTYPE; n public.vehicle_handover_forms%ROWTYPE; hid uuid:=coalesce(p_id,gen_random_uuid()); old_row jsonb; new_row jsonb; stamp timestamptz:=clock_timestamp(); finalize boolean:=coalesce((p_input->>'finalize')::boolean,false);
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('assignments',CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END) IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: assignment permission and verified session required'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('form_type','form_date','odometer_reading','fuel_level','overall_condition','exterior_front','exterior_rear','exterior_left','exterior_right','interior_cabin','tires_front_left','tires_front_right','tires_rear_left','tires_rear_right','spare_tire','windshield','lights_headlights','lights_rear','ac_system','engine_compartment','registration_card_present','insurance_card_present','spare_tire_present','jack_tools_present','fire_extinguisher_present','reflectors_present','defects_noted','notes','finalize')) THEN RAISE EXCEPTION 'FLT002: invalid handover fields'; END IF;
 SELECT vehicle_id INTO vid FROM public.vehicle_assignments WHERE id=p_assignment_id AND tenant_id=t AND deleted_at IS NULL;
 SELECT * INTO v FROM public.vehicles WHERE id=vid AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLT003: active tenant vehicle not found'; END IF;
 SELECT * INTO x FROM public.vehicle_assignments WHERE id=p_assignment_id AND tenant_id=t AND vehicle_id=vid AND deleted_at IS NULL FOR UPDATE;
 IF p_id IS NOT NULL THEN
  SELECT * INTO h FROM public.vehicle_handover_forms WHERE id=p_id AND tenant_id=t AND assignment_id=x.id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLT022: handover form not found'; END IF;
  IF p_expected_version IS NULL OR h.version<>p_expected_version THEN RAISE EXCEPTION 'FLT005: record changed; reload before saving'; END IF;
  IF h.finalized_at IS NOT NULL OR h.driver_acknowledged_at IS NOT NULL OR h.supervisor_acknowledged_at IS NOT NULL THEN RAISE EXCEPTION 'FLT023: acknowledged handover history is immutable'; END IF;
  IF p_input->>'form_type' IS DISTINCT FROM h.form_type THEN RAISE EXCEPTION 'FLT024: handover type cannot change'; END IF;
  old_row:=to_jsonb(h);
 END IF;
 -- Require an explicit condition for every item; do not silently mark it OK.
 IF p_id IS NULL AND EXISTS(SELECT 1 FROM unnest(ARRAY['exterior_front','exterior_rear','exterior_left','exterior_right','interior_cabin','tires_front_left','tires_front_right','tires_rear_left','tires_rear_right','spare_tire','windshield','lights_headlights','lights_rear','ac_system','engine_compartment','registration_card_present','insurance_card_present','spare_tire_present','jack_tools_present','fire_extinguisher_present','reflectors_present']) k WHERE NOT p_input ? k) THEN RAISE EXCEPTION 'FLT025: inspect and complete every checklist item'; END IF;
 n:=jsonb_populate_record(NULL::public.vehicle_handover_forms,coalesce(old_row,jsonb_build_object('id',hid,'tenant_id',t,'assignment_id',x.id,'created_at',stamp,'updated_at',stamp,'created_by',a,'version',1))||(p_input-'finalize'));
 IF n.form_type NOT IN ('handover','return') OR n.form_date IS NULL OR n.form_date>(stamp AT TIME ZONE 'Asia/Riyadh')::date OR n.form_date<(x.assigned_at AT TIME ZONE 'Asia/Riyadh')::date OR n.odometer_reading IS NULL OR n.odometer_reading NOT BETWEEN 0 AND 5000000 OR n.overall_condition IS NULL OR length(coalesce(n.notes,''))>2000 OR length(coalesce(n.defects_noted,''))>2000 THEN RAISE EXCEPTION 'FLT010: invalid handover details'; END IF;
 IF n.form_type='return' AND x.is_current THEN RAISE EXCEPTION 'FLT026: end the assignment before recording its return'; END IF;
 IF n.form_type='handover' AND NOT x.is_current THEN RAISE EXCEPTION 'FLT026: initial handover requires a current assignment'; END IF;
 IF n.odometer_reading<coalesce(x.handover_odometer,0) OR (n.form_type='return' AND n.odometer_reading<coalesce(x.return_odometer,0)) THEN RAISE EXCEPTION 'VEH003: odometer reading cannot move backwards'; END IF;
 IF finalize THEN n.finalized_at:=stamp; n.finalized_by:=a; END IF;
 IF p_id IS NULL THEN INSERT INTO public.vehicle_handover_forms SELECT n.*;
 ELSE UPDATE public.vehicle_handover_forms SET form_date=n.form_date,odometer_reading=n.odometer_reading,fuel_level=n.fuel_level,overall_condition=n.overall_condition,exterior_front=n.exterior_front,exterior_rear=n.exterior_rear,exterior_left=n.exterior_left,exterior_right=n.exterior_right,interior_cabin=n.interior_cabin,tires_front_left=n.tires_front_left,tires_front_right=n.tires_front_right,tires_rear_left=n.tires_rear_left,tires_rear_right=n.tires_rear_right,spare_tire=n.spare_tire,windshield=n.windshield,lights_headlights=n.lights_headlights,lights_rear=n.lights_rear,ac_system=n.ac_system,engine_compartment=n.engine_compartment,registration_card_present=n.registration_card_present,insurance_card_present=n.insurance_card_present,spare_tire_present=n.spare_tire_present,jack_tools_present=n.jack_tools_present,fire_extinguisher_present=n.fire_extinguisher_present,reflectors_present=n.reflectors_present,defects_noted=n.defects_noted,notes=n.notes,finalized_at=n.finalized_at,finalized_by=n.finalized_by,updated_by=a WHERE id=hid AND tenant_id=t; END IF;
 UPDATE public.vehicle_assignments SET handover_form_id=CASE WHEN n.form_type='handover' THEN hid ELSE handover_form_id END,return_form_id=CASE WHEN n.form_type='return' THEN hid ELSE return_form_id END,updated_by=a WHERE id=x.id AND tenant_id=t;
 SELECT to_jsonb(z) INTO new_row FROM public.vehicle_handover_forms z WHERE id=hid AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'vehicles','vehicle_handover_forms',hid,'vehicle_handover_saved',old_row,new_row);
 RETURN jsonb_build_object('id',hid,'version',new_row->'version');
END; $$;

-- Authenticated clients read via RLS and mutate only through these contracts.
REVOKE INSERT,UPDATE,DELETE ON public.vehicles,public.vehicle_assignments,public.vehicle_documents,public.vehicle_handover_forms,public.vehicle_maintenance_events,public.vehicle_odometer_logs FROM PUBLIC,authenticated,anon;

-- Remove legacy column grants as well as table grants, preventing direct partial writes.
DO $fleet_acl$ DECLARE tab text; col record; BEGIN
 FOREACH tab IN ARRAY ARRAY['vehicles','vehicle_assignments','vehicle_documents','vehicle_handover_forms','vehicle_maintenance_events','vehicle_odometer_logs'] LOOP
  FOR col IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.'||tab) AND attnum>0 AND NOT attisdropped LOOP
   EXECUTE format('REVOKE INSERT(%I),UPDATE(%I) ON public.%I FROM PUBLIC,anon,authenticated',col.attname,col.attname,tab);
  END LOOP;
 END LOOP;
END $fleet_acl$;
REVOKE ALL ON FUNCTION private.mutate_maintenance_event(text,jsonb,uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.mutate_maintenance_event(text,jsonb,uuid,bigint) TO authenticated;
CREATE OR REPLACE FUNCTION public.mutate_maintenance_event(p_action text,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.mutate_maintenance_event(p_action,p_input,p_id,p_expected_version); $$;
REVOKE ALL ON FUNCTION public.mutate_maintenance_event(text,jsonb,uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_maintenance_event(text,jsonb,uuid,bigint) TO authenticated;

REVOKE ALL ON FUNCTION private.record_fleet_odometer(uuid,integer,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.record_fleet_odometer(uuid,integer,timestamptz,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.record_fleet_odometer(p_vehicle_id uuid,p_reading integer,p_recorded_at timestamptz DEFAULT NULL,p_source text DEFAULT 'manual',p_notes text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.record_fleet_odometer(p_vehicle_id,p_reading,p_recorded_at,p_source,p_notes); $$;
REVOKE ALL ON FUNCTION public.record_fleet_odometer(uuid,integer,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_fleet_odometer(uuid,integer,timestamptz,text,text) TO authenticated;

REVOKE ALL ON FUNCTION private.save_fleet_vehicle(jsonb,uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.save_fleet_vehicle(jsonb,uuid,bigint,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.save_fleet_vehicle(p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL,p_archive_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.save_fleet_vehicle(p_input,p_id,p_expected_version,p_archive_reason); $$;
REVOKE ALL ON FUNCTION public.save_fleet_vehicle(jsonb,uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_fleet_vehicle(jsonb,uuid,bigint,text) TO authenticated;

REVOKE ALL ON FUNCTION private.mutate_fleet_assignment(text,uuid,uuid,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.mutate_fleet_assignment(text,uuid,uuid,jsonb,bigint) TO authenticated;
CREATE OR REPLACE FUNCTION public.mutate_fleet_assignment(p_action text,p_vehicle_id uuid,p_driver_id uuid,p_input jsonb DEFAULT '{}',p_expected_version bigint DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.mutate_fleet_assignment(p_action,p_vehicle_id,p_driver_id,p_input,p_expected_version); $$;
REVOKE ALL ON FUNCTION public.mutate_fleet_assignment(text,uuid,uuid,jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_fleet_assignment(text,uuid,uuid,jsonb,bigint) TO authenticated;

REVOKE ALL ON FUNCTION private.mutate_fleet_document(text,uuid,jsonb,uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.mutate_fleet_document(text,uuid,jsonb,uuid,bigint) TO authenticated;
CREATE OR REPLACE FUNCTION public.mutate_fleet_document(p_action text,p_vehicle_id uuid,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.mutate_fleet_document(p_action,p_vehicle_id,p_input,p_id,p_expected_version); $$;
REVOKE ALL ON FUNCTION public.mutate_fleet_document(text,uuid,jsonb,uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_fleet_document(text,uuid,jsonb,uuid,bigint) TO authenticated;

REVOKE ALL ON FUNCTION private.save_fleet_handover(uuid,jsonb,uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.save_fleet_handover(uuid,jsonb,uuid,bigint) TO authenticated;
CREATE OR REPLACE FUNCTION public.save_fleet_handover(p_assignment_id uuid,p_input jsonb,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.save_fleet_handover(p_assignment_id,p_input,p_id,p_expected_version); $$;
REVOKE ALL ON FUNCTION public.save_fleet_handover(uuid,jsonb,uuid,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_fleet_handover(uuid,jsonb,uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION private.archive_fleet_handover(p_id uuid,p_expected_version bigint,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); vid uuid; h public.vehicle_handover_forms%ROWTYPE;
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('assignments','delete') IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: assignment permission and verified session required'; END IF;
 SELECT x.vehicle_id INTO vid FROM public.vehicle_handover_forms f JOIN public.vehicle_assignments x ON x.id=f.assignment_id AND x.tenant_id=t WHERE f.id=p_id AND f.tenant_id=t;
 PERFORM 1 FROM public.vehicles WHERE id=vid AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLT003: active tenant vehicle not found'; END IF;
 SELECT * INTO h FROM public.vehicle_handover_forms WHERE id=p_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLT022: handover form not found'; END IF;
 IF p_expected_version IS NULL OR h.version<>p_expected_version THEN RAISE EXCEPTION 'FLT005: record changed; reload before saving'; END IF;
 IF h.finalized_at IS NOT NULL OR h.driver_acknowledged_at IS NOT NULL OR h.supervisor_acknowledged_at IS NOT NULL THEN RAISE EXCEPTION 'FLT023: acknowledged handover history is immutable'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'FLT012: a reason is required'; END IF;
 UPDATE public.vehicle_handover_forms SET deleted_at=clock_timestamp(),updated_by=a WHERE id=p_id AND tenant_id=t;
 UPDATE public.vehicle_assignments SET handover_form_id=CASE WHEN handover_form_id=p_id THEN NULL ELSE handover_form_id END,return_form_id=CASE WHEN return_form_id=p_id THEN NULL ELSE return_form_id END,updated_by=a WHERE id=h.assignment_id AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'vehicles','vehicle_handover_forms',p_id,'vehicle_handover_archived',to_jsonb(h),jsonb_build_object('reason',p_reason));
 RETURN jsonb_build_object('id',p_id);
END; $$;
REVOKE ALL ON FUNCTION private.archive_fleet_handover(uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.archive_fleet_handover(uuid,bigint,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.archive_fleet_handover(p_id uuid,p_expected_version bigint,p_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.archive_fleet_handover(p_id,p_expected_version,p_reason); $$;
REVOKE ALL ON FUNCTION public.archive_fleet_handover(uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_fleet_handover(uuid,bigint,text) TO authenticated;
COMMIT;
