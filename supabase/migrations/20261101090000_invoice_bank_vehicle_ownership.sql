-- Invoice print/payment intent and Saudi fleet ownership details.
--
-- Invoices: the bank account printed in the invoice's bank-details box. It is
-- presentation data only and never moves money.
--
-- Vehicles: ownership (company-owned / rented / driver-owned), the
-- registration (istimara) sequence number and rental details for rented
-- vehicles. Saudi plates accept 1-4 digits after up to three letters.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id);
CREATE INDEX IF NOT EXISTS idx_invoices_bank_account ON public.invoices(bank_account_id) WHERE bank_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_my_invoice_draft(p_input jsonb,p_invoice_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.get_my_tenant_id();a uuid:=auth.uid();h text;r invoice_workflow_private.draft_receipts%ROWTYPE;response jsonb;
 v_bank uuid;v_stamp timestamptz;
BEGIN
 IF t IS NULL OR a IS NULL OR NOT public.user_has_permission('invoices',CASE WHEN p_invoice_id IS NULL THEN 'create' ELSE 'update' END) THEN RAISE EXCEPTION 'AUTH007: invoice permission required';END IF;
 IF p_request_id IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'INV002: draft request identity and input required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-draft:'||t::text||':'||a::text||':'||p_request_id::text,0));
 h:=encode(extensions.digest(jsonb_build_object('input',p_input,'invoice_id',p_invoice_id,'expected_updated_at',to_char(p_expected_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'sha256'),'hex');
 SELECT * INTO r FROM invoice_workflow_private.draft_receipts WHERE tenant_id=t AND actor_id=a AND request_id=p_request_id;
 IF FOUND THEN
  IF r.payload_hash<>h THEN RAISE EXCEPTION 'INV015: draft request identifies different details; reload before a new request';END IF;
  RETURN r.response||jsonb_build_object('replayed',true);
 END IF;
 IF coalesce(jsonb_typeof(p_input->'bank_account_id'),'null') NOT IN ('null','string')
  OR (jsonb_typeof(p_input->'bank_account_id')='string' AND p_input->>'bank_account_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN RAISE EXCEPTION 'INV002: invalid invoice bank account';END IF;
 v_bank:=(p_input->>'bank_account_id')::uuid;
 IF v_bank IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bank_accounts b WHERE b.id=v_bank AND b.tenant_id=t AND b.is_active AND b.deleted_at IS NULL AND b.currency=coalesce(p_input->>'currency','SAR')) THEN
  RAISE EXCEPTION 'INV002: select an active bank account in the invoice currency';END IF;
 response:=public.save_invoice_draft(p_input-'bank_account_id',p_invoice_id,p_expected_updated_at);
 UPDATE public.invoices SET bank_account_id=v_bank
  WHERE id=(response->>'id')::uuid AND tenant_id=t RETURNING updated_at INTO v_stamp;
 IF v_stamp IS NOT NULL THEN response:=response||jsonb_build_object('updated_at',v_stamp);END IF;
 INSERT INTO invoice_workflow_private.draft_receipts(tenant_id,actor_id,request_id,payload_hash,response) VALUES(t,a,p_request_id,h,response);
 RETURN response||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.save_my_invoice_draft(jsonb,uuid,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_my_invoice_draft(jsonb,uuid,timestamptz,uuid) TO authenticated;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS ownership_type text,
  ADD COLUMN IF NOT EXISTS sequence_number text,
  ADD COLUMN IF NOT EXISTS rental_company text,
  ADD COLUMN IF NOT EXISTS rental_contract_end date,
  ADD COLUMN IF NOT EXISTS rental_monthly_cost numeric(12,2);
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_ownership_type_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_ownership_type_check
  CHECK (ownership_type IS NULL OR ownership_type IN ('company_owned','rented','driver_owned'));
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_sequence_number_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_sequence_number_check
  CHECK (sequence_number IS NULL OR sequence_number ~ '^[0-9]{6,10}$');
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_rental_monthly_cost_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_rental_monthly_cost_check
  CHECK (rental_monthly_cost IS NULL OR rental_monthly_cost >= 0);

CREATE OR REPLACE FUNCTION private.save_fleet_vehicle(p_input jsonb, p_id uuid DEFAULT NULL::uuid, p_expected_version bigint DEFAULT NULL::bigint, p_archive_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t uuid:=public.get_my_tenant_id(); a uuid:=auth.uid(); v public.vehicles%ROWTYPE; n public.vehicles%ROWTYPE; vid uuid:=coalesce(p_id,gen_random_uuid()); old_row jsonb; new_row jsonb; stamp timestamptz:=clock_timestamp();
BEGIN
 IF a IS NULL OR t IS NULL OR public.user_has_permission('vehicles',CASE WHEN p_archive_reason IS NOT NULL THEN 'delete' WHEN p_id IS NULL THEN 'create' ELSE 'update' END) IS NOT TRUE THEN RAISE EXCEPTION 'AUTH007: vehicle permission and verified session required'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('vehicle_code','plate_number','plate_type','make','model','year','color','chassis_number','engine_number','vin','status','condition_status','fuel_type','odometer_current','odometer_last_service','odometer_unit','purchase_date','warranty_expiry','insurance_expiry','insurance_provider','insurance_policy_number','inspection_expiry','registration_expiry','operating_card_expiry','primary_platform_id','transmission','seats','cargo_capacity','notes','tags','ownership_type','sequence_number','rental_company','rental_contract_end','rental_monthly_cost')) THEN RAISE EXCEPTION 'FLT002: invalid vehicle fields'; END IF;
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
  IF length(btrim(coalesce(n.plate_number,''))) NOT BETWEEN 2 AND 16 OR n.plate_number !~ '^([A-Z]{1,3}[ ]?[0-9]{1,4}|[ء-ي]{1,3}[ ]?[0-9]{1,4}|[0-9]{4,7})$' OR length(btrim(coalesce(n.make,''))) NOT BETWEEN 1 AND 100 OR length(btrim(coalesce(n.model,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FLT014: valid plate, make and model required'; END IF;
  IF n.odometer_current NOT BETWEEN 0 AND 5000000 OR (p_id IS NOT NULL AND n.odometer_current<v.odometer_current) OR n.odometer_last_service>n.odometer_current OR n.seats NOT BETWEEN 1 AND 100 OR n.cargo_capacity<0 OR length(coalesce(n.notes,''))>2000 THEN RAISE EXCEPTION 'FLT010: invalid vehicle values'; END IF;
  IF n.primary_platform_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.delivery_platforms WHERE id=n.primary_platform_id AND tenant_id=t AND deleted_at IS NULL) THEN RAISE EXCEPTION 'FLT009: platform must belong to this tenant'; END IF;
  IF (p_id IS NULL AND n.status NOT IN ('available','off_road','retired')) OR (p_id IS NOT NULL AND n.status IS DISTINCT FROM v.status AND (n.status NOT IN ('available','off_road','retired') OR v.current_driver_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.vehicle_assignments WHERE tenant_id=t AND vehicle_id=vid AND is_current AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.vehicle_maintenance_events WHERE tenant_id=t AND vehicle_id=vid AND deleted_at IS NULL AND status IN ('open','in_progress')))) THEN RAISE EXCEPTION 'FLT015: status is managed by active assignments and maintenance'; END IF;
  IF n.ownership_type IS NOT NULL AND n.ownership_type NOT IN ('company_owned','rented','driver_owned') THEN RAISE EXCEPTION 'FLT010: invalid vehicle ownership type'; END IF;
  IF n.sequence_number IS NOT NULL AND btrim(n.sequence_number) !~ '^[0-9]{6,10}$' THEN RAISE EXCEPTION 'FLT010: registration sequence number must be 6-10 digits'; END IF;
  IF n.ownership_type IS DISTINCT FROM 'rented' THEN n.rental_company:=NULL; n.rental_contract_end:=NULL; n.rental_monthly_cost:=NULL; END IF;
  IF length(coalesce(n.rental_company,''))>200 OR n.rental_monthly_cost<0 OR n.rental_monthly_cost>9999999.99 THEN RAISE EXCEPTION 'FLT010: invalid rental details'; END IF;
  n.sequence_number:=nullif(btrim(n.sequence_number),''); n.rental_company:=nullif(btrim(n.rental_company),'');
  n.vehicle_code:=coalesce(nullif(btrim(n.vehicle_code),''),'VEH-'||upper(substr(replace(vid::text,'-',''),1,10))); n.plate_number:=btrim(n.plate_number); n.make:=btrim(n.make); n.model:=btrim(n.model);
  IF p_id IS NULL THEN INSERT INTO public.vehicles SELECT n.*;
  ELSE UPDATE public.vehicles SET vehicle_code=n.vehicle_code,plate_number=n.plate_number,plate_type=n.plate_type,make=n.make,model=n.model,year=n.year,color=n.color,chassis_number=n.chassis_number,engine_number=n.engine_number,vin=n.vin,status=n.status,condition_status=n.condition_status,fuel_type=n.fuel_type,odometer_current=n.odometer_current,odometer_last_service=n.odometer_last_service,odometer_unit=n.odometer_unit,purchase_date=n.purchase_date,warranty_expiry=n.warranty_expiry,insurance_expiry=n.insurance_expiry,insurance_provider=n.insurance_provider,insurance_policy_number=n.insurance_policy_number,inspection_expiry=n.inspection_expiry,registration_expiry=n.registration_expiry,operating_card_expiry=n.operating_card_expiry,primary_platform_id=n.primary_platform_id,transmission=n.transmission,seats=n.seats,cargo_capacity=n.cargo_capacity,notes=n.notes,tags=n.tags,ownership_type=n.ownership_type,sequence_number=n.sequence_number,rental_company=n.rental_company,rental_contract_end=n.rental_contract_end,rental_monthly_cost=n.rental_monthly_cost,updated_by=a WHERE id=vid AND tenant_id=t; END IF;
  IF p_id IS NULL OR n.odometer_current>v.odometer_current THEN INSERT INTO public.vehicle_odometer_logs(tenant_id,vehicle_id,reading,recorded_by,notes) VALUES(t,vid,n.odometer_current,a,'Vehicle record observation'); END IF;
 END IF;
 SELECT to_jsonb(x) INTO new_row FROM public.vehicles x WHERE id=vid AND tenant_id=t;
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,a,'vehicles','vehicles',vid,CASE WHEN p_archive_reason IS NOT NULL THEN 'vehicle_archived' WHEN p_id IS NULL THEN 'vehicle_created' ELSE 'vehicle_updated' END,old_row,new_row||jsonb_build_object('archive_reason',p_archive_reason));
 RETURN jsonb_build_object('id',vid,'version',new_row->'version');
END; $function$;

NOTIFY pgrst,'reload schema';
COMMIT;
